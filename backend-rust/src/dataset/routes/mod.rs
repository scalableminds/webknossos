use axum::{
    Extension, Json, Router,
    extract::State,
    routing::{get, patch},
};
use serde::Deserialize;
use serde_json::{Value, json};

mod dao;

use crate::{
    AppState,
    auth::{AuthUser, OptionalAuthUser},
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    state::JobsEnabled,
    system::application_info::MiscState,
    users::notification_emails::{NotificationEmailService, SharedResource},
    util::id::{ObjectId, PathObjectId},
};

const UNREPORTED: &str = "No longer available on datastore.";
const DELETED_BY_USER: &str = "Deleted by user.";

/// Contracts shared by API v10-v16. List format changed in v16, so the list
/// route is kept in a separate router and must not be mounted on legacy APIs.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datasets/{datasetName}/isValidNewName", get(valid_name))
        .route(
            "/datasets/{datasetId}/sharingToken",
            get(sharing_token).delete(delete_sharing_token),
        )
        .route("/datasets/{datasetId}/teams", patch(update_teams))
        .route("/datasets/{datasetId}/accessList", get(access_list))
        .route(
            "/datasets/{datasetId}/dataSourceForSuperUser",
            get(superuser_data_source),
        )
}

pub fn list_router() -> Router<AppState> {
    // DatasetController.list wraps only its success result in addRemoteOriginHeaders.
    Router::new()
        .route("/datasets", get(list))
        .layer(axum::middleware::map_response(
            crate::util::cors::remote_origin_headers_on_success,
        ))
}

pub fn read_router() -> Router<AppState> {
    Router::new().route("/datasets/{datasetId}", get(read))
}

/// Main settings PATCH has no legacy response adapter; keep it separate from
/// the read router, which older API versions wrap in bigint compatibility.
pub fn metadata_router() -> Router<AppState> {
    Router::new().route("/datasets/{datasetId}", patch(update_metadata))
}

