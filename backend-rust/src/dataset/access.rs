//! DatasetDAO read access and DatasetService edit access, shared by resource routes.
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    sql::{Arg, PushArg, Sql},
    util::id::ObjectId,
};

/// Datasets (alias `d`) of the requester's organization reachable through a
/// live team of it, directly or via a folder grant. Uncorrelated: depends only on `user`.
fn push_team_grant<'a>(q: &mut Sql<'a>, user: Arg<'a>, managers_only: bool) {
    let manager = if managers_only {
        " AND r.isTeamManager"
    } else {
        ""
    };
    q.push(
        "(d._organization IN (SELECT u._organization FROM webknossos.users_ u WHERE u._id = ",
    )
    .push_arg(user)
    .push(
        ") AND (
      d._id IN (SELECT dt._dataset FROM webknossos.dataset_allowedTeams dt
        JOIN webknossos.user_team_roles r ON r._team = dt._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = ",
    )
    .push_arg(user)
    .push(manager)
    .push(
        ")
      OR d._folder IN (SELECT fp._descendant FROM webknossos.folder_paths fp
        JOIN webknossos.folder_allowedTeams ft ON ft._folder = fp._ancestor
        JOIN webknossos.user_team_roles r ON r._team = ft._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = ",
    )
    .push_arg(user)
    .push(manager)
    .push(")))");
}

/// Datasets (alias `d`) of an organization the user administers or manages datasets of.
fn push_manager_grant<'a>(q: &mut Sql<'a>, user: Arg<'a>) {
    q.push("d._organization IN (SELECT u._organization FROM webknossos.users_ u WHERE u._id = ")
        .push_arg(user)
        .push(" AND (u.isAdmin OR u.isDatasetManager))");
}

/// DatasetDAO read access for a `datasets_` row aliased `d`. The user and
/// sharing-token grants are additive, as in URLSharing's fallback context. A
/// private-link token only grants access until the link expires
/// (DatasetDAO.anonymousReadAccessQ).
///
/// Team grants only count for live teams of the requesting (live) user's own organization,
/// which must also own the dataset. Every subquery is uncorrelated (`IN (…)` over sets that
/// depend only on the user and token), so PostgreSQL evaluates each once per statement as a
/// hashed subplan instead of once per dataset row; list queries over thousands of datasets
/// depend on this (DatasetDAO.readAccessQ uses the same shape).
pub fn push_read_predicate<'a>(q: &mut Sql<'a>, user: Arg<'a>, sharing_token: Option<&'a str>) {
    q.push("(d.isPublic OR ");
    push_manager_grant(q, user);
    q.push(" OR ");
    push_team_grant(q, user, false);
    if let Some(token) = sharing_token {
        q.push(" OR d.sharingToken = ")
            .push_bind(token)
            .push(
                " OR d._id IN (
    SELECT a._dataset FROM webknossos.annotation_privateLinks_ link
    JOIN webknossos.annotations_ a ON a._id = link._annotation
    WHERE link.accessToken = ",
            )
            .push_bind(token)
            .push(
                " AND (link.expirationDateTime IS NULL OR link.expirationDateTime > statement_timestamp()))",
            );
    }
    q.push(")");
}

/// DatasetService.isEditableBy for alias `d`. Being an uploader or superuser
/// alone does not grant editing. Admins and dataset managers may only edit
/// datasets of their own organization (isAdminOf, isDatasetManagerOf); callers
/// needing read access must check it separately, just like the Scala
/// controllers. Uncorrelated like [`push_read_predicate`].
pub fn push_edit_predicate<'a>(q: &mut Sql<'a>, user: Arg<'a>) {
    q.push("(");
    push_manager_grant(q, user);
    q.push(" OR ");
    push_team_grant(q, user, true);
    q.push(")");
}

pub async fn can_read(
    pool: &PgPool,
    user: Option<&AuthUser>,
    dataset_id: &ObjectId,
    sharing_token: Option<&str>,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = ");
    q.push_bind(dataset_id).push(" AND ");
    push_read_predicate(&mut q, user.map(|u| &u.id).into(), sharing_token);
    q.push(")");
    Ok(q.build_query_scalar().fetch_one(pool).await?)
}

pub async fn can_edit(pool: &PgPool, user: &AuthUser, dataset_id: &ObjectId) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = ");
    q.push_bind(dataset_id).push(" AND ");
    push_edit_predicate(&mut q, (&user.id).into());
    q.push(")");
    Ok(q.build_query_scalar().fetch_one(pool).await?)
}

/// Serialize dataset permission changes, and retain live teams/memberships
/// until commit so concurrent team deletion or membership revocation cannot
/// invalidate the grants between authorization and the write.
pub async fn lock_edit(
    transaction: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    dataset_id: &ObjectId,
    require_read: bool,
) -> ApiResult<()> {
    sqlx::query("SELECT _id FROM webknossos.datasets_ WHERE _id = $1 FOR UPDATE")
        .bind(dataset_id)
        .fetch_one(&mut **transaction)
        .await?;
    sqlx::query(
        "SELECT _id FROM webknossos.teams_ WHERE _organization = $1 ORDER BY _id FOR SHARE",
    )
    .bind(&user.organization_id)
    .fetch_all(&mut **transaction)
    .await?;
    sqlx::query(
        "SELECT _team FROM webknossos.user_team_roles WHERE _user = $1 ORDER BY _team FOR SHARE",
    )
    .bind(&user.id)
    .fetch_all(&mut **transaction)
    .await?;
    // Prevent an inherited folder grant changing while this write is in flight.
    sqlx::query("SELECT ft._folder FROM webknossos.folder_allowedTeams ft JOIN webknossos.folder_paths fp ON fp._ancestor = ft._folder JOIN webknossos.datasets_ d ON d._folder = fp._descendant WHERE d._id = $1 ORDER BY ft._folder, ft._team FOR SHARE OF ft, fp")
        .bind(dataset_id).fetch_all(&mut **transaction).await?;
    let mut q = Sql::new("SELECT ");
    push_read_predicate(&mut q, (&user.id).into(), None);
    q.push(", ");
    push_edit_predicate(&mut q, (&user.id).into());
    q.push(" FROM webknossos.datasets_ d WHERE d._id = ")
        .push_bind(dataset_id);
    let (read, edit): (bool, bool) = q.build_query_as().fetch_one(&mut **transaction).await?;
    if require_read && !read {
        return Err(ApiError::not_found(crate::msg::dataset::MISSING));
    }
    if !edit {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    Ok(())
}
