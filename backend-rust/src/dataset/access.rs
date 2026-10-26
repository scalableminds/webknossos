//! DatasetDAO read access and DatasetService edit access, shared by resource routes.
use sqlx::{PgPool, Postgres, Transaction};

use super::dao;
use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    util::id::ObjectId,
};

pub use super::dao::{push_edit_predicate, push_read_predicate};

pub async fn can_read(
    pool: &PgPool,
    user: Option<&AuthUser>,
    dataset_id: &ObjectId,
    sharing_token: Option<&str>,
) -> ApiResult<bool> {
    dao::is_readable(pool, user, dataset_id, sharing_token).await
}

pub async fn can_edit(pool: &PgPool, user: &AuthUser, dataset_id: &ObjectId) -> ApiResult<bool> {
    dao::is_editable(pool, user, dataset_id).await
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
    dao::find_id_for_update(transaction, dataset_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    dao::lock_organization_teams(transaction, &user.organization_id).await?;
    dao::lock_user_team_roles(transaction, &user.id).await?;
    // Prevent an inherited folder grant changing while this write is in flight.
    dao::lock_inherited_folder_grants(transaction, dataset_id).await?;
    let (read, edit) = dao::read_and_edit_access(transaction, &user.id, dataset_id).await?;
    if require_read && !read {
        return Err(ApiError::not_found(crate::msg::dataset::MISSING));
    }
    if !edit {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    Ok(())
}
