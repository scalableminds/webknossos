//! DataSourceController's disk update, reload and cache invalidation entrypoints.
use super::helpers::{QueryFields, dataset_id, validated_body};
use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    error::{DsError, DsResult},
    models::{
        DataSource, DataSourceWithRootPathInfo, DiskWriteError, UsableDataSource,
        update_data_source_on_disk,
    },
};
use axum::{
    Json, Router,
    extract::{Path, RawQuery, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
};
use serde_json::Value;

pub fn router() -> Router<AppState> {
    controller(
        Router::new()
            .route(
                "/data/datasets/{datasetId}",
                put(update_on_disk).delete(invalidate_cache),
            )
            .route(
                "/data/triggers/reload/{organizationId}/{datasetId}",
                post(reload),
            )
            .route("/data/triggers/checkInboxBlocking", post(scan_inbox))
            .route(
                "/data/triggers/scanRealPathsForVirtual",
                post(scan_virtual_paths),
            )
            .route(
                "/data/triggers/createOrganizationDirectory",
                post(create_org_directory),
            )
            .route("/data/getOrganizationBaseDirectory", get(get_org_directory))
            .route(
                "/data/datasets/getOneBaseDirForOrgaAbsolute",
                get(get_one_base_dir_absolute),
            )
            .route(
                "/data/datasets/measureUsedStorage/{organizationId}",
                post(measure_used_storage),
            )
            .route(
                "/data/datasets/{datasetId}/deleteOnDisk",
                delete(delete_on_disk),
            )
            .route("/data/datasets/deletePaths", delete(delete_paths))
            .route("/data/datasets/validatePaths", post(validate_paths))
            .route("/data/datasets/writeMirrors", post(write_mirrors))
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/mappings",
                get(list_mappings),
            )
            .route("/data/datasets/exploreRemote", post(explore_remote)),
        true,
    )
}

async fn scan_inbox(
    State(state): State<AppState>,
    tc: TokenContext,
    RawQuery(raw): RawQuery,
) -> AccessResult<StatusCode> {
    let q = QueryFields::new(raw);
    let org = q.0.get("organizationId").map(String::as_str);
    let access = org
        .map(UserAccessRequest::administrate_datasets_of)
        .unwrap_or_else(UserAccessRequest::administrate_datasets);
    state.access.validate_access(access, &tc).await?;
    state
        .source_scanner
        .scan_base_directories(org, true)
        .await?;
    Ok(StatusCode::OK)
}

async fn scan_virtual_paths(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let sources = match validated_body(body, |v| {
        crate::models::json::read_list(v, DataSourceWithRootPathInfo::from_json)
    }) {
        Ok(sources) => sources,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    state
        .source_scanner
        .scan_real_paths_for_virtual(sources)
        .await?;
    Ok(StatusCode::OK.into_response())
}

async fn create_org_directory(
    State(state): State<AppState>,
    tc: TokenContext,
    RawQuery(raw): RawQuery,
) -> AccessResult<StatusCode> {
    let q = QueryFields::new(raw);
    let org = q.required("organizationId")?.to_owned();
    state
        .access
        .validate_access(UserAccessRequest::administrate_datasets_of(&org), &tc)
        .await?;
    let bases = state.base_dirs.clone();
    tokio::task::spawn_blocking(move || bases.get_one_local_for_org(&org, false, true, true))
        .await
        .map_err(DsError::from_exception)??;
    Ok(StatusCode::OK)
}

async fn get_org_directory(
    State(state): State<AppState>,
    tc: TokenContext,
    RawQuery(raw): RawQuery,
) -> AccessResult<Json<crate::models::UPath>> {
    let q = QueryFields::new(raw);
    let org = q.required("organizationId")?;
    // Both Booleans are required Play query parameters, unlike GET binary-data halfByte.
    q.required("requireAllowsUpload")?;
    q.required("requireLocal")?;
    let upload = q.bool_or_false("requireAllowsUpload")?;
    let local = q.bool_or_false("requireLocal")?;
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    Ok(Json(
        state.base_dirs.get_one_for_org(org, upload, local, false)?,
    ))
}

async fn update_on_disk(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(id): Path<String>,
    RawQuery(raw): RawQuery,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    let root = QueryFields::new(raw).required("rootPath")?.to_owned();
    let source = match validated_body(body, UsableDataSource::from_json) {
        Ok(source) => source,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    let result = tokio::task::spawn_blocking(move || {
        update_data_source_on_disk(std::path::Path::new(&root), &source)
    })
    .await
    .map_err(DsError::from_exception)?;
    match result {
        Ok(()) => {
            state.datasets.invalidate(&id);
            Ok(StatusCode::OK.into_response())
        }
        Err(DiskWriteError::Invalid(errors)) => Ok((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"messages":errors})),
        )
            .into_response()),
        Err(DiskWriteError::Failure(error)) => Err(error.into()),
    }
}

