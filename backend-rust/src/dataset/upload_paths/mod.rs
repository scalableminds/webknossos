//! DatasetController reserve*UploadToPath* routes (UploadToPathsService, LayerToLinkService).
use axum::{Extension, Json, Router, extract::State, routing::post};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    dataset::create::NewDataset,
    dataset::lifecycle::{
        AttachmentUploadRequest, MagUploadRequest, NOT_YET_UPLOADED, NOT_YET_UPLOADED_TO_PATHS,
    },
    dataset::options::{DatasetRouteConfig, UploadToPathsConfig},
    dataset::source::{StaticLayer, UsableDataSource},
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path},
    remote::datastore::{attachment_upload::push_attachment_key, mag_upload::push_mag_predicate},
    sql::Sql,
    stores::client::ServiceClients,
    util::id::{ObjectId, PathObjectId},
};
use webknossos_common::{
    datasource::DataSourceId,
    enums::{LayerAttachmentDataformat, LayerAttachmentType},
    geometry::Vec3Int,
    json::read_i32,
    upath::{UPath, UPathError},
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
        .map(|p| {
            UPath::parse(p)
                .map(|p| p.to_string())
                .map_err(crate::dataset::source::invalid_body)
        })
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
        join_literal(base, child)
            .map(|path| path.to_string())
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

/// UPath `/` on a UPath literal.
fn join_literal(base: &str, child: &str) -> Result<UPath, UPathError> {
    Ok(UPath::parse(base)?.join(child))
}

fn join(base: &str, child: &str) -> ApiResult<UPath> {
    join_literal(base, child)
        .map_err(|_| ApiError::bad_request(crate::msg::request::INVALID_STORAGE_PATH))
}

/// UploadToPathsService.generateAttachmentPath.
fn attachment_path(
    name: &str,
    data_format: LayerAttachmentDataformat,
    typ: LayerAttachmentType,
    layer_path: &UPath,
) -> ApiResult<UPath> {
    let safe = match crate::util::text::normalize_strong(name) {
        Some(safe) => safe,
        None => format!("{typ}__{}", crate::dataset::create::random_id(12)?),
    };
    Ok(layer_path
        .join(typ.default_directory_name())
        .join(&format!("{safe}{}", data_format.suffix())))
}

/// addPathsToDatasource: every mag and attachment gets a generated path below
/// `<parent>/<directoryName>/<layer>`.
fn add_paths(source: &mut UsableDataSource, parent: &str) -> ApiResult<()> {
    let dataset_path = join(parent, &source.id.directory_name)?;
    for layer in &mut source.data_layers {
        let layer_path = dataset_path.join(&layer.name);
        for mag in &mut layer.mags {
            mag.path = Some(layer_path.join(&mag.mag.to_mag_literal(true)));
        }
        if let Some(attachments) = &layer.attachments {
            let failure = std::cell::RefCell::new(None);
            let mapped = attachments.mapped_with_type(|attachment, typ| {
                let mut attachment = attachment.clone();
                match attachment_path(&attachment.name, attachment.data_format, typ, &layer_path) {
                    Ok(path) => attachment.path = path,
                    Err(error) => *failure.borrow_mut() = Some(error),
                }
                attachment
            });
            if let Some(error) = failure.into_inner() {
                return Err(error);
            }
            layer.attachments = Some(mapped);
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
) -> ApiResult<Vec<StaticLayer>> {
    let failed = || ApiError::bad_request(crate::msg::dataset::layer_to_link::FAILED);
    let mut layers = Vec::new();
    for link in linked {
        if !crate::dataset::access::can_read(&state.pool, Some(user), &link.dataset_id, None)
            .await?
        {
            return Err(failed());
        }
        let usable: bool =
            sqlx::query_scalar("SELECT isUsable FROM webknossos.datasets_ WHERE _id = $1")
                .bind(&link.dataset_id)
                .fetch_one(&state.pool)
                .await?;
        if !usable {
            return Err(failed());
        }
        let source = crate::dataset::source::load(&state.pool, &link.dataset_id).await?;
        let mut layer = source
            .data_layers
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
    let ids: Vec<&ObjectId> = linked.iter().map(|l| &l.dataset_id).collect();
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT trim(_dataStore) FROM webknossos.datasets_ WHERE _id = ANY($1) AND NOT isVirtual ORDER BY 1",
    )
    .bind(&ids)
    .fetch_all(&mut *connection)
    .await?;
    if names.len() > 1 {
        return Err(ApiError::bad_request(crate::msg::data_store::AMBIGUOUS));
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
        store.ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))?;
    if !allows {
        return Err(ApiError::bad_request(
            crate::msg::data_store::UPLOAD_TO_PATHS_NOT_ALLOWED,
        ));
    }
    Ok(name)
}

/// DatasetService.addInitialTeams for a freshly created dataset.
pub(crate) async fn add_initial_teams(
    connection: &mut sqlx::PgConnection,
    user: &AuthUser,
    dataset: &ObjectId,
    teams: &[ObjectId],
) -> ApiResult<()> {
    let allowed: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM webknossos.teams_ t WHERE t._id = ANY($1) AND (
             t._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $2 AND isAdmin)
             OR t._id IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $2 AND ($3 OR isTeamManager)))"#,
    )
    .bind(teams)
    .bind(&user.id)
    .bind(user.is_dataset_manager)
    .fetch_one(&mut *connection)
    .await?;
    let mut distinct: Vec<&ObjectId> = teams.iter().collect();
    distinct.sort_unstable();
    distinct.dedup();
    if allowed != distinct.len() as i64 {
        return Err(ApiError::bad_request(
            crate::msg::dataset::initial_teams::INVALID_TEAMS,
        ));
    }
    let mut q = Sql::new("SELECT ");
    crate::dataset::access::push_read_predicate(&mut q, (&user.id).into(), None);
    q.push(" FROM webknossos.datasets_ d WHERE d._id = ")
        .push_bind(dataset);
    let readable: bool = q.build_query_scalar().fetch_one(&mut *connection).await?;
    if !readable {
        return Err(ApiError::bad_request(
            crate::msg::dataset::initial_teams::FORBIDDEN,
        ));
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
    let mut source = UsableDataSource::from_json(&body.data_source)
        .map_err(crate::dataset::source::invalid_body)?;
    let path_prefix = parse_prefix(body.path_prefix.as_deref())?;
    let (root_folder, included): (ObjectId, Option<i64>) = sqlx::query_as(
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
                crate::msg::dataset::upload::STORAGE_EXCEEDED,
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
            return Err(ApiError::bad_request(crate::msg::dataset::name::taken(
                &body.dataset_name,
            )));
        }
    }
    crate::dataset::create::validate_dataset_name(&body.dataset_name)?;
    for layer in &source.data_layers {
        crate::dataset::create::validate_layer_name_lax(&layer.name)?;
    }
    for name in body
        .layers_to_link
        .iter()
        .filter_map(|l| l.new_layer_name.as_ref())
    {
        crate::dataset::create::validate_layer_name_lax(name)?;
    }
    let id = ObjectId::new();
    source.id = DataSourceId::new(
        crate::dataset::create::generate_directory_name(&body.dataset_name, &id),
        &user.organization_id,
    );
    if source.data_layers.is_empty() {
        return Err(ApiError::bad_request(
            crate::msg::dataset::upload::NO_LAYERS,
        ));
    }
    let parent = dataset_parent(&config, path_prefix.as_deref(), &user.organization_id)?;
    add_paths(&mut source, &parent)?;
    let mut with_linked = source.clone();
    let mut layers = resolve_linked_layers(&state, &user, &body.layers_to_link).await?;
    layers.extend(with_linked.data_layers);
    with_linked.data_layers = layers;
    let mut names = std::collections::HashSet::new();
    if !with_linked
        .data_layers
        .iter()
        .all(|l| names.insert(l.name.clone()))
    {
        return Err(ApiError::bad_request(
            crate::msg::dataset::layer::DUPLICATE_NAMES,
        ));
    }
    crate::dataset::create::assert_valid_data_source(&with_linked)?;
    let folder = body.folder_id.as_ref().unwrap_or(&root_folder);
    let mut transaction = state.pool.begin().await?;
    if !crate::dataset::create::folder_writable(&mut transaction, &user, folder).await? {
        return Err(ApiError::bad_request(crate::msg::folder::NO_WRITE_ACCESS));
    }
    let store = referenced_data_store(&mut transaction, &user, &body.layers_to_link).await?;
    crate::dataset::create::insert_dataset(
        &mut transaction,
        NewDataset {
            id: &id,
            store_name: &store,
            name: &body.dataset_name,
            source: &with_linked,
            is_usable: false,
            voxel_size: Some(with_linked.scale),
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
        .bind(folder)
        .bind(&user.id)
        .execute(&mut *transaction)
        .await?;
    add_initial_teams(&mut transaction, &user, &id, &body.initial_team_ids).await?;
    transaction.commit().await?;
    // Linked layers are managed by the server; the client only needs its own paths.
    Ok(Json(json!({"newDatasetId": id, "dataSource": source})))
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
    let mut source = UsableDataSource::from_json(&body.data_source)
        .map_err(crate::dataset::source::invalid_body)?;
    let path_prefix = parse_prefix(body.path_prefix.as_deref())?;
    crate::dataset::lifecycle::require_readable(&state, &user, &id).await?;
    let mut transaction = state.pool.begin().await?;
    let (status, uploader, directory): (String, Option<ObjectId>, String) = sqlx::query_as(
        "SELECT status, _uploader, directoryName FROM webknossos.datasets_ WHERE _id = $1 FOR UPDATE",
    )
    .bind(&*id)
    .fetch_one(&mut *transaction)
    .await?;
    if status != NOT_YET_UPLOADED && status != crate::dataset::lifecycle::CONVERSION_FAILED {
        return Err(ApiError::bad_request(format!(
            "Dataset is not in uploading status, got {status}."
        )));
    }
    if uploader.as_ref() != Some(&user.id) {
        return Err(ApiError::bad_request(
            crate::msg::dataset::upload::to_paths::OTHER_UPLOADER,
        ));
    }
    source.id = DataSourceId::new(directory, &user.organization_id);
    source.status_opt = Some(NOT_YET_UPLOADED.to_owned());
    let parent = dataset_parent(&config, path_prefix.as_deref(), &user.organization_id)?;
    add_paths(&mut source, &parent)?;
    crate::dataset::create::assert_valid_data_source(&source)?;
    // DatasetDAO.updateDataSource(isUsable = false).
    sqlx::query(
        r#"UPDATE webknossos.datasets SET _organization = $2, inboxSourceHash = NULL, defaultViewConfiguration = $3,
             isUsable = false, voxelSizeFactor = ROW($4, $5, $6)::webknossos.VECTOR3,
             voxelSizeUnit = $7::webknossos.LENGTH_UNIT, status = $8 WHERE _id = $1"#,
    )
    .bind(&*id)
    .bind(&user.organization_id)
    .bind(source.default_view_configuration.clone().map(Value::Object))
    .bind(source.scale.factor.x)
    .bind(source.scale.factor.y)
    .bind(source.scale.factor.z)
    .bind(source.scale.unit.as_str())
    .bind(NOT_YET_UPLOADED)
    .execute(&mut *transaction)
    .await?;
    crate::dataset::source::write_layers(&mut transaction, &id, &source.data_layers).await?;
    transaction.commit().await?;
    Ok(Json(json!({"dataSource": source})))
}

fn not_usable(id: &ObjectId) -> ApiError {
    ApiError::bad_request(crate::msg::dataset::not_usable(id))
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
            let x = order.get("x").map(read_i32);
            let y = order.get("y").map(read_i32);
            match (x, y) {
                (Some(Ok(_)), Some(Ok(_))) => Ok(order.clone()),
                _ => Err(ApiError::bad_request(
                    crate::msg::request::INVALID_JSON_BODY,
                )),
            }
        })
        .transpose()?;
    let record = crate::dataset::lifecycle::require_readable(&state, &user, &id).await?;
    if !record.is_virtual {
        return Err(ApiError::bad_request(
            crate::msg::dataset::upload::MAG_UPLOAD_ONLY_VIRTUAL,
        ));
    }
    if !crate::dataset::access::can_edit(&state.pool, &user, &id).await? {
        return Err(crate::dataset::lifecycle::not_allowed());
    }
    if !record.is_usable {
        return Err(not_usable(&id));
    }
    let [x, y, z] = body.mag.map(f64::from);
    let mut q = Sql::new("SELECT path, uploadToPathIsPending FROM webknossos.dataset_mags WHERE ");
    push_mag_predicate(&mut q, &id, &body.layer_name, [x, y, z]);
    q.push(" AND (uploadToPathIsPending OR uploadIsPending)");
    let pending: Vec<(Option<String>, bool)> = q.build_query_as().fetch_all(&state.pool).await?;
    if !pending.is_empty() {
        if !body.overwrite_pending {
            return Err(ApiError::bad_request(
                crate::msg::dataset::upload::to_paths::MAG_ALREADY_PENDING,
            ));
        }
        let old_paths: Vec<String> = pending
            .iter()
            .filter(|(_, to_path)| *to_path)
            .filter_map(|(path, _)| path.clone())
            .collect();
        if !old_paths.is_empty() {
            crate::dataset::paths::delete_paths(
                &state.pool,
                &clients,
                record.store_url()?,
                &old_paths,
            )
            .await?;
        }
    }
    let parent = dataset_parent(&config, path_prefix.as_deref(), &record.organization)?;
    let directory: String =
        sqlx::query_scalar("SELECT directoryName FROM webknossos.datasets_ WHERE _id = $1")
            .bind(&*id)
            .fetch_one(&state.pool)
            .await?;
    let layer_path = join(&parent, &directory)?.join(&body.layer_name);
    let path = layer_path
        .join(&format!(
            "{}__{}",
            Vec3Int::from(body.mag).to_mag_literal(true),
            crate::dataset::create::random_id(12)?
        ))
        .to_string();
    let mut transaction = state.pool.begin().await?;
    if body.overwrite_pending {
        let mut q = Sql::new("DELETE FROM webknossos.dataset_mags WHERE ");
        push_mag_predicate(&mut q, &id, &body.layer_name, [x, y, z]);
        q.push(" AND (uploadToPathIsPending OR uploadIsPending)");
        q.build().execute(&mut *transaction).await?;
    }
    sqlx::query(r#"INSERT INTO webknossos.dataset_mags (_dataset, dataLayerName, mag, path, axisOrder, channelIndex, uploadToPathIsPending, uploadIsPending)
        VALUES ($1, $2, ROW($3, $4, $5)::webknossos.VECTOR3, $6, $7, $8, true, false)"#)
        .bind(&*id).bind(&*body.layer_name).bind(x).bind(y).bind(z)
        .bind(&path).bind(axis_order).bind(body.channel_index)
        .execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(Json(path))
}

