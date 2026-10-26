//! JobController job submission (`POST /jobs/run/*`) with JobService.submitJob /
//! submitPaidJob: worker selection, storage quota, credit reservation and job
//! creation in one database transaction.
//!
//! Like Play, route parameters and request bodies are validated before the
//! request is authenticated. Failures inside a submission are wrapped by the
//! route's "Could not start …" message; the cause is reported in Play's `chain`
//! entry (see [`Failure`]).
use axum::{
    Extension, Json, Router,
    body::Bytes,
    extract::{
        FromRequestParts, State,
        rejection::{BytesRejection, PathRejection},
    },
    http::{StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Utc};
use serde_json::{Map, Value, json};
use sqlx::PgConnection;

use crate::{
    AppState,
    auth::{AuthUser, authenticate_request},
    dataset::create::{validate_dataset_name, validate_layer_name_lax},
    error::ApiError,
    extract::extension,
    job::routes::NOT_ENOUGH_CREDITS,
    stores::client::ServiceClients,
    system::application_info::MiscState,
    util::id::ObjectId,
};
use webknossos_common::{
    enums::LengthUnit,
    geometry::{BoundingBox, Vec3Int},
};

mod dao;

use dao::{Dataset, LayerRow};

const NO_WORKER: &str =
    "No worker supporting the requested job is available for the selected data store.";
const PAID_NO_ADMIN_OR_MANAGER: &str =
    "Starting paid jobs is only allowed for Administrators, Dataset Managers or Team Managers.";
const SUBMIT_FAILED: &str = "Could not submit job.";
const STORAGE_EXCEEDED: &str = "Cannot start this job because the storage quota of the organization is exceeded, so its results could not be stored. Please free up storage or upgrade your plan.";
const ORGANIZATION_STORAGE_EXCEEDED: &str = "The storage quota of the organization is exceeded.";
const INVALID_BOUNDING_BOX_OR_MAG: &str = "Either the selected bounding box could not be parsed (must be x,y,z,width,height,depth) or the mag is wrong or does not exist.";
const INVALID_BOUNDING_BOX: &str =
    "The selected bounding box could not be parsed, must be x,y,z,width,height,depth.";
const VOLUME_EXCEEDED: &str = "The volume of the selected bounding box is too large.";
const EDGE_LENGTH_EXCEEDED: &str = "An edge length of the selected bounding box is too large.";
const INVALID_EXPORT_FORMAT: &str =
    "Invalid export format. Must be one of ome_tiff, tiff_stack, ozx.";
const INVALID_ADDITIONAL_COORDINATES: &str = "Invalid additional coordinates for this data layer.";
const SUPER_USER_ONLY: &str = "Only super users can perform this action.";
const MUST_INCLUDE_WATERMARK: &str =
    "Render animation jobs for free plans must include the WEBKNOSSOS watermark.";
const RESOLUTION_MUST_BE_SD: &str = "Render animation jobs for free plans must use SD resolution.";

/// Per-route messages: Msg.Job.<Route>.wrongOrga and submitFailed.
const MESH_WRONG_ORGA: &str =
    "Computing mesh files is only allowed for datasets of your own organization.";
const MESH_SUBMIT_FAILED: &str = "Could not start mesh file computation job.";
const SEGMENT_INDEX_WRONG_ORGA: &str =
    "Computing segment index files is only allowed for datasets of your own organization.";
const SEGMENT_INDEX_SUBMIT_FAILED: &str = "Could not start segment index file computation job.";
pub(crate) const INFERENCE_WRONG_ORGA: &str =
    "Running AI models is only allowed for datasets of your own organization.";
pub(crate) const INFERENCE_SUBMIT_FAILED: &str = "Could not start the AI inference job.";
const ALIGN_WRONG_ORGA: &str =
    "Aligning sections is only allowed for datasets of your own organization.";
const ALIGN_SUBMIT_FAILED: &str = "Could not start the section alignment job.";
const EXPORT_SUBMIT_FAILED: &str = "Could not start data export job.";
const MATERIALIZE_WRONG_ORGA: &str =
    "Materializing volume annotations is only allowed for datasets of your own organization.";
const MATERIALIZE_SUBMIT_FAILED: &str = "Could not start the materialize volume annotation job.";
const LARGEST_SEGMENT_WRONG_ORGA: &str =
    "Finding the largest segment id is only allowed for datasets of your own organization.";
const LARGEST_SEGMENT_SUBMIT_FAILED: &str = "Could not start find largest segment id job.";
const ANIMATION_SUBMIT_FAILED: &str = "Could not start render animation job.";

/// JobCommand.jobsWritingToStorage: refused while the storage quota is exceeded.
const JOBS_WRITING_TO_STORAGE: [&str; 7] = [
    "align_sections",
    "compute_mesh_file",
    "compute_segment_index_file",
    "infer_instances",
    "infer_mitochondria",
    "infer_neurons",
    "materialize_volume_annotation",
];

#[derive(Clone)]
struct SubmitRoutes {
    enabled: bool,
}

pub fn router(enabled: bool) -> Router<AppState> {
    Router::new()
        .route(
            "/jobs/run/computeMeshFile/{datasetId}",
            post(compute_mesh_file),
        )
        .route(
            "/jobs/run/computeSegmentIndexFile/{datasetId}",
            post(compute_segment_index_file),
        )
        .route("/jobs/run/exportTiff/{datasetId}", post(export_tiff))
        .route(
            "/jobs/run/inferMitochondria/{datasetId}",
            post(infer_mitochondria),
        )
        .route("/jobs/run/alignSections/{datasetId}", post(align_sections))
        .route(
            "/jobs/run/materializeVolumeAnnotation/{datasetId}",
            post(materialize_volume_annotation),
        )
        .route(
            "/jobs/run/findLargestSegmentId/{datasetId}",
            post(find_largest_segment_id),
        )
        .route(
            "/jobs/run/renderAnimation/{datasetId}",
            post(render_animation),
        )
        .layer(Extension(SubmitRoutes { enabled }))
}

// ---------------------------------------------------------------------------
// Fox failures with chains
// ---------------------------------------------------------------------------

/// A Play/Fox `Failure`: message, optional HTTP status (`~> CODE`, ParamFailure)
/// and the failure it wraps (`?~>`). Rendered like ExtendedController.asResult:
/// `{"messages": [{"error": message}, {"chain": "[Server Time …] cause <~ …"}]}`.
#[derive(Debug)]
pub(crate) struct Failure {
    message: String,
    status: Option<StatusCode>,
    cause: Option<Box<Failure>>,
}

impl Failure {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: None,
            cause: None,
        }
    }

    pub(crate) fn with_status(message: impl Into<String>, status: StatusCode) -> Self {
        Self {
            status: Some(status),
            ..Self::new(message)
        }
    }

    /// `?~> message`: a ParamFailure keeps its status.
    pub(crate) fn wrap(self, message: &str) -> Self {
        Self {
            message: message.to_owned(),
            status: self.status,
            cause: Some(Box::new(self)),
        }
    }

    /// Formatter.formatFailureChain (ParamFailures append their parameter).
    fn format_chain(&self) -> String {
        let mut text = self.message.clone();
        if let Some(status) = self.status {
            text.push(' ');
            text.push_str(&status.as_u16().to_string());
        }
        if let Some(cause) = &self.cause {
            text.push_str(" <~ ");
            text.push_str(&cause.format_chain());
        }
        text
    }
}

