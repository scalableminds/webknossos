//! DatasetDAO queries behind the reserve-upload-to-paths routes.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::{
    auth::AuthUser,
    dataset::{dao::push_read_predicate, source::UsableDataSource},
    error::ApiResult,
    remote::datastore::{attachment_upload::push_attachment_key, mag_upload::push_mag_predicate},
    sql::Sql,
    util::id::ObjectId,
};

/// The distinct datastores of the given non-virtual datasets.
pub(crate) async fn find_data_store_names(
    connection: &mut PgConnection,
    dataset_ids: &[&ObjectId],
) -> ApiResult<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT trim(_dataStore) FROM webknossos.datasets_ WHERE _id = ANY($1) AND NOT isVirtual ORDER BY 1",
    )
    .bind(dataset_ids)
    .fetch_all(connection)
    .await?)
}

/// (name, allowsUploadToPaths) of the datastore the user's organization may use: the named
/// one, or else the first that allows uploads to paths.
pub(crate) async fn find_upload_to_paths_store(
    connection: &mut PgConnection,
    name: Option<&String>,
    organization_id: &str,
) -> ApiResult<Option<(String, bool)>> {
    Ok(sqlx::query_as(
        r#"SELECT name, allowsUploadToPaths FROM webknossos.dataStores_
           WHERE ($1::text IS NULL AND allowsUploadToPaths OR name = $1)
             AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $2)
           ORDER BY name LIMIT 1"#,
    )
    .bind(name)
    .bind(organization_id)
    .fetch_optional(connection)
    .await?)
}

/// How many of the teams the user may grant dataset access to.
pub(crate) async fn count_grantable_teams(
    connection: &mut PgConnection,
    user: &AuthUser,
    team_ids: &[ObjectId],
) -> ApiResult<i64> {
    Ok(sqlx::query_scalar(
        r#"SELECT count(*) FROM webknossos.teams_ t WHERE t._id = ANY($1) AND (
             t._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $2 AND isAdmin)
             OR t._id IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $2 AND ($3 OR isTeamManager)))"#,
    )
    .bind(team_ids)
    .bind(&user.id)
    .bind(user.is_dataset_manager)
    .fetch_one(connection)
    .await?)
}

/// Whether the user can read the dataset, evaluated in the caller's transaction.
pub(crate) async fn is_dataset_readable_by(
    connection: &mut PgConnection,
    user: &AuthUser,
    dataset: &ObjectId,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT ");
    push_read_predicate(&mut q, (&user.id).into(), None);
    q.push(" FROM webknossos.datasets_ d WHERE d._id = ")
        .push_bind(dataset);
    Ok(q.build_query_scalar().fetch_one(connection).await?)
}

pub(crate) async fn insert_allowed_teams_ignoring_conflicts(
    connection: &mut PgConnection,
    dataset: &ObjectId,
    team_ids: &[&ObjectId],
) -> ApiResult<()> {
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset, _team) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING")
        .bind(dataset)
        .bind(team_ids)
        .execute(connection)
        .await?;
    Ok(())
}

/// (root folder, included storage) of the organization.
pub(crate) async fn find_root_folder_and_included_storage(
    pool: &PgPool,
    organization_id: &str,
) -> ApiResult<(ObjectId, Option<i64>)> {
    Ok(sqlx::query_as(
        "SELECT _rootFolder, includedStorage FROM webknossos.organizations_ WHERE _id = $1",
    )
    .bind(organization_id)
    .fetch_one(pool)
    .await?)
}

/// Total bytes used by the organization's mags and attachments.
pub(crate) async fn find_used_storage_bytes(
    pool: &PgPool,
    organization_id: &str,
) -> ApiResult<i64> {
    Ok(sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(usedStorageBytes), 0)::bigint FROM (
                 SELECT usedStorageBytes FROM webknossos.organization_usedStorage_mags WHERE _organization = $1
                 UNION ALL
                 SELECT usedStorageBytes FROM webknossos.organization_usedStorage_attachments WHERE _organization = $1) combined"#,
    )
    .bind(organization_id)
    .fetch_one(pool)
    .await?)
}

/// Whether the organization already has a dataset with this name.
pub(crate) async fn is_name_taken(
    pool: &PgPool,
    name: &str,
    organization_id: &str,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE name = $1 AND _organization = $2)",
    )
    .bind(name)
    .bind(organization_id)
    .fetch_one(pool)
    .await?)
}

pub(crate) async fn update_folder_and_uploader(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    folder: &ObjectId,
    uploader: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.datasets SET _folder = $2, _uploader = $3 WHERE _id = $1")
        .bind(dataset_id)
        .bind(folder)
        .bind(uploader)
        .execute(connection)
        .await?;
    Ok(())
}

