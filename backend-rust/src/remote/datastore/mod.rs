//! Datastore → WEBKNOSSOS callbacks of WKRemoteDataStoreController that keep
//! the dataset table in sync with the datastore inboxes: status heartbeat,
//! single/full data source reports, real path reports and the per-dataset
//! data source read/update RPCs.
//!
//! All routes authenticate the calling datastore with `?key=` against the live
//! datastore row (DataStoreService.validateAccess). The shared
//! [`ValidatedDataStore`] extractor is meant for the remaining
//! `/datastores/{name}/…` callbacks as well.
//!
//! Deliberate differences to Play, all documented in
//! checkpoints/remote-datastore.md:
//! - The datastore key is checked before the request body is read, so a wrong
//!   key with a malformed body is a 403 (Play: 400). Bodies may be as large as
//!   Play's `maxMemoryBuffer` (250 MiB), but only after authentication.
//! - Report database changes are atomic per request (Play commits per dataset)
//!   and run in a detached task, so a request timeout cannot abort a large
//!   report half-way. Datastore cache invalidations run after the commit.
//! - `inboxSourceHash` is a deterministic SHA-1 based hash of the canonical
//!   data source JSON instead of Scala's case-class `hashCode`.

pub mod attachment_upload;
pub mod credentials;
pub mod dataset_report;
pub mod dataset_upload;
pub mod lookup;
pub mod mag_upload;

use std::collections::{BTreeMap, HashMap};

use axum::{
    Extension, Json as ResponseJson, Router,
    extract::{DefaultBodyLimit, FromRequestParts, State},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, patch, put},
};
use serde::Deserialize;
use serde_json::{Value, json};
use webknossos_common::{
    json::read_list,
    source_paths::{DataSourcePathInfo, DataSourceWithRootPathInfo, RealPathInfo},
};

use crate::{
    AppState,
    dataset::source::DataSource,
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    stores::client::ServiceClients,
    util::id::{ObjectId, PathObjectId},
};

/// Play's `play.http.parser.maxMemoryBuffer` (conf/application.conf).
const PLAY_MAX_MEMORY_BUFFER: usize = 250 * 1024 * 1024;
/// DataSourceStatus.unreported.
pub(crate) const UNREPORTED: &str = "No longer available on datastore.";
/// DataSourceStatus.inactiveStatusList.
const INACTIVE_STATUSES: [&str; 5] = [
    UNREPORTED,
    "Not yet fully uploaded.",
    "Not yet marked as fully uploaded to paths.",
    "Deleted by user.",
    crate::dataset::lifecycle::CONVERSION_FAILED,
];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datastores/{name}/status", patch(status_update))
        .route("/datastores/{name}/datasource", put(update_one))
        .route("/datastores/{name}/datasources", put(update_all))
        .route(
            "/datastores/{name}/datasources/realpaths",
            put(update_real_paths),
        )
        .route(
            "/datastores/{name}/datasources/{datasetId}",
            get(get_data_source).put(update_data_source),
        )
        .layer(DefaultBodyLimit::max(PLAY_MAX_MEMORY_BUFFER))
}

// ---------------------------------------------------------------- access

/// A live datastore row as needed by the callbacks. The key is never selected.
#[derive(Clone, Debug, sqlx::FromRow)]
pub(crate) struct DataStoreRecord {
    pub name: String,
    pub only_allowed_organization: Option<String>,
}

/// DataStoreService.validateAccess: the `{name}` path parameter and the `key`
/// query parameter must match a non-deleted datastore. Place it after the
/// route's own Path/Query extractors (Play binds those first) and before the
/// body, so unauthenticated bodies are never read.
pub(crate) struct ValidatedDataStore(pub DataStoreRecord);

#[derive(Deserialize)]
struct KeyQuery {
    key: String,
}

impl FromRequestParts<AppState> for ValidatedDataStore {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(IntoResponse::into_response)?;
        let name = params
            .get("name")
            .ok_or_else(|| ApiError::internal().into_response())?;
        let Query(query) = Query::<KeyQuery>::from_request_parts(parts, state)
            .await
            .map_err(IntoResponse::into_response)?;
        match validate_access(&state.pool, name, &query.key).await {
            Ok(Some(store)) => Ok(Self(store)),
            Ok(None) => Err(forbidden_response()),
            Err(error) => Err(error.into_response()),
        }
    }
}

