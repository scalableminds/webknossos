//! The queries of job submission: dataset, organization, datastore, layer and
//! worker lookups, the storage quota, and the job and credit transaction inserts.
//!
//! Callers own the connection and transaction; these functions only run SQL and
//! return rows. Mapping a missing row to an error is up to the caller. They return
//! `sqlx::Result` because the callers convert database errors themselves.
use sqlx::{PgConnection, PgPool};

use crate::{dataset::access::push_read_predicate, sql::Sql, util::id::ObjectId};
use serde_json::Value;

#[derive(sqlx::FromRow)]
pub(crate) struct Dataset {
    pub(crate) id: ObjectId,
    pub(crate) name: String,
    pub(crate) directory_name: String,
    pub(crate) organization: String,
    pub(crate) data_store: String,
    pub(crate) is_usable: bool,
    pub(crate) has_voxel_size: bool,
    pub(crate) voxel_size_factor: Option<Vec<f64>>,
    pub(crate) voxel_size_unit: Option<String>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct LayerRow {
    pub(crate) name: String,
    pub(crate) bounding_box: Vec<i32>,
    pub(crate) finest_mag: Option<Vec<i32>>,
}

/// DatasetDAO.findOne with the user's access.
pub(crate) async fn find_one_readable_dataset(
    pool: &PgPool,
    user_id: &ObjectId,
    id: &ObjectId,
) -> sqlx::Result<Option<Dataset>> {
    let mut q = Sql::new(
        r#"SELECT d._id AS id, d.name, d.directoryName AS directory_name, d._organization AS organization,
            d._dataStore AS data_store, d.isUsable AS is_usable, d.voxelSizeFactor IS NOT NULL AS has_voxel_size,
            CASE WHEN d.voxelSizeFactor IS NULL THEN NULL ELSE ARRAY[(d.voxelSizeFactor).x, (d.voxelSizeFactor).y,
              (d.voxelSizeFactor).z]::float8[] END AS voxel_size_factor, d.voxelSizeUnit::text AS voxel_size_unit
          FROM webknossos.datasets_ d WHERE d._id = "#,
    );
    q.push_bind(id).push(" AND ");
    push_read_predicate(&mut q, user_id.into(), None);
    q.build_query_as().fetch_optional(pool).await
}

/// OrganizationDAO.findOne with global access: the organization id.
pub(crate) async fn find_organization_id(
    pool: &PgPool,
    organization: &str,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT _id FROM webknossos.organizations_ WHERE _id = $1")
        .bind(organization)
        .fetch_optional(pool)
        .await
}

/// DataStoreDAO.findOneByName with the user's access: the internal URL.
pub(crate) async fn find_data_store_url_for_user(
    pool: &PgPool,
    name: &str,
    user_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        r#"SELECT url FROM webknossos.dataStores_ WHERE name = $1 AND
          (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization IN
            (SELECT _organization FROM webknossos.users_ WHERE _id = $2))"#,
    )
    .bind(name)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

/// The layers of the dataset ordered by name, with their bounding box and finest mag.
pub(crate) async fn find_all_layers(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<Vec<LayerRow>> {
    sqlx::query_as(
        r#"SELECT l.name,
            ARRAY[(l.boundingBox).x::int, (l.boundingBox).y::int, (l.boundingBox).z::int,
              (l.boundingBox).width::int, (l.boundingBox).height::int, (l.boundingBox).depth::int] AS bounding_box,
            (SELECT ARRAY[(m.mag).x::int, (m.mag).y::int, (m.mag).z::int] FROM webknossos.dataset_mags m
              WHERE m._dataset = l._dataset AND m.dataLayerName = l.name
                AND NOT m.uploadToPathIsPending AND NOT m.uploadIsPending
              ORDER BY GREATEST((m.mag).x, (m.mag).y, (m.mag).z), (m.mag).x, (m.mag).y, (m.mag).z
              LIMIT 1) AS finest_mag
          FROM webknossos.dataset_layers l WHERE l._dataset = $1 ORDER BY l.name"#,
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await
}

/// DatasetMagsDAO.findMagsForLayer: without pending uploads and, as in Scala, without
/// an ORDER BY.
pub(crate) async fn find_mags_for_layer(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
) -> sqlx::Result<Vec<(i32, i32, i32)>> {
    sqlx::query_as(
        r#"SELECT (mag).x::int, (mag).y::int, (mag).z::int FROM webknossos.dataset_mags
          WHERE _dataset = $1 AND dataLayerName = $2 AND NOT uploadToPathIsPending AND NOT uploadIsPending"#,
    )
    .bind(dataset_id)
    .bind(layer_name)
    .fetch_all(pool)
    .await
}

/// DatasetLayerAdditionalAxesDAO: name, lower and upper bound of the layer's additional
/// axes ordered by index.
pub(crate) async fn find_additional_axes(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
) -> sqlx::Result<Vec<(String, i32, i32)>> {
    sqlx::query_as(
        r#"SELECT name, lowerBound, upperBound FROM webknossos.dataset_layer_additionalAxes
              WHERE _dataset = $1 AND layerName = $2 ORDER BY index, name"#,
    )
    .bind(dataset_id)
    .bind(layer_name)
    .fetch_all(pool)
    .await
}

/// The included storage of the organization. The outer `Option` is the organization
/// being found, the inner one the nullable column.
pub(crate) async fn find_included_storage(
    connection: &mut PgConnection,
    organization: &str,
) -> sqlx::Result<Option<Option<i64>>> {
    sqlx::query_scalar("SELECT includedStorage FROM webknossos.organizations_ WHERE _id = $1")
        .bind(organization)
        .fetch_optional(&mut *connection)
        .await
}

/// The bytes used by the organization's mags and attachments.
pub(crate) async fn find_used_storage_bytes(
    connection: &mut PgConnection,
    organization: &str,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(usedStorageBytes), 0)::bigint FROM (
            SELECT usedStorageBytes FROM webknossos.organization_usedStorage_mags WHERE _organization = $1
            UNION ALL
            SELECT usedStorageBytes FROM webknossos.organization_usedStorage_attachments WHERE _organization = $1
          ) combined"#,
    )
    .bind(organization)
    .fetch_one(&mut *connection)
    .await
}

/// The pricing plan of the organization.
pub(crate) async fn find_pricing_plan(
    pool: &PgPool,
    organization: &str,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT pricingPlan::text FROM webknossos.organizations_ WHERE _id = $1")
        .bind(organization)
        .fetch_optional(pool)
        .await
}

/// WorkerDAO.findAllByDataStore: the supported job commands of every worker.
pub(crate) async fn find_supported_job_commands_by_data_store(
    connection: &mut PgConnection,
    data_store: &str,
) -> sqlx::Result<Vec<Vec<String>>> {
    sqlx::query_scalar("SELECT supportedJobCommands FROM webknossos.workers_ WHERE _dataStore = $1")
        .bind(data_store)
        .fetch_all(&mut *connection)
        .await
}

/// JobDAO.insertOne: a pending job.
pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    owner_id: &ObjectId,
    data_store: &str,
    command: &str,
    args: &Value,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.jobs (_id, _owner, _dataStore, command, commandArgs, state, created, isDeleted)
          VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW(), FALSE)"#,
    )
    .bind(id)
    .bind(owner_id)
    .bind(data_store)
    .bind(command)
    .bind(args)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// CreditTransactionDAO.reserveCredits: a pending reservation that is not yet linked
