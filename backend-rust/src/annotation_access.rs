//! Annotation DAO access and runtime restrictions are distinct Scala contracts.
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{Executor, FromRow, Postgres, Transaction};

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    id::ObjectId,
};

/// AnnotationDAO.readAccessQ: alias `a`, $1 requester id, $2 organization,
/// $3 organization administrator. Dataset access is not part of this grant.
pub const READ_PREDICATE: &str = r#"(a.visibility='Public' OR
    (a.visibility='Internal' AND EXISTS(SELECT 1 FROM webknossos.users_ owner WHERE owner._id=a._user AND owner._organization=$2)) OR
    (a.visibility='Private' AND (a._user=$1 OR ($3 AND EXISTS(SELECT 1 FROM webknossos.users_ owner WHERE owner._id=a._user AND owner._organization=$2)))))"#;

/// AnnotationDAO update/delete grants ignore state, collaboration mode and
/// owner lock. Runtime editing/finishing restrictions below additionally check these.
pub const MUTATE_PREDICATE: &str = r#"(a._user=$1 OR
    ($3 AND EXISTS(SELECT 1 FROM webknossos.users_ owner WHERE owner._id=a._user AND owner._organization=$2)) OR
    EXISTS(SELECT 1 FROM webknossos.tasks_ task JOIN webknossos.projects_ project ON project._id=task._project
      JOIN webknossos.teams_ team ON team._id=project._team AND team._organization=$2
      JOIN webknossos.user_team_roles role ON role._team=team._id AND role._user=$1 AND role.isteammanager
      WHERE task._id=a._task AND project._organization=$2))"#;

/// Annotation list ownership/sharing grant. Shared annotations also require
/// dataset read access; callers must add that predicate themselves. Bind $1
/// requester id and $2 requester organization for live team grant scoping.
pub const OWNED_OR_SHARED_PREDICATE: &str = r#"(a._user=$1 OR
    (a.visibility IN ('Public','Internal') AND (
      EXISTS(SELECT 1 FROM webknossos.annotation_sharedTeams shared JOIN webknossos.teams_ team ON team._id=shared._team AND team._organization=$2 JOIN webknossos.user_team_roles role ON role._team=team._id WHERE shared._annotation=a._id AND role._user=$1) OR
      EXISTS(SELECT 1 FROM webknossos.annotation_contributors contributor WHERE contributor._annotation=a._id AND contributor._user=$1))))"#;

#[derive(Debug, FromRow)]
pub struct AnnotationMetadata {
    pub id: String,
    pub dataset_id: String,
    pub task_id: Option<String>,
    pub owner_id: String,
    pub owner_organization: Option<String>,
    pub name: String,
    pub description: String,
    pub visibility: String,
    pub state: String,
    pub annotation_type: String,
    pub collaboration_mode: String,
    pub is_locked_by_owner: bool,
    pub tags: Vec<String>,
    pub tracing_time: Option<i64>,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
    pub requester_manages_task_team: bool,
    pub task_context_available: bool,
    pub requester_has_mutex: bool,
}

const SELECT: &str = r#"SELECT a._id AS id,a._dataset AS dataset_id,a._task AS task_id,a._user AS owner_id,
    (SELECT _organization FROM webknossos.users_ WHERE _id=a._user) AS owner_organization,
    a.name,a.description,a.visibility::text,a.state::text,a.typ::text AS annotation_type,
    a.collaborationMode::text AS collaboration_mode,a.isLockedByOwner AS is_locked_by_owner,
    a.tags,a.tracingTime AS tracing_time,a.created,a.modified,
    EXISTS(SELECT 1 FROM webknossos.tasks_ task JOIN webknossos.projects_ project ON project._id=task._project
      JOIN webknossos.teams_ team ON team._id=project._team AND team._organization=$2
      JOIN webknossos.user_team_roles role ON role._team=team._id AND role._user=$1 AND role.isteammanager
      WHERE task._id=a._task AND project._organization=$2) AS requester_manages_task_team,
    (a._task IS NULL OR EXISTS(SELECT 1 FROM webknossos.tasks_ task JOIN webknossos.projects_ project ON project._id=task._project WHERE task._id=a._task)) AS task_context_available,
    EXISTS(SELECT 1 FROM webknossos.annotation_mutexes mutex WHERE mutex._annotation=a._id AND mutex._user=$1 AND mutex.expiry>statement_timestamp()) AS requester_has_mutex
    FROM webknossos.annotations a WHERE NOT a.isDeleted AND a._id=$4 "#;

pub async fn find<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
    user: Option<&AuthUser>,
    id: &str,
    global: bool,
) -> ApiResult<AnnotationMetadata> {
    find_optional(executor, user, id, global)
        .await?
        .ok_or_else(|| ApiError::not_found("Annotation not found."))
}

