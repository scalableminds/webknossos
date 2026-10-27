//! AnnotationIOController.download (`GET /annotations/:typ/:id/download`) and
//! downloadWithoutType (`GET /annotations/:id/download`): a saved annotation
//! as NML (skeleton only) or as a zip holding the NML plus the volume data and
//! edited-mapping zips; compound project/task/task-type annotations as a zip
//! of the finished annotations' NMLs (with nested volume zips).
//!
//! Both are UserAwareActions (anonymous requesters may download what they can
//! read). Responses are buffered in memory (Scala writes a temporary file).
mod dao;

use std::{
    fmt::Write as _,
    io::{Cursor, Write},
};

use axum::{
    Router,
    body::Body,
    extract::{FromRequestParts, State},
    http::{HeaderValue, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Map, Value};
use sqlx::PgPool;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use crate::{
    AppState,
    annotation::access::AnnotationMetadata,
    annotation::nml::writer::{
        NmlAnnotation, NmlLayer, NmlLayerTracing, NmlVoxelSize, NmlWriteInput, VolumeDataZipFormat,
        edited_mapping_edges_zip_name, volume_data_zip_name, write_nml,
    },
    annotation::provider::{
        AccessContext, AnnotationIdentifier, AnnotationProvider, AnnotationType, ProviderError,
        RESTRICTIONS_NOT_FOUND,
    },
    auth::{AuthUser, OptionalAuthUser},
    error::{ApiError, ApiResult},
    extract::Path,
    extract::extension,
    job::submission::{Failure, RunError, RunResult},
    proto::{AnnotationUserStateProto, SkeletonTracing, VolumeTracing},
    stores::client::ServiceError,
    stores::tracing_client::{
        FetchedVolumeLayer, TracingStoreClient, TracingStoreError, VolumeLayerFetch,
        find_first_tracing_store_url,
    },
    system::application_info::MiscState,
    util::id::ObjectId,
};

// Msg.Annotation.Download.* and related texts.
pub const DOWNLOAD_FAILED: &str = "Could not download annotation.";
pub const FETCH_VOLUME_LAYER_FAILED: &str = "Could not fetch volume annotation layer.";
pub const FETCH_SKELETON_LAYER_FAILED: &str = "Could not fetch skeleton annotation layer.";
pub const FIND_USER_FAILED: &str = "Could not find or access annotation user.";
pub const ZIP_NML_FAILED: &str = "Could not add NML file to zip archive.";
pub const SKELETON_TO_FILE_FAILED: &str = "Could not write skeleton-only annotation to file.";
pub const HYBRID_TO_FILE_FAILED: &str = "Could not write annotation with volume layer to file.";
pub const DOWNLOAD_NOT_ALLOWED: &str = "You do not have permission to download this annotation.";
pub const WRITE_TO_FILE_FAILED: &str = "Could not write annotation to temporary file for download.";
/// Msg.Annotation.nameNotAvailable.
pub const NAME_NOT_AVAILABLE: &str = "Could not determine name for annotation.";
/// Msg.Task.notFound (without id).
pub const TASK_NOT_FOUND: &str = "Task could not be found or accessed.";
pub const VIEW_NOT_DOWNLOADABLE: &str = "Cannot download View annotation";
pub const MISMATCHING_SKELETON: &str = "Annotation has mismatching skeleton ids and tracings.";
pub const MISMATCHING_VOLUME: &str = "Annotation has mismatching volume ids and tracings.";
pub const NEEDS_SKELETON_OR_VOLUME: &str =
    "Annotation needs at least one skeleton or volume layer.";

const XML_MIME_TYPE: &str = "application/xml";
const ZIP_MIME_TYPE: &str = "application/zip";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/annotations/{typ}/{id}/download", get(download))
        .route("/annotations/{id}/download", get(download_without_type))
}

// ---------------------------------------------------------------------------
// Request binding
// ---------------------------------------------------------------------------

/// `version: Option[Long], skipVolumeData: Option[Boolean],
/// volumeDataZipFormat: Option[String]`, bound in route order (first value
/// wins) before the action runs.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DownloadParams {
    pub version: Option<i64>,
    pub skip_volume_data: bool,
    /// Unknown or absent formats fall back to `wkw` (`fromString` + getOrElse).
    pub volume_data_zip_format: VolumeDataZipFormat,
}

pub fn parse_download_params(query: Option<&str>) -> ApiResult<DownloadParams> {
    let pairs: Vec<(String, String)> = serde_urlencoded::from_str(query.unwrap_or(""))
        .map_err(|_| ApiError::bad_request(crate::msg::request::INVALID_QUERY))?;
    let first = |key: &str| {
        pairs
            .iter()
            .find(|(candidate, _)| candidate == key)
            .map(|(_, value)| value.as_str())
    };
    let version = first("version").map(parse_long_param).transpose()?;
    let skip_volume_data = first("skipVolumeData")
        .map(|value| parse_boolean_param("skipVolumeData", value))
        .transpose()?
        .unwrap_or(false);
    let volume_data_zip_format = first("volumeDataZipFormat")
        .and_then(VolumeDataZipFormat::parse)
        .unwrap_or_default();
    Ok(DownloadParams {
        version,
        skip_volume_data,
        volume_data_zip_format,
    })
}

/// Play's Long binder (java.lang.Long.parseLong).
fn parse_long_param(value: &str) -> ApiResult<i64> {
    let digits = value.strip_prefix(['+', '-']).unwrap_or(value);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(long_parse_error(value));
    }
    value.parse::<i64>().map_err(|_| long_parse_error(value))
}

fn long_parse_error(value: &str) -> ApiError {
    ApiError::bad_request(format!(
        "Cannot parse parameter version as Long: For input string: \"{value}\""
    ))
}

