//! AnalyticsDAO and the user and dataset lookups that fill in an analytics event.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::AnalyticsEvent;
use crate::{error::ApiResult, util::id::ObjectId};

/// AnalyticsDAO.insertMany (one statement, like Play's multi-row VALUES).
pub(super) async fn insert_many(pool: &PgPool, events: &[AnalyticsEvent]) -> ApiResult<()> {
    let mut builder = sqlx::QueryBuilder::new(
        "INSERT INTO webknossos.analyticsEvents(_id, created, sessionId, eventType, eventProperties, _user, _organization, isOrganizationAdmin, isSuperUser, webknossosUri) ",
    );
    builder.push_values(events, |mut row, event| {
        row.push_bind(ObjectId::new())
            .push_bind(event.time)
            .push_bind(event.session_id)
            .push_bind(&event.event_type)
            .push_bind(Value::Object(event.event_properties.clone()))
            .push_bind(&event.user_id)
            .push_bind(&event.user_properties.organization_id)
            .push_bind(event.user_properties.is_organization_admin)
            .push_bind(event.user_properties.is_super_user)
            .push_bind(&event.user_properties.webknossos_uri);
    });
    builder.build().execute(pool).await?;
    Ok(())
}

/// Returns `(multiUser id, isSuperUser)` of the user's account.
pub(super) async fn find_multi_user_and_super_user_flag(
    pool: &PgPool,
    user_id: &ObjectId,
) -> ApiResult<(ObjectId, bool)> {
    Ok(sqlx::query_as(
        "SELECT m._id, m.isSuperUser FROM webknossos.users u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?)
}

/// Returns `(multiUser id, organization id, isAdmin, isSuperUser)` of the user.
pub(super) async fn find_actor_fields(
    pool: &PgPool,
    user_id: &ObjectId,
) -> ApiResult<(ObjectId, String, bool, bool)> {
    Ok(sqlx::query_as(
        "SELECT m._id, u._organization, u.isAdmin, m.isSuperUser FROM webknossos.users u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?)
}

/// Returns `(name, organization id, uploader)` of the dataset.
pub(super) async fn find_name_organization_and_uploader(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> ApiResult<(String, String, Option<ObjectId>)> {
    Ok(sqlx::query_as(
        "SELECT name, _organization, _uploader FROM webknossos.datasets WHERE _id = $1",
    )
    .bind(dataset_id)
    .fetch_one(pool)
    .await?)
}

pub(super) async fn find_multi_user_id(pool: &PgPool, user_id: ObjectId) -> ApiResult<ObjectId> {
    Ok(
        sqlx::query_scalar::<_, ObjectId>(
            "SELECT _multiUser FROM webknossos.users_ WHERE _id = $1",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?,
    )
}

/// UserDAO.findOldestActive: the id of the oldest active user.
pub(super) async fn find_oldest_active_user_id(
    connection: &mut PgConnection,
) -> Result<Option<ObjectId>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT _id FROM webknossos.users_ WHERE NOT isDeactivated ORDER BY created LIMIT 1",
    )
    .fetch_optional(connection)
    .await
}