/// AnnotationDAO.findOne under the requester's (or the global) access
/// context; `None` when the annotation is missing, deleted or unreadable,
/// so callers can attach their route-specific Scala message and status.
pub async fn find_optional<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
    user: Option<&AuthUser>,
    id: &str,
    global: bool,
) -> ApiResult<Option<AnnotationMetadata>> {
    ObjectId::parse(id)?;
    Ok(
        sqlx::query_as(&format!("{SELECT} AND ($5 OR {READ_PREDICATE})"))
            .bind(user.map(|u| u.id.as_str()))
            .bind(user.map(|u| u.organization_id.as_str()))
            .bind(user.is_some_and(|u| u.is_admin))
            .bind(id)
            .bind(global)
            .fetch_optional(executor)
            .await?,
    )
}

/// Hold live annotation metadata through a mutation. FOR SHARE conflicts with
/// soft deletion and owner changes, unlike FOR KEY SHARE.
pub async fn lock_for_mutation(
    transaction: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    id: &str,
) -> ApiResult<AnnotationMetadata> {
    ObjectId::parse(id)?;
    sqlx::query_as(&format!("{SELECT} AND {MUTATE_PREDICATE} FOR SHARE OF a"))
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(id)
        .fetch_optional(&mut **transaction)
        .await?
        .ok_or_else(|| ApiError::forbidden("You are not allowed to edit this annotation."))
}

/// Readable live annotation metadata (AnnotationDAO read access), row-locked
/// FOR NO KEY UPDATE so runtime restrictions re-checked inside the
/// transaction stay valid until commit (conflicts with soft deletion, owner,
/// state and lock changes). `None` when missing, deleted or unreadable.
pub async fn lock_readable(
    transaction: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    id: &str,
) -> ApiResult<Option<AnnotationMetadata>> {
    ObjectId::parse(id)?;
    Ok(sqlx::query_as(&format!(
        "{SELECT} AND {READ_PREDICATE} FOR NO KEY UPDATE OF a"
    ))
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(id)
    .fetch_optional(&mut **transaction)
    .await?)
}

/// AnnotationDAO.assertUpdateAccess on the live row (owner, owner-organization
/// admin or task project-team manager; state, lock and collaboration mode are
/// ignored), row-locked FOR NO KEY UPDATE through the transaction.
pub async fn lock_update_access(
    transaction: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    id: &str,
) -> ApiResult<bool> {
    ObjectId::parse(id)?;
    let found: Option<String> = sqlx::query_scalar(&format!(
        "SELECT a._id FROM webknossos.annotations a WHERE NOT a.isDeleted AND a._id=$4 AND {MUTATE_PREDICATE} FOR NO KEY UPDATE OF a"
    ))
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(id)
    .fetch_optional(&mut **transaction)
    .await?;
    Ok(found.is_some())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restrictions {
    pub allow_access: bool,
    pub allow_update: bool,
    pub allow_update_with_mutex: bool,
    pub allow_finish: bool,
    pub allow_finish_soft: bool,
    pub allow_download: bool,
}

/// AnnotationRestrictionDefaults, independent of AnnotationDAO read access.
/// In particular task managers can access private task annotations through
/// restrictions while the DAO read predicate itself grants only owners/admins.
pub fn restrictions(annotation: &AnnotationMetadata, user: Option<&AuthUser>) -> Restrictions {
    let owned = user.is_some_and(|u| u.id == annotation.owner_id);
    let same_org = user.is_some_and(|u| {
        annotation.owner_organization.as_deref() == Some(u.organization_id.as_str())
    });
    let manager_or_admin =
        user.is_some_and(|u| (u.is_admin && same_org) || annotation.requester_manages_task_team);
    let allow_access = match annotation.visibility.as_str() {
        "Public" => true,
        "Internal" => same_org,
        "Private" => {
            annotation.owner_organization.is_some()
                && annotation.task_context_available
                && (owned || manager_or_admin)
        }
        _ => false,
    };
    let mutable = annotation.state != "Finished" && !annotation.is_locked_by_owner;
    let others_may_edit = matches!(
        annotation.collaboration_mode.as_str(),
        "Exclusive" | "Concurrent"
    );
    let allow_update = user.is_some()
        && mutable
        && if others_may_edit {
            same_org && allow_access
        } else {
            owned
        };
    let allow_finish_soft = annotation.owner_organization.is_some()
        && annotation.task_context_available
        && !annotation.is_locked_by_owner
        && (owned || manager_or_admin);
    Restrictions {
        allow_access,
        allow_update,
        allow_update_with_mutex: allow_update
            && (!others_may_edit || annotation.requester_has_mutex),
        allow_finish: allow_finish_soft && annotation.state != "Finished",
        allow_finish_soft,
        allow_download: allow_access,
    }
}