/// Play's Boolean binder: trimmed `true`/`false` or any integer (non-zero = true).
fn parse_boolean_param(key: &str, value: &str) -> ApiResult<bool> {
    match value.trim() {
        "true" => Ok(true),
        "false" => Ok(false),
        other => other
            .parse::<i32>()
            .map(|number| number != 0)
            .map_err(|_| ApiError::bad_request(crate::msg::request::invalid_boolean(key))),
    }
}

impl<S: Send + Sync> FromRequestParts<S> for DownloadParams {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parse_download_params(parts.uri.query())
    }
}

/// Router-wide extensions used by both handlers.
struct Services {
    provider: AnnotationProvider,
    tracing_store: TracingStoreClient,
    misc: MiscState,
}

impl<S: Send + Sync> FromRequestParts<S> for Services {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: extension(parts)?,
            tracing_store: extension(parts)?,
            misc: extension(parts)?,
        })
    }
}

struct Context<'a> {
    state: &'a AppState,
    services: &'a Services,
    user: Option<&'a AuthUser>,
}

impl Context<'_> {
    fn pool(&self) -> &PgPool {
        &self.state.pool
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /annotations/:typ/:id/download?version=&skipVolumeData=&volumeDataZipFormat=
async fn download(
    State(state): State<AppState>,
    services: Services,
    Path((typ, id)): Path<(String, String)>,
    params: DownloadParams,
    OptionalAuthUser(user): OptionalAuthUser,
) -> Response {
    let id = match ObjectId::parse_path(&id) {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let context = Context {
        state: &state,
        services: &services,
        user: user.as_ref(),
    };
    download_for(&context, &typ, &id, &params)
        .await
        .unwrap_or_else(IntoResponse::into_response)
}

/// GET /annotations/:id/download?...: provideAnnotation(id, userOpt)
/// `?~> notFound ~> NOT_FOUND`, then `download` with the STORED type.
async fn download_without_type(
    State(state): State<AppState>,
    services: Services,
    Path(id): Path<String>,
    params: DownloadParams,
    OptionalAuthUser(user): OptionalAuthUser,
) -> Response {
    let id = match ObjectId::parse_path(&id) {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let context = Context {
        state: &state,
        services: &services,
        user: user.as_ref(),
    };
    let saved = match services
        .provider
        .provide_saved(AccessContext::requester(user.as_ref()), &id)
        .await
    {
        Ok(saved) => saved,
        Err(error) => {
            return provider_failure(error)
                .wrap_status(crate::msg::annotation::NOT_FOUND, StatusCode::NOT_FOUND)
                .into_response();
        }
    };
    download_for(&context, &saved.annotation_type, &id, &params)
        .await
        .unwrap_or_else(IntoResponse::into_response)
}

/// AnnotationIOController.download after binding.
async fn download_for(
    context: &Context<'_>,
    typ: &str,
    id: &ObjectId,
    params: &DownloadParams,
) -> RunResult<Response> {
    let identifier =
        AnnotationIdentifier::parse(typ, id).map_err(|error| Failure::new(error.to_string()))?;
    if let Some(user) = context.user {
        let mut properties = Map::new();
        properties.insert("annotation_id".into(), Value::String(id.to_string()));
        properties.insert("annotation_type".into(), Value::String(typ.to_owned()));
        crate::system::analytics::track(
            context.state,
            &context.services.misc,
            user,
            "download_annotation".into(),
            properties,
        );
    }
    match identifier.annotation_type {
        AnnotationType::View => Err(Failure::new(VIEW_NOT_DOWNLOADABLE).into()),
        AnnotationType::CompoundProject
        | AnnotationType::CompoundTask
        | AnnotationType::CompoundTaskType => {
            download_compound(
                context,
                identifier.annotation_type,
                id,
                params.skip_volume_data,
            )
            .await
        }
        _ => download_saved(context, &identifier, params)
            .await
            .map_err(|error| error.wrap(DOWNLOAD_FAILED)),
    }
}

// ---------------------------------------------------------------------------
// Fox failure helpers
// ---------------------------------------------------------------------------

trait RunErrorExt {
    /// `?~> message ~> status` (a lone message when the inner error is Empty).
    fn wrap_status(self, message: &str, status: StatusCode) -> RunError;
}

impl RunErrorExt for RunError {
    fn wrap_status(self, message: &str, status: StatusCode) -> RunError {
        match self {
            RunError::Api(error) => RunError::Api(error),
            RunError::Failure(_) => Failure::with_status(message, status).into(),
        }
    }
}

/// A provider error as Fox failure (infrastructure errors pass through).
fn provider_failure(error: ProviderError) -> RunError {
    match error {
        ProviderError::Api(error) => RunError::Api(error),
        ProviderError::Failure(failure) => {
            let mut chain = failure.chain.into_iter().rev();
            let mut built = match chain.next() {
                Some(innermost) => Failure::new(innermost),
                None => {
                    return match failure.status {
                        Some(status) => Failure::with_status(failure.message, status).into(),
                        None => Failure::new(failure.message).into(),
                    };
                }
            };
            for message in chain {
                built = built.wrap(&message);
            }
            built.wrap(&failure.message).into()
        }
        other => Failure::new(other.to_string()).into(),
    }
}

/// RPC failures are Fox failures; an unsuccessful upstream HTTP status is
/// kept as ParamFailure status (RPCRequest `~> result.status`).
fn rpc_failure(error: TracingStoreError) -> RunError {
    match &error {
        TracingStoreError::Service(ServiceError::UpstreamStatus(code)) => {
            match StatusCode::from_u16(*code) {
                Ok(status) => Failure::with_status(error.to_string(), status).into(),
                Err(_) => Failure::new(error.to_string()).into(),
            }
        }
        _ => Failure::new(error.to_string()).into(),
    }
}

/// `Fox.empty ?~> message` (or a plain failure).
fn fail(message: impl Into<String>) -> RunError {
    Failure::new(message).into()
}

// ---------------------------------------------------------------------------
// Database lookups
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, sqlx::FromRow)]
struct LayerRow {
    tracing_id: String,
    typ: String,
    name: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct DatasetRow {
    id: ObjectId,
    name: String,
    organization: String,
    factor: Option<Vec<f64>>,
    unit: Option<String>,
}

impl DatasetRow {
    /// Dataset.voxelSize (unit defaults to nanometer).
    fn voxel_size(&self) -> Option<NmlVoxelSize> {
        let factor = self.factor.as_ref()?;
        Some(NmlVoxelSize {
            factor: [
                factor.first().copied()?,
                factor.get(1).copied()?,
                factor.get(2).copied()?,
            ],
            unit: self.unit.clone().unwrap_or_else(|| "nanometer".into()),
        })
    }
}

/// UserService.findOneCached under GlobalAccessContext: the owner's MultiUser id.
async fn find_user_multi_user(pool: &PgPool, user_id: &ObjectId) -> ApiResult<Option<ObjectId>> {
    Ok(crate::annotation::dao::find_multi_user_id(pool, user_id).await?)
}

/// MultiUserDAO.findOne: (firstName, lastName), `None` when unreadable.
async fn find_multi_user(
    pool: &PgPool,
    multi_user_id: &ObjectId,
    readable: bool,
) -> ApiResult<Option<(String, String)>> {
    if !readable {
        return Ok(None);
    }
    dao::find_multi_user_names(pool, multi_user_id).await
}

/// MultiUser.abbreviatedName.
fn abbreviated_name(first_name: &str, last_name: &str) -> String {
    let initial: String = first_name.chars().take(1).collect();
    format!("{initial}{last_name}")
        .to_lowercase()
        .replace(' ', "_")
}

/// TextUtils.normalize (umlaut and accent replacement map).
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        let replacement = match c {
            'ü' => "ue",
            'Ü' => "Ue",
            'ö' => "oe",
            'Ö' => "Oe",
            'ä' => "ae",
            'Ä' => "Ae",
            'ß' => "ss",
            'é' | 'è' | 'ê' | 'ë' => "e",
            'È' | 'É' | 'Ê' | 'Ë' => "E",
            'Ç' => "C",
            'ç' => "c",
            'ñ' => "n",
            'Ñ' => "N",
            'ï' | 'í' | 'ì' => "i",
            'Ï' => "I",
            'å' => "a",
            'Å' => "A",
            'œ' => "oe",
            'Œ' => "Oe",
            'æ' => "ae",
            'Æ' => "Ae",
            'þ' => "th",
            'Þ' => "Th",
            'ø' => "oe",
            'Ø' => "Oe",
            other => {
                out.push(other);
                continue;
            }
        };
        out.push_str(replacement);
    }
    out
}

