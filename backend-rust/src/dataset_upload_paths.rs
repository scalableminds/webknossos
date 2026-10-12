//! DatasetController reserve*UploadToPath* routes (UploadToPathsService, LayerToLinkService).
use axum::{Extension, Json, Router, extract::State, routing::post};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    dataset_access,
    dataset_create::{self, NewDataset},
    dataset_lifecycle::{
        self, AttachmentDataformat, AttachmentType, AttachmentUploadRequest, MagUploadRequest,
        NOT_YET_UPLOADED, NOT_YET_UPLOADED_TO_PATHS,
    },
    dataset_options::{DatasetRouteConfig, UploadToPathsConfig},
    dataset_paths,
    dataset_source::{self, Attachment, DataSource, Layer},
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path},
    id::{ObjectId, PathObjectId},
    service_clients::ServiceClients,
};

const NO_MATCHING_PREFIX: &str =
    "Could not determine a configured path prefix that matches the request.";
const FALLBACK_PREFIX: &str = "./binaryData";

pub fn router(config: DatasetRouteConfig) -> Router<AppState> {
    Router::new()
        .route(
            "/datasets/reserveUploadToPaths",
            post(reserve_upload_to_paths),
        )
        .route(
            "/datasets/{datasetId}/reserveUploadToPathsForPreliminary",
            post(reserve_for_preliminary),
        )
        .route(
            "/datasets/{datasetId}/reserveMagUploadToPath",
            post(reserve_mag_upload_to_path),
        )
        .route(
            "/datasets/{datasetId}/reserveAttachmentUploadToPath",
            post(reserve_attachment_upload_to_path),
        )
        .layer(Extension(config.upload_to_paths))
}

/// A request body's `pathPrefix` (Reads[UPath]); invalid paths are invalid JSON.
pub(crate) fn parse_prefix(prefix: Option<&str>) -> ApiResult<Option<String>> {
    prefix
        .map(|p| dataset_source::normalize_upath(p).map_err(dataset_source::invalid_body))
        .transpose()
}

/// UploadToPathsService.selectPathPrefix `?~> Msg.Dataset.Upload.ToPaths.noMatchingPrefix`:
/// the requested prefix if it is configured, otherwise the first configured one.
pub(crate) fn select_path_prefix(
    config: &UploadToPathsConfig,
    requested: Option<&str>,
) -> ApiResult<String> {
    let fallback = [FALLBACK_PREFIX.to_owned()];
    let configured: &[String] = if config.prefixes.is_empty() {
        &fallback
    } else {
        &config.prefixes
    };
    match requested {
        Some(requested) => configured.iter().find(|p| p.as_str() == requested),
        None => configured.first(),
    }
    .cloned()
    .ok_or_else(|| ApiError::bad_request(NO_MATCHING_PREFIX))
}

/// selectPathPrefixDatasetParent: requested (must be configured) or first
/// prefix, then the organization directory and infix.
fn dataset_parent(
    config: &UploadToPathsConfig,
    requested: Option<&str>,
    organization: &str,
) -> ApiResult<String> {
    let join = |base: &str, child: &str| {
        dataset_source::upath_join(base, child)
            .map_err(|_| ApiError::bad_request(NO_MATCHING_PREFIX))
    };
    let mut parent = select_path_prefix(config, requested)?;
    if config.insert_organization_directory {
        parent = join(&parent, organization)?;
    }
    if let Some(infix) = &config.infix {
        parent = join(&parent, infix)?;
    }
    Ok(parent)
}

fn join(base: &str, child: &str) -> ApiResult<String> {
    dataset_source::upath_join(base, child).map_err(|_| ApiError::bad_request("Invalid path."))
}

fn mag_literal_scalar(mag: [i32; 3]) -> String {
    if mag[0] == mag[1] && mag[1] == mag[2] {
        mag[0].to_string()
    } else {
        format!("{}-{}-{}", mag[0], mag[1], mag[2])
    }
}