async fn invalidate_cache(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(id): Path<String>,
) -> AccessResult<StatusCode> {
    let id = dataset_id(&id)?;
    state
        .access
        .validate_access(UserAccessRequest::write_dataset(&id), &tc)
        .await?;
    state.datasets.invalidate(&id);
    // Scala shiftBox/foreach: refresh failures are deliberately swallowed, without fake data.
    if let Ok(source) = state.datasets.get_by_id(&id).await {
        clear_source_caches(&state, &DataSource::Usable((*source).clone()), None).await;
    }
    Ok(StatusCode::OK)
}

async fn reload(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((organization, id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
) -> AccessResult<Json<DataSource>> {
    let id = dataset_id(&id)?;
    let q = QueryFields::new(raw);
    let layer = q.0.get("layerName").map(String::as_str);
    state
        .access
        .validate_access(
            UserAccessRequest::administrate_datasets_of(&organization),
            &tc,
        )
        .await?;
    let source: DataSource = state
        .wk_client
        .get_data_source(&id)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?;
    check_organization(&source.id().organization_id, &organization)?;
    clear_source_caches(&state, &source, layer).await;
    Ok(Json(refresh_source(&state, &id, &organization, &tc).await?))
}

/// Existing data caches only; later DS5 services register their invalidation here.
async fn clear_source_caches(state: &AppState, source: &DataSource, layer: Option<&str>) {
    let id = source.id();
    let (closed, providers, chunks) =
        state
            .binary_data
            .clear_cache(&id.organization_id, &id.directory_name, layer);
    let segment_index_arrays = state.segment_index.clear_caches(id, layer);
    state.statistics_file.clear_caches(id, layer);
    state.index_statistics.clear_caches(id, layer);
    state.mesh_files.clear_caches(id, layer);
    state.mappings.clear_caches(id, layer);
    state.full_mesh.clear_caches(id, layer);
    state.connectomes.clear_caches(id, layer);
    tracing::debug!(source=%id, layer, segment_index_arrays, "Cleared segment index caches");
    if let Some(mags) = state
        .data_sources
        .invalidate_vault_cache(source, layer)
        .await
    {
        tracing::info!(source=%id,layer,closed_mapping_handles=closed,bucket_providers=providers,
            image_chunks=chunks,mag_references=mags,"Cleared datasource caches");
    }
}

fn check_organization(actual: &str, expected: &str) -> DsResult<()> {
    if actual == expected {
        Ok(())
    } else {
        Err(
            DsError::failure("Dataset does not belong to the requested organization.")
                .with_status(StatusCode::NOT_FOUND),
        )
    }
}

async fn refresh_source(
    state: &AppState,
    id: &str,
    organization: &str,
    tc: &TokenContext,
) -> DsResult<DataSource> {
    let source: DataSource = state
        .wk_client
        .get_data_source(id)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?;
    check_organization(&source.id().organization_id, organization)?;
    let root = state.wk_client.get_local_root_path_or_empty(id).await?;
    let disk_source = match root {
        Some(root) => {
            let service = state.data_sources.clone();
            let organization = source.id().organization_id.clone();
            tokio::task::spawn_blocking(move || {
                root.exists()
                    .then(|| service.data_source_from_dir(&root, &organization, true))
            })
            .await
            .map_err(DsError::from_exception)?
        }
        None => None,
    };
    if let Some(source) = &disk_source {
        state.wk_client.update_data_source(source, id, tc).await?;
    }
    state.datasets.invalidate(id);
    match (state.datasets.get_by_id(id).await, disk_source) {
        (Ok(source), _) => {
            check_organization(&source.id.organization_id, organization)?;
            Ok(DataSource::Usable((*source).clone()))
        }
        (_, Some(source)) => Ok(source),
        _ => Err(DsError::failure("DataSource not found").with_status(StatusCode::NOT_FOUND)),
    }
}

/// Scala `ObjectIdFormat.reads`.
fn read_object_id(json: &Value) -> crate::models::JsResult<String> {
    let id = crate::models::json::read_string(json)?;
    if id.len() == 24 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(id.to_ascii_lowercase())
    } else {
        Err(crate::models::JsError::new(format!(
            "The supplied resource id “{id}” is not a valid ObjectId."
        )))
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> DsResult<T> + Send + 'static,
) -> DsResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(DsError::from_exception)?
}

async fn get_one_base_dir_absolute(
    State(state): State<AppState>,
    tc: TokenContext,
    RawQuery(raw): RawQuery,
) -> AccessResult<Json<crate::models::UPath>> {
    let org = QueryFields::new(raw).required("organizationId")?.to_owned();
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    let bases = state.base_dirs.clone();
    let dir = blocking(move || bases.get_one_local_for_org(&org, false, false, false)).await?;
    Ok(Json(crate::models::UPath::from_local_path(&dir)))
}

async fn measure_used_storage(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(organization): Path<String>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let paths = match validated_body(body, |v| {
        let mut fields = crate::models::json::Fields::new(v);
        let paths = fields.req("paths", |v| {
            crate::models::json::read_list(v, crate::models::json::read_string)
        });
        fields.finish()?;
        paths
    }) {
        Ok(paths) => paths,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    let started = std::time::Instant::now();
    let reports = crate::services::dataset_files::measure_storage_for_paths(
        &state.data_vaults,
        &paths,
        tc.user_token.as_deref(),
    )
    .await?;
    if started.elapsed() > std::time::Duration::from_secs(10) {
        tracing::info!(
            "Measuring storage for orga {organization} for {} paths took {:?}",
            paths.len(),
            started.elapsed()
        );
    }
    Ok(Json(serde_json::json!({ "reports": reports })).into_response())
}

async fn delete_on_disk(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(id): Path<String>,
    RawQuery(raw): RawQuery,
) -> AccessResult<StatusCode> {
    let id = dataset_id(&id)?;
    let root = QueryFields::new(raw).required("rootPath")?.to_owned();
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    let source: DataSource = state
        .wk_client
        .get_data_source(&id)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?;
    let directory_name = source.id().directory_name.clone();
    blocking(move || {
        crate::services::dataset_files::move_to_trash(
            &id,
            std::path::Path::new(&root),
            &directory_name,
            Some("the user wants to delete the dataset"),
        )
    })
    .await
    .map_err(|e| e.wrap("Could not delete the dataset on disk."))?;
    Ok(StatusCode::OK)
}

async fn delete_paths(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let paths = match validated_body(body, |v| {
        crate::models::json::read_list(v, crate::models::UPath::from_json)
    }) {
        Ok(paths) => paths,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    let bases = state.base_dirs.clone();
    let to_delete = paths.clone();
    blocking(move || {
        crate::services::dataset_files::delete_local_paths_from_disk(&bases, &to_delete)
    })
    .await?;
    let managed: Vec<_> = paths
        .into_iter()
        .filter(|p| state.data_vaults.path_is_in_managed_s3(p))
        .collect();
    Ok(Json(managed).into_response())
}

async fn validate_paths(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let paths = match validated_body(body, |v| {
        crate::models::json::read_list(v, crate::models::UPath::from_json)
    }) {
        Ok(paths) => paths,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    let results: Vec<Value> = paths
        .into_iter()
        .map(|path| {
            let valid = state.data_vaults.path_is_allowed_to_add_directly(&path);
            serde_json::json!({ "path": path, "valid": valid })
        })
        .collect();
    Ok(Json(results).into_response())
}

async fn write_mirror_for_dataset(
    state: &AppState,
    id: &str,
) -> DsResult<Option<(String, String)>> {
    state.datasets.invalidate(id);
    let Ok(source) = state.datasets.get_by_id(id).await else {
        return Ok(None);
    };
    let bases = state.base_dirs.clone();
    let owned_id = id.to_owned();
    let mirror =
        blocking(move || crate::services::dataset_files::write_mirror(&bases, &source, &owned_id))
            .await
            .map_err(|e| e.wrap(format!("Error writing datasource mirror for {id}")))?;
    Ok(mirror.map(|path| (id.to_owned(), path)))
}

async fn write_mirrors(
    State(state): State<AppState>,
    tc: TokenContext,
    RawQuery(raw): RawQuery,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let q = QueryFields::new(raw);
    q.required("failOnError")?;
    let fail_on_error = q.bool_or_false("failOnError")?;
    let ids = match validated_body(body, |v| crate::models::json::read_list(v, read_object_id)) {
        Ok(ids) => ids,
        Err(response) => return Ok(*response),
    };
    if !state.config.write_virtual_datasets_mirror {
        return Ok(Json(Vec::<(String, String)>::new()).into_response());
    }
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    let mut results = Vec::new();
    let mut failures = Vec::new();
    for id in &ids {
        match write_mirror_for_dataset(&state, id).await {
            Ok(result) => results.extend(result),
            Err(e) if fail_on_error => return Err(e.into()),
            Err(e) => failures.push(e.to_string()),
        }
    }
    if fail_on_error {
        tracing::info!(
            "Successfully wrote dataset mirrors where needed for {} datasets.",
            ids.len()
        );
    } else {
        tracing::info!(
            "Wrote dataset mirrors where needed for {} datasets ({} failures: {})",
            ids.len(),
            failures.len(),
            failures.join(", ")
        );
    }
    Ok(Json(results).into_response())
}

async fn list_mappings(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
) -> AccessResult<Json<Vec<String>>> {
    let id = dataset_id(&id)?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let source = state.datasets.get_by_id(&id).await?;
    if source.get_data_layer(&layer_name).is_none() {
        return Err(
            DsError::failure(format!("Could not find layer “{layer_name}” in dataset.")).into(),
        );
    }
    let mappings = match state.wk_client.get_local_root_path_or_empty(&id).await? {
        Some(root) => {
            blocking(move || {
                Ok(crate::services::mapping::explore_mappings(
                    &root.join(&layer_name),
                ))
            })
            .await?
        }
        None => Vec::new(),
    };
    Ok(Json(mappings))
}

/// Scala `ExploreRemoteLayerParameters` reads.
fn read_explore_parameters(
    json: &Value,
) -> crate::models::JsResult<crate::explore::ExploreRemoteLayerParameters> {
    use crate::models::json::{Fields, read_string};
    let mut f = Fields::new(json);
    let remote_uri = f.req("remoteUri", read_string);
    let credential_id = f.opt("credentialId", read_string);
    let preferred = f.opt("preferredVoxelSize", crate::models::VoxelSize::from_json);
    f.finish()?;
    Ok(crate::explore::ExploreRemoteLayerParameters {
        remote_uri: remote_uri?,
        credential_id: credential_id?,
        preferred_voxel_size: preferred?,
    })
}

/// `java.net.URI.getScheme` of the part before a zip-entry `|` (if it parses as a URI scheme).
fn uri_scheme(uri: &str) -> Option<&str> {
    let head = uri.split('|').next().unwrap_or_default();
    let (scheme, _) = head.split_once(':')?;
    let mut chars = scheme.chars();
    (chars.next()?.is_ascii_alphabetic()
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')))
    .then_some(scheme)
}

async fn explore_remote(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let (parameters, organization) = match validated_body(body, |v| {
        use crate::models::json::{Fields, read_list, read_string};
        let mut f = Fields::new(v);
        let parameters = f.req("layerParameters", |v| read_list(v, read_explore_parameters));
        let organization = f.req("organizationId", read_string);
        f.finish()?;
        Ok((parameters?, organization?))
    }) {
        Ok(parsed) => parsed,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(
            UserAccessRequest::administrate_datasets_of(&organization),
            &tc,
        )
        .await?;
    let local_request = parameters
        .iter()
        .any(|p| uri_scheme(&p.remote_uri) == Some("file"));
    let service = crate::explore::ExploreRemoteLayerService {
        ctx: crate::explore::ExploreContext {
            vaults: state.data_vaults.clone(),
            token: tc.user_token.clone(),
        },
        wk_client: &state.wk_client,
        local_directory_whitelist: &state.config.local_directory_whitelist,
    };
    let mut report = Vec::new();
    let result = service
        .explore_remote_datasource(&parameters, &mut report)
        .await;
    // The recursive report would expose the local file system.
    if local_request {
        report.clear();
    }
    let data_source = match result {
        Ok(source) if !source.data_layers.is_empty() => {
            report.push(format!(
                "Resulted in dataSource with {} layers.",
                source.data_layers.len()
            ));
            Some(source)
        }
        Ok(_) => {
            report.push("Error when exploring as layer set: Resulted in zero layers.".into());
            None
        }
        Err(e) => {
            report.push(format!(
                "Error when exploring as layer set: {}",
                crate::explore::format_failure(&e)
            ));
            None
        }
    };
    let mut response = serde_json::json!({ "report": report.join("\n") });
    if let Some(source) = data_source {
        response["dataSource"] = serde_json::to_value(&source).map_err(DsError::from_exception)?;
    }
    Ok(Json(response).into_response())
}