/// Look up a live datastore by name and key (never logs the key).
pub(crate) async fn validate_access(
    executor: impl sqlx::PgExecutor<'_>,
    name: &str,
    key: &str,
) -> ApiResult<Option<DataStoreRecord>> {
    Ok(sqlx::query_as(
        r#"SELECT name, onlyAllowedOrganization AS only_allowed_organization
           FROM webknossos.dataStores_ WHERE name = $1 AND key = $2"#,
    )
    .bind(name)
    .bind(key)
    .fetch_optional(executor)
    .await?)
}

/// `Forbidden(Json.obj("granted" -> false, "msg" -> Msg.DataStore.notFound))`.
pub(crate) fn forbidden_response() -> Response {
    (
        StatusCode::FORBIDDEN,
        ResponseJson(json!({
            "granted": false,
            "msg": crate::msg::data_store::NOT_FOUND
        })),
    )
        .into_response()
}

fn invalid_body() -> ApiError {
    ApiError::bad_request(crate::msg::request::INVALID_JSON_BODY)
}

// ---------------------------------------------------------------- status

#[derive(Deserialize)]
struct DataStoreStatus {
    ok: bool,
    url: String,
}

/// statusUpdate: only the (internal) url is persisted.
async fn status_update(
    State(state): State<AppState>,
    ValidatedDataStore(store): ValidatedDataStore,
    Json(body): Json<DataStoreStatus>,
) -> ApiResult<StatusCode> {
    tracing::info!(
        datastore = %store.name,
        "Status update from data store. Status {}",
        if body.ok { "ok" } else { "not ok" }
    );
    sqlx::query("UPDATE webknossos.dataStores SET url = $2 WHERE name = $1 AND NOT isDeleted")
        .bind(&store.name)
        .bind(&body.url)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------- reports

fn parse_reported(value: &Value) -> ApiResult<DataSourceWithRootPathInfo> {
    DataSourceWithRootPathInfo::from_json(value).map_err(|_| invalid_body())
}

/// updateOne: a single data source; root path info None never overwrites.
async fn update_one(
    State(state): State<AppState>,
    Extension(clients): Extension<ServiceClients>,
    ValidatedDataStore(store): ValidatedDataStore,
    Json(body): Json<Value>,
) -> ApiResult<StatusCode> {
    let data_source = DataSource::from_json(&body).map_err(|_| invalid_body())?;
    let reported = vec![DataSourceWithRootPathInfo {
        data_source,
        root_path: None,
        root_real_path: None,
    }];
    run_detached(state, clients, store, reported, None).await?;
    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAllQuery {
    organization_id: Option<String>,
}

/// updateAll: the full inbox (optionally of one organization); datasets of
/// this datastore that were not reported are deactivated.
async fn update_all(
    State(state): State<AppState>,
    Query(query): Query<UpdateAllQuery>,
    Extension(clients): Extension<ServiceClients>,
    ValidatedDataStore(store): ValidatedDataStore,
    Json(body): Json<Value>,
) -> ApiResult<StatusCode> {
    let reported = body
        .as_array()
        .ok_or_else(invalid_body)?
        .iter()
        .map(parse_reported)
        .collect::<ApiResult<Vec<_>>>()?;
    let label = query.organization_id.as_deref().map_or_else(
        || "for all organizations".to_owned(),
        |id| format!("for organization {id}"),
    );
    tracing::info!(
        datastore = %store.name,
        "Received dataset list from datastore {label}: {} active, {} inactive",
        reported.iter().filter(|r| r.data_source.is_usable()).count(),
        reported.iter().filter(|r| !r.data_source.is_usable()).count(),
    );
    let started = std::time::Instant::now();
    run_detached(
        state,
        clients,
        store.clone(),
        reported,
        Some(query.organization_id),
    )
    .await?;
    if started.elapsed() > std::time::Duration::from_secs(30) {
        tracing::info!(
            datastore = %store.name,
            "Updating datasources from datastore {label} took {:?}",
            started.elapsed()
        );
    }
    Ok(StatusCode::OK)
}

/// Run the report in its own task: if the request is cancelled (timeout,
/// disconnect) the report still commits, so the next report is cheap.
async fn run_detached(
    state: AppState,
    clients: ServiceClients,
    store: DataStoreRecord,
    reported: Vec<DataSourceWithRootPathInfo>,
    deactivate_unreported: Option<Option<String>>,
) -> ApiResult<()> {
    tokio::spawn(async move {
        apply_report(
            &state.pool,
            &clients,
            &store,
            reported,
            deactivate_unreported,
        )
        .await
    })
    .await
    .map_err(|_| ApiError::internal())?
}

#[derive(sqlx::FromRow)]
struct FoundDataset {
    id: String,
    directory_name: String,
    data_store: String,
    is_virtual: bool,
    inbox_source_hash: Option<i32>,
    root_path: Option<String>,
    root_real_path: Option<String>,
    status: String,
}

/// DatasetService.updateDataSources (+ deactivateUnreportedDataSources when
/// `deactivate_unreported` is set, with its optional organization filter).
async fn apply_report(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    store: &DataStoreRecord,
    reported: Vec<DataSourceWithRootPathInfo>,
    deactivate_unreported: Option<Option<String>>,
) -> ApiResult<()> {
    let mut by_organization: BTreeMap<String, Vec<DataSourceWithRootPathInfo>> = BTreeMap::new();
    for entry in reported {
        by_organization
            .entry(entry.data_source.id().organization_id.clone())
            .or_default()
            .push(entry);
    }
    let mut tx = pool.begin().await?;
    let mut existing_ids: Vec<String> = Vec::new();
    let mut updated_ids: Vec<String> = Vec::new();
    for (organization, entries) in by_organization {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ WHERE _id = $1)",
        )
        .bind(&organization)
        .fetch_one(&mut *tx)
        .await?;
        if !exists {
            tracing::info!(
                "Ignoring {} reported datasets for non-existing organization {organization}",
                entries.len()
            );
            continue;
        }
        if store
            .only_allowed_organization
            .as_ref()
            .is_some_and(|allowed| *allowed != organization)
        {
            tracing::info!(
                datastore = %store.name,
                "Ignoring {} reported datasets for forbidden organization {organization} from organization-specific datastore",
                entries.len()
            );
            continue;
        }
        let names: Vec<&str> = entries
            .iter()
            .map(|e| e.data_source.id().directory_name.as_str())
            .collect();
        let found: Vec<FoundDataset> = sqlx::query_as(&format!(
            "SELECT {FOUND_DATASET_COLUMNS} FROM webknossos.datasets_ \
             WHERE directoryName = ANY($1) AND _organization = $2 ORDER BY created, _id"
        ))
        .bind(&names)
        .bind(&organization)
        .fetch_all(&mut *tx)
        .await?;
        let mut by_name: HashMap<&str, &FoundDataset> = HashMap::new();
        for dataset in &found {
            by_name
                .entry(dataset.directory_name.as_str())
                .or_insert(dataset);
        }
        for entry in &entries {
            let hash = crate::dataset::source::inbox_source_hash(&entry.data_source);
            let existing = match by_name.get(entry.data_source.id().directory_name.as_str()) {
                Some(found) => {
                    update_existing(&mut tx, store, found, hash, entry, &mut updated_ids).await?
                }
                None => match create_disk_scan_dataset(&mut tx, store, hash, entry).await? {
                    Some(id) => Some(id),
                    None => {
                        // Concurrent disk scans (or duplicate entries in one
                        // report) may report the same new dataset.
                        let id = entry.data_source.id();
                        tracing::info!(
                            "Dataset {}/{} already exists, using existing one instead.",
                            id.organization_id,
                            id.directory_name
                        );
                        let found = find_by_directory_name(
                            &mut tx,
                            &id.directory_name,
                            &id.organization_id,
                        )
                        .await?;
                        update_existing(&mut tx, store, &found, hash, entry, &mut updated_ids)
                            .await?
                    }
                },
            };
            existing_ids.extend(existing);
        }
    }
    if let Some(organization) = deactivate_unreported {
        deactivate(&mut tx, &existing_ids, &store.name, organization.as_deref()).await?;
    }
    tx.commit().await?;
    // notifyDatastoreOnUpdate, after the commit. All are attempted; the first
    // failure is reported like Play's failing Fox.
    let mut first_error = None;
    for id in updated_ids {
        let result = match crate::dataset::lifecycle::load_record(pool, &id).await {
            Ok(Some(record)) => crate::dataset::lifecycle::invalidate_cache(clients, &record).await,
            Ok(None) => Err(crate::dataset::lifecycle::not_found(&id)),
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

const FOUND_DATASET_COLUMNS: &str = "_id AS id, directoryName AS directory_name, \
    _dataStore AS data_store, isVirtual AS is_virtual, inboxSourceHash AS inbox_source_hash, \
    rootPath AS root_path, rootRealPath AS root_real_path, status";

/// DatasetDAO.findOneByDataSourceId.
async fn find_by_directory_name(
    connection: &mut sqlx::PgConnection,
    directory_name: &str,
    organization: &str,
) -> ApiResult<FoundDataset> {
    let found: Option<FoundDataset> = sqlx::query_as(&format!(
        "SELECT {FOUND_DATASET_COLUMNS} FROM webknossos.datasets_ \
         WHERE directoryName = $1 AND _organization = $2"
    ))
    .bind(directory_name)
    .bind(organization)
    .fetch_optional(&mut *connection)
    .await?;
    found.ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))
}

/// DatasetService.updateExistingDataset: returns the id to keep active, or
/// None if the dataset is still reported by its original datastore.
async fn update_existing(
    connection: &mut sqlx::PgConnection,
    store: &DataStoreRecord,
    found: &FoundDataset,
    hash: i32,
    entry: &DataSourceWithRootPathInfo,
    updated_ids: &mut Vec<String>,
) -> ApiResult<Option<String>> {
    if found.is_virtual {
        // Virtual datasets are not expected on the datastore's disk.
        return Ok(Some(found.id.clone()));
    }
    if found.data_store == store.name {
        let unchanged = found.inbox_source_hash == Some(hash)
            && found.root_path == entry.root_path
            && found.root_real_path == entry.root_real_path;
        if !unchanged {
            replace_data_source(connection, &found.id, store, hash, entry).await?;
            updated_ids.push(found.id.clone());
        }
        return Ok(Some(found.id.clone()));
    }
    if found.status == UNREPORTED {
        tracing::info!(
            dataset = %found.id,
            datastore = %store.name,
            "Replacing dataset from datastore {} by the one reported from this datastore",
            found.data_store
        );
        replace_data_source(connection, &found.id, store, hash, entry).await?;
        updated_ids.push(found.id.clone());
        Ok(Some(found.id.clone()))
    } else {
        tracing::info!(
            dataset = %found.id,
            datastore = %store.name,
            "Reported dataset is already present from datastore {} and will not be replaced",
            found.data_store
        );
        Ok(None)
    }
}

/// updateKnownDataSource / updateDataSourceDifferentDataStore (database part):
/// thumbnailCachingService.removeFromCache, then DatasetDAO.updateDataSource.
async fn replace_data_source(
    connection: &mut sqlx::PgConnection,
    id: &str,
    store: &DataStoreRecord,
    hash: i32,
    entry: &DataSourceWithRootPathInfo,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.dataset_thumbnails WHERE _dataset = $1")
        .bind(id)
        .execute(&mut *connection)
        .await?;
    sqlx::query(
        "UPDATE webknossos.datasets SET thumbnailCacheVersion = thumbnailCacheVersion + 1 WHERE _id = $1",
    )
    .bind(id)
    .execute(&mut *connection)
    .await?;
    write_data_source(
        connection,
        id,
        &store.name,
        hash,
        &entry.data_source,
        entry.root_path.as_deref(),
        entry.root_real_path.as_deref(),
    )
    .await
}

/// DatasetDAO.updateDataSource: None root paths keep the stored values.
pub(crate) async fn write_data_source(
    connection: &mut sqlx::PgConnection,
    id: &str,
    store_name: &str,
    hash: i32,
    source: &DataSource,
    root_path: Option<&str>,
    root_real_path: Option<&str>,
) -> ApiResult<()> {
    let organization: Option<String> =
        sqlx::query_scalar("SELECT _id FROM webknossos.organizations_ WHERE _id = $1")
            .bind(&source.id().organization_id)
            .fetch_optional(&mut *connection)
            .await?;
    let organization = organization.ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let voxel_size = source.voxel_size_opt();
    let status: String = source
        .status_opt()
        .unwrap_or_default()
        .chars()
        .take(1024)
        .collect();
    sqlx::query(
        r#"UPDATE webknossos.datasets SET _dataStore = $2, _organization = $3, inboxSourceHash = $4,
             defaultViewConfiguration = $5, isUsable = $6,
             voxelSizeFactor = CASE WHEN $7::float8 IS NULL THEN NULL ELSE ROW($7, $8, $9)::webknossos.VECTOR3 END,
             voxelSizeUnit = $10::webknossos.LENGTH_UNIT, status = $11,
             rootPath = COALESCE($12, rootPath), rootRealPath = COALESCE($13, rootRealPath)
           WHERE _id = $1"#,
    )
    .bind(id)
    .bind(store_name)
    .bind(&organization)
    .bind(hash)
    .bind(source.default_view_configuration().cloned().map(Value::Object))
    .bind(source.is_usable())
    .bind(voxel_size.map(|v| v.factor.x))
    .bind(voxel_size.map(|v| v.factor.y))
    .bind(voxel_size.map(|v| v.factor.z))
    .bind(voxel_size.map(|v| v.unit.as_str()))
    .bind(status)
    .bind(root_path)
    .bind(root_real_path)
    .execute(&mut *connection)
    .await?;
    crate::dataset::source::write_layers(connection, id, source.all_layers()).await
}

/// DatasetService.createDataset for a newly discovered inbox data source with
/// reuseExistingOnDirectoryNameConflict: None if a dataset with this directory
/// name already exists (nothing is written then).
async fn create_disk_scan_dataset(
    connection: &mut sqlx::PgConnection,
    store: &DataStoreRecord,
    hash: i32,
    entry: &DataSourceWithRootPathInfo,
) -> ApiResult<Option<String>> {
    let id = ObjectId::new().to_string();
    let source = &entry.data_source;
    let shape = crate::dataset::source::as_usable_shape(source);
    let inserted = crate::dataset::create::insert_dataset_unless_directory_name_taken(
        connection,
        crate::dataset::create::NewDataset {
            id: &id,
            store_name: &store.name,
            name: &source.id().directory_name,
            source: &shape,
            is_usable: source.is_usable(),
            voxel_size: source.voxel_size_opt(),
            status: source.status_opt().unwrap_or_default(),
            is_virtual: false,
            metadata: json!([]),
            description: None,
            creation_type: "DiskScan",
            import_url: None,
        },
    )
    .await?;
    if !inserted {
        return Ok(None);
    }
    // createDataset stores the hash only for usable data sources.
    sqlx::query(
        "UPDATE webknossos.datasets SET inboxSourceHash = $2, rootPath = $3, rootRealPath = $4 WHERE _id = $1",
    )
    .bind(&id)
    .bind(source.is_usable().then_some(hash))
    .bind(&entry.root_path)
    .bind(&entry.root_real_path)
    .execute(&mut *connection)
    .await?;
    Ok(Some(id))
}

/// DatasetDAO.deactivateUnreported.
async fn deactivate(
    connection: &mut sqlx::PgConnection,
    existing_ids: &[String],
    store_name: &str,
    organization: Option<&str>,
) -> ApiResult<()> {
    const TARGETS: &str = "SELECT _id FROM webknossos.datasets WHERE _dataStore = $1 AND NOT (_id = ANY($2)) AND NOT isVirtual AND ($3::text IS NULL OR _organization = $3)";
    for statement in [
        format!("DELETE FROM webknossos.dataset_mags WHERE _dataset IN ({TARGETS})"),
        format!("DELETE FROM webknossos.dataset_layers WHERE _dataset IN ({TARGETS})"),
    ] {
        sqlx::query(&statement)
            .bind(store_name)
            .bind(existing_ids)
            .bind(organization)
            .execute(&mut *connection)
            .await?;
    }
    sqlx::query(
        r#"UPDATE webknossos.datasets
           SET isUsable = false, status = $4, voxelSizeFactor = NULL, voxelSizeUnit = NULL, inboxSourceHash = NULL
           WHERE _dataStore = $1 AND NOT (_id = ANY($2)) AND NOT isVirtual AND ($3::text IS NULL OR _organization = $3)
             AND NOT (status = ANY($5))"#,
    )
    .bind(store_name)
    .bind(existing_ids)
    .bind(organization)
    .bind(UNREPORTED)
    .bind(&INACTIVE_STATUSES[..])
    .execute(&mut *connection)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------- real paths

/// RealPathInfo as stored strings.
fn normalized(infos: &[RealPathInfo]) -> Vec<(String, String, bool)> {
    infos
        .iter()
        .map(|info| {
            (
                info.path.to_string(),
                info.real_path.to_string(),
                info.has_local_data,
            )
        })
        .collect()
}

/// updateRealPaths: data sources whose dataset does not exist (ignored
/// reports of non-existing/forbidden organizations) are skipped.
async fn update_real_paths(
    State(state): State<AppState>,
    ValidatedDataStore(_store): ValidatedDataStore,
    Json(body): Json<Value>,
) -> ApiResult<StatusCode> {
    let infos = read_list(&body, DataSourcePathInfo::from_json).map_err(|_| invalid_body())?;
    let mut parsed = Vec::with_capacity(infos.len());
    for info in &infos {
        parsed.push((
            &info.data_source_id,
            normalized(&info.mag_path_infos),
            normalized(&info.attachment_path_infos),
        ));
    }
    let mut tx = state.pool.begin().await?;
    for (source_id, mags, attachments) in parsed {
        let dataset: Option<String> = sqlx::query_scalar(
            "SELECT _id FROM webknossos.datasets_ WHERE directoryName = $1 AND _organization = $2 LIMIT 1",
        )
        .bind(&source_id.directory_name)
        .bind(&source_id.organization_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(dataset) = dataset else { continue };
        // Rows already carrying the reported values are left untouched, like
        // the DAO's "check what actually changed first".
        for (table, infos) in [
            ("dataset_mags", &mags),
            ("dataset_layer_attachments", &attachments),
        ] {
            let statement = format!(
                "UPDATE webknossos.{table} SET realPath = $3, hasLocalData = $4
                 WHERE _dataset = $1 AND path = $2 AND (realPath IS DISTINCT FROM $3 OR hasLocalData <> $4)"
            );
            for (path, real_path, has_local_data) in infos {
                sqlx::query(&statement)
                    .bind(&dataset)
                    .bind(path)
                    .bind(real_path)
                    .bind(has_local_data)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }
    tx.commit().await?;
    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------- per dataset

/// getDataSource: DatasetService.dataSourceFor (real paths, credential ids).
async fn get_data_source(
    State(state): State<AppState>,
    Path((_name, id)): Path<(String, PathObjectId)>,
    ValidatedDataStore(_store): ValidatedDataStore,
) -> ApiResult<ResponseJson<Value>> {
    let row: Option<(bool, bool)> = sqlx::query_as(
        "SELECT isUsable, voxelSizeFactor IS NOT NULL FROM webknossos.datasets_ WHERE _id = $1",
    )
    .bind(id.as_str())
    .fetch_optional(&state.pool)
    .await?;
    let (is_usable, has_voxel_size) =
        row.ok_or_else(|| crate::dataset::lifecycle::not_found(id.as_str()))?;
    if is_usable && !has_voxel_size {
        return Err(ApiError::bad_request(
            crate::msg::dataset::data_source::USABLE_BUT_NO_VOXEL_SIZE,
        ));
    }
    Ok(ResponseJson(
        crate::dataset::routes::data_source_for_rpc(&state.pool, id.as_str(), true).await?,
    ))
}

/// updateDataSource: virtual datasets are left unchanged; root paths are kept.
async fn update_data_source(
    State(state): State<AppState>,
    Path((name, id)): Path<(String, PathObjectId)>,
    ValidatedDataStore(_store): ValidatedDataStore,
    Json(body): Json<Value>,
) -> ApiResult<StatusCode> {
    let source = DataSource::from_json(&body).map_err(|_| invalid_body())?;
    let mut tx = state.pool.begin().await?;
    let is_virtual: Option<bool> = sqlx::query_scalar(
        "SELECT isVirtual FROM webknossos.datasets_ WHERE _id = $1 FOR NO KEY UPDATE",
    )
    .bind(id.as_str())
    .fetch_optional(&mut *tx)
    .await?;
    let is_virtual = is_virtual.ok_or_else(|| crate::dataset::lifecycle::not_found(id.as_str()))?;
    if !is_virtual {
        let hash = crate::dataset::source::inbox_source_hash(&source);
        write_data_source(&mut tx, id.as_str(), &name, hash, &source, None, None).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests;
