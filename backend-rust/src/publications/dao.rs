//! PublicationDAO: the publication queries and the datasets, annotations and
//! tracing store looked up for rendering them.
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

use crate::{sql::Sql, util::id::ObjectId};

#[derive(sqlx::FromRow)]
pub(crate) struct Publication {
    pub(crate) id: ObjectId,
    pub(crate) publication_date: Option<DateTime<Utc>>,
    pub(crate) image_url: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) created: DateTime<Utc>,
}

const COLUMNS: &str = "_id AS id, publicationDate AS publication_date, imageUrl AS image_url, title, description, created";

pub(crate) async fn find_one(pool: &PgPool, id: &ObjectId) -> sqlx::Result<Option<Publication>> {
    Sql::new("SELECT ")
        .push(COLUMNS)
        .push(" FROM webknossos.publications_ WHERE _id = ")
        .push_bind(id)
        .build_query_as()
        .fetch_optional(pool)
        .await
}

pub(crate) async fn find_all(pool: &PgPool) -> sqlx::Result<Vec<Publication>> {
    // Scala has no ORDER BY; creation order is the deterministic equivalent.
    Sql::new("SELECT ")
        .push(COLUMNS)
        .push(" FROM webknossos.publications_ ORDER BY created, _id")
        .build_query_as()
        .fetch_all(pool)
        .await
}

pub(crate) async fn find_dataset_ids_for_publication(
    connection: &mut PgConnection,
    publication_id: &ObjectId,
) -> sqlx::Result<Vec<ObjectId>> {
    sqlx::query_scalar(
        "SELECT _id FROM webknossos.datasets_ WHERE _publication = $1 ORDER BY created, _id",
    )
    .bind(publication_id)
    .fetch_all(connection)
    .await
}

/// Returns `(id, name, description, typ, dataset id)` per annotation.
pub(crate) async fn find_annotations_for_publication(
    connection: &mut PgConnection,
    publication_id: &ObjectId,
) -> sqlx::Result<Vec<(ObjectId, String, String, String, ObjectId)>> {
    sqlx::query_as(
        r#"SELECT _id, name, description, typ::text, _dataset FROM webknossos.annotations_
          WHERE _publication = $1 ORDER BY created, _id"#,
    )
    .bind(publication_id)
    .fetch_all(connection)
    .await
}

pub(crate) async fn dataset_exists(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id = $1)")
        .bind(dataset_id)
        .fetch_one(connection)
        .await
}

/// TracingStoreDAO.findFirst: the name and public URL of the first tracing store.
pub(crate) async fn find_first_tracing_store(
    connection: &mut PgConnection,
) -> sqlx::Result<Option<(String, String)>> {
    sqlx::query_as("SELECT name, publicUrl FROM webknossos.tracingStores_ LIMIT 1")
        .fetch_optional(connection)
        .await
}
