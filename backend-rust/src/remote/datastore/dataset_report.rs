//! WKRemoteDataStoreController `reportDatasetUpload`: the datastore reports a
//! finished dataset upload (reserved earlier via `reserveDatasetUpload`).
//!
//! Without conversion the reported data source (plus linked layers) is stored
//! and the dataset becomes usable; then used storage is refreshed, real paths
//! are scanned and the mirror is written for virtual datasets. With conversion
//! a `convert_to_wkw` job is submitted instead. Deviations from Play are listed
//! in checkpoints/remote-datastore-dataset-report.md.
use axum::{
    Extension, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    dataset::source::{DataSource, UsableDataSource, VoxelSize},
    dataset::thumbnails::java_double_string,
    dataset::upload_paths::{LinkedLayer, resolve_linked_layers},
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    job::submission::{Failure, RunError, RunResult, Submission},
    remote::datastore::ValidatedDataStore,
    remote::datastore::mag_upload::user_for_token_forbidden,
    slack::SlackNotificationService,
    stores::client::ServiceClients,
    system::application_info::MiscState,
    util::id::ObjectId,
};

/// Msg.Dataset.Upload.needsConversionMissingVoxelSize.
const MISSING_VOXEL_SIZE: &str = "Dataset needs conversion but no voxel size was supplied.";
/// Msg.Job.ConvertToWkw.submitFailed.
const CONVERT_SUBMIT_FAILED: &str = "Could not start image conversion/import job.";
/// DatasetService.trackNewDataset's `addVariantLabel` for this route.
const ADD_VARIANT_LABEL: &str = "upload without conversion";

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/datastores/{name}/reportDatasetUpload",
        post(report_dataset_upload),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportQuery {
    token: String,
    dataset_id: ObjectId,
}

/// ReportDatasetUploadParameters (JsonAutoFormat). `dataSourceOpt` is a
/// UsableDataSource and `voxelSize` a VoxelSize; both are parsed below.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportDatasetUploadParameters {
    needs_conversion: bool,
    dataset_size_bytes: i64,
    data_source_opt: Option<Value>,
    layers_to_link: Vec<LinkedLayer>,
    voxel_size: Option<Value>,
}

/// The dataset columns this route reads (DatasetDAO.findOne, global access).
#[derive(sqlx::FromRow)]
struct ReportedDataset {
    id: ObjectId,
    name: String,
    directory_name: String,
    organization: String,
    /// Raw `_dataStore` column, written back and used for job submission as is.
    data_store: String,
}

async fn find_dataset(pool: &sqlx::PgPool, id: &ObjectId) -> ApiResult<ReportedDataset> {
    sqlx::query_as(
        r#"SELECT _id AS id, name, directoryName AS directory_name,
             _organization AS organization, _dataStore AS data_store
           FROM webknossos.datasets_ WHERE _id = $1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| crate::dataset::lifecycle::not_found(id))
}

async fn report_dataset_upload(
    State(state): State<AppState>,
    Query(query): Query<ReportQuery>,
    ValidatedDataStore(store): ValidatedDataStore,
    Extension(clients): Extension<ServiceClients>,
    Extension(misc): Extension<MiscState>,
    slack: SlackNotificationService,
    Json(body): Json<ReportDatasetUploadParameters>,
) -> Response {
    match report(&state, &store.name, &clients, &misc, &slack, query, body).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(error) => error.into_response(),
    }
}

async fn report(
    state: &AppState,
    store_name: &str,
    clients: &ServiceClients,
    misc: &MiscState,
    slack: &SlackNotificationService,
    query: ReportQuery,
    body: ReportDatasetUploadParameters,
) -> RunResult<()> {
    let data_source = body
        .data_source_opt
        .as_ref()
        .map(UsableDataSource::from_json)
        .transpose()
        .map_err(crate::dataset::source::invalid_body)
        .map_err(RunError::Api)?;
    let voxel_size = body
        .voxel_size
        .as_ref()
        .map(VoxelSize::from_json)
        .transpose()
        .map_err(crate::dataset::source::invalid_body)
        .map_err(RunError::Api)?;
    let pool = &state.pool;
    let id = &query.dataset_id;
    let user = user_for_token_forbidden(pool, &query.token)
        .await
        .map_err(RunError::Api)?;
    let dataset = find_dataset(pool, id).await.map_err(RunError::Api)?;
    track_new_dataset(state, misc, slack, &user, &dataset, &body).await;
    if let Some(data_source) = data_source {
        let data_source = add_layers_to_link(state, &user, data_source, &body.layers_to_link)
            .await
            .map_err(RunError::Api)?;
        tracing::info!(dataset = %id, store = %store_name, "Updating dataset in database after upload reported from datastore");
        update_data_source(pool, &dataset, data_source)
            .await
            .map_err(RunError::Api)?;
    }
    let updated = find_dataset(pool, id).await.map_err(RunError::Api)?;
    if body.needs_conversion {
        submit_conversion(state, clients, misc, &user, &dataset, &updated, voxel_size).await
    } else {
        finish_without_conversion(pool, clients, &updated)
            .await
            .map_err(RunError::Api)
    }
}