/// Either a Fox failure (client error, possibly chained) or a server-side error,
/// which is never wrapped or chained.
#[derive(Debug)]
pub(crate) enum RunError {
    Failure(Failure),
    Api(ApiError),
}

pub(crate) type RunResult<T> = Result<T, RunError>;

impl From<Failure> for RunError {
    fn from(failure: Failure) -> Self {
        Self::Failure(failure)
    }
}

impl From<ApiError> for RunError {
    fn from(error: ApiError) -> Self {
        if error.status.is_client_error() && error.status != StatusCode::UNAUTHORIZED {
            let status = (error.status != StatusCode::BAD_REQUEST).then_some(error.status);
            Self::Failure(Failure {
                message: error.message,
                status,
                cause: None,
            })
        } else {
            Self::Api(error)
        }
    }
}

impl From<sqlx::Error> for RunError {
    fn from(error: sqlx::Error) -> Self {
        Self::Api(error.into())
    }
}

impl RunError {
    /// `?~> message` on a Fox failure; server-side errors stay unwrapped.
    pub(crate) fn wrap(self, message: &str) -> Self {
        match self {
            Self::Failure(failure) => Self::Failure(failure.wrap(message)),
            api => api,
        }
    }
}

impl IntoResponse for RunError {
    fn into_response(self) -> Response {
        match self {
            Self::Api(error) => error.into_response(),
            Self::Failure(failure) => {
                let status = failure.status.unwrap_or(StatusCode::BAD_REQUEST);
                let mut messages = vec![json!({"error": failure.message})];
                if let Some(cause) = &failure.cause {
                    let time = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
                    messages.push(json!({
                        "chain": format!("[Server Time {time}] {}", cause.format_chain())
                    }));
                }
                (status, Json(json!({"messages": messages}))).into_response()
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Request binding (route parameters and bodies precede authentication)
// ---------------------------------------------------------------------------

/// ObjectId.fromStringSync: 24 hex digits in either case, normalized to lowercase.
fn parse_object_id(literal: &str) -> Option<ObjectId> {
    ObjectId::parse(literal).ok()
}

/// ObjectId.pathBinder (fromStringWithPrefixSync): `anything-<ObjectId>` is accepted.
async fn dataset_id(parts: &mut Parts, state: &AppState) -> RunResult<ObjectId> {
    let raw: axum::extract::Path<String> = axum::extract::Path::from_request_parts(parts, state)
        .await
        .map_err(|_: PathRejection| Failure::new(crate::msg::request::INVALID_PATH))?;
    let candidate = raw.rsplit_once('-').map_or(raw.as_str(), |(_, id)| id);
    ObjectId::parse(candidate).map_err(|_| {
        Failure::new(format!(
            "Cannot parse URI path parameter datasetId with value “{}” as ObjectId.",
            raw.0
        ))
        .into()
    })
}

/// Play's query string binders (first value of each key wins).
struct Params(Vec<(String, String)>);

impl Params {
    fn from_parts(parts: &Parts) -> RunResult<Self> {
        let query = parts.uri.query().unwrap_or_default();
        let pairs: Vec<(String, String)> = serde_urlencoded::from_str(query)
            .map_err(|_| Failure::new(crate::msg::request::INVALID_QUERY))?;
        Ok(Self(pairs))
    }

    fn optional(&self, key: &str) -> Option<String> {
        self.0
            .iter()
            .find(|(candidate, _)| candidate == key)
            .map(|(_, value)| value.clone())
    }

    fn required(&self, key: &str) -> RunResult<String> {
        self.optional(key)
            .ok_or_else(|| Failure::new(crate::msg::request::missing_parameter(key)).into())
    }

    /// QueryStringBindable.bindableBoolean: true/false, or any integer (non-zero is true).
    fn boolean(&self, key: &str) -> RunResult<bool> {
        let value = self.required(key)?;
        parse_play_boolean(&value)
            .ok_or_else(|| Failure::new(crate::msg::request::invalid_boolean(key)).into())
    }

    fn object_id(&self, key: &str) -> RunResult<ObjectId> {
        let value = self.required(key)?;
        parse_object_id(&value).ok_or_else(|| invalid_query_object_id(key, &value))
    }

    fn optional_object_id(&self, key: &str) -> RunResult<Option<ObjectId>> {
        self.optional(key)
            .map(|value| {
                parse_object_id(&value).ok_or_else(|| invalid_query_object_id(key, &value))
            })
            .transpose()
    }
}

fn invalid_query_object_id(key: &str, value: &str) -> RunError {
    Failure::new(format!(
        "Cannot parse URI query parameter {key} with value “{value}” as ObjectId."
    ))
    .into()
}

fn parse_play_boolean(value: &str) -> Option<bool> {
    match value.trim() {
        "true" => Some(true),
        "false" => Some(false),
        other => other.parse::<i32>().ok().map(|number| number != 0),
    }
}

/// `validateJson`: Play's json body parser (text/json or application/json) and Reads.
fn json_body(parts: &Parts, body: Result<Bytes, BytesRejection>) -> RunResult<Map<String, Value>> {
    let json_content_type = parts
        .headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .is_some_and(|mime| {
            mime.eq_ignore_ascii_case("application/json") || mime.eq_ignore_ascii_case("text/json")
        });
    if !json_content_type {
        return Err(RunError::Api(ApiError::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            crate::msg::request::EXPECTING_JSON_BODY,
        )));
    }
    let bytes = body.map_err(|rejection| {
        RunError::Api(ApiError::new(
            rejection.status(),
            crate::msg::request::INVALID_JSON_BODY,
        ))
    })?;
    match serde_json::from_slice(&bytes) {
        Ok(Value::Object(object)) => Ok(object),
        _ => Err(Failure::new(crate::msg::request::INVALID_JSON_BODY).into()),
    }
}

async fn authenticate(parts: &Parts, state: &AppState) -> RunResult<AuthUser> {
    authenticate_request(parts, state)
        .await
        .map_err(RunError::Api)?
        .map(|(user, _)| user)
        .ok_or_else(|| RunError::Api(ApiError::unauthorized()))
}

// ---------------------------------------------------------------------------
// JSON Reads with Play semantics
// ---------------------------------------------------------------------------

fn invalid_body() -> RunError {
    Failure::new(crate::msg::request::INVALID_JSON_BODY).into()
}

/// Reads[Int]: a JSON number that is a valid Int (BigDecimal.isValidInt).
fn json_int(value: &Value) -> Option<i32> {
    if let Some(number) = value.as_i64() {
        return i32::try_from(number).ok();
    }
    let number = value.as_f64()?;
    (number.fract() == 0.0 && number >= f64::from(i32::MIN) && number <= f64::from(i32::MAX))
        .then_some(number as i32)
}

fn read_string(body: &Map<String, Value>, key: &str) -> RunResult<String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(invalid_body)
}

fn read_bool(body: &Map<String, Value>, key: &str) -> RunResult<bool> {
    body.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(invalid_body)
}

/// readNullable: missing or null is None, anything else must parse.
fn read_optional<T>(
    body: &Map<String, Value>,
    key: &str,
    parse: impl FnOnce(&Value) -> Option<T>,
) -> RunResult<Option<T>> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => parse(value).map(Some).ok_or_else(invalid_body),
    }
}

