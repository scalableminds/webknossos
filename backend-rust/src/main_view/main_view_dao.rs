//! Queries behind the main view: the requester's theme, short links and readable datasets.
use sqlx::PgPool;

use crate::{auth::AuthUser, dataset::access::push_read_predicate, sql::Sql, util::id::ObjectId};

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct DatasetName {
    pub id: ObjectId,
    pub name: String,
}

/// MultiUserDAO.findOne(user._multiUser).selectedTheme.
pub(crate) async fn find_selected_theme(
    pool: &PgPool,
    user_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT multi.selectedTheme::TEXT FROM webknossos.users_ AS usr \
         JOIN webknossos.multiUsers_ AS multi ON multi._id = usr._multiUser WHERE usr._id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

/// ShortLinkDAO.findOneByKey(key).longLink.
pub(crate) async fn find_long_link(pool: &PgPool, key: &str) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT longLink FROM webknossos.shortLinks WHERE key = $1")
        .bind(key)
        .fetch_optional(pool)
        .await
}

/// DatasetDAO.findOne under the requester's access, extended by the sharing token.
pub(crate) async fn find_readable_dataset(
    pool: &PgPool,
    user: Option<&AuthUser>,
    id: &ObjectId,
    sharing_token: Option<&str>,
) -> sqlx::Result<Option<DatasetName>> {
    let mut q = Sql::new("SELECT d._id AS id, d.name FROM webknossos.datasets_ d WHERE d._id = ");
    q.push_bind(id).push(" AND ");
    push_read_predicate(&mut q, user.map(|u| &u.id).into(), sharing_token);
    q.build_query_as().fetch_optional(pool).await
}

/// DatasetDAO.findOneByNameAndOrganization (legacy `/datasets/<organization>/<directory name>`).
pub(crate) async fn find_readable_dataset_by_directory_name(
    pool: &PgPool,
    user: Option<&AuthUser>,
    organization_id: &str,
    directory_name: &str,
    sharing_token: Option<&str>,
) -> sqlx::Result<Option<DatasetName>> {
    let mut q =
        Sql::new("SELECT d._id AS id, d.name FROM webknossos.datasets_ d WHERE d.directoryName = ");
    q.push_bind(directory_name)
        .push(" AND d._organization = ")
        .push_bind(organization_id)
        .push(" AND ");
    push_read_predicate(&mut q, user.map(|u| &u.id).into(), sharing_token);
    q.push(" ORDER BY d.created ASC LIMIT 1");
    q.build_query_as().fetch_optional(pool).await
}

/// The first color layer of DatasetLayerDAO.findAllForDataset (ordered by name).
pub(crate) async fn find_first_color_layer(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT name FROM webknossos.dataset_layers WHERE _dataset = $1 AND category = 'color' \
         ORDER BY name LIMIT 1",
    )
    .bind(dataset_id)
    .fetch_optional(pool)
    .await
}
