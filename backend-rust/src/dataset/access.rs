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
pub const READ_PREDICATE: &str = r#"(
  d.isPublic
  OR EXISTS (SELECT 1 FROM webknossos.users_ u WHERE u._id = $1
    AND u._organization = d._organization AND (u.isAdmin OR u.isDatasetManager))
  OR EXISTS (SELECT 1 FROM webknossos.dataset_allowedTeams dt
    JOIN webknossos.user_team_roles r ON r._team = dt._team
    JOIN webknossos.teams_ t ON t._id = r._team AND t._organization = d._organization
    JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
    WHERE dt._dataset = d._id AND r._user = $1)
  OR EXISTS (SELECT 1 FROM webknossos.folder_paths fp
    JOIN webknossos.folder_allowedTeams ft ON ft._folder = fp._ancestor
    JOIN webknossos.user_team_roles r ON r._team = ft._team
    JOIN webknossos.teams_ t ON t._id = r._team AND t._organization = d._organization
    JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
    WHERE fp._descendant = d._folder AND r._user = $1)
  OR ($2::text IS NOT NULL AND (d.sharingToken = $2 OR EXISTS (
    SELECT 1 FROM webknossos.annotation_privateLinks_ link
    JOIN webknossos.annotations_ a ON a._id = link._annotation
    WHERE a._dataset = d._id AND link.accessToken = $2)))
)"#;

/// SQL predicate for DatasetService.isEditableBy. Bind $1 user id. Being an
/// uploader or superuser alone does not grant editing. Dataset managers are
/// allowed by the service independently of organization; callers needing read
/// access must check it separately, just like the Scala controllers.
pub const EDIT_PREDICATE: &str = r#"EXISTS (
  SELECT 1 FROM webknossos.users_ u WHERE u._id = $1 AND (
    (u.isAdmin AND u._organization = d._organization) OR u.isDatasetManager
    OR EXISTS (SELECT 1 FROM webknossos.dataset_allowedTeams dt
      JOIN webknossos.user_team_roles r ON r._team = dt._team
      JOIN webknossos.teams_ t ON t._id = r._team AND t._organization = d._organization AND t._organization = u._organization
      WHERE dt._dataset = d._id AND r._user = u._id AND r.isTeamManager)
    OR EXISTS (SELECT 1 FROM webknossos.folder_paths fp
      JOIN webknossos.folder_allowedTeams ft ON ft._folder = fp._ancestor
      JOIN webknossos.user_team_roles r ON r._team = ft._team
      JOIN webknossos.teams_ t ON t._id = r._team AND t._organization = d._organization AND t._organization = u._organization
      WHERE fp._descendant = d._folder AND r._user = u._id AND r.isTeamManager)
  )
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
        return Err(ApiError::not_found("Dataset not found."));
    }
    if !edit {
        return Err(ApiError::forbidden("Not allowed."));
    }
    Ok(())
}