/// SavedTracingInformationHandler.nameForAnnotation:
/// `normalize("<dataset>__<taskId|explorational>__<owner abbreviated>__<id[-6:]>")`.
/// A missing owner or unreadable MultiUser yields an empty user part; a
/// missing dataset is Empty.
async fn name_for_annotation(
    pool: &PgPool,
    annotation: AnnotationNameParts<'_>,
    multi_user_readable: bool,
) -> RunResult<Option<String>> {
    let user_name = match find_user_multi_user(pool, annotation.owner_id).await? {
        Some(multi_user) => find_multi_user(pool, &multi_user, multi_user_readable)
            .await?
            .map(|(first, last)| abbreviated_name(&first, &last))
            .unwrap_or_default(),
        None => String::new(),
    };
    let Some(dataset) = dao::find_dataset(pool, annotation.dataset_id).await? else {
        return Ok(None);
    };
    let task = annotation.task_id.map_or("explorational", ObjectId::as_str);
    let id = annotation.id.as_str();
    let hash = &id[id.len().saturating_sub(6)..];
    Ok(Some(normalize(&format!(
        "{}__{task}__{user_name}__{hash}",
        dataset.name
    ))))
}

#[derive(Clone, Copy)]
struct AnnotationNameParts<'a> {
    id: &'a ObjectId,
    owner_id: &'a ObjectId,
    dataset_id: &'a ObjectId,
    task_id: Option<&'a ObjectId>,
}

/// AnnotationInformationProvider.nameFor.
async fn name_for(context: &Context<'_>, annotation: &AnnotationMetadata) -> RunResult<String> {
    if !annotation.name.is_empty() {
        return Ok(annotation.name.clone());
    }
    let parts = AnnotationNameParts {
        id: &annotation.id,
        owner_id: &annotation.owner_id,
        dataset_id: &annotation.dataset_id,
        task_id: annotation.task_id.as_ref(),
    };
    name_for_annotation(context.pool(), parts, context.user.is_some())
        .await
        .map_err(|error| error.wrap(NAME_NOT_AVAILABLE))?
        .ok_or_else(|| fail(NAME_NOT_AVAILABLE))
}

// ---------------------------------------------------------------------------
// Saved annotations
// ---------------------------------------------------------------------------

/// `URLEncoder.encode(name, "UTF-8").replace("+", "%20")`.
pub fn java_url_encode_path(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

fn file_response(bytes: Vec<u8>, mime_type: &'static str, disposition: String) -> Response {
    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime_type));
    match HeaderValue::from_str(&disposition) {
        Ok(value) => {
            headers.insert(header::CONTENT_DISPOSITION, value);
        }
        Err(_) => return ApiError::internal().into_response(),
    }
    response
}

/// Everything the NML writer needs about the annotation's surroundings.
struct SavedDownload<'a> {
    annotation: &'a AnnotationMetadata,
    layers: Vec<LayerRow>,
    dataset: DatasetRow,
    voxel_size: Option<NmlVoxelSize>,
    tracing_store_url: String,
    name: String,
    params: &'a DownloadParams,
}