fn read_enum(body: &Map<String, Value>, key: &str, values: &[&str]) -> RunResult<String> {
    let value = read_string(body, key)?;
    if values.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(invalid_body())
    }
}

fn json_object_id(value: &Value) -> Option<ObjectId> {
    value.as_str().and_then(parse_object_id)
}

fn optional_json<T: Into<Value>>(value: Option<T>) -> Value {
    value.map_or(Value::Null, Into::into)
}

// ---------------------------------------------------------------------------
// Geometry (com.scalableminds.util.geometry with JVM Int arithmetic)
// ---------------------------------------------------------------------------

/// The `BoundingBox` JSON wkLibs reads: topLeft, width, height, depth.
fn to_wk_libs_json(bounding_box: BoundingBox) -> Map<String, Value> {
    let mut object = Map::new();
    object.insert("topLeft".into(), json!(bounding_box.top_left));
    object.insert("width".into(), json!(bounding_box.width));
    object.insert("height".into(), json!(bounding_box.height));
    object.insert("depth".into(), json!(bounding_box.depth));
    object
}

/// JobService.assertBoundingBoxLimits.
fn assert_bounding_box_limits(
    misc: &MiscState,
    bounding_box: &str,
    mag: Option<&str>,
) -> RunResult<()> {
    let bounding_box_in_mag = BoundingBox::from_literal(bounding_box)
        .zip(Vec3Int::from_mag_literal(mag.unwrap_or("1-1-1"), true))
        .and_then(|(bounding_box, mag)| bounding_box.checked_div_mag(mag))
        .ok_or_else(|| Failure::new(INVALID_BOUNDING_BOX_OR_MAG))?;
    let features = &misc.config().features;
    let feature =
        |key: &str, default: i64| features.get(key).and_then(Value::as_i64).unwrap_or(default);
    let max_volume = feature("exportTiffMaxVolumeMVx", 1024).saturating_mul(1024 * 1024);
    if bounding_box_in_mag.volume() > max_volume {
        return Err(Failure::new(VOLUME_EXCEEDED).into());
    }
    if i64::from(bounding_box_in_mag.size().max_dim()) > feature("exportTiffMaxEdgeLengthVx", 8192)
    {
        return Err(Failure::new(EDGE_LENGTH_EXCEEDED).into());
    }
    Ok(())
}

/// Formatter.formatDateForFilename: SimpleDateFormat("YYYY-MM-dd_HH-mm"). `YYYY`
/// is the week year (weeks start on Sunday; the week containing January 1st is
/// week 1, as for the en_US locale). Rendered in UTC.
/// Formatter.formatDateForFilename: SimpleDateFormat("YYYY-MM-dd_HH-mm") in the JVM default zone;
/// callers pass `Local::now()` (TZ, else /etc/localtime, like the JVM).
fn format_date_for_filename<Tz: TimeZone>(now: DateTime<Tz>) -> String
where
    Tz::Offset: std::fmt::Display,
{
    let end_of_week =
        now.date_naive() + Duration::days(6 - i64::from(now.weekday().num_days_from_sunday()));
    let week_year = if end_of_week.year() > now.year() {
        now.year() + 1
    } else {
        now.year()
    };
    format!("{week_year:04}-{}", now.format("%m-%d_%H-%M"))
}

// ---------------------------------------------------------------------------
// Dataset, organization and datastore lookups
// ---------------------------------------------------------------------------

impl Dataset {
    /// The data source's voxel size (`dataset.voxelSize`) in nanometers
    /// (VoxelSize.toNanometer; a missing unit is nanometer).
    pub(crate) fn voxel_size_in_nanometers(&self) -> Option<[f64; 3]> {
        let factor = <[f64; 3]>::try_from(self.voxel_size_factor.clone()?).ok()?;
        let per_unit = self
            .voxel_size_unit
            .as_deref()
            .and_then(LengthUnit::from_name)
            .map_or(1.0, LengthUnit::to_nanometer);
        Some(factor.map(|component| component * per_unit))
    }
}

/// DatasetDAO.findOne with the user's access; `None` is the empty Fox (callers
/// attach their own message).
pub(crate) async fn find_readable_dataset(
    state: &AppState,
    user: &AuthUser,
    id: &ObjectId,
) -> RunResult<Option<Dataset>> {
    Ok(dao::find_one_readable_dataset(&state.pool, &user.id, id).await?)
}

/// DatasetDAO.findOne with the user's access `?~> Msg.Dataset.notFound(id) ~> NOT_FOUND`.
async fn find_dataset(state: &AppState, user: &AuthUser, id: &ObjectId) -> RunResult<Dataset> {
    find_readable_dataset(state, user, id)
        .await?
        .ok_or_else(|| {
            Failure::with_status(crate::msg::dataset::not_found(id), StatusCode::NOT_FOUND).into()
        })
}