/// DatasetService.trackNewDataset (fire-and-forget in Scala, never fails the
/// route): Slack notice (only without conversion) and UploadDatasetEvent
/// analytics. The Mailchimp `HasUploadedOwnDataset` tag is not ported.
async fn track_new_dataset(
    state: &AppState,
    misc: &MiscState,
    slack: &SlackNotificationService,
    user: &AuthUser,
    dataset: &ReportedDataset,
    body: &ReportDatasetUploadParameters,
) {
    if !body.needs_conversion {
        slack.notice_dataset_added(
            &state.pool,
            &user.organization_id,
            user.is_superuser,
            &dataset.id,
            ADD_VARIANT_LABEL,
        );
    }
    // dataStoreDAO.findOneByName(dataset._dataStore): a missing store skips the event.
    let public_url: Option<String> =
        match sqlx::query_scalar("SELECT publicUrl FROM webknossos.dataStores_ WHERE name = $1")
            .bind(&dataset.data_store)
            .fetch_optional(&state.pool)
            .await
        {
            Ok(url) => url,
            Err(error) => {
                tracing::debug!(%error, "Upload analytics: datastore lookup failed");
                None
            }
        };
    let Some(public_url) = public_url else {
        return;
    };
    let mut properties = Map::new();
    properties.insert("dataset_id".into(), json!(dataset.id));
    properties.insert("dataset_name".into(), json!(dataset.name));
    properties.insert("dataset_size_bytes".into(), json!(body.dataset_size_bytes));
    properties.insert("datastore_uri".into(), json!(public_url));
    properties.insert(
        "dataset_organization_id".into(),
        json!(dataset.organization),
    );
    crate::system::analytics::track(state, misc, user, "upload_dataset".into(), properties);
}

/// LayerToLinkService.addLayersToLinkToDataSource under the user's access:
/// linked layers (renamed) precede the uploaded layers; names must be unique.
async fn add_layers_to_link(
    state: &AppState,
    user: &AuthUser,
    mut data_source: UsableDataSource,
    layers_to_link: &[LinkedLayer],
) -> ApiResult<UsableDataSource> {
    let mut layers = resolve_linked_layers(state, user, layers_to_link).await?;
    layers.append(&mut data_source.data_layers);
    let mut names: Vec<&str> = layers.iter().map(|layer| layer.name.as_str()).collect();
    names.sort_unstable();
    if names.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(ApiError::bad_request(
            crate::msg::dataset::layer::DUPLICATE_NAMES,
        ));
    }
    data_source.data_layers = layers;
    Ok(data_source)
}

/// DatasetDAO.updateDataSource(id, dataset._dataStore, hash, dataSource,
/// isUsable = true), row and layers in one transaction.
async fn update_data_source(
    pool: &sqlx::PgPool,
    dataset: &ReportedDataset,
    data_source: UsableDataSource,
) -> ApiResult<()> {
    let source = DataSource::Usable(data_source);
    let hash = crate::dataset::source::inbox_source_hash(&source);
    let mut transaction = pool.begin().await?;
    crate::remote::datastore::write_data_source(
        &mut transaction,
        &dataset.id,
        &dataset.data_store,
        hash,
        &source,
        None,
        None,
    )
    .await?;
    transaction.commit().await?;
    Ok(())
}

