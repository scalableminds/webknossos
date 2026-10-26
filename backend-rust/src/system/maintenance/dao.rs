//! MaintenanceDAO: the maintenance window queries.
use chrono::{DateTime, Utc};
use sqlx::PgPool;

use super::Maintenance;
use crate::{error::ApiResult, sql::Sql, util::id::ObjectId};

const COLUMNS: &str = "_id AS id, startTime AS start_time, endTime AS end_time, message";

pub(super) async fn find_all_current_and_upcoming(pool: &PgPool) -> ApiResult<Vec<Maintenance>> {
    let query = format!(
        "SELECT {COLUMNS} FROM webknossos.maintenances_ WHERE endTime >= NOW() ORDER BY startTime, _id"
    );
    Ok(sqlx::query_as(&query).fetch_all(pool).await?)
}

pub(super) async fn find_all(pool: &PgPool) -> ApiResult<Vec<Maintenance>> {
    let query = format!("SELECT {COLUMNS} FROM webknossos.maintenances_ ORDER BY startTime, _id");
    Ok(sqlx::query_as(&query).fetch_all(pool).await?)
}

pub(super) async fn find_one(pool: &PgPool, id: &ObjectId) -> ApiResult<Option<Maintenance>> {
    let mut q = Sql::new("SELECT ");
    q.push(COLUMNS)
        .push(" FROM webknossos.maintenances_ WHERE _id=")
        .push_bind(id);
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

pub(super) async fn insert_one(
    pool: &PgPool,
    user_id: &ObjectId,
    start_time: DateTime<Utc>,
    end_time: DateTime<Utc>,
    message: String,
) -> ApiResult<Maintenance> {
    let mut q = Sql::new(
        "INSERT INTO webknossos.maintenances (_id, _user, startTime, endTime, message) VALUES (",
    );
    let mut values = q.separated(",");
    values
        .push_bind(ObjectId::new())
        .push_bind(user_id)
        .push_bind(start_time)
        .push_bind(end_time)
        .push_bind(message);
    q.push(") RETURNING ").push(COLUMNS);
    Ok(q.build_query_as().fetch_one(pool).await?)
}

pub(super) async fn update_one(
    pool: &PgPool,
    id: &ObjectId,
    start_time: DateTime<Utc>,
    end_time: DateTime<Utc>,
    message: String,
) -> ApiResult<Option<Maintenance>> {
    let mut q = Sql::new("UPDATE webknossos.maintenances SET startTime=");
    q.push_bind(start_time)
        .push(", endTime=")
        .push_bind(end_time)
        .push(", message=")
        .push_bind(message)
        .push(" WHERE _id=")
        .push_bind(id)
        .push(" AND NOT isDeleted RETURNING ")
        .push(COLUMNS);
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

/// Returns the number of deleted rows.
pub(super) async fn delete_one(pool: &PgPool, id: &ObjectId) -> ApiResult<u64> {
    Ok(sqlx::query(
        "UPDATE webknossos.maintenances SET isDeleted=TRUE WHERE _id=$1 AND NOT isDeleted",
    )
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected())
}