fn default_directory(typ: &str) -> &'static str {
    match typ {
        "mesh" => "meshes",
        "agglomerate" | "cumsum" => "agglomerates",
        "segmentIndex" => "segmentIndex",
        "connectome" => "connectomes",
        _ => "segmentStatistics",
    }
}

fn suffix(data_format: &str) -> &'static str {
    match data_format {
        "hdf5" => ".hdf5",
        "json" => ".json",
        _ => "",
    }
}

/// UploadToPathsService.generateAttachmentPath.
fn attachment_path(
    name: &str,
    data_format: &str,
    typ: &str,
    layer_path: &str,
) -> ApiResult<String> {
    let safe = match dataset_create::normalize_strong(name) {
        Some(safe) => safe,
        None => format!("{typ}__{}", dataset_create::random_id(12)?),
    };
    join(
        &join(layer_path, default_directory(typ))?,
        &format!("{safe}{}", suffix(data_format)),
    )
}

/// addPathsToDatasource: every mag and attachment gets a generated path below
/// `<parent>/<directoryName>/<layer>`.
fn add_paths(source: &mut DataSource, parent: &str) -> ApiResult<()> {
    let dataset_path = join(parent, &source.directory_name)?;
    for layer in &mut source.layers {
        let layer_path = join(&dataset_path, &layer.name)?;
        for mag in &mut layer.mags {
            mag.path = Some(join(&layer_path, &mag_literal_scalar(mag.mag))?);
        }
        if let Some(attachments) = &mut layer.attachments {
            let mut result = Ok(());
            attachments.for_each_mut(|typ, attachment| {
                if result.is_ok() {
                    match attachment_path(
                        &attachment.name,
                        &attachment.data_format,
                        typ,
                        &layer_path,
                    ) {
                        Ok(path) => attachment.path = path,
                        Err(error) => result = Err(error),
                    }
                }
            });
            result?;
        }
    }
    Ok(())
}

/// LinkedLayerIdentifier (also read by the datastore upload callbacks).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedLayer {
    pub(crate) dataset_id: ObjectId,
    pub(crate) layer_name: String,
    pub(crate) new_layer_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReserveRequest {
    dataset_name: String,
    layers_to_link: Vec<LinkedLayer>,
    data_source: Value,
    folder_id: Option<ObjectId>,
    #[serde(default)]
    initial_team_ids: Vec<ObjectId>,
    #[serde(default)]
    require_unique_name: bool,
    path_prefix: Option<String>,
}

/// LayerToLinkService.resolveLayerToLink with the requesting user's read access.
pub(crate) async fn resolve_linked_layers(
    state: &AppState,
    user: &AuthUser,
    linked: &[LinkedLayer],
) -> ApiResult<Vec<Layer>> {
    let failed = || ApiError::bad_request("Could not resolve layers to link.");
    let mut layers = Vec::new();
    for link in linked {
        if !dataset_access::can_read(&state.pool, Some(user), link.dataset_id.as_str(), None)
            .await?
        {
            return Err(failed());
        }
        let usable: bool =
            sqlx::query_scalar("SELECT isUsable FROM webknossos.datasets_ WHERE _id = $1")
                .bind(link.dataset_id.as_str())
                .fetch_one(&state.pool)
                .await?;
        if !usable {
            return Err(failed());
        }
        let source = dataset_source::load(&state.pool, link.dataset_id.as_str()).await?;
        let mut layer = source
            .layers
            .into_iter()
            .find(|l| l.name == link.layer_name)
            .ok_or_else(failed)?;
        if let Some(name) = &link.new_layer_name {
            layer.name = name.clone();
        }
        layers.push(layer);
    }
    Ok(layers)
}