/// downloadExplorational (saved annotations of any non-View, non-compound type).
async fn download_saved(
    context: &Context<'_>,
    identifier: &AnnotationIdentifier,
    params: &DownloadParams,
) -> RunResult<Response> {
    let access = AccessContext::requester(context.user);
    let typ = identifier.annotation_type.as_str();
    let id = &identifier.identifier;
    // provideAnnotation(typ, id, user) ~> NOT_FOUND
    let provided = context
        .services
        .provider
        .provide(access, typ, id)
        .await
        .map_err(|error| match provider_failure(error) {
            RunError::Failure(_) => Failure::with_status(
                crate::msg::annotation::NOT_FOUND.to_owned(),
                StatusCode::NOT_FOUND,
            )
            .into(),
            api => api,
        })?;
    let Some(annotation) = provided.saved() else {
        return Err(fail(crate::msg::annotation::NOT_FOUND));
    };
    let restrictions = context
        .services
        .provider
        .restrictions_for(access, identifier)
        .await
        .map_err(|error| provider_failure(error).wrap(RESTRICTIONS_NOT_FOUND))?;
    let name = name_for(context, annotation).await?;
    let layers = dao::find_all_layers(context.pool(), &annotation.id).await?;
    let skeleton_only = layers.iter().any(|layer| layer.typ == "Skeleton")
        && !layers.iter().any(|layer| layer.typ == "Volume");
    // Fox.assertTrue(restrictions.allowDownload(user)) ?~> notAllowed ~> FORBIDDEN.
    if !restrictions.allow_download {
        return Err(Failure::with_status(DOWNLOAD_NOT_ALLOWED, StatusCode::FORBIDDEN).into());
    }
    let dataset = dao::find_dataset(context.pool(), &annotation.dataset_id)
        .await?
        .ok_or_else(|| {
            RunError::from(Failure::with_status(
                crate::msg::dataset::not_found_for_annotation(
                    &annotation.dataset_id,
                    &annotation.id,
                ),
                StatusCode::NOT_FOUND,
            ))
        })?;
    if !dao::organization_exists(context.pool(), &dataset.organization).await? {
        return Err(Failure::with_status(
            crate::msg::organization::not_found(&dataset.organization),
            StatusCode::NOT_FOUND,
        )
        .into());
    }
    let (extension, mime_type) = if skeleton_only {
        (".nml", XML_MIME_TYPE)
    } else {
        (".zip", ZIP_MIME_TYPE)
    };
    let file_name = java_url_encode_path(&format!("{name}{extension}"));
    let download = SavedDownload {
        annotation,
        layers,
        voxel_size: dataset.voxel_size(),
        dataset,
        tracing_store_url: String::new(),
        name,
        params,
    };
    let bytes = annotation_to_file(context, download)
        .await
        .map_err(|error| error.wrap(WRITE_TO_FILE_FAILED))?;
    Ok(file_response(
        bytes,
        mime_type,
        format!("attachment; filename=\"{file_name}\""),
    ))
}

/// annotationToTemporaryFile.
async fn annotation_to_file(
    context: &Context<'_>,
    mut download: SavedDownload<'_>,
) -> RunResult<Vec<u8>> {
    let skeleton_only = download.layers.iter().any(|layer| layer.typ == "Skeleton")
        && !download.layers.iter().any(|layer| layer.typ == "Volume");
    // tracingStoreService.clientFor(dataset)
    let url = find_first_tracing_store_url(context.pool()).await?;
    if skeleton_only {
        let result = match url {
            Some(url) => {
                download.tracing_store_url = url;
                skeleton_to_file(context, &download).await
            }
            None => Err(fail(crate::msg::tracing_store::NOT_FOUND)),
        };
        result.map_err(|error| error.wrap(SKELETON_TO_FILE_FAILED))
    } else {
        let result = match url {
            Some(url) => {
                download.tracing_store_url = url;
                volume_or_hybrid_to_file(context, &download).await
            }
            None => Err(fail(crate::msg::tracing_store::NOT_FOUND)),
        };
        result.map_err(|error| error.wrap(HYBRID_TO_FILE_FAILED))
    }
}

async fn fetch_skeleton_layers(
    context: &Context<'_>,
    download: &SavedDownload<'_>,
) -> RunResult<Vec<(LayerRow, SkeletonTracing)>> {
    let mut fetched = Vec::new();
    for layer in download
        .layers
        .iter()
        .filter(|layer| layer.typ == "Skeleton")
    {
        let tracing = context
            .services
            .tracing_store
            .get_skeleton_tracing(
                &download.tracing_store_url,
                &layer.tracing_id,
                &download.annotation.id,
                download.params.version,
            )
            .await
            .map_err(rpc_failure)?;
        fetched.push((layer.clone(), tracing));
    }
    Ok(fetched)
}

/// The owner's MultiUser fullName (global lookups); `None` is Fox.empty.
async fn owner_full_name(pool: &PgPool, owner_id: &ObjectId) -> RunResult<Option<String>> {
    let Some(multi_user) = find_user_multi_user(pool, owner_id).await? else {
        return Ok(None);
    };
    Ok(find_multi_user(pool, &multi_user, true)
        .await?
        .map(|(first, last)| format!("{first} {last}")))
}

struct NmlContext<'a> {
    user_states: &'a [AnnotationUserStateProto],
    owner_name: &'a str,
    task_id: Option<&'a ObjectId>,
}

fn nml_input<'a>(
    context: &'a Context<'_>,
    download: &'a SavedDownload<'_>,
    layers: Vec<NmlLayer<'a>>,
    nml: &NmlContext<'a>,
) -> NmlWriteInput<'a> {
    let config = &context.services.misc.0.config;
    NmlWriteInput {
        layers,
        annotation_user_states: nml.user_states,
        requesting_user_id: context.user.map(|user| &user.id),
        annotation_owner_id: &download.annotation.owner_id,
        annotation_owner_name: nml.owner_name,
        annotation: Some(NmlAnnotation {
            id: &download.annotation.id,
            description: &download.annotation.description,
            has_task: download.annotation.task_id.is_some(),
        }),
        task_id: nml.task_id,
        voxel_size: download.voxel_size.as_ref(),
        volume_filename: None,
        organization_id: &download.dataset.organization,
        wk_url: &config.public_uri,
        dataset_name: &download.dataset.name,
        dataset_id: &download.dataset.id,
        skip_volume_data: download.params.skip_volume_data,
        volume_data_zip_format: download.params.volume_data_zip_format,
        writer_git_commit: &config.build_info.commit_hash,
        timestamp_millis: chrono::Utc::now().timestamp_millis(),
    }
}