/// (status, uploader, directoryName) of the dataset, row-locked.
pub(crate) async fn find_upload_state_for_update(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<(String, Option<ObjectId>, String)> {
    Ok(sqlx::query_as(
        "SELECT status, _uploader, directoryName FROM webknossos.datasets_ WHERE _id = $1 FOR UPDATE",
    )
    .bind(dataset_id)
    .fetch_one(connection)
    .await?)
}

/// DatasetDAO.updateDataSource(isUsable = false).
pub(crate) async fn update_data_source_unusable(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    organization_id: &str,
    source: &UsableDataSource,
    status: &str,
) -> ApiResult<()> {
    sqlx::query(
        r#"UPDATE webknossos.datasets SET _organization = $2, inboxSourceHash = NULL, defaultViewConfiguration = $3,
             isUsable = false, voxelSizeFactor = ROW($4, $5, $6)::webknossos.VECTOR3,
             voxelSizeUnit = $7::webknossos.LENGTH_UNIT, status = $8 WHERE _id = $1"#,
    )
    .bind(dataset_id)
    .bind(organization_id)
    .bind(source.default_view_configuration.clone().map(Value::Object))
    .bind(source.scale.factor.x)
    .bind(source.scale.factor.y)
    .bind(source.scale.factor.z)
    .bind(source.scale.unit.as_str())
    .bind(status)
    .execute(connection)
    .await?;
    Ok(())
}

/// (path, uploadToPathIsPending) of the pending uploads of the mag.
pub(crate) async fn find_pending_mags(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
    mag: [f64; 3],
) -> ApiResult<Vec<(Option<String>, bool)>> {
    let mut q = Sql::new("SELECT path, uploadToPathIsPending FROM webknossos.dataset_mags WHERE ");
    push_mag_predicate(&mut q, dataset_id, layer_name, mag);
    q.push(" AND (uploadToPathIsPending OR uploadIsPending)");
    Ok(q.build_query_as().fetch_all(pool).await?)
}

pub(crate) async fn delete_pending_mags(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    mag: [f64; 3],
) -> ApiResult<()> {
    let mut q = Sql::new("DELETE FROM webknossos.dataset_mags WHERE ");
    push_mag_predicate(&mut q, dataset_id, layer_name, mag);
    q.push(" AND (uploadToPathIsPending OR uploadIsPending)");
    q.build().execute(connection).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_pending_mag(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    mag: [f64; 3],
    path: &str,
    axis_order: Option<Value>,
    channel_index: Option<i32>,
) -> ApiResult<()> {
    let [x, y, z] = mag;
    sqlx::query(r#"INSERT INTO webknossos.dataset_mags (_dataset, dataLayerName, mag, path, axisOrder, channelIndex, uploadToPathIsPending, uploadIsPending)
        VALUES ($1, $2, ROW($3, $4, $5)::webknossos.VECTOR3, $6, $7, $8, true, false)"#)
        .bind(dataset_id).bind(layer_name).bind(x).bind(y).bind(z)
        .bind(path).bind(axis_order).bind(channel_index)
        .execute(connection).await?;
    Ok(())
}

pub(crate) async fn delete_pending_attachments(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    attachment_type: &str,
    attachment_name: &str,
) -> ApiResult<()> {
    let mut q = Sql::new("DELETE FROM webknossos.dataset_layer_attachments WHERE ");
    push_attachment_key(
        &mut q,
        dataset_id,
        layer_name,
        attachment_type,
        attachment_name,
    );
    q.push(" AND (uploadIsPending OR uploadToPathIsPending)");
    q.build().execute(connection).await?;
    Ok(())
}

pub(crate) async fn has_pending_attachment(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    attachment_type: &str,
    attachment_name: &str,
) -> ApiResult<bool> {
    let mut q =
        Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments WHERE ");
    push_attachment_key(
        &mut q,
        dataset_id,
        layer_name,
        attachment_type,
        attachment_name,
    );
    q.push(" AND (uploadIsPending OR uploadToPathIsPending))");
    Ok(q.build_query_scalar().fetch_one(connection).await?)
}

/// How many attachments of the layer have this type (and name, unless `name` is `None`).
pub(crate) async fn count_attachments(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    name: Option<&String>,
    attachment_type: &str,
) -> ApiResult<i64> {
    Ok(sqlx::query_scalar(
        "SELECT count(*) FROM webknossos.dataset_layer_attachments WHERE _dataset = $1 AND layerName = $2 AND ($3::text IS NULL OR name = $3) AND type = $4::webknossos.LAYER_ATTACHMENT_TYPE",
    )
    .bind(dataset_id)
    .bind(layer_name)
    .bind(name)
    .bind(attachment_type)
    .fetch_one(connection)
    .await?)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_pending_attachment(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    name: &str,
    path: &str,
    attachment_type: &str,
    data_format: &str,
) -> ApiResult<()> {
    sqlx::query(r#"INSERT INTO webknossos.dataset_layer_attachments (_dataset, layerName, name, path, type, dataFormat, uploadToPathIsPending, uploadIsPending)
        VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6::webknossos.LAYER_ATTACHMENT_DATAFORMAT, true, false)"#)
        .bind(dataset_id).bind(layer_name).bind(name).bind(path)
        .bind(attachment_type).bind(data_format)
        .execute(connection).await?;
    Ok(())
}