/// OrganizationDAO.findOne(dataset._organization) with global access.
async fn find_organization(state: &AppState, organization: &str) -> RunResult<String> {
    dao::find_organization_id(&state.pool, organization)
        .await?
        .ok_or_else(|| Failure::new(crate::msg::organization::not_found(organization)).into())
}

/// Dataset of the user's own organization, else 403 with the route's wrongOrga message.
async fn own_organization(
    state: &AppState,
    user: &AuthUser,
    dataset: &Dataset,
    wrong_orga: &str,
) -> RunResult<String> {
    let organization = find_organization(state, &dataset.organization).await?;
    if user.organization_id != organization {
        return Err(Failure::with_status(wrong_orga, StatusCode::FORBIDDEN).into());
    }
    Ok(organization)
}

/// DatasetService.clientFor(dataset).getOrganizationBaseDirectory(user org, requireLocal = true).
async fn organization_base_directory(
    state: &AppState,
    clients: &ServiceClients,
    user: &AuthUser,
    dataset: &Dataset,
) -> RunResult<String> {
    // DataStoreDAO.findOneByName with the user's access.
    let url = dao::find_data_store_url_for_user(&state.pool, dataset.data_store.trim(), &user.id)
        .await?
        .ok_or_else(|| Failure::new(crate::msg::data_store::NOT_FOUND))?;
    let directory: Value = clients
        .get_json(
            &url,
            &["data", "getOrganizationBaseDirectory"],
            &[
                ("organizationId", user.organization_id.clone()),
                ("requireLocal", "true".into()),
                ("requireAllowsUpload", "false".into()),
            ],
        )
        .await
        .map_err(ApiError::from)?;
    match directory {
        Value::String(directory) => Ok(directory),
        _ => Err(RunError::Api(ApiError::new(
            StatusCode::BAD_GATEWAY,
            crate::msg::request::SERVICE_INVALID_JSON,
        ))),
    }
}

pub(crate) struct DataLayer {
    pub(crate) name: String,
    pub(crate) bounding_box: BoundingBox,
    pub(crate) finest_mag: Option<[i32; 3]>,
}

/// DatasetService.getDataSourceAndLayerFor: the usable data source's bounding box
/// (union of all layers) and the requested layer.
pub(crate) async fn data_source_and_layer(
    state: &AppState,
    dataset: &Dataset,
    layer_name: &str,
) -> RunResult<(BoundingBox, DataLayer)> {
    let (data_source_box, layers) = usable_data_source(state, dataset).await?;
    let layer = layers
        .into_iter()
        .find(|layer| layer.name == layer_name)
        .ok_or_else(|| Failure::new(crate::msg::dataset::layer::not_found(layer_name)))?;
    Ok((data_source_box, layer))
}

/// DatasetService.usableDataSourceFor: the data source's bounding box (union of
/// all layers) and its layers, ordered by name.
pub(crate) async fn usable_data_source(
    state: &AppState,
    dataset: &Dataset,
) -> RunResult<(BoundingBox, Vec<DataLayer>)> {
    if !dataset.is_usable {
        return Err(Failure::new(crate::msg::dataset::not_usable(&dataset.id)).into());
    }
    if !dataset.has_voxel_size {
        return Err(
            Failure::new(crate::msg::dataset::data_source::USABLE_BUT_NO_VOXEL_SIZE)
                .wrap(crate::msg::dataset::data_source::NOT_FOUND)
                .with_param(StatusCode::NOT_FOUND)
                .into(),
        );
    }
    let rows: Vec<LayerRow> = dao::find_all_layers(&state.pool, &dataset.id).await?;
    let mut layers = Vec::with_capacity(rows.len());
    for row in rows {
        let bounding_box = BoundingBox::from_sql(&row.bounding_box)
            .ok_or_else(|| RunError::Api(ApiError::internal()))?;
        let finest_mag = row
            .finest_mag
            .map(<[i32; 3]>::try_from)
            .transpose()
            .map_err(|_| RunError::Api(ApiError::internal()))?;
        layers.push(DataLayer {
            name: row.name,
            bounding_box,
            finest_mag,
        });
    }
    let data_source_box = layers
        .iter()
        .map(|layer| layer.bounding_box)
        .reduce(|a, b| a.union(&b))
        .unwrap_or_else(BoundingBox::empty);
    Ok((data_source_box, layers))
}

/// All mags of a data layer (DatasetMagDAO.findMagLocatorsForLayer: without pending
/// uploads and, as in Scala, without an ORDER BY).
pub(crate) async fn layer_mags(
    state: &AppState,
    dataset: &Dataset,
    layer_name: &str,
) -> RunResult<Vec<[i32; 3]>> {
    let rows = dao::find_mags_for_layer(&state.pool, &dataset.id, layer_name).await?;
    Ok(rows.into_iter().map(|(x, y, z)| [x, y, z]).collect())
}

impl Failure {
    /// `~> CODE` on an existing failure.
    pub(crate) fn with_param(mut self, status: StatusCode) -> Self {
        self.status = Some(status);
        self
    }
}

// ---------------------------------------------------------------------------
// JobService.submitJob / submitPaidJob
// ---------------------------------------------------------------------------

/// A job to submit: JobCommand, commandArgs and the datastore whose workers run it.
pub(crate) struct Submission<'a> {
    pub(crate) command: &'static str,
    pub(crate) args: Value,
    pub(crate) data_store: &'a str,
}

/// OrganizationService.assertUsedStorageNotExceeded for storage-writing commands,
/// `?~> Msg.Job.storageExceeded ~> FORBIDDEN`.
async fn assert_storage_not_exceeded(
    connection: &mut PgConnection,
    command: &str,
    organization: &str,
) -> RunResult<()> {
    if !JOBS_WRITING_TO_STORAGE.contains(&command) {
        return Ok(());
    }
    let included: Option<i64> = dao::find_included_storage(connection, organization)
        .await?
        .ok_or_else(|| Failure::new(crate::msg::organization::not_found(organization)))?;
    let Some(included) = included else {
        return Ok(());
    };
    let used: i64 = dao::find_used_storage_bytes(connection, organization).await?;
    if used > included {
        return Err(Failure::new(ORGANIZATION_STORAGE_EXCEEDED)
            .wrap(STORAGE_EXCEEDED)
            .with_param(StatusCode::FORBIDDEN)
            .into());
    }
    Ok(())
}

