//! ShortLinkDAO: the short link queries.
use sqlx::PgPool;

use super::ShortLink;
use crate::util::id::ObjectId;

pub(crate) async fn insert_one(
    pool: &PgPool,
    id: ObjectId,
    key: String,
    long_link: String,
) -> sqlx::Result<ShortLink> {
    sqlx::query_as("INSERT INTO webknossos.shortLinks (_id,key,longLink) VALUES ($1,$2,$3) RETURNING _id,key,longLink AS long_link")
        .bind(id).bind(key).bind(long_link).fetch_one(pool).await
}

pub(crate) async fn find_one_by_key(pool: &PgPool, key: String) -> sqlx::Result<Option<ShortLink>> {
    sqlx::query_as("SELECT _id,key,longLink AS long_link FROM webknossos.shortLinks WHERE key=$1")
        .bind(key)
        .fetch_optional(pool)
        .await
}