/// UploadToPathsService.findReferencedDataStore.
async fn referenced_data_store(
    connection: &mut sqlx::PgConnection,
    user: &AuthUser,
    linked: &[LinkedLayer],
) -> ApiResult<String> {
    let ids: Vec<&str> = linked.iter().map(|l| l.dataset_id.as_str()).collect();
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT trim(_dataStore) FROM webknossos.datasets_ WHERE _id = ANY($1) AND NOT isVirtual ORDER BY 1",
    )
    .bind(&ids)
    .fetch_all(&mut *connection)
    .await?;
    if names.len() > 1 {
        return Err(ApiError::bad_request(
            "Can only link layers of datasets from the same data store.",
        ));
    }
    let store: Option<(String, bool)> = sqlx::query_as(
        r#"SELECT name, allowsUploadToPaths FROM webknossos.dataStores_
           WHERE ($1::text IS NULL AND allowsUploadToPaths OR name = $1)
             AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $2)
           ORDER BY name LIMIT 1"#,
    )
    .bind(names.first())
    .bind(&user.organization_id)
    .fetch_optional(&mut *connection)
    .await?;
    let (name, allows) =
        store.ok_or_else(|| ApiError::bad_request("Data store could not be found or accessed."))?;
    if !allows {
        return Err(ApiError::bad_request(
            "The data store that holds the layers requested to be linked does not support dataset upload to paths.",
        ));
    }
    Ok(name)
}

/// DatasetService.addInitialTeams for a freshly created dataset.
pub(crate) async fn add_initial_teams(
    connection: &mut sqlx::PgConnection,
    user: &AuthUser,
    dataset: &str,
    teams: &[ObjectId],
) -> ApiResult<()> {
    let team_ids: Vec<&str> = teams.iter().map(ObjectId::as_str).collect();
    let allowed: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM webknossos.teams_ t WHERE t._id = ANY($1) AND (
             t._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $2 AND isAdmin)
             OR t._id IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $2 AND ($3 OR isTeamManager)))"#,
    )
    .bind(&team_ids)
    .bind(&user.id)
    .bind(user.is_dataset_manager)
    .fetch_one(&mut *connection)
    .await?;
    let mut distinct = team_ids.clone();
    distinct.sort_unstable();
    distinct.dedup();
    if allowed != distinct.len() as i64 {
        return Err(ApiError::bad_request(
            "Can only assign teams the requesting user is in.",
        ));
    }
    let readable: bool = sqlx::query_scalar(&format!(
        "SELECT {} FROM webknossos.datasets_ d WHERE d._id = $3",
        dataset_access::READ_PREDICATE
    ))
    .bind(&user.id)
    .bind(Option::<&str>::None)
    .bind(dataset)
    .fetch_one(&mut *connection)
    .await?;
    if !readable {
        return Err(ApiError::bad_request("No access to update dataset teams."));
    }
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset, _team) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING")
        .bind(dataset)
        .bind(&distinct)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