/// JobService.submitJob: jobs enabled, a worker of the datastore supports the
/// command, storage quota, insert the pending job. Returns the new job id.
pub(crate) async fn submit_job(
    connection: &mut PgConnection,
    enabled: bool,
    user: &AuthUser,
    submission: &Submission<'_>,
) -> RunResult<ObjectId> {
    if !enabled {
        return Err(Failure::new(crate::msg::job::NOT_ENABLED).into());
    }
    // WorkerDAO.findAllByDataStore: union of all workers' supported commands;
    // an unparsable worker row fails the lookup.
    let commands: Vec<Vec<String>> =
        dao::find_supported_job_commands_by_data_store(connection, submission.data_store).await?;
    let parsable = commands
        .iter()
        .flatten()
        .all(|command| crate::job::routes::is_job_command(command));
    if !parsable
        || !commands
            .iter()
            .flatten()
            .any(|command| command == submission.command)
    {
        return Err(Failure::new(NO_WORKER).into());
    }
    assert_storage_not_exceeded(connection, submission.command, &user.organization_id).await?;
    let job_id = ObjectId::new();
    dao::insert_one(
        connection,
        &job_id,
        &user.id,
        submission.data_store,
        submission.command,
        &submission.args,
    )
    .await?;
    Ok(job_id)
}

enum PaidSubmission {
    Submitted(ObjectId),
    /// Expected submission failures retain Scala's reservation/refund audit pair.
    Refunded(Failure),
}

/// JobService.submitPaidJob: paid-job permission, storage quota, cost, balance and
/// the pending credit reservation, all in the job's transaction. An expected
/// submission failure commits a refunded audit pair; database errors roll back.
#[allow(clippy::too_many_arguments)]
async fn submit_paid_job(
    connection: &mut PgConnection,
    enabled: bool,
    may_start_paid_jobs: bool,
    misc: &MiscState,
    user: &AuthUser,
    submission: &Submission<'_>,
    bounding_box_in_target_mag: BoundingBox,
    comment: &str,
) -> RunResult<PaidSubmission> {
    if !may_start_paid_jobs {
        return Err(Failure::new(PAID_NO_ADMIN_OR_MANAGER).into());
    }
    assert_storage_not_exceeded(connection, submission.command, &user.organization_id).await?;
    let cost = crate::job::routes::job_cost_in_milli_credits(
        &misc.config().features,
        submission.command,
        &bounding_box_in_target_mag,
    )
    .map_err(Failure::new)?;
    let balance =
        crate::job::dao::get_milli_credit_balance(connection, &user.id, &user.organization_id)
            .await?;
    if balance < i64::from(cost) {
        return Err(Failure::new(NOT_ENOUGH_CREDITS).into());
    }
    let transaction_id = ObjectId::new();
    dao::insert_pending_credit_transaction(
        connection,
        &transaction_id,
        &user.organization_id,
        -cost,
        comment,
    )
    .await
    .map_err(crate::organization::credit_transactions::balance_error)?;
    let job_id = match submit_job(connection, enabled, user, submission).await {
        Ok(job_id) => job_id,
        Err(RunError::Failure(_)) => {
            dao::insert_refund_credit_transaction(
                connection,
                &ObjectId::new(),
                &user.organization_id,
                &transaction_id,
                cost,
                &format!("Refund for transaction {transaction_id}."),
            )
            .await?;
            dao::update_credit_transaction_refunded(connection, &transaction_id).await?;
            return Ok(PaidSubmission::Refunded(Failure::new(SUBMIT_FAILED)));
        }
        Err(error) => return Err(error),
    };
    dao::update_credit_transaction_paid_job(connection, &transaction_id, &job_id).await?;
    Ok(PaidSubmission::Submitted(job_id))
}

/// A paid job (job row plus its pending credit reservation) inserted in a still
/// open serializable transaction. Callers that create dependent rows (AI models,
/// AI inferences) insert them through [`PendingPaidJob::connection`] so the job,
/// the reservation and those rows commit or roll back together, then call
/// [`PendingPaidJob::commit`]. Dropping it rolls everything back.
pub(crate) struct PendingPaidJob {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    job_id: ObjectId,
    command: &'static str,
}

impl PendingPaidJob {
    pub(crate) fn job_id(&self) -> &ObjectId {
        &self.job_id
    }

    pub(crate) fn connection(&mut self) -> &mut PgConnection {
        &mut self.transaction
    }

    /// Commits and tracks JobService.submitJob's RunJobEvent. Returns the job id.
    pub(crate) async fn commit(
        self,
        state: &AppState,
        misc: &MiscState,
        user: &AuthUser,
    ) -> RunResult<ObjectId> {
        self.transaction.commit().await?;
        let mut properties = Map::new();
        properties.insert("command".into(), json!(self.command));
        crate::system::analytics::track(state, misc, user, "run_job".into(), properties);
        Ok(self.job_id)
    }
}

/// JobService.submitPaidJob `?~> submit_failed` for routes outside JobController:
/// paid-job permission (dataset manager, team manager or admin), storage quota,
/// cost from `bounding_box_in_target_mag`, balance, worker support and jobs
/// enabled. Expected failures after the reservation commit Scala's
/// reservation/refund audit pair before failing; every other failure rolls back.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn begin_paid_job(
    state: &AppState,
    misc: &MiscState,
    jobs_enabled: bool,
    user: &AuthUser,
    submission: &Submission<'_>,
    bounding_box_in_target_mag: BoundingBox,
    comment: &str,
    submit_failed: &str,
) -> RunResult<PendingPaidJob> {
    let may_start_paid_jobs = user.is_dataset_manager
        || user
            .is_team_manager_or_admin(&state.pool)
            .await
            .map_err(RunError::Api)?;
    let mut transaction = crate::job::routes::serializable(&state.pool).await?;
    let outcome = submit_paid_job(
        &mut transaction,
        jobs_enabled,
        may_start_paid_jobs,
        misc,
        user,
        submission,
        bounding_box_in_target_mag,
        comment,
    )
    .await
    .map_err(|error| error.wrap(submit_failed))?;
    match outcome {
        PaidSubmission::Submitted(job_id) => Ok(PendingPaidJob {
            transaction,
            job_id,
            command: submission.command,
        }),
        PaidSubmission::Refunded(failure) => {
            transaction.commit().await?;
            Err(failure.wrap(submit_failed).into())
        }
    }
}