/// UsedStorageService.refreshStorageReportForDataset, then
/// DatasetService.scanRealpathsIfVirtual and writeMirrorForVirtual.
async fn finish_without_conversion(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    updated: &ReportedDataset,
) -> ApiResult<()> {
    crate::organization::storage::refresh_for_dataset(pool, clients, &updated.id).await?;
    let record = crate::dataset::lifecycle::load_record(pool, &updated.id)
        .await?
        .ok_or_else(|| crate::dataset::lifecycle::not_found(&updated.id))?;
    crate::dataset::lifecycle::scan_realpaths_if_virtual(pool, clients, &record).await?;
    crate::dataset::lifecycle::write_mirror_for_virtual(pool, clients, &record).await
}

/// The conversion branch: required voxel size, the datastore's organization
/// base directory (requireAllowsUpload, requireLocal) for the original
/// dataset's store, then JobService.submitConvertToWkwJob on the updated row.
async fn submit_conversion(
    state: &AppState,
    clients: &ServiceClients,
    misc: &MiscState,
    user: &AuthUser,
    dataset: &ReportedDataset,
    updated: &ReportedDataset,
    voxel_size: Option<VoxelSize>,
) -> RunResult<()> {
    let VoxelSize { factor, unit } =
        voxel_size.ok_or_else(|| RunError::Api(ApiError::bad_request(MISSING_VOXEL_SIZE)))?;
    let base_directory = organization_base_directory(&state.pool, clients, dataset)
        .await
        .map_err(RunError::Api)?;
    submit_convert_to_wkw_job(
        state,
        misc,
        user,
        updated,
        factor.to_array(),
        unit.as_str(),
        base_directory,
    )
    .await
}

/// DatasetService.clientFor(dataset)(GlobalAccessContext)
/// .getOrganizationBaseDirectory(dataset._organization, requireAllowsUpload = true, requireLocal = true).
async fn organization_base_directory(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    dataset: &ReportedDataset,
) -> ApiResult<Value> {
    let record = crate::dataset::lifecycle::load_record(pool, &dataset.id)
        .await?
        .ok_or_else(|| crate::dataset::lifecycle::not_found(&dataset.id))?;
    let directory: Value = clients
        .get_json(
            record.store_url()?,
            &["data", "getOrganizationBaseDirectory"],
            &[
                ("organizationId", dataset.organization.clone()),
                ("requireLocal", "true".into()),
                ("requireAllowsUpload", "true".into()),
            ],
        )
        .await?;
    // Reads[UPath]: a JSON string.
    if !directory.is_string() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            crate::msg::request::SERVICE_INVALID_JSON,
        ));
    }
    Ok(directory)
}

/// JobService.submitConvertToWkwJob: organization lookup (400
/// Msg.Organization.notFound), then submitJob `?~>` submitFailed and the
/// RunJobEvent.
async fn submit_convert_to_wkw_job(
    state: &AppState,
    misc: &MiscState,
    user: &AuthUser,
    dataset: &ReportedDataset,
    factor: [f64; 3],
    unit: &str,
    base_directory: Value,
) -> RunResult<()> {
    let organization: Option<(String, String)> =
        sqlx::query_as("SELECT _id, name FROM webknossos.organizations_ WHERE _id = $1")
            .bind(&dataset.organization)
            .fetch_optional(&state.pool)
            .await?;
    let (organization_id, organization_name) = organization
        .ok_or_else(|| Failure::new(crate::msg::organization::not_found(&dataset.organization)))?;
    let args = json!({
        "organization_id": organization_id,
        "organization_base_directory": base_directory,
        "organization_display_name": organization_name,
        "dataset_name": dataset.name,
        "dataset_id": dataset.id,
        "dataset_directory_name": dataset.directory_name,
        "voxel_size_factor": factor.map(java_double_string).join(","),
        "voxel_size_unit": unit,
    });
    let submission = Submission {
        command: "convert_to_wkw",
        args,
        data_store: &dataset.data_store,
    };
    let mut transaction = state.pool.begin().await?;
    let job_id = crate::job::submission::submit_job(
        &mut transaction,
        misc.config().jobs_enabled,
        user,
        &submission,
    )
    .await
    .map_err(|error| error.wrap(CONVERT_SUBMIT_FAILED))?;
    transaction.commit().await?;
    let mut properties = Map::new();
    properties.insert("command".into(), json!(submission.command));
    crate::system::analytics::track(state, misc, user, "run_job".into(), properties);
    tracing::info!(dataset = %dataset.id, job = %job_id, "Submitted convert_to_wkw job after upload");
    Ok(())
}