async fn reserve_attachment_upload_to_path(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(config): Extension<UploadToPathsConfig>,
    RequestJson(body): RequestJson<AttachmentUploadRequest>,
) -> ApiResult<Json<String>> {
    let path_prefix = parse_prefix(body.path_prefix.as_deref())?;
    let record = crate::dataset::lifecycle::require_editable(&state, &user, &id).await?;
    if !record.is_usable {
        return Err(not_usable(&id));
    }
    let attachment_type = body.attachment_type;
    let typ = attachment_type.as_str();
    let mut transaction = state.pool.begin().await?;
    sqlx::query("SELECT _id FROM webknossos.datasets_ WHERE _id = $1 FOR UPDATE")
        .bind(&*id)
        .fetch_one(&mut *transaction)
        .await?;
    if body.overwrite_pending.unwrap_or(false) {
        let mut q = Sql::new("DELETE FROM webknossos.dataset_layer_attachments WHERE ");
        push_attachment_key(&mut q, &id, &body.layer_name, typ, &body.attachment_name);
        q.push(" AND (uploadIsPending OR uploadToPathIsPending)");
        q.build().execute(&mut *transaction).await?;
    } else {
        let mut q =
            Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments WHERE ");
        push_attachment_key(&mut q, &id, &body.layer_name, typ, &body.attachment_name);
        q.push(" AND (uploadIsPending OR uploadToPathIsPending))");
        let pending: bool = q.build_query_scalar().fetch_one(&mut *transaction).await?;
        if pending {
            return Err(ApiError::bad_request(
                crate::msg::dataset::layer::ATTACHMENT_ALREADY_PENDING,
            ));
        }
    }
    let singleton = body.attachment_type.is_singleton();
    let existing: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM webknossos.dataset_layer_attachments WHERE _dataset = $1 AND layerName = $2 AND ($3::text IS NULL OR name = $3) AND type = $4::webknossos.LAYER_ATTACHMENT_TYPE",
    )
    .bind(&*id)
    .bind(&body.layer_name)
    .bind((!singleton).then_some(&body.attachment_name))
    .bind(typ)
    .fetch_one(&mut *transaction)
    .await?;
    if existing != 0 {
        return Err(ApiError::bad_request(if singleton {
            crate::msg::dataset::layer::ATTACHMENT_SINGLETON_ALREADY_FILLED
        } else {
            crate::msg::dataset::layer::ATTACHMENT_NAME_TAKEN
        }));
    }
    let directory: String =
        sqlx::query_scalar("SELECT directoryName FROM webknossos.datasets_ WHERE _id = $1")
            .bind(&*id)
            .fetch_one(&mut *transaction)
            .await?;
    let parent = dataset_parent(&config, path_prefix.as_deref(), &record.organization)?;
    let layer_path = join(&parent, &directory)?.join(&body.layer_name);
    let format = body.attachment_dataformat;
    let path =
        attachment_path(&body.attachment_name, format, attachment_type, &layer_path)?.to_string();
    sqlx::query(r#"INSERT INTO webknossos.dataset_layer_attachments (_dataset, layerName, name, path, type, dataFormat, uploadToPathIsPending, uploadIsPending)
        VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6::webknossos.LAYER_ATTACHMENT_DATAFORMAT, true, false)"#)
        .bind(&*id).bind(&*body.layer_name).bind(&*body.attachment_name).bind(&*path)
        .bind(typ).bind(format.as_str())
        .execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(Json(path))
}

#[cfg(test)]
mod tests;