/// Submit (paid or not) in one transaction, track the RunJobEvent and answer
/// with JobService.publicWrites. Submission failures are wrapped by `submit_failed`.
async fn run_submission(
    state: &AppState,
    misc: &MiscState,
    routes: &SubmitRoutes,
    user: &AuthUser,
    submission: Submission<'_>,
    paid: Option<(BoundingBox, String)>,
    submit_failed: &str,
) -> RunResult<Json<Value>> {
    let job_id = match paid {
        None => {
            let mut transaction = state.pool.begin().await?;
            let job_id = submit_job(&mut transaction, routes.enabled, user, &submission)
                .await
                .map_err(|error| error.wrap(submit_failed))?;
            transaction.commit().await?;
            let mut properties = Map::new();
            properties.insert("command".into(), json!(submission.command));
            crate::system::analytics::track(state, misc, user, "run_job".into(), properties);
            job_id
        }
        Some((bounding_box, comment)) => {
            begin_paid_job(
                state,
                misc,
                routes.enabled,
                user,
                &submission,
                bounding_box,
                &comment,
                submit_failed,
            )
            .await?
            .commit(state, misc, user)
            .await?
        }
    };
    let mut connection = state.pool.acquire().await?;
    let job = crate::job::routes::find_job(&mut connection, &user.id, &job_id)
        .await?
        .ok_or_else(|| Failure::with_status(crate::msg::NOT_FOUND, StatusCode::NOT_FOUND))?;
    Ok(Json(
        crate::job::routes::public_writes(&mut connection, &user.id, &job).await?,
    ))
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async fn compute_mesh_file(
    State(state): State<AppState>,
    Extension(routes): Extension<SubmitRoutes>,
    mut parts: Parts,
) -> RunResult<Json<Value>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let layer_name = params.required("layerName")?;
    let mag = params.required("mag")?;
    let agglomerate_view = params.optional("agglomerateView");
    let user = authenticate(&parts, &state).await?;
    let misc: MiscState = extension(&parts)?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization = own_organization(&state, &user, &dataset, MESH_WRONG_ORGA).await?;
    validate_layer_name_lax(&layer_name)?;
    let args = json!({
        "organization_id": organization,
        "dataset_name": dataset.name,
        "dataset_id": dataset.id,
        "dataset_directory_name": dataset.directory_name,
        "layer_name": layer_name,
        "mag": mag,
        "agglomerate_view": agglomerate_view,
    });
    let submission = Submission {
        command: "compute_mesh_file",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        &routes,
        &user,
        submission,
        None,
        MESH_SUBMIT_FAILED,
    )
    .await
}

async fn compute_segment_index_file(
    State(state): State<AppState>,
    Extension(routes): Extension<SubmitRoutes>,
    mut parts: Parts,
) -> RunResult<Json<Value>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let layer_name = params.required("layerName")?;
    let user = authenticate(&parts, &state).await?;
    let misc: MiscState = extension(&parts)?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    own_organization(&state, &user, &dataset, SEGMENT_INDEX_WRONG_ORGA).await?;
    validate_layer_name_lax(&layer_name)?;
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": dataset.organization,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "segmentation_layer_name": layer_name,
    });
    let submission = Submission {
        command: "compute_segment_index_file",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        &routes,
        &user,
        submission,
        None,
        SEGMENT_INDEX_SUBMIT_FAILED,
    )
    .await
}

async fn infer_mitochondria(
    State(state): State<AppState>,
    Extension(routes): Extension<SubmitRoutes>,
    mut parts: Parts,
) -> RunResult<Json<Value>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let layer_name = params.required("layerName")?;
    let bbox = params.required("bbox")?;
    let new_dataset_name = params.required("newDatasetName")?;
    let user = authenticate(&parts, &state).await?;
    let misc: MiscState = extension(&parts)?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    own_organization(&state, &user, &dataset, INFERENCE_WRONG_ORGA).await?;
    validate_dataset_name(&new_dataset_name)?;
    validate_layer_name_lax(&layer_name)?;
    let (_, layer) = data_source_and_layer(&state, &dataset, &layer_name).await?;
    // `.toFox` on an empty Option: Play's generic 404.
    let not_found = || RunError::Api(ApiError::not_found(crate::msg::NOT_FOUND));
    let mag1_bounding_box = BoundingBox::from_literal(&bbox).ok_or_else(not_found)?;
    let target_mag = layer.finest_mag.ok_or_else(not_found)?;
    let target_bounding_box = mag1_bounding_box
        .checked_div_mag(target_mag.into())
        .ok_or_else(|| RunError::Api(ApiError::internal()))?;
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": dataset.organization,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "new_dataset_name": new_dataset_name,
        "layer_name": layer_name,
        "bbox": bbox,
    });
    let comment = format!(
        "Run for AI mitochondria segmentation for dataset {}",
        dataset.name
    );
    let submission = Submission {
        command: "infer_mitochondria",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        &routes,
        &user,
        submission,
        Some((target_bounding_box, comment)),
        INFERENCE_SUBMIT_FAILED,
    )
    .await
}

async fn align_sections(
    State(state): State<AppState>,
    Extension(routes): Extension<SubmitRoutes>,
    mut parts: Parts,
    body: Result<Bytes, BytesRejection>,
) -> RunResult<Json<Value>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    // AlignSectionsJobOptions
    let body = json_body(&parts, body)?;
    let layer_name = read_string(&body, "layerName")?;
    let new_dataset_name = read_string(&body, "newDatasetName")?;
    let annotation_id = read_optional(&body, "annotationId", json_object_id)?;
    let custom_configuration = read_optional(&body, "customConfiguration", |value| {
        value.is_object().then(|| value.clone())
    })?;
    let fine_alignment_max_jump_size = read_optional(&body, "fineAlignmentMaxJumpSize", json_int)?;
    let user = authenticate(&parts, &state).await?;
    let misc: MiscState = extension(&parts)?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization = own_organization(&state, &user, &dataset, ALIGN_WRONG_ORGA).await?;
    validate_dataset_name(&new_dataset_name)?;
    validate_layer_name_lax(&layer_name)?;
    let not_usable = crate::msg::dataset::not_usable(&dataset.id);
    let (data_source_box, layer) = data_source_and_layer(&state, &dataset, &layer_name)
        .await
        .map_err(|error| error.wrap(&not_usable))?;
    let layer_mag = layer
        .finest_mag
        .ok_or_else(|| Failure::new(crate::msg::dataset::NO_MAGS))?;
    let finest_mag_box = data_source_box
        .checked_div_mag(layer_mag.into())
        .ok_or_else(|| RunError::Api(ApiError::internal()))?;
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": organization,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "new_dataset_name": new_dataset_name,
        "layer_name": layer_name,
        "annotation_id": annotation_id,
        "custom_configuration": custom_configuration,
        "fine_alignment_max_jump_size": fine_alignment_max_jump_size,
    });
    let comment = format!("Align dataset {}", dataset.name);
    let submission = Submission {
        command: "align_sections",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        &routes,
        &user,
        submission,
        Some((finest_mag_box, comment)),
        ALIGN_SUBMIT_FAILED,
    )
    .await
}