/// skeletonToTemporaryFile: plain NML (no `?~>` inside).
async fn skeleton_to_file(
    context: &Context<'_>,
    download: &SavedDownload<'_>,
) -> RunResult<Vec<u8>> {
    let skeletons = fetch_skeleton_layers(context, download).await?;
    let proto = context
        .services
        .tracing_store
        .get_annotation_proto(
            &download.tracing_store_url,
            &download.annotation.id,
            download.params.version,
        )
        .await
        .map_err(rpc_failure)?;
    let owner_name = owner_full_name(context.pool(), &download.annotation.owner_id)
        .await?
        .ok_or_else(|| fail(crate::msg::user::NOT_FOUND_NO_ID))?;
    // Fox.runOptional(annotation._task)(taskDAO.findOne) under the requester's
    // access context; an unreadable task is Fox.empty.
    let task_id = match &download.annotation.task_id {
        Some(task_id) => {
            if !dao::task_exists(context.pool(), task_id, Some(context.user)).await? {
                return Err(fail(TASK_NOT_FOUND));
            }
            Some(task_id)
        }
        None => None,
    };
    let layers = skeletons
        .iter()
        .map(|(layer, tracing)| NmlLayer {
            tracing_id: &layer.tracing_id,
            name: &layer.name,
            tracing: NmlLayerTracing::Skeleton(tracing),
            has_edited_mapping_edges: false,
            base_mapping_name: None,
        })
        .collect();
    let nml = NmlContext {
        user_states: &proto.user_states,
        owner_name: &owner_name,
        task_id,
    };
    let document = write_nml(&nml_input(context, download, layers, &nml))
        .map_err(|error| fail(error.to_string()))?;
    Ok(document.into_bytes())
}

/// volumeOrHybridToTemporaryFile: zip with `<name>.nml` (default deflate),
/// then per volume layer its data zip and edited-edges zip (BEST_SPEED).
async fn volume_or_hybrid_to_file(
    context: &Context<'_>,
    download: &SavedDownload<'_>,
) -> RunResult<Vec<u8>> {
    let annotation_id = &download.annotation.id;
    let tracing_store = &context.services.tracing_store;
    let mut volumes: Vec<(LayerRow, FetchedVolumeLayer)> = Vec::new();
    let fetched_volumes: RunResult<()> = async {
        for layer in download.layers.iter().filter(|layer| layer.typ == "Volume") {
            let fetched = tracing_store
                .fetch_volume_layer(
                    &download.tracing_store_url,
                    VolumeLayerFetch {
                        tracing_id: &layer.tracing_id,
                        annotation_id,
                        version: download.params.version,
                        skip_volume_and_edges_data: download.params.skip_volume_data,
                        volume_data_zip_format: download.params.volume_data_zip_format,
                        voxel_size: download.voxel_size.as_ref(),
                    },
                )
                .await
                .map_err(rpc_failure)?;
            volumes.push((layer.clone(), fetched));
        }
        Ok(())
    }
    .await;
    fetched_volumes.map_err(|error| error.wrap(FETCH_VOLUME_LAYER_FAILED))?;
    let skeletons = fetch_skeleton_layers(context, download)
        .await
        .map_err(|error| error.wrap(FETCH_SKELETON_LAYER_FAILED))?;
    let multi_user = find_user_multi_user(context.pool(), &download.annotation.owner_id)
        .await?
        .ok_or_else(|| fail(FIND_USER_FAILED))?;
    let owner_name = find_multi_user(context.pool(), &multi_user, true)
        .await?
        .map(|(first, last)| format!("{first} {last}"))
        .ok_or_else(|| fail(crate::msg::user::NOT_FOUND_NO_ID))?;
    let task_id = match &download.annotation.task_id {
        Some(task_id) => {
            if !dao::task_exists(context.pool(), task_id, None).await? {
                return Err(fail(TASK_NOT_FOUND));
            }
            Some(task_id)
        }
        None => None,
    };
    let proto = tracing_store
        .get_annotation_proto(
            &download.tracing_store_url,
            annotation_id,
            download.params.version,
        )
        .await
        .map_err(rpc_failure)?;
    let mut layers: Vec<NmlLayer<'_>> = skeletons
        .iter()
        .map(|(layer, tracing)| NmlLayer {
            tracing_id: &layer.tracing_id,
            name: &layer.name,
            tracing: NmlLayerTracing::Skeleton(tracing),
            has_edited_mapping_edges: false,
            base_mapping_name: None,
        })
        .collect();
    layers.extend(volumes.iter().map(|(layer, fetched)| NmlLayer {
        tracing_id: &layer.tracing_id,
        name: &layer.name,
        tracing: NmlLayerTracing::Volume(&fetched.tracing),
        has_edited_mapping_edges: fetched.edited_mapping_edges.is_some(),
        base_mapping_name: fetched.base_mapping_name.as_deref(),
    }));
    let nml = NmlContext {
        user_states: &proto.user_states,
        owner_name: &owner_name,
        task_id,
    };
    let document = write_nml(&nml_input(context, download, layers, &nml))
        .map_err(|error| fail(error.to_string()).wrap(ZIP_NML_FAILED))?;
    let is_single = volumes.len() == 1;
    let mut entries: Vec<ZipEntry<'_>> = vec![ZipEntry {
        name: format!("{}.nml", download.name),
        bytes: document.as_bytes(),
        fast: false,
    }];
    for (index, (layer, fetched)) in volumes.iter().enumerate() {
        if let Some(data) = &fetched.data {
            entries.push(ZipEntry {
                name: volume_data_zip_name(&layer.name, index, is_single),
                bytes: data,
                fast: true,
            });
        }
        if let Some(edges) = &fetched.edited_mapping_edges {
            entries.push(ZipEntry {
                name: edited_mapping_edges_zip_name(&layer.name, index, is_single),
                bytes: edges,
                fast: true,
            });
        }
    }
    zip_entries(&entries).map_err(|_| fail(ZIP_NML_FAILED))
}

