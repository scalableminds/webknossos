//! Dataset and organization lookups for uploaded annotations.
use sqlx::PgPool;

use crate::{dataset::access::push_read_predicate, error::ApiResult, sql::Sql, util::id::ObjectId};

/// A dataset's id, name and organization.
pub(crate) type DatasetRow = (ObjectId, String, String);

/// `DatasetDAO.findOne(id)` with the user's read access (`datasets_`, i.e. not
/// deleted).
pub(crate) async fn find_readable_dataset(
    pool: &PgPool,
    user_id: &ObjectId,
    dataset_id: &ObjectId,
) -> ApiResult<Option<DatasetRow>> {
    let mut q = Sql::new(
        "SELECT d._id, d.name, d._organization FROM webknossos.datasets_ d
         WHERE d._id = ",
    );
    q.push_bind(dataset_id).push(" AND ");
    push_read_predicate(&mut q, user_id.into(), None);
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

/// The oldest readable dataset with this directory name in the organization.
pub(crate) async fn find_one_by_directory_name_and_organization(
    pool: &PgPool,
    user_id: &ObjectId,
    directory_name: &str,
    organization_id: &str,
) -> ApiResult<Option<DatasetRow>> {
    let mut q = Sql::new(
        "SELECT d._id, d.name, d._organization FROM webknossos.datasets_ d
         WHERE d.directoryName = ",
    );
    q.push_bind(directory_name)
        .push(" AND d._organization = ")
        .push_bind(organization_id)
        .push(" AND ");
    push_read_predicate(&mut q, user_id.into(), None);
    q.push(" ORDER BY d.created ASC LIMIT 1");
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

/// Up to two readable datasets with this name in the organization, enough to
/// tell whether the name is unique.
pub(crate) async fn find_up_to_two_by_name_and_organization(
    pool: &PgPool,
    user_id: &ObjectId,
    name: &str,
    organization_id: &str,
) -> ApiResult<Vec<DatasetRow>> {
    let mut q = Sql::new(
        "SELECT d._id, d.name, d._organization FROM webknossos.datasets_ d
         WHERE d.name = ",
    );
    q.push_bind(name)
        .push(" AND d._organization = ")
        .push_bind(organization_id)
        .push(" AND ");
    push_read_predicate(&mut q, user_id.into(), None);
    q.push(" LIMIT 2");
    Ok(q.build_query_as().fetch_all(pool).await?)
}

pub(crate) async fn organization_exists(pool: &PgPool, organization_id: &str) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ WHERE _id = $1)",
        )
        .bind(organization_id)
        .fetch_one(pool)
        .await?,
    )
}

/// The organization of the dataset (no access predicate).
pub(crate) async fn find_organization_id_for_dataset(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT o._id FROM webknossos.organizations_ o
             JOIN webknossos.datasets_ d ON o._id = d._organization WHERE d._id = $1",
    )
    .bind(dataset_id)
    .fetch_optional(pool)
    .await?)
}