/// AdditionalCoordinate list (JsonHelper.parseAs[Seq[AdditionalCoordinate]]).
fn parse_additional_coordinates(text: &str) -> Result<Vec<(String, i32)>, &'static str> {
    let value: Value = serde_json::from_str(text).map_err(|_| "Failed to parse json")?;
    let invalid = "Failed to validate json against schema";
    let array = value.as_array().ok_or(invalid)?;
    array
        .iter()
        .map(|coordinate| {
            let object = coordinate.as_object().ok_or(invalid)?;
            let name = object.get("name").and_then(Value::as_str).ok_or(invalid)?;
            let value = object.get("value").and_then(json_int).ok_or(invalid)?;
            match object.get("length") {
                None | Some(Value::Null) => {}
                Some(length) if json_int(length).is_some() => {}
                Some(_) => return Err(invalid),
            }
            Ok((name.to_owned(), value))
        })
        .collect()
}

async fn export_tiff(
    State(state): State<AppState>,
    Extension(routes): Extension<SubmitRoutes>,
    mut parts: Parts,
) -> RunResult<Json<Value>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let bbox = params.required("bbox")?;
    let additional_coordinates = params.optional("additionalCoordinates");
    let layer_name = params.optional("layerName");
    let mag = params.optional("mag");
    let annotation_layer_name = params.optional("annotationLayerName");
    let annotation_id = params.optional_object_id("annotationId")?;
    let export_format = params.required("exportFormat")?;
    let user = authenticate(&parts, &state).await?;
    let misc: MiscState = extension(&parts)?;
    let clients: ServiceClients = extension(&parts)?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let dataset_organization = find_organization(&state, &dataset.organization).await?;
    if let Some(layer_name) = &layer_name {
        validate_layer_name_lax(layer_name)?;
    }
    if let Some(annotation_layer_name) = &annotation_layer_name {
        validate_layer_name_lax(annotation_layer_name)?;
    }
    let file_extension = match export_format.as_str() {
        "ome_tiff" => "ome.tif",
        "tiff_stack" => "zip",
        "ozx" => "ozx",
        _ => return Err(Failure::new(INVALID_EXPORT_FORMAT).into()),
    };
    assert_bounding_box_limits(&misc, &bbox, mag.as_deref())?;
    // DatasetLayerAdditionalAxesDAO + Zarr3OutputHelper.reorderAdditionalAxes:
    // sorted by index and renumbered after the channel axis.
    let additional_axes: Vec<(String, i32, i32)> = match &layer_name {
        Some(layer_name) => dao::find_additional_axes(&state.pool, &dataset.id, layer_name).await?,
        None => Vec::new(),
    };
    let rank = i32::try_from(additional_axes.len()).unwrap_or(i32::MAX - 4) + 4;
    let three_d_box =
        BoundingBox::from_literal(&bbox).ok_or_else(|| Failure::new(INVALID_BOUNDING_BOX))?;
    let coordinates = additional_coordinates
        .as_deref()
        .map(parse_additional_coordinates)
        .transpose()
        .map_err(|cause| Failure::new(cause).wrap(INVALID_ADDITIONAL_COORDINATES))?
        .unwrap_or_default();
    // AdditionalAxis.intersectWithAdditionalCoordinates: width-1 bounds at the
    // requested coordinate, else at the lower bound.
    let axes_json: Vec<Value> = additional_axes
        .iter()
        .zip(1..)
        .map(
            |((name, lower_bound, _), index): (&(String, i32, i32), i32)| {
                let start = coordinates
                    .iter()
                    .find(|(coordinate, _)| coordinate == name)
                    .map_or(*lower_bound, |(_, value)| *value);
                json!({"name": name, "bounds": [start, start.wrapping_add(1)], "index": index})
            },
        )
        .collect();
    let mut nd_bbox = to_wk_libs_json(three_d_box);
    nd_bbox.insert("additionalAxes".into(), Value::Array(axes_json));
    nd_bbox.insert(
        "axisOrder".into(),
        json!({"x": rank - 3, "y": rank - 2, "z": rank - 1}),
    );
    let base_directory = organization_base_directory(&state, &clients, &user, &dataset).await?;
    let layer_label = if annotation_layer_name.is_some() {
        "volume"
    } else {
        layer_name.as_deref().unwrap_or_default()
    };
    let export_file_name = format!(
        "{}__{}__{layer_label}.{file_extension}",
        format_date_for_filename(Local::now()),
        dataset.name
    );
    let args = json!({
        "dataset_id": dataset.id,
        "dataset_directory_name": dataset.directory_name,
        "organization_id": dataset_organization,
        "user_organization_base_directory": base_directory,
        "dataset_name": dataset.name,
        "nd_bbox": nd_bbox,
        "export_file_name": export_file_name,
        "export_format": export_format,
        "layer_name": layer_name,
        "mag": mag,
        "annotation_layer_name": annotation_layer_name,
        "annotation_id": annotation_id,
    });
    let submission = Submission {
        command: "export_tiff",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        &routes,
        &user,
        submission,
        None,
        EXPORT_SUBMIT_FAILED,
    )
    .await
}

async fn materialize_volume_annotation(
    State(state): State<AppState>,
    Extension(routes): Extension<SubmitRoutes>,
    mut parts: Parts,
) -> RunResult<Json<Value>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let fallback_layer_name = params.required("fallbackLayerName")?;
    let annotation_id = params.object_id("annotationId")?;
    let annotation_type = params.required("annotationType")?;
    let new_dataset_name = params.required("newDatasetName")?;
    let output_segmentation_layer_name = params.required("outputSegmentationLayerName")?;
    let merge_segments = params.boolean("mergeSegments")?;
    let volume_layer_name = params.optional("volumeLayerName");
    let includes_editable_mapping = params.boolean("includesEditableMapping")?;
    let bounding_box = params.optional("boundingBox");
    let user = authenticate(&parts, &state).await?;
    let misc: MiscState = extension(&parts)?;
    let clients: ServiceClients = extension(&parts)?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization = own_organization(&state, &user, &dataset, MATERIALIZE_WRONG_ORGA).await?;
    validate_layer_name_lax(&fallback_layer_name)?;
    validate_dataset_name(&new_dataset_name)?;
    validate_layer_name_lax(&output_segmentation_layer_name)?;
    let base_directory = organization_base_directory(&state, &clients, &user, &dataset).await?;
    if !user.is_superuser
        && includes_editable_mapping
        && let Some(bounding_box) = &bounding_box
    {
        assert_bounding_box_limits(&misc, bounding_box, None)?;
    }
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": organization,
        "organization_base_directory": base_directory,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "fallback_layer_name": fallback_layer_name,
        "annotation_id": annotation_id,
        "output_segmentation_layer_name": output_segmentation_layer_name,
        "annotation_type": annotation_type,
        "new_dataset_name": new_dataset_name,
        "merge_segments": merge_segments,
        "volume_layer_name": volume_layer_name,
        "use_zarr_streaming": includes_editable_mapping,
        "bounding_box": bounding_box,
    });
    let submission = Submission {
        command: "materialize_volume_annotation",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        &routes,
        &user,
        submission,
        None,
        MATERIALIZE_SUBMIT_FAILED,
    )
    .await
}