async fn reserve_upload_to_paths(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(config): Extension<UploadToPathsConfig>,
    RequestJson(body): RequestJson<ReserveRequest>,
) -> ApiResult<Json<Value>> {
    let mut source = dataset_source::parse_data_source(&body.data_source)
        .map_err(dataset_source::invalid_body)?;
    let path_prefix = parse_prefix(body.path_prefix.as_deref())?;
    let (root_folder, included): (String, Option<i64>) = sqlx::query_as(
        "SELECT _rootFolder, includedStorage FROM webknossos.organizations_ WHERE _id = $1",
    )
    .bind(&user.organization_id)
    .fetch_one(&state.pool)
    .await?;
    if let Some(included) = included {
        let used: i64 = sqlx::query_scalar(
            r#"SELECT COALESCE(SUM(usedStorageBytes), 0)::bigint FROM (
                 SELECT usedStorageBytes FROM webknossos.organization_usedStorage_mags WHERE _organization = $1
                 UNION ALL
                 SELECT usedStorageBytes FROM webknossos.organization_usedStorage_attachments WHERE _organization = $1) combined"#,
        )
        .bind(&user.organization_id)
        .fetch_one(&state.pool)
        .await?;
        if used > included {
            return Err(ApiError::forbidden(
                "Cannot upload dataset because the storage quota of the organization is exceeded.",
            ));
        }
    }
    if body.require_unique_name {
        // Scala passes the arguments swapped, which disables this check; the
        // intended uniqueness check is applied.
        let taken: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE name = $1 AND _organization = $2)",
        )
        .bind(&body.dataset_name)
        .bind(&user.organization_id)
        .fetch_one(&state.pool)
        .await?;
        if taken {
            return Err(ApiError::bad_request(format!(
                "Dataset name “{}” is already taken.",
                body.dataset_name
            )));
        }
    }
    dataset_create::validate_dataset_name(&body.dataset_name)?;
    for layer in &source.layers {
        dataset_create::validate_layer_name_lax(&layer.name)?;
    }
    for name in body
        .layers_to_link
        .iter()
        .filter_map(|l| l.new_layer_name.as_ref())
    {
        dataset_create::validate_layer_name_lax(name)?;
    }
    let id = ObjectId::new().to_string();
    source.directory_name = dataset_create::generate_directory_name(&body.dataset_name, &id);
    source.organization = user.organization_id.clone();
    if source.layers.is_empty() {
        return Err(ApiError::bad_request(
            "Cannot reserve upload for dataset with no layers.",
        ));
    }
    let parent = dataset_parent(&config, path_prefix.as_deref(), &user.organization_id)?;
    add_paths(&mut source, &parent)?;
    let mut with_linked = source.clone();
    let mut layers = resolve_linked_layers(&state, &user, &body.layers_to_link).await?;
    layers.extend(with_linked.layers);
    with_linked.layers = layers;
    let mut names = std::collections::HashSet::new();
    if !with_linked
        .layers
        .iter()
        .all(|l| names.insert(l.name.clone()))
    {
        return Err(ApiError::bad_request(
            "Dataset layers must have unique names.",
        ));
    }
    dataset_create::assert_valid_data_source(&with_linked)?;
    let folder = body
        .folder_id
        .as_ref()
        .map(|f| f.as_str().to_owned())
        .unwrap_or(root_folder);
    let mut transaction = state.pool.begin().await?;
    if !dataset_create::folder_writable(&mut transaction, &user, &folder).await? {
        return Err(ApiError::bad_request("No write access in this folder."));
    }
    let store = referenced_data_store(&mut transaction, &user, &body.layers_to_link).await?;
    dataset_create::insert_dataset(
        &mut transaction,
        NewDataset {
            id: &id,
            store_name: &store,
            name: &body.dataset_name,
            source: &with_linked,
            is_usable: false,
            voxel_size: Some((with_linked.factor, &with_linked.unit)),
            status: NOT_YET_UPLOADED_TO_PATHS,
            is_virtual: true,
            metadata: json!([]),
            description: None,
            creation_type: "UploadToPaths",
            import_url: None,
        },
    )
    .await?;
    sqlx::query("UPDATE webknossos.datasets SET _folder = $2, _uploader = $3 WHERE _id = $1")
        .bind(&id)
        .bind(&folder)
        .bind(&user.id)
        .execute(&mut *transaction)
        .await?;
    add_initial_teams(&mut transaction, &user, &id, &body.initial_team_ids).await?;
    transaction.commit().await?;
    // Linked layers are managed by the server; the client only needs its own paths.
    Ok(Json(
        json!({"newDatasetId": id, "dataSource": dataset_source::data_source_json(&source)}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreliminaryRequest {
    data_source: Value,
    path_prefix: Option<String>,
}

async fn reserve_for_preliminary(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(config): Extension<UploadToPathsConfig>,
    RequestJson(body): RequestJson<PreliminaryRequest>,
) -> ApiResult<Json<Value>> {
    let mut source = dataset_source::parse_data_source(&body.data_source)
        .map_err(dataset_source::invalid_body)?;
    let path_prefix = parse_prefix(body.path_prefix.as_deref())?;
    dataset_lifecycle::require_readable(&state, &user, &id).await?;
    let mut transaction = state.pool.begin().await?;
    let (status, uploader, directory): (String, Option<String>, String) = sqlx::query_as(
        "SELECT status, _uploader, directoryName FROM webknossos.datasets_ WHERE _id = $1 FOR UPDATE",
    )
    .bind(id.as_str())
    .fetch_one(&mut *transaction)
    .await?;
    if status != NOT_YET_UPLOADED {
        return Err(ApiError::bad_request(format!(
            "Dataset is not in uploading status, got {status}."
        )));
    }
    if uploader.as_deref() != Some(user.id.as_str()) {
        return Err(ApiError::bad_request(
            "Cannot reserve paths for a dataset someone else uploaded.",
        ));
    }
    source.directory_name = directory;
    source.organization = user.organization_id.clone();
    source.status_opt = Some(NOT_YET_UPLOADED.to_owned());
    let parent = dataset_parent(&config, path_prefix.as_deref(), &user.organization_id)?;
    add_paths(&mut source, &parent)?;
    dataset_create::assert_valid_data_source(&source)?;
    // DatasetDAO.updateDataSource(isUsable = false).
    sqlx::query(
        r#"UPDATE webknossos.datasets SET _organization = $2, inboxSourceHash = NULL, defaultViewConfiguration = $3,
             isUsable = false, voxelSizeFactor = ROW($4, $5, $6)::webknossos.VECTOR3,
             voxelSizeUnit = $7::webknossos.LENGTH_UNIT, status = $8 WHERE _id = $1"#,
    )
    .bind(id.as_str())
    .bind(&user.organization_id)
    .bind(source.default_view_configuration.clone().map(Value::Object))
    .bind(source.factor[0])
    .bind(source.factor[1])
    .bind(source.factor[2])
    .bind(&source.unit)
    .bind(NOT_YET_UPLOADED)
    .execute(&mut *transaction)
    .await?;
    dataset_source::write_layers(&mut transaction, id.as_str(), &source.layers).await?;
    transaction.commit().await?;
    Ok(Json(
        json!({"dataSource": dataset_source::data_source_json(&source)}),
    ))
}

fn not_usable(id: &ObjectId) -> ApiError {
    ApiError::bad_request(format!("Dataset “{id}” is not imported or incomplete."))
}

async fn reserve_mag_upload_to_path(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(config): Extension<UploadToPathsConfig>,
    Extension(clients): Extension<ServiceClients>,
    RequestJson(body): RequestJson<MagUploadRequest>,
) -> ApiResult<Json<String>> {
    let path_prefix = parse_prefix(body.path_prefix.as_deref())?;
    let axis_order = body
        .axis_order
        .as_ref()
        .map(|order| {
            let x = order.get("x").map(dataset_source::int);
            let y = order.get("y").map(dataset_source::int);
            match (x, y) {
                (Some(Ok(_)), Some(Ok(_))) => Ok(order.clone()),
                _ => Err(ApiError::bad_request("Invalid JSON request body.")),
            }
        })
        .transpose()?;
    let record = dataset_lifecycle::require_readable(&state, &user, &id).await?;
    if !record.is_virtual {
        return Err(ApiError::bad_request(
            "Adding mags to existing datasets is only allowed for virtual datasets.",
        ));
    }
    if !dataset_access::can_edit(&state.pool, &user, id.as_str()).await? {
        return Err(dataset_lifecycle::not_allowed());
    }
    if !record.is_usable {
        return Err(not_usable(&id));
    }
    let [x, y, z] = body.mag.map(f64::from);
    let mag_predicate =
        "_dataset = $1 AND dataLayerName = $2 AND mag = ROW($3, $4, $5)::webknossos.VECTOR3";
    let pending: Vec<(Option<String>, bool)> = sqlx::query_as(&format!(
        "SELECT path, uploadToPathIsPending FROM webknossos.dataset_mags WHERE {mag_predicate} AND (uploadToPathIsPending OR uploadIsPending)"
    ))
    .bind(id.as_str())
    .bind(&body.layer_name)
    .bind(x)
    .bind(y)
    .bind(z)
    .fetch_all(&state.pool)
    .await?;
    if !pending.is_empty() {
        if !body.overwrite_pending {
            return Err(ApiError::bad_request(
                "Conflict with existing pending mag. Pass overwritePending to overwrite.",
            ));
        }
        let old_paths: Vec<String> = pending
            .iter()
            .filter(|(_, to_path)| *to_path)
            .filter_map(|(path, _)| path.clone())
            .collect();
        if !old_paths.is_empty() {
            dataset_paths::delete_paths(&state.pool, &clients, record.store_url()?, &old_paths)
                .await?;
        }
    }
    let parent = dataset_parent(&config, path_prefix.as_deref(), &record.organization)?;
    let directory: String =
        sqlx::query_scalar("SELECT directoryName FROM webknossos.datasets_ WHERE _id = $1")
            .bind(id.as_str())
            .fetch_one(&state.pool)
            .await?;
    let layer_path = join(&join(&parent, &directory)?, &body.layer_name)?;
    let path = join(
        &layer_path,
        &format!(
            "{}__{}",
            mag_literal_scalar(body.mag),
            dataset_create::random_id(12)?
        ),
    )?;
    let mut transaction = state.pool.begin().await?;
    if body.overwrite_pending {
        sqlx::query(&format!(
            "DELETE FROM webknossos.dataset_mags WHERE {mag_predicate} AND (uploadToPathIsPending OR uploadIsPending)"
        ))
        .bind(id.as_str())
        .bind(&body.layer_name)
        .bind(x)
        .bind(y)
        .bind(z)
        .execute(&mut *transaction)
        .await?;
    }
    sqlx::query(r#"INSERT INTO webknossos.dataset_mags (_dataset, dataLayerName, mag, path, axisOrder, channelIndex, uploadToPathIsPending, uploadIsPending)
        VALUES ($1, $2, ROW($3, $4, $5)::webknossos.VECTOR3, $6, $7, $8, true, false)"#)
        .bind(id.as_str()).bind(&body.layer_name).bind(x).bind(y).bind(z)
        .bind(&path).bind(axis_order).bind(body.channel_index)
        .execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(Json(path))
}

fn is_singleton(typ: AttachmentType) -> bool {
    matches!(
        typ,
        AttachmentType::SegmentIndex | AttachmentType::Cumsum | AttachmentType::SegmentStatistics
    )
}

async fn reserve_attachment_upload_to_path(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(config): Extension<UploadToPathsConfig>,
    RequestJson(body): RequestJson<AttachmentUploadRequest>,
) -> ApiResult<Json<String>> {
    let path_prefix = parse_prefix(body.path_prefix.as_deref())?;
    let record = dataset_lifecycle::require_editable(&state, &user, &id).await?;
    if !record.is_usable {
        return Err(not_usable(&id));
    }
    let typ = body.attachment_type.as_str();
    let mut transaction = state.pool.begin().await?;
    sqlx::query("SELECT _id FROM webknossos.datasets_ WHERE _id = $1 FOR UPDATE")
        .bind(id.as_str())
        .fetch_one(&mut *transaction)
        .await?;
    let identity = "_dataset = $1 AND layerName = $2 AND type = $3::webknossos.LAYER_ATTACHMENT_TYPE AND name = $4 AND (uploadIsPending OR uploadToPathIsPending)";
    if body.overwrite_pending.unwrap_or(false) {
        sqlx::query(&format!(
            "DELETE FROM webknossos.dataset_layer_attachments WHERE {identity}"
        ))
        .bind(id.as_str())
        .bind(&body.layer_name)
        .bind(typ)
        .bind(&body.attachment_name)
        .execute(&mut *transaction)
        .await?;
    } else {
        let pending: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments WHERE {identity})"
        ))
        .bind(id.as_str())
        .bind(&body.layer_name)
        .bind(typ)
        .bind(&body.attachment_name)
        .fetch_one(&mut *transaction)
        .await?;
        if pending {
            return Err(ApiError::bad_request(
                "Conflict with existing pending attachment. Pass overwritePending to overwrite.",
            ));
        }
    }
    let singleton = is_singleton(body.attachment_type);
    let existing: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM webknossos.dataset_layer_attachments WHERE _dataset = $1 AND layerName = $2 AND ($3::text IS NULL OR name = $3) AND type = $4::webknossos.LAYER_ATTACHMENT_TYPE",
    )
    .bind(id.as_str())
    .bind(&body.layer_name)
    .bind((!singleton).then_some(&body.attachment_name))
    .bind(typ)
    .fetch_one(&mut *transaction)
    .await?;
    if existing != 0 {
        return Err(ApiError::bad_request(if singleton {
            "There is already an attachment of this type in this layer. Only one attachment of this type can be registered per layer."
        } else {
            "An attachment with this name already exists in this layer. Please choose a different name."
        }));
    }
    let directory: String =
        sqlx::query_scalar("SELECT directoryName FROM webknossos.datasets_ WHERE _id = $1")
            .bind(id.as_str())
            .fetch_one(&mut *transaction)
            .await?;
    let parent = dataset_parent(&config, path_prefix.as_deref(), &record.organization)?;
    let layer_path = join(&join(&parent, &directory)?, &body.layer_name)?;
    let format: AttachmentDataformat = body.attachment_dataformat;
    let path = attachment_path(&body.attachment_name, format.as_str(), typ, &layer_path)?;
    let attachment = Attachment {
        name: body.attachment_name.clone(),
        path: path.clone(),
        data_format: format.as_str().to_owned(),
        credential_id: None,
    };
    sqlx::query(r#"INSERT INTO webknossos.dataset_layer_attachments (_dataset, layerName, name, path, type, dataFormat, uploadToPathIsPending, uploadIsPending)
        VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6::webknossos.LAYER_ATTACHMENT_DATAFORMAT, true, false)"#)
        .bind(id.as_str()).bind(&body.layer_name).bind(&attachment.name).bind(&attachment.path)
        .bind(typ).bind(&attachment.data_format)
        .execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(Json(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dataset_parents_use_prefix_organization_and_infix() {
        let config = UploadToPathsConfig {
            prefixes: vec!["/srv/a".into(), "s3://bucket/b".into()],
            ..Default::default()
        };
        assert_eq!(
            dataset_parent(&config, None, "org").unwrap(),
            "/srv/a/org/.virtual"
        );
        assert_eq!(
            dataset_parent(&config, Some("s3://bucket/b"), "org").unwrap(),
            "s3://bucket/b/org/.virtual"
        );
        assert!(dataset_parent(&config, Some("/elsewhere"), "org").is_err());
        let plain = UploadToPathsConfig {
            prefixes: vec![],
            insert_organization_directory: false,
            infix: None,
        };
        assert_eq!(dataset_parent(&plain, None, "org").unwrap(), "./binaryData");
        assert_eq!(
            attachment_path("Mesh ä", "hdf5", "mesh", "/p/layer").unwrap(),
            "/p/layer/meshes/Mesh ae.hdf5"
        );
        let generated = attachment_path("§", "zarr3", "cumsum", "/p/layer").unwrap();
        assert!(generated.starts_with("/p/layer/agglomerates/cumsum__"));
    }
}