pub fn lookup_router() -> Router<AppState> {
    Router::new()
        .route("/datasets/findByImportURL", get(find_by_import_url))
        .route(
            "/datasets/disambiguate/{datasetName}/toNew",
            get(organization_for_name),
        )
        .route(
            "/datasets/disambiguate/{organizationId}/{datasetName}/toId",
            get(id_for_directory_name),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportQuery {
    #[serde(rename = "importURL")]
    import_url: String,
}

async fn find_by_import_url(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<ImportQuery>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
) -> ApiResult<Json<Value>> {
    let id = dao::find_id_by_import_url(&state.pool, &user, &query.import_url).await?;
    Ok(Json(match id {
        Some(id) => full_json(&state.pool, Some(&user), &id, jobs_enabled).await?,
        None => Value::Null,
    }))
}

async fn organization_for_name(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(name): Path<String>,
    Query(query): Query<ReadQuery>,
) -> ApiResult<Json<Value>> {
    let organization = dao::find_organization_by_name(
        &state.pool,
        user.as_ref(),
        query.sharing_token.as_deref(),
        &name,
    )
    .await?;
    Ok(Json(
        json!({"organization":organization.ok_or_else(||ApiError::not_found(crate::msg::NOT_FOUND))?}),
    ))
}

async fn id_for_directory_name(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path((organization, name)): Path<(String, String)>,
    Query(query): Query<ReadQuery>,
) -> ApiResult<Json<Value>> {
    let selected = dao::find_by_directory_name(&state.pool, &organization, &name).await?;
    let (id, result) = selected.ok_or_else(|| ApiError::not_found(crate::msg::dataset::MISSING))?;
    if crate::dataset::access::can_read(
        &state.pool,
        user.as_ref(),
        &id,
        query.sharing_token.as_deref(),
    )
    .await?
    {
        return Ok(Json(result));
    }
    // AccessibleBySwitchingService only tests another identity's grant. This
    // endpoint returns the id without changing the active identity or token.
    let user = user.ok_or_else(|| ApiError::not_found(crate::msg::dataset::MISSING))?;
    if user.is_superuser && user.organization_id != organization {
        return Ok(Json(result));
    }
    if user.organization_id != organization {
        let identities =
            dao::find_identities_in_organization(&state.pool, &user.id, &organization).await?;
        for identity in identities {
            if crate::dataset::access::can_read(&state.pool, Some(&identity), &id, None).await? {
                return Ok(Json(result));
            }
        }
    }
    Err(ApiError::not_found(crate::msg::dataset::MISSING))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataUpdate {
    description: Option<String>,
    name: Option<String>,
    display_name: Option<String>,
    #[serde(default, deserialize_with = "crate::util::instant::optional")]
    sorting_key: Option<chrono::DateTime<chrono::Utc>>,
    is_public: bool,
    tags: Vec<String>,
    metadata: Option<Vec<Value>>,
    folder_id: Option<ObjectId>,
}

pub(crate) fn validate_metadata(metadata: &[Value]) -> ApiResult<()> {
    fn keys(value: &Value, seen: &mut std::collections::HashSet<String>) -> ApiResult<()> {
        match value {
            Value::Object(object) => {
                for (key, value) in object {
                    if key == "key" {
                        let key = value.as_str().ok_or_else(|| {
                            ApiError::bad_request(
                                crate::msg::dataset::metadata::KEYS_MUST_BE_STRINGS,
                            )
                        })?;
                        if !seen.insert(key.to_owned()) {
                            return Err(ApiError::bad_request(
                                crate::msg::dataset::metadata::DUPLICATE_KEYS,
                            ));
                        }
                    }
                    keys(value, seen)?;
                }
            }
            Value::Array(array) => {
                for value in array {
                    keys(value, seen)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    let mut seen = std::collections::HashSet::new();
    for entry in metadata {
        if !entry.is_object() {
            return Err(ApiError::bad_request(
                crate::msg::dataset::metadata::ENTRIES_MUST_BE_OBJECTS,
            ));
        }
        keys(entry, &mut seen)?;
    }
    Ok(())
}

async fn update_metadata(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(misc): State<MiscState>,
    RequestJson(body): RequestJson<MetadataUpdate>,
) -> ApiResult<Json<Value>> {
    require_edit(&state, &user, &id).await?;
    let mut transaction = state.pool.begin().await?;
    crate::dataset::access::lock_edit(&mut transaction, &user, &id, true).await?;
    let (existing_metadata, existing_folder, organization, created): (
        Value,
        ObjectId,
        String,
        chrono::DateTime<chrono::Utc>,
    ) = dao::find_metadata_fields(&mut transaction, &id).await?;
    let metadata = body
        .metadata
        .unwrap_or_else(|| existing_metadata.as_array().cloned().unwrap_or_default());
    validate_metadata(&metadata)?;
    let folder = body.folder_id.unwrap_or(existing_folder);
    // Keep folder references live and within the dataset's organization. A
    // settings editor can move a dataset without managing the target folder.
    crate::dataset::dao::lock_folder_in_organization(&mut transaction, &folder, &organization)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::folder::NOT_IN_DATASET_ORGANIZATION))?;
    let sorting_key = body.sorting_key.unwrap_or(created);
    dao::update_metadata(
        &mut transaction,
        &id,
        body.description,
        body.display_name.or(body.name),
        sorting_key,
        body.is_public,
        body.tags,
        json!(metadata),
        folder,
    )
    .await?;
    let readable =
        crate::dataset::dao::is_readable_on_connection(&mut transaction, &user.id, &id).await?;
    if !readable {
        return Err(ApiError::not_found(crate::msg::dataset::MISSING));
    }
    let result = full_json_on_connection(&mut transaction, Some(&user), &id, jobs_enabled).await?;
    transaction.commit().await?;
    // ChangeDatasetSettingsEvent(request.identity, updated)
    crate::system::analytics::track(
        &state,
        &misc,
        &user,
        "change_dataset_settings".into(),
        crate::system::analytics::properties("dataset_id", id.as_str()),
    );
    Ok(Json(result))
}

async fn access_list(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Vec<Value>>> {
    require_read(&state, &user, &id).await?;
    let organization = dao::find_organization_id(&state.pool, &id).await?;
    if !dao::can_read_organization(&state.pool, &organization, &user).await? {
        return Err(ApiError::not_found(crate::msg::organization::MISSING));
    }
    let rows = dao::find_access_list(&state.pool, &user, &organization, &id).await?;
    Ok(Json(rows))
}

async fn superuser_data_source(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Value>> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(crate::msg::user::SUPER_USER_ROUTE_ONLY));
    }
    Ok(Json(
        data_source_json(&state.pool, &id, CredentialIdExposure::Include, true).await?,
    ))
}

#[derive(Clone, Copy)]
enum CredentialIdExposure {
    Omit,
    Include,
}

/// DataSource JSON as sent to the datastore (credential ids included). With
/// `use_real_paths = false`, stored paths are used instead of resolved real paths.
pub(crate) async fn data_source_for_rpc(
    pool: &sqlx::PgPool,
    id: &ObjectId,
    use_real_paths: bool,
) -> ApiResult<Value> {
    data_source_json(pool, id, CredentialIdExposure::Include, use_real_paths).await
}

async fn data_source_json(
    pool: &sqlx::PgPool,
    id: &ObjectId,
    exposure: CredentialIdExposure,
    use_real_paths: bool,
) -> ApiResult<Value> {
    let (usable, mut source, default_view_configuration) =
        dao::find_data_source_header(pool, id).await?;
    if usable {
        if source["scale"].is_null() {
            return Err(ApiError::internal());
        }
        source.as_object_mut().unwrap().remove("status");
        if let Some(default_view_configuration) =
            default_view_configuration.filter(|v| !v.is_null())
        {
            source["defaultViewConfiguration"] = default_view_configuration;
        }
        source["dataLayers"] =
            json!(full_layers_with_exposure(pool, id, exposure, use_real_paths).await?);
    } else {
        omit_null_fields(&mut source, &["scale"]);
    }
    Ok(source)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadQuery {
    sharing_token: Option<String>,
}

async fn read(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(id): Path<PathObjectId>,
    Query(query): Query<ReadQuery>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(misc): State<MiscState>,
) -> ApiResult<Json<Value>> {
    if !crate::dataset::access::can_read(
        &state.pool,
        user.as_ref(),
        &id,
        query.sharing_token.as_deref(),
    )
    .await?
    {
        return Err(ApiError::not_found(if user.is_some() {
            crate::msg::dataset::not_found(&id)
        } else {
            crate::msg::dataset::not_found_consider_login(&id)
        }));
    }
    if let Some(user) = user.as_ref() {
        dao::upsert_last_used_time(&state.pool, &id, &user.id).await?;
    }
    let result = full_json(&state.pool, user.as_ref(), &id, jobs_enabled).await?;
    if let Some(user) = user {
        crate::system::analytics::track_open_dataset(&state, &misc, &user, &id);
        crate::dataset::dao::touch_user_last_activity(&state.pool, user.id).await?;
    }
    Ok(Json(result))
}

/// Render DatasetService.publicWrites after the caller has checked read access.
/// Credentials and datastore keys are never selected into the returned JSON.
pub(crate) async fn full_json(
    pool: &sqlx::PgPool,
    user: Option<&AuthUser>,
    dataset_id: &ObjectId,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let mut connection = pool.acquire().await?;
    full_json_on_connection(&mut connection, user, dataset_id, jobs_enabled).await
}

pub(crate) async fn full_json_on_connection(
    connection: &mut sqlx::PgConnection,
    user: Option<&AuthUser>,
    dataset_id: &ObjectId,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let mut result = dao::find_public_json(connection, user, dataset_id).await?;
    let datastore_name = result["dataStore"]["name"]
        .as_str()
        .ok_or_else(ApiError::internal)?
        .to_owned();
    result["dataStore"] =
        public_datastore_json_on_connection(connection, &datastore_name, jobs_enabled).await?;
    let usable = result["isActive"].as_bool().unwrap_or(false);
    let datasource = result["dataSource"]
        .as_object_mut()
        .ok_or_else(ApiError::internal)?;
    if datasource["scale"].is_null() {
        if usable {
            return Err(ApiError::internal());
        }
        datasource.remove("scale");
    }
    if usable {
        datasource.remove("status");
        datasource.insert(
            "dataLayers".to_owned(),
            Value::Array(
                full_layers_with_exposure_on_connection(
                    connection,
                    dataset_id,
                    CredentialIdExposure::Omit,
                    true,
                )
                .await?,
            ),
        );
    }
    scrub_credentials(&mut result["dataSource"]);
    Ok(result)
}

/// DataStoreService.publicWrites, including WorkerDAO's command validation.
/// Datastore list routes can share this after applying their own read predicate.
pub(crate) async fn public_datastore_json_on_connection(
    connection: &mut sqlx::PgConnection,
    name: &str,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let (name, url, allows_upload) = dao::find_datastore_public_fields(connection, name).await?;
    let mut commands = dao::find_supported_job_commands(connection, &name).await?;
    for command in &commands {
        if !matches!(
            command.as_str(),
            "compute_mesh_file"
                | "compute_segment_index_file"
                | "convert_to_wkw"
                | "export_tiff"
                | "find_largest_segment_id"
                | "materialize_volume_annotation"
                | "render_animation"
                | "align_sections"
                | "infer_neurons"
                | "infer_instances"
                | "infer_mitochondria"
                | "train_neuron_model"
                | "train_instance_model"
                | "globalize_floodfills"
                | "train_model"
                | "infer_with_model"
                | "infer_nuclei"
        ) {
            return Err(ApiError::internal());
        }
    }
    let enabled = jobs_enabled && !commands.is_empty();
    if !jobs_enabled {
        commands.clear();
    }
    Ok(
        json!({"name":name,"url":url,"allowsUpload":allows_upload,"jobsSupportedByAvailableWorkers":commands,"jobsEnabled":enabled}),
    )
}

fn scrub_credentials(value: &mut Value) {
    match value {
        Value::Object(object) => {
            object.remove("credentialId");
            object.remove("credentials");
            for nested in object.values_mut() {
                scrub_credentials(nested);
            }
        }
        Value::Array(array) => {
            for nested in array {
                scrub_credentials(nested);
            }
        }
        _ => {}
    }
}

fn omit_null_fields(value: &mut Value, keys: &[&str]) {
    if let Some(object) = value.as_object_mut() {
        for key in keys {
            if object.get(*key).is_some_and(Value::is_null) {
                object.remove(*key);
            }
        }
    }
}

#[derive(Deserialize, serde::Serialize)]
struct AxisOrder {
    x: i32,
    y: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    z: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    c: Option<i32>,
}

fn canonicalize_axis_order(mag: &mut Value) {
    fn integer(value: &Value) -> Option<i32> {
        let number = value.as_f64()?;
        (number.fract() == 0.0 && number >= f64::from(i32::MIN) && number <= f64::from(i32::MAX))
            .then_some(number as i32)
    }
    if let Some(object) = mag.as_object_mut()
        && let Some(raw) = object.remove("axisOrder")
    {
        let optional_valid = |key| {
            raw.get(key)
                .is_none_or(|v| v.is_null() || integer(v).is_some())
        };
        if let (Some(x), Some(y)) = (integer(&raw["x"]), integer(&raw["y"]))
            && optional_valid("z")
            && optional_valid("c")
        {
            object.insert(
                "axisOrder".to_owned(),
                json!(AxisOrder {
                    x,
                    y,
                    z: integer(&raw["z"]),
                    c: integer(&raw["c"])
                }),
            );
        }
    }
}

fn vec3_list(value: &Value) -> bool {
    value.as_array().is_some_and(|vectors| {
        vectors.iter().all(|vector| {
            vector.as_array().is_some_and(|coordinates| {
                coordinates.len() == 3 && coordinates.iter().all(Value::is_number)
            })
        })
    })
}

fn canonicalize_transform(transform: &mut Value) -> ApiResult<()> {
    match transform["type"].as_str() {
        Some("affine") => {
            if !transform["matrix"].as_array().is_some_and(|rows| {
                rows.iter().all(|row| {
                    row.as_array()
                        .is_some_and(|values| values.iter().all(Value::is_number))
                })
            }) {
                return Err(ApiError::internal());
            }
            transform.as_object_mut().unwrap().remove("correspondences");
        }
        Some("thin_plate_spline") => {
            if !vec3_list(&transform["correspondences"]["source"])
                || !vec3_list(&transform["correspondences"]["target"])
            {
                return Err(ApiError::internal());
            }
            let correspondences = json!({"source":transform["correspondences"]["source"],"target":transform["correspondences"]["target"]});
            transform["correspondences"] = correspondences;
            transform.as_object_mut().unwrap().remove("matrix");
        }
        _ => return Err(ApiError::internal()),
    }
    Ok(())
}

pub(crate) async fn full_layers(
    pool: &sqlx::PgPool,
    dataset_id: &ObjectId,
) -> ApiResult<Vec<Value>> {
    full_layers_with_exposure(pool, dataset_id, CredentialIdExposure::Omit, true).await
}

async fn full_layers_with_exposure(
    pool: &sqlx::PgPool,
    dataset_id: &ObjectId,
    exposure: CredentialIdExposure,
    use_real_paths: bool,
) -> ApiResult<Vec<Value>> {
    let mut connection = pool.acquire().await?;
    full_layers_with_exposure_on_connection(&mut connection, dataset_id, exposure, use_real_paths)
        .await
}

async fn full_layers_with_exposure_on_connection(
    connection: &mut sqlx::PgConnection,
    dataset_id: &ObjectId,
    exposure: CredentialIdExposure,
    use_real_paths: bool,
) -> ApiResult<Vec<Value>> {
    let rows = dao::find_layers_json(connection, dataset_id, use_real_paths).await?;
    let attachments = dao::find_attachments_json(connection, dataset_id, use_real_paths).await?;
    let attachments = attachments
        .into_iter()
        .map(|(name, typ, mut attachment)| {
            omit_null_fields(&mut attachment, &["credentialId"]);
            if matches!(exposure, CredentialIdExposure::Omit) {
                attachment.as_object_mut().unwrap().remove("credentialId");
            }
            (name, typ, attachment)
        })
        .collect::<Vec<_>>();
    let mut result = Vec::new();
    for mut layer in rows {
        if layer["dataFormat"].is_null()
            || !matches!(layer["category"].as_str(), Some("color" | "segmentation"))
        {
            return Err(ApiError::internal());
        }
        let segmentation = layer["category"] == "segmentation";
        if let Some(id) = layer["largestSegmentId"].as_i64().filter(|_| segmentation) {
            layer["largestSegmentId"] =
                json!({"customJsonEncoding":"bigint","value":(id as u64).to_string()});
        } else {
            layer.as_object_mut().unwrap().remove("largestSegmentId");
        }
        if !segmentation || layer["mappings"].as_array().is_none_or(Vec::is_empty) {
            layer.as_object_mut().unwrap().remove("mappings");
        } else if let Some(mappings) = layer["mappings"].as_array_mut() {
            let mut seen = std::collections::HashSet::new();
            mappings.retain(|mapping| seen.insert(mapping.as_str().unwrap_or_default().to_owned()));
        }
        if let Some(mags) = layer["mags"].as_array_mut() {
            for mag in mags {
                omit_null_fields(mag, &["path", "axisOrder", "channelIndex", "credentialId"]);
                if matches!(exposure, CredentialIdExposure::Omit) {
                    mag.as_object_mut().unwrap().remove("credentialId");
                }
                canonicalize_axis_order(mag);
            }
        }
        layer["resolutions"] = json!(
            layer["mags"]
                .as_array()
                .unwrap()
                .iter()
                .map(|mag| mag["mag"].clone())
                .collect::<Vec<_>>()
        );
        if let Some(transforms) = layer["coordinateTransformations"].as_array_mut() {
            for transform in transforms {
                canonicalize_transform(transform)?;
            }
        }
        omit_null_fields(
            &mut layer,
            &[
                "defaultViewConfiguration",
                "adminViewConfiguration",
                "coordinateTransformations",
                "additionalAxes",
            ],
        );
        let mut wrapper = json!({"meshes":[],"agglomerates":[],"connectomes":[]});
        let mut present = false;
        for (_, typ, attachment) in attachments
            .iter()
            .filter(|(name, _, _)| layer["name"].as_str() == Some(name))
        {
            present = true;
            match typ.as_str() {
                "mesh" => wrapper["meshes"]
                    .as_array_mut()
                    .unwrap()
                    .push(attachment.clone()),
                "agglomerate" => wrapper["agglomerates"]
                    .as_array_mut()
                    .unwrap()
                    .push(attachment.clone()),
                "connectome" => wrapper["connectomes"]
                    .as_array_mut()
                    .unwrap()
                    .push(attachment.clone()),
                singleton => {
                    wrapper
                        .as_object_mut()
                        .unwrap()
                        .entry(singleton.to_owned())
                        .or_insert_with(|| attachment.clone());
                }
            }
        }
        if present {
            layer["attachments"] = wrapper;
        }
        result.push(layer);
    }
    Ok(result)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListQuery {
    is_active: Option<bool>,
    is_unreported: Option<bool>,
    organization_id: Option<String>,
    only_my_organization: Option<bool>,
    uploader_id: Option<ObjectId>,
    folder_id: Option<ObjectId>,
    include_subfolders: Option<bool>,
    search_query: Option<String>,
    limit: Option<i64>,
    pub(crate) include_annotation_count: Option<bool>,
    pub(crate) compact: Option<bool>,
}

async fn list(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<Vec<Value>>> {
    let rows = list_values(&state.pool, user.as_ref(), &query).await?;
    if let Some(user) = user {
        crate::dataset::dao::touch_user_last_activity(&state.pool, user.id).await?;
    }
    Ok(Json(rows))
}

pub(crate) async fn list_values(
    pool: &sqlx::PgPool,
    user: Option<&AuthUser>,
    query: &ListQuery,
) -> ApiResult<Vec<Value>> {
    if query.limit.is_some_and(|n| n < 0) {
        return Err(ApiError::bad_request(crate::msg::request::INVALID_LIMIT));
    }
    let organization = if query.only_my_organization.unwrap_or(false) {
        user.as_ref().map(|u| u.organization_id.as_str())
    } else {
        query.organization_id.as_deref()
    };
    let tokens: Vec<String> = query
        .search_query
        .as_deref()
        .map(|s| {
            s.trim()
                .to_lowercase()
                .split(' ')
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let searched_id = tokens
        .first()
        .filter(|s| tokens.len() == 1 && ObjectId::parse(s).is_ok());
    let rows = dao::find_all_compact(pool, user, query, organization, &tokens, searched_id).await?;
    rows.into_iter()
        .map(|row| serde_json::to_value(row).map_err(|_| ApiError::internal()))
        .collect()
}

/// DatasetCompactInfo as serialized by DatasetController.list (compact).
#[derive(sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CompactDataset {
    id: ObjectId,
    name: String,
    owning_organization: String,
    folder_id: ObjectId,
    is_active: bool,
    directory_name: String,
    created: i64,
    is_editable: bool,
    last_used_by_user: i64,
    status: String,
    tags: Vec<String>,
    is_unreported: bool,
    color_layer_names: Vec<String>,
    segmentation_layer_names: Vec<String>,
    used_storage_bytes: i64,
    thumbnail_cache_version: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    annotation_count: Option<i64>,
}

async fn require_read(state: &AppState, user: &AuthUser, id: &ObjectId) -> ApiResult<()> {
    if !crate::dataset::access::can_read(&state.pool, Some(user), id, None).await? {
        return Err(ApiError::not_found(crate::msg::dataset::MISSING));
    }
    Ok(())
}

async fn require_edit(state: &AppState, user: &AuthUser, id: &ObjectId) -> ApiResult<()> {
    require_read(state, user, id).await?;
    if !crate::dataset::access::can_edit(&state.pool, user, id).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    Ok(())
}

async fn sharing_token(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Value>> {
    require_read(&state, &user, &id).await?;
    // RandomIDGenerator.generateBlocking(): 16 random bytes, unpadded base64url (22 characters).
    let new_token = crate::auth::browser::random_base64url(16)?;
    let result = dao::set_sharing_token_if_absent(&state.pool, &user, &id, new_token).await?;
    Ok(Json(
        json!({"sharingToken": result.ok_or_else(|| ApiError::forbidden(crate::msg::NOT_ALLOWED_SHORT))?.trim()}),
    ))
}

async fn delete_sharing_token(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<()> {
    require_edit(&state, &user, &id).await?;
    let rows_affected = dao::clear_sharing_token(&state.pool, &user, &id).await?;
    if rows_affected != 1 {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    Ok(())
}

async fn update_teams(
    State(state): State<AppState>,
    Extension(notification_emails): Extension<NotificationEmailService>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    RequestJson(requested): RequestJson<Vec<ObjectId>>,
) -> ApiResult<Json<Vec<ObjectId>>> {
    require_edit(&state, &user, &id).await?;
    let mut transaction = state.pool.begin().await?;
    crate::dataset::access::lock_edit(&mut transaction, &user, &id, true).await?;
    // Dataset managers can update teams they can read; other users only teams
    // they manage. Unmanageable current grants must survive the replacement.
    let managed = dao::find_manageable_team_ids(&mut transaction, &user).await?;
    let current = dao::find_allowed_team_ids(&mut transaction, &id).await?;
    let mut updated: Vec<ObjectId> = requested
        .into_iter()
        .filter(|t| managed.contains(t))
        .collect();
    updated.extend(current.iter().filter(|t| !managed.contains(t)).cloned());
    let mut seen = std::collections::HashSet::new();
    updated.retain(|t| seen.insert(t.clone()));
    let pending_emails = notification_emails
        .prepare_share_emails(
            &mut transaction,
            SharedResource::Dataset { id: (*id).clone() },
            &current,
            &updated,
            &[&user.id],
        )
        .await;
    dao::delete_allowed_teams(&mut transaction, &id).await?;
    dao::insert_allowed_teams(&mut transaction, &id, &updated).await?;
    transaction.commit().await?;
    notification_emails.send_share_emails(&state.pool, pending_emails, &user.id);
    Ok(Json(updated))
}

async fn valid_name(_user: AuthUser, Path(name): Path<String>) -> Json<Value> {
    let error = if !name
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c))
    {
        Some(crate::msg::dataset::name::INVALID_CHARACTERS)
    } else if name.starts_with('.') {
        Some(crate::msg::dataset::name::INVALID_STARTS_WITH_DOT)
    } else if name.len() < 3 {
        Some(crate::msg::dataset::name::INVALID_LESS_THAN_THREE_CHARACTERS)
    } else {
        None
    };
    Json(
        error
            .map(|e| json!({"isValid": false, "errors": e}))
            .unwrap_or_else(|| json!({"isValid": true})),
    )
}