// ---------------------------------------------------------------------------
// Zip assembly
// ---------------------------------------------------------------------------

struct ZipEntry<'a> {
    name: String,
    bytes: &'a [u8],
    /// Deflater.BEST_SPEED (level 1) instead of the default level.
    fast: bool,
}

/// ZipIO: DEFLATED entries in order (default level unless `fast`).
fn zip_entries(entries: &[ZipEntry<'_>]) -> Result<Vec<u8>, zip::result::ZipError> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for entry in entries {
        add_entry(
            &mut writer,
            &entry.name,
            entry.bytes,
            entry.fast.then_some(1),
        )?;
    }
    Ok(writer.finish()?.into_inner())
}

/// One DEFLATED entry at the default level.
fn add_zip_entry(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    bytes: &[u8],
) -> Result<(), zip::result::ZipError> {
    add_entry(writer, name, bytes, None)
}

fn add_entry(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    bytes: &[u8],
    level: Option<i64>,
) -> Result<(), zip::result::ZipError> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(level)
        .large_file(bytes.len() as u64 >= u64::from(u32::MAX));
    writer.start_file(name, options)?;
    writer.write_all(bytes)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Compound annotations
// ---------------------------------------------------------------------------

/// `Fox.empty` reaching the controller: 404 Msg.notFound.
fn empty() -> RunError {
    Failure::with_status(crate::msg::NOT_FOUND, StatusCode::NOT_FOUND).into()
}

fn not_allowed() -> RunError {
    Failure::with_status(crate::msg::NOT_ALLOWED, StatusCode::FORBIDDEN).into()
}

/// `play.core.utils.HttpHeaderParameterEncoding.encode` (Play 3.0.11, checked
/// against the jar): printable ASCII except `"`, `\` and `%` is quoted as is,
/// anything else becomes `?` and adds an RFC 5987 `name*=utf-8''…` parameter
/// (attr-chars raw, other bytes as lowercase `%xx`).
pub fn play_header_parameter(name: &str, value: &str) -> String {
    let mut out = format!("{name}=\"");
    let mut extended = false;
    for c in value.chars() {
        if (' '..='~').contains(&c) && !matches!(c, '"' | '\\' | '%') {
            out.push(c);
        } else {
            extended = true;
            out.push('?');
        }
    }
    out.push('"');
    if extended {
        let _ = write!(out, "; {name}*=utf-8''");
        for byte in value.bytes() {
            if byte.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&byte) {
                out.push(char::from(byte));
            } else {
                let _ = write!(out, "%{byte:02x}");
            }
        }
    }
    out
}

/// A finished Task annotation of a compound download.
#[derive(Debug, Clone, sqlx::FromRow)]
struct CompoundRow {
    id: ObjectId,
    dataset_id: ObjectId,
    task_id: Option<ObjectId>,
    owner_id: ObjectId,
    description: String,
}

/// downloadProject / downloadTask / downloadTaskType: a logged-in team
/// manager or administrator of the parent's team receives a zip of the
/// finished Task annotations (`AnnotationService.zipAnnotations`).
async fn download_compound(
    context: &Context<'_>,
    typ: AnnotationType,
    id: &ObjectId,
    skip_volume_data: bool,
) -> RunResult<Response> {
    let user = context.user.ok_or_else(not_allowed)?;
    let pool = context.pool();
    let (annotations, zip_name) = match typ {
        AnnotationType::CompoundProject => {
            let (team, name) = dao::find_project(pool, user, id).await?.ok_or_else(|| {
                RunError::from(Failure::with_status(
                    crate::msg::project::not_found(id),
                    StatusCode::NOT_FOUND,
                ))
            })?;
            assert_team_manager_or_admin(pool, user, &team).await?;
            (dao::finished_project_annotations(pool, id).await?, name)
        }
        AnnotationType::CompoundTask => {
            let project = dao::find_task_project(pool, user, id)
                .await?
                .ok_or_else(|| {
                    RunError::from(Failure::with_status(
                        crate::msg::task::not_found(id),
                        StatusCode::NOT_FOUND,
                    ))
                })?;
            let (team, _) = dao::find_project(pool, user, &project)
                .await?
                .ok_or_else(|| {
                    RunError::from(Failure::with_status(
                        crate::msg::project::not_found(&project),
                        StatusCode::NOT_FOUND,
                    ))
                })?;
            assert_team_manager_or_admin(pool, user, &team).await?;
            (
                dao::finished_task_annotations(pool, user, std::slice::from_ref(id)).await?,
                id.to_string(),
            )
        }
        AnnotationType::CompoundTaskType => {
            let (team, summary) = dao::find_task_type(pool, user, id).await?.ok_or_else(|| {
                RunError::from(Failure::with_status(
                    crate::msg::task_type::not_found(id),
                    StatusCode::NOT_FOUND,
                ))
            })?;
            assert_team_manager_or_admin(pool, user, &team).await?;
            let tasks = dao::task_type_tasks(pool, user, id).await?;
            (
                dao::finished_task_annotations(pool, user, &tasks).await?,
                summary,
            )
        }
        _ => return Err(fail(VIEW_NOT_DOWNLOADABLE)),
    };
    let bytes = zip_annotations(context, user, &annotations, skip_volume_data).await?;
    let file_name = normalize(&format!("{zip_name}_nmls.zip"));
    Ok(file_response(
        bytes,
        ZIP_MIME_TYPE,
        format!(
            "attachment; {}",
            play_header_parameter("filename", &file_name)
        ),
    ))
}

