//! DatasetDAO read access and DatasetService edit access, shared by resource routes.
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
};

/// SQL predicate for a `datasets_` row aliased `d`. Bind $1 user id and $2
/// optional sharing token. Both grants are additive, as in URLSharing's fallback
/// context. A private-link expiration is deliberately not tested here: Scala's
/// dataset predicate uses annotation_privateLinks_ without an expiration filter.
///
/// Team grants only count for live teams of the requesting (live) user's own organization,
/// which must also own the dataset. Every subquery is uncorrelated (`IN (…)` over sets that
/// depend only on $1/$2), so PostgreSQL evaluates each once per statement as a hashed
/// subplan instead of once per dataset row; list queries over thousands of datasets depend
/// on this (DatasetDAO.readAccessQ uses the same shape).
pub const READ_PREDICATE: &str = r#"(
  d.isPublic
  OR d._organization IN (SELECT u._organization FROM webknossos.users_ u
    WHERE u._id = $1 AND (u.isAdmin OR u.isDatasetManager))
  OR (d._organization IN (SELECT u._organization FROM webknossos.users_ u WHERE u._id = $1)
    AND (
      d._id IN (SELECT dt._dataset FROM webknossos.dataset_allowedTeams dt
        JOIN webknossos.user_team_roles r ON r._team = dt._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = $1)
      OR d._folder IN (SELECT fp._descendant FROM webknossos.folder_paths fp
        JOIN webknossos.folder_allowedTeams ft ON ft._folder = fp._ancestor
        JOIN webknossos.user_team_roles r ON r._team = ft._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = $1)))
  OR ($2::text IS NOT NULL AND (d.sharingToken = $2 OR d._id IN (
    SELECT a._dataset FROM webknossos.annotation_privateLinks_ link
    JOIN webknossos.annotations_ a ON a._id = link._annotation
    WHERE link.accessToken = $2)))
)"#;

/// SQL predicate for DatasetService.isEditableBy. Bind $1 user id. Being an
/// uploader or superuser alone does not grant editing. Dataset managers are
/// allowed by the service independently of organization; callers needing read
/// access must check it separately, just like the Scala controllers.
/// Uncorrelated like [`READ_PREDICATE`].
pub const EDIT_PREDICATE: &str = r#"(
  EXISTS (SELECT 1 FROM webknossos.users_ u WHERE u._id = $1 AND u.isDatasetManager)
  OR d._organization IN (SELECT u._organization FROM webknossos.users_ u WHERE u._id = $1 AND u.isAdmin)
  OR (d._organization IN (SELECT u._organization FROM webknossos.users_ u WHERE u._id = $1)
    AND (
      d._id IN (SELECT dt._dataset FROM webknossos.dataset_allowedTeams dt
        JOIN webknossos.user_team_roles r ON r._team = dt._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = $1 AND r.isTeamManager)
      OR d._folder IN (SELECT fp._descendant FROM webknossos.folder_paths fp
        JOIN webknossos.folder_allowedTeams ft ON ft._folder = fp._ancestor
        JOIN webknossos.user_team_roles r ON r._team = ft._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = $1 AND r.isTeamManager)))
)"#;

/// `isEditable` of the compact dataset list (DatasetDAO.findAllCompactWithSearch): like
/// [`EDIT_PREDICATE`], but any member (not only managers) of a team with access to the
/// dataset's folder or an ancestor counts. Informational only; mutations use can_edit.
pub const COMPACT_EDIT_PREDICATE: &str = r#"(
  EXISTS (SELECT 1 FROM webknossos.users_ u WHERE u._id = $1 AND u.isDatasetManager)
  OR d._organization IN (SELECT u._organization FROM webknossos.users_ u WHERE u._id = $1 AND u.isAdmin)
  OR (d._organization IN (SELECT u._organization FROM webknossos.users_ u WHERE u._id = $1)
    AND (
      d._id IN (SELECT dt._dataset FROM webknossos.dataset_allowedTeams dt
        JOIN webknossos.user_team_roles r ON r._team = dt._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = $1 AND r.isTeamManager)
      OR d._folder IN (SELECT fp._descendant FROM webknossos.folder_paths fp
        JOIN webknossos.folder_allowedTeams ft ON ft._folder = fp._ancestor
        JOIN webknossos.user_team_roles r ON r._team = ft._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = $1)))
)"#;

pub async fn can_read(
    pool: &PgPool,
    user: Option<&AuthUser>,
    dataset_id: &str,
    sharing_token: Option<&str>,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = $3 AND {READ_PREDICATE})"
    ))
    .bind(user.map(|u| u.id.as_str()))
    .bind(sharing_token)
    .bind(dataset_id)
    .fetch_one(pool)
    .await?)
}

pub async fn can_edit(pool: &PgPool, user: &AuthUser, dataset_id: &str) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = $2 AND {EDIT_PREDICATE})"
    ))
    .bind(&user.id)
    .bind(dataset_id)
    .fetch_one(pool)
    .await?)
}

/// Serialize dataset permission changes, and retain live teams/memberships
/// until commit so concurrent team deletion or membership revocation cannot
/// invalidate the grants between authorization and the write.
pub async fn lock_edit(
    transaction: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    dataset_id: &str,
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
    let (read, edit): (bool, bool) = sqlx::query_as(&format!(
        "SELECT {READ_PREDICATE}, {EDIT_PREDICATE} FROM webknossos.datasets_ d WHERE d._id = $3"
    ))
    .bind(&user.id)
    .bind(Option::<&str>::None)
    .bind(dataset_id)
    .fetch_one(&mut **transaction)
    .await?;
    if require_read && !read {
        return Err(ApiError::not_found(crate::msg::dataset::MISSING));
    }
    if !edit {
        return Err(ApiError::forbidden("Not allowed."));
    }
    Ok(())
}
