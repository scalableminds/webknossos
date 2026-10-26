//! Annotation DAO access and runtime restrictions are distinct Scala contracts.
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{Executor, FromRow, Postgres, Transaction};

use super::dao;

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    sql::Requester,
    util::id::ObjectId,
};

pub(crate) use super::dao::{
    push_mutate_predicate, push_owned_or_shared_predicate, push_read_predicate,
};

#[derive(Debug, FromRow)]
pub struct AnnotationMetadata {
    pub id: ObjectId,
    pub dataset_id: ObjectId,
    pub task_id: Option<ObjectId>,
    pub owner_id: ObjectId,
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

pub async fn find<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
    user: Option<&AuthUser>,
    id: &ObjectId,
    global: bool,
) -> ApiResult<AnnotationMetadata> {
    find_optional(executor, user, id, global)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::annotation::MISSING))
}

/// AnnotationDAO.findOne under the requester's (or the global) access
/// context; `None` when the annotation is missing, deleted or unreadable,
/// so callers can attach their route-specific Scala message and status.
pub async fn find_optional<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
    user: Option<&AuthUser>,
    id: &ObjectId,
    global: bool,
) -> ApiResult<Option<AnnotationMetadata>> {
    dao::find_one(executor, Requester::from(user), id, global).await
}

/// Hold live annotation metadata through a mutation, see
/// [`dao::find_one_for_mutation`].
pub async fn lock_for_mutation(
    transaction: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<AnnotationMetadata> {
    dao::find_one_for_mutation(transaction, user, id)
        .await?
        .ok_or_else(|| ApiError::forbidden(crate::msg::annotation::EDIT_NOT_ALLOWED))
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

impl Restrictions {
    /// The subset Annotation.publicWrites renders as `restrictions`.
    pub fn public_json(&self) -> serde_json::Value {
        serde_json::json!({
            "allowAccess": self.allow_access,
            "allowUpdate": self.allow_update,
            "allowFinish": self.allow_finish,
            "allowDownload": self.allow_download,
        })
    }
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