/// to a job.
pub(crate) async fn insert_pending_credit_transaction(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization: &str,
    milli_credit_delta: i32,
    comment: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id, _organization, milli_credit_delta, comment, _paid_job,
           transaction_state, credit_state, expiration_date, created_at, updated_at, is_deleted)
          VALUES ($1, $2, $3, $4, NULL, 'Pending', 'Pending', NULL, NOW(), NOW(), FALSE)"#,
    )
    .bind(id)
    .bind(organization)
    .bind(milli_credit_delta)
    .bind(comment)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// CreditTransactionDAO.refundTransaction: the refunding half of the audit pair.
pub(crate) async fn insert_refund_credit_transaction(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization: &str,
    related_transaction_id: &ObjectId,
    milli_credit_delta: i32,
    comment: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
                  (_id, _organization, _related_transaction, milli_credit_delta, comment,
                   transaction_state, credit_state)
                  VALUES ($1, $2, $3, $4, $5, 'Complete', 'Refunding')"#,
    )
    .bind(id)
    .bind(organization)
    .bind(related_transaction_id)
    .bind(milli_credit_delta)
    .bind(comment)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// CreditTransactionDAO.refundTransaction: marks the reservation as refunded.
pub(crate) async fn update_credit_transaction_refunded(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE webknossos.credit_transactions
                  SET transaction_state = 'Complete', credit_state = 'Refunded', updated_at = NOW()
                  WHERE _id = $1"#,
    )
    .bind(id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// CreditTransactionDAO.setPaidJob: links the reservation to its job.
pub(crate) async fn update_credit_transaction_paid_job(
    connection: &mut PgConnection,
    id: &ObjectId,
    job_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.credit_transactions SET _paid_job = $2, updated_at = NOW() WHERE _id = $1",
    )
    .bind(id)
    .bind(job_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}