/// `Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, team)) ?~>
/// notAllowed ~> FORBIDDEN`. A missing team is Msg.Team.adminNotAllowed
/// (kept as cause); team-manager roles count only inside the user's
/// organization.
async fn assert_team_manager_or_admin(
    pool: &PgPool,
    user: &AuthUser,
    team_id: &ObjectId,
) -> RunResult<()> {
    let team = crate::annotation::dao::find_team_with_manager_flag(pool, user, team_id).await?;
    match team {
        None => Err(Failure::new(crate::msg::team::ADMIN_NOT_ALLOWED)
            .wrap(crate::msg::NOT_ALLOWED)
            .with_param(StatusCode::FORBIDDEN)
            .into()),
        Some((organization, manages))
            if organization == user.organization_id && (manages || user.is_admin) =>
        {
            Ok(())
        }
        Some(_) => Err(not_allowed()),
    }
}

/// Annotation.skeletonTracingId / volumeTracingId: at most one layer of the
/// kind (else Msg.Annotation.multiLayers*NotImplemented).
fn single_tracing_id(layers: &[LayerRow], typ: &str, message: &str) -> RunResult<Option<String>> {
    let mut matching = layers.iter().filter(|layer| layer.typ == typ);
    let first = matching.next().map(|layer| layer.tracing_id.clone());
    if matching.next().is_some() {
        return Err(fail(message));
    }
    Ok(first)
}

/// AnnotationService.DownloadAnnotation after getTracingsScalesAndNamesFor.
struct DownloadAnnotation<'a> {
    row: &'a CompoundRow,
    skeleton_id: Option<String>,
    volume_id: Option<String>,
    skeleton: Option<SkeletonTracing>,
    volume: Option<VolumeTracing>,
    volume_data: Option<Vec<u8>>,
    name: String,
    voxel_size: Option<NmlVoxelSize>,
    owner_name: String,
    task_id: Option<&'a ObjectId>,
    organization_id: String,
    dataset_name: String,
    dataset_id: ObjectId,
}

/// getTracingsScalesAndNamesFor for one dataset group: scale, tracing ids,
/// getMultiple skeletons/volumes, volume data, then per-annotation lookups.
/// Lists are zipped like Scala (a shorter tracing-store answer truncates).
async fn download_annotations_for_dataset<'a>(
    context: &Context<'_>,
    user: &AuthUser,
    dataset_id: &ObjectId,
    group: &[&'a CompoundRow],
    skip_volume_data: bool,
) -> RunResult<Vec<DownloadAnnotation<'a>>> {
    let pool = context.pool();
    let tracing_store = &context.services.tracing_store;
    let dataset = dao::find_readable_dataset(pool, user, dataset_id)
        .await?
        .ok_or_else(empty)?;
    let voxel_size = dataset.voxel_size();
    let mut layers = Vec::with_capacity(group.len());
    for row in group {
        layers.push(dao::find_all_layers(pool, &row.id).await?);
    }
    let skeleton_ids = layers
        .iter()
        .map(|layers| {
            single_tracing_id(
                layers,
                "Skeleton",
                crate::msg::annotation::MULTI_LAYERS_SKELETON_NOT_IMPLEMENTED,
            )
        })
        .collect::<RunResult<Vec<_>>>()?;
    let volume_ids = layers
        .iter()
        .map(|layers| {
            single_tracing_id(
                layers,
                "Volume",
                crate::msg::annotation::MULTI_LAYERS_VOLUME_NOT_IMPLEMENTED,
            )
        })
        .collect::<RunResult<Vec<_>>>()?;
    let url = find_first_tracing_store_url(pool)
        .await?
        .ok_or_else(|| fail(crate::msg::tracing_store::NOT_FOUND))?;
    let skeletons = tracing_store
        .get_skeleton_tracings(&url, &skeleton_ids)
        .await
        .map_err(rpc_failure)?;
    let volumes = tracing_store
        .get_volume_tracings(&url, &volume_ids)
        .await
        .map_err(rpc_failure)?;
    let mut volume_data = Vec::with_capacity(volume_ids.len());
    for volume_id in &volume_ids {
        volume_data.push(match volume_id {
            Some(tracing_id) if !skip_volume_data => Some(
                tracing_store
                    .get_volume_data(
                        &url,
                        tracing_id,
                        VolumeDataZipFormat::Wkw,
                        voxel_size.as_ref(),
                    )
                    .await
                    .map_err(|error| rpc_failure(error.into()))?,
            ),
            _ => None,
        });
    }
    let mut incomplete = Vec::with_capacity(group.len());
    for (row, (skeleton_id, volume_id)) in
        group.iter().zip(skeleton_ids.into_iter().zip(volume_ids))
    {
        incomplete.push(
            single_download_annotation(
                context,
                user,
                row,
                skeleton_id,
                volume_id,
                voxel_size.clone(),
            )
            .await?,
        );
    }
    Ok(incomplete
        .into_iter()
        .zip(skeletons)
        .zip(volumes)
        .zip(volume_data)
        .map(|(((mut annotation, skeleton), volume), data)| {
            annotation.skeleton = skeleton;
            annotation.volume = volume;
            annotation.volume_data = data;
            annotation
        })
        .collect())
}