async fn find_largest_segment_id(
    State(state): State<AppState>,
    Extension(routes): Extension<SubmitRoutes>,
    mut parts: Parts,
) -> RunResult<Json<Value>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let layer_name = params.required("layerName")?;
    let user = authenticate(&parts, &state).await?;
    let misc: MiscState = extension(&parts)?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization =
        own_organization(&state, &user, &dataset, LARGEST_SEGMENT_WRONG_ORGA).await?;
    validate_layer_name_lax(&layer_name)?;
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": organization,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "layer_name": layer_name,
    });
    let submission = Submission {
        command: "find_largest_segment_id",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        &routes,
        &user,
        submission,
        None,
        LARGEST_SEGMENT_SUBMIT_FAILED,
    )
    .await
}

/// AnimationJobOptions (JsonAutoFormat).
struct AnimationOptions {
    layer_name: String,
    bounding_box: BoundingBox,
    include_watermark: bool,
    meshes: Value,
    movie_resolution: String,
    movie_duration: String,
    camera_position: String,
    mag_for_textures: Vec3Int,
    annotation_id: Option<ObjectId>,
    include_skeletons: bool,
    hide_image_data: bool,
    save_blender_file: bool,
    segmentation_layer_name: Option<String>,
}

fn read_animation_options(body: &Map<String, Value>) -> RunResult<AnimationOptions> {
    Ok(AnimationOptions {
        layer_name: read_string(body, "layerName")?,
        bounding_box: body
            .get("boundingBox")
            .and_then(|value| BoundingBox::from_json(value).ok())
            .ok_or_else(invalid_body)?,
        include_watermark: read_bool(body, "includeWatermark")?,
        meshes: body.get("meshes").cloned().ok_or_else(invalid_body)?,
        movie_resolution: read_enum(body, "movieResolution", &["SD", "HD"])?,
        movie_duration: read_enum(body, "movieDuration", &["SHORT", "STANDARD", "LONG"])?,
        camera_position: read_enum(
            body,
            "cameraPosition",
            &[
                "MOVING",
                "STATIC_ISOMETRIC",
                "STATIC_XY",
                "STATIC_XZ",
                "STATIC_YZ",
            ],
        )?,
        mag_for_textures: body
            .get("magForTextures")
            .and_then(|value| Vec3Int::from_json(value).ok())
            .ok_or_else(invalid_body)?,
        annotation_id: read_optional(body, "annotationId", json_object_id)?,
        include_skeletons: read_bool(body, "includeSkeletons")?,
        hide_image_data: read_bool(body, "hideImageData")?,
        save_blender_file: read_bool(body, "saveBlenderFile")?,
        segmentation_layer_name: read_optional(body, "segmentationLayerName", |value| {
            value.as_str().map(str::to_owned)
        })?,
    })
}

async fn render_animation(
    State(state): State<AppState>,
    Extension(routes): Extension<SubmitRoutes>,
    mut parts: Parts,
    body: Result<Bytes, BytesRejection>,
) -> RunResult<Json<Value>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let body = json_body(&parts, body)?;
    let options = read_animation_options(&body)?;
    let user = authenticate(&parts, &state).await?;
    let misc: MiscState = extension(&parts)?;
    let clients: ServiceClients = extension(&parts)?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization = find_organization(&state, &dataset.organization).await?;
    let pricing_plan: String = dao::find_pricing_plan(&state.pool, &user.organization_id)
        .await?
        .ok_or_else(|| RunError::Api(ApiError::not_found(crate::msg::NOT_FOUND)))?;
    // PricingPlan.isPaidPlan: everything but Personal.
    if pricing_plan == "Personal" {
        if !options.include_watermark {
            return Err(Failure::new(MUST_INCLUDE_WATERMARK).into());
        }
        if options.movie_resolution != "SD" {
            return Err(Failure::new(RESOLUTION_MUST_BE_SD).into());
        }
    }
    if options.save_blender_file && !user.is_superuser {
        return Err(Failure::new(SUPER_USER_ONLY)
            .wrap(crate::msg::NOT_ALLOWED)
            .with_param(StatusCode::FORBIDDEN)
            .into());
    }
    validate_layer_name_lax(&options.layer_name)?;
    if let Some(segmentation_layer_name) = &options.segmentation_layer_name {
        validate_layer_name_lax(segmentation_layer_name)?;
    }
    let base_directory = organization_base_directory(&state, &clients, &user, &dataset).await?;
    let export_file_name = format!(
        "webknossos_animation_{}__{}__{}.mp4",
        format_date_for_filename(Local::now()),
        dataset.name,
        options.layer_name
    );
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": organization,
        "user_organization_base_directory": base_directory,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "export_file_name": export_file_name,
        "layer_name": options.layer_name,
        "segmentation_layer_name": optional_json(options.segmentation_layer_name),
        "bounding_box": options.bounding_box.to_literal(),
        "include_watermark": options.include_watermark,
        "meshes": options.meshes,
        "movie_resolution": options.movie_resolution,
        "movie_duration": options.movie_duration,
        "camera_position": options.camera_position,
        "mag_for_textures": options.mag_for_textures,
        "annotation_id": options.annotation_id,
        "include_skeletons": options.include_skeletons,
        "hide_image_data": options.hide_image_data,
        "save_blender_file": options.save_blender_file,
    });
    let submission = Submission {
        command: "render_animation",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        &routes,
        &user,
        submission,
        None,
        ANIMATION_SUBMIT_FAILED,
    )
    .await
}

#[cfg(test)]
mod tests;