/// getSingleDownloadAnnotation (requester access context).
async fn single_download_annotation<'a>(
    context: &Context<'_>,
    user: &AuthUser,
    row: &'a CompoundRow,
    skeleton_id: Option<String>,
    volume_id: Option<String>,
    voxel_size: Option<NmlVoxelSize>,
) -> RunResult<DownloadAnnotation<'a>> {
    let pool = context.pool();
    // userService.findOneCached under UserDAO read access ?~> Msg.User.notFound
    let multi_user = dao::find_multi_user_id_readable(pool, user, &row.owner_id).await?;
    let multi_user = multi_user.ok_or_else(|| fail(crate::msg::user::NOT_FOUND_NO_ID))?;
    let owner_name = find_multi_user(pool, &multi_user, true)
        .await?
        .map(|(first, last)| format!("{first} {last}"))
        .ok_or_else(empty)?;
    let task_id = match &row.task_id {
        Some(task_id) => {
            if !dao::task_exists(pool, task_id, Some(Some(user))).await? {
                return Err(fail(TASK_NOT_FOUND));
            }
            Some(task_id)
        }
        None => None,
    };
    let parts = AnnotationNameParts {
        id: &row.id,
        owner_id: &row.owner_id,
        dataset_id: &row.dataset_id,
        task_id: row.task_id.as_ref(),
    };
    let name = name_for_annotation(pool, parts, true)
        .await?
        .ok_or_else(empty)?;
    let dataset = dao::find_readable_dataset(pool, user, &row.dataset_id)
        .await?
        .ok_or_else(empty)?;
    let organization_id = dao::find_organization_id_for_annotation(pool, &row.id)
        .await?
        .ok_or_else(empty)?;
    Ok(DownloadAnnotation {
        row,
        skeleton_id,
        volume_id,
        skeleton: None,
        volume: None,
        volume_data: None,
        name,
        voxel_size,
        owner_name,
        task_id,
        organization_id,
        dataset_name: dataset.name,
        dataset_id: dataset.id,
    })
}

/// AnnotationService.zipAnnotations + createZip: per annotation `<name>.nml`,
/// or `<name>.zip` holding `<name>_data.zip` and `<name>.nml` when volume
/// data was fetched. Annotations are grouped by dataset (first appearance).
async fn zip_annotations(
    context: &Context<'_>,
    user: &AuthUser,
    annotations: &[CompoundRow],
    skip_volume_data: bool,
) -> RunResult<Vec<u8>> {
    let mut groups: Vec<(&ObjectId, Vec<&CompoundRow>)> = Vec::new();
    for row in annotations {
        match groups
            .iter_mut()
            .find(|(dataset, _)| **dataset == row.dataset_id)
        {
            Some((_, group)) => group.push(row),
            None => groups.push((&row.dataset_id, vec![row])),
        }
    }
    let mut downloads = Vec::with_capacity(annotations.len());
    for (dataset_id, group) in &groups {
        downloads.extend(
            download_annotations_for_dataset(context, user, dataset_id, group, skip_volume_data)
                .await?,
        );
    }
    let config = &context.services.misc.0.config;
    let mut rendered: Vec<(String, String, Option<Vec<u8>>)> = Vec::with_capacity(downloads.len());
    for download in downloads {
        // FetchedAnnotationLayer.layersFromTracings
        if download.skeleton_id.is_some() != download.skeleton.is_some() {
            return Err(fail(MISMATCHING_SKELETON));
        }
        if download.volume_id.is_some() != download.volume.is_some() {
            return Err(fail(MISMATCHING_VOLUME));
        }
        let mut layers = Vec::with_capacity(2);
        if let (Some(tracing_id), Some(tracing)) = (&download.skeleton_id, &download.skeleton) {
            layers.push(NmlLayer {
                tracing_id,
                name: "Skeleton",
                tracing: NmlLayerTracing::Skeleton(tracing),
                has_edited_mapping_edges: false,
                base_mapping_name: None,
            });
        }
        if let (Some(tracing_id), Some(tracing)) = (&download.volume_id, &download.volume) {
            layers.push(NmlLayer {
                tracing_id,
                name: "Volume",
                tracing: NmlLayerTracing::Volume(tracing),
                has_edited_mapping_edges: false,
                base_mapping_name: None,
            });
        }
        if layers.is_empty() {
            return Err(fail(NEEDS_SKELETON_OR_VOLUME));
        }
        let volume_filename = format!("{}_data.zip", download.name);
        let document = write_nml(&NmlWriteInput {
            layers,
            annotation_user_states: &[],
            requesting_user_id: None,
            annotation_owner_id: &download.row.owner_id,
            annotation_owner_name: &download.owner_name,
            annotation: Some(NmlAnnotation {
                id: &download.row.id,
                description: &download.row.description,
                has_task: download.row.task_id.is_some(),
            }),
            task_id: download.task_id,
            voxel_size: download.voxel_size.as_ref(),
            volume_filename: Some(&volume_filename),
            organization_id: &download.organization_id,
            wk_url: &config.public_uri,
            dataset_name: &download.dataset_name,
            dataset_id: &download.dataset_id,
            skip_volume_data,
            volume_data_zip_format: VolumeDataZipFormat::Wkw,
            writer_git_commit: &config.build_info.commit_hash,
            timestamp_millis: chrono::Utc::now().timestamp_millis(),
        })
        .map_err(|error| fail(error.to_string()))?;
        rendered.push((download.name, document, download.volume_data));
    }
    let mut outer = ZipWriter::new(Cursor::new(Vec::new()));
    let zip_error = |_| fail(ZIP_NML_FAILED);
    for (name, document, volume_data) in &rendered {
        match volume_data {
            Some(data) => {
                let inner = zip_entries(&[
                    ZipEntry {
                        name: format!("{name}_data.zip"),
                        bytes: data,
                        fast: false,
                    },
                    ZipEntry {
                        name: format!("{name}.nml"),
                        bytes: document.as_bytes(),
                        fast: false,
                    },
                ])
                .map_err(zip_error)?;
                add_zip_entry(&mut outer, &format!("{name}.zip"), &inner).map_err(zip_error)?;
            }
            None => {
                add_zip_entry(&mut outer, &format!("{name}.nml"), document.as_bytes())
                    .map_err(zip_error)?;
            }
        }
    }
    Ok(outer.finish().map_err(zip_error)?.into_inner())
}

#[cfg(test)]
mod tests;
