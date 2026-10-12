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
use chrono::{DateTime, Datelike, Duration, Utc};
use serde_json::{Map, Value, json};
use sqlx::PgConnection;

use crate::{
    AppState,
    application_info::MiscState,
    auth::{AuthUser, authenticate_request},
    dataset_access::READ_PREDICATE,
    dataset_create::{validate_dataset_name, validate_layer_name_lax},
    error::ApiError,
    id::ObjectId,
    jobs::{self, NOT_ENOUGH_CREDITS},
    service_clients::ServiceClients,
};

const GENERIC_NOT_FOUND: &str = "Could not find or access the requested resource.";
const NOT_ENABLED: &str = "Long-running jobs are not enabled for this WEBKNOSSOS instance.";
const NO_WORKER: &str =
    "No worker supporting the requested job is available for the selected data store.";
const PAID_NO_ADMIN_OR_MANAGER: &str =
    "Starting paid jobs is only allowed for Administrators, Dataset Managers or Team Managers.";
const SUBMIT_FAILED: &str = "Could not submit job.";
const STORAGE_EXCEEDED: &str = "Cannot start this job because the storage quota of the organization is exceeded, so its results could not be stored. Please free up storage or upgrade your plan.";
const ORGANIZATION_STORAGE_EXCEEDED: &str = "The storage quota of the organization is exceeded.";
const DATA_STORE_NOT_FOUND: &str = "Data store could not be found or accessed.";
const INVALID_BOUNDING_BOX_OR_MAG: &str = "Either the selected bounding box could not be parsed (must be x,y,z,width,height,depth) or the mag is wrong or does not exist.";
const INVALID_BOUNDING_BOX: &str =
    "The selected bounding box could not be parsed, must be x,y,z,width,height,depth.";
const VOLUME_EXCEEDED: &str = "The volume of the selected bounding box is too large.";
const EDGE_LENGTH_EXCEEDED: &str = "An edge length of the selected bounding box is too large.";
const INVALID_EXPORT_FORMAT: &str =
    "Invalid export format. Must be one of ome_tiff, tiff_stack, ozx.";
const INVALID_ADDITIONAL_COORDINATES: &str = "Invalid additional coordinates for this data layer.";
const DATA_SOURCE_NOT_FOUND: &str =
    "Data source not found on data store server. It may still be initializing.";
const USABLE_BUT_NO_VOXEL_SIZE: &str = "Dataset is marked as usable but has no voxel size.";
pub(crate) const NO_MAGS: &str = "Data layer does not contain any mags.";
const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
const SUPER_USER_ONLY: &str = "Only super users can perform this action.";
const MUST_INCLUDE_WATERMARK: &str =
    "Render animation jobs for free plans must include the WEBKNOSSOS watermark.";
const RESOLUTION_MUST_BE_SD: &str = "Render animation jobs for free plans must use SD resolution.";
const INVALID_BODY: &str = "Invalid JSON request body.";

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
fn parse_object_id(literal: &str) -> Option<String> {
    (literal.len() == 24 && literal.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| literal.to_ascii_lowercase())
}

/// ObjectId.pathBinder (fromStringWithPrefixSync): `anything-<ObjectId>` is accepted.
async fn dataset_id(parts: &mut Parts, state: &AppState) -> RunResult<String> {
    let raw: axum::extract::Path<String> = axum::extract::Path::from_request_parts(parts, state)
        .await
        .map_err(|_: PathRejection| Failure::new("Invalid path parameters."))?;
    let candidate = raw.rsplit_once('-').map_or(raw.as_str(), |(_, id)| id);
    parse_object_id(candidate).ok_or_else(|| {
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
            .map_err(|_| Failure::new("Invalid query parameters."))?;
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
            .ok_or_else(|| Failure::new(format!("Missing parameter: {key}")).into())
    }

    /// QueryStringBindable.bindableBoolean: true/false, or any integer (non-zero is true).
    fn boolean(&self, key: &str) -> RunResult<bool> {
        let value = self.required(key)?;
        parse_play_boolean(&value).ok_or_else(|| {
            Failure::new(format!(
                "Cannot parse parameter {key} as Boolean: should be true, false, 0 or 1"
            ))
            .into()
        })
    }

    fn object_id(&self, key: &str) -> RunResult<String> {
        let value = self.required(key)?;
        parse_object_id(&value).ok_or_else(|| invalid_query_object_id(key, &value))
    }

    fn optional_object_id(&self, key: &str) -> RunResult<Option<String>> {
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
            "Expecting text/json or application/json body",
        )));
    }
    let bytes =
        body.map_err(|rejection| RunError::Api(ApiError::new(rejection.status(), INVALID_BODY)))?;
    match serde_json::from_slice(&bytes) {
        Ok(Value::Object(object)) => Ok(object),
        _ => Err(Failure::new(INVALID_BODY).into()),
    }
}

async fn authenticate(parts: &Parts, state: &AppState) -> RunResult<AuthUser> {
    authenticate_request(parts, state)
        .await
        .map_err(RunError::Api)?
        .map(|(user, _)| user)
        .ok_or_else(|| RunError::Api(ApiError::unauthorized()))
}

fn extension<T: Clone + Send + Sync + 'static>(parts: &Parts) -> RunResult<T> {
    parts
        .extensions
        .get::<T>()
        .cloned()
        .ok_or_else(|| RunError::Api(ApiError::internal()))
}

// ---------------------------------------------------------------------------
// JSON Reads with Play semantics
// ---------------------------------------------------------------------------

fn invalid_body() -> RunError {
    Failure::new(INVALID_BODY).into()
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

/// Vec3IntReads: an array of exactly three Ints.
fn json_vec3(value: &Value) -> Option<[i32; 3]> {
    let array = value.as_array().filter(|array| array.len() == 3)?;
    Some([
        json_int(&array[0])?,
        json_int(&array[1])?,
        json_int(&array[2])?,
    ])
}

/// BoundingBox (JsonAutoFormat): topLeft, width, height, depth.
fn json_bounding_box(value: &Value) -> Option<BoundingBox> {
    let object = value.as_object()?;
    let top_left = json_vec3(object.get("topLeft")?)?;
    Some(BoundingBox {
        x: top_left[0],
        y: top_left[1],
        z: top_left[2],
        width: json_int(object.get("width")?)?,
        height: json_int(object.get("height")?)?,
        depth: json_int(object.get("depth")?)?,
    })
}

fn json_object_id(value: &Value) -> Option<String> {
    value.as_str().and_then(parse_object_id)
}

fn optional_json<T: Into<Value>>(value: Option<T>) -> Value {
    value.map_or(Value::Null, Into::into)
}

// ---------------------------------------------------------------------------
// Geometry (com.scalableminds.util.geometry with JVM Int arithmetic)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BoundingBox {
    x: i32,
    y: i32,
    z: i32,
    width: i32,
    height: i32,
    depth: i32,
}

impl BoundingBox {
    pub(crate) fn from_literal(literal: &str) -> Option<Self> {
        let [x, y, z, width, height, depth] = jobs::parse_bounding_box(literal)?;
        Some(Self {
            x,
            y,
            z,
            width,
            height,
            depth,
        })
    }

    fn bottom_right(&self) -> [i32; 3] {
        [
            self.x.wrapping_add(self.width),
            self.y.wrapping_add(self.height),
            self.z.wrapping_add(self.depth),
        ]
    }

    fn union(&self, other: &Self) -> Self {
        let (a, b) = (self.bottom_right(), other.bottom_right());
        let (x, y, z) = (
            self.x.min(other.x),
            self.y.min(other.y),
            self.z.min(other.z),
        );
        Self {
            x,
            y,
            z,
            width: a[0].max(b[0]).wrapping_sub(x),
            height: a[1].max(b[1]).wrapping_sub(y),
            depth: a[2].max(b[2]).wrapping_sub(z),
        }
    }

    /// `/(Vec3Int)`: truncating division of the top left, ceilDiv of the size.
    /// `None` for a zero component (an ArithmeticException in Scala).
    pub(crate) fn divide(&self, mag: [i32; 3]) -> Option<Self> {
        if mag.contains(&0) {
            return None;
        }
        Some(Self {
            x: self.x.wrapping_div(mag[0]),
            y: self.y.wrapping_div(mag[1]),
            z: self.z.wrapping_div(mag[2]),
            width: ceil_div(self.width, mag[0]),
            height: ceil_div(self.height, mag[1]),
            depth: ceil_div(self.depth, mag[2]),
        })
    }

    pub(crate) fn volume(&self) -> i64 {
        // Scala Long multiplication wraps, including for oversized request boxes.
        i64::from(self.width)
            .wrapping_mul(i64::from(self.height))
            .wrapping_mul(i64::from(self.depth))
    }

    fn max_dim(&self) -> i32 {
        self.width.max(self.height).max(self.depth)
    }

    pub(crate) fn to_literal(self) -> String {
        format!(
            "{},{},{},{},{},{}",
            self.x, self.y, self.z, self.width, self.height, self.depth
        )
    }

    fn to_wk_libs_json(self) -> Map<String, Value> {
        let mut object = Map::new();
        object.insert("topLeft".into(), json!([self.x, self.y, self.z]));
        object.insert("width".into(), json!(self.width));
        object.insert("height".into(), json!(self.height));
        object.insert("depth".into(), json!(self.depth));
        object
    }
}

/// MathUtils.ceilDiv(Int, Int).
fn ceil_div(number: i32, divisor: i32) -> i32 {
    let sign = number.signum() * divisor.signum();
    sign.wrapping_mul(
        number
            .wrapping_abs()
            .wrapping_add(divisor.wrapping_abs())
            .wrapping_sub(1),
    )
    .wrapping_div(divisor.wrapping_abs())
}

/// Vec3Int.fromMagLiteral(allowScalar = true): an Int scalar or `x-y-z`.
fn parse_mag(literal: &str) -> Option<[i32; 3]> {
    if let Some(scalar) = parse_java_int(literal) {
        return Some([scalar; 3]);
    }
    let mut parts = literal.split('-');
    let mut mag = [0; 3];
    for component in &mut mag {
        let digits = parts.next()?;
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *component = digits.parse().ok()?;
    }
    parts.next().is_none().then_some(mag)
}

/// Integer.parseInt: optional sign and ASCII digits.
fn parse_java_int(literal: &str) -> Option<i32> {
    let digits = literal.strip_prefix(['+', '-']).unwrap_or(literal);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    literal.parse().ok()
}

/// JobService.assertBoundingBoxLimits.
fn assert_bounding_box_limits(
    misc: &MiscState,
    bounding_box: &str,
    mag: Option<&str>,
) -> RunResult<()> {
    let bounding_box_in_mag = BoundingBox::from_literal(bounding_box)
        .zip(parse_mag(mag.unwrap_or("1-1-1")))
        .and_then(|(bounding_box, mag)| bounding_box.divide(mag))
        .ok_or_else(|| Failure::new(INVALID_BOUNDING_BOX_OR_MAG))?;
    let features = &misc.config().features;
    let feature =
        |key: &str, default: i64| features.get(key).and_then(Value::as_i64).unwrap_or(default);
    let max_volume = feature("exportTiffMaxVolumeMVx", 1024).saturating_mul(1024 * 1024);
    if bounding_box_in_mag.volume() > max_volume {
        return Err(Failure::new(VOLUME_EXCEEDED).into());
    }
    if i64::from(bounding_box_in_mag.max_dim()) > feature("exportTiffMaxEdgeLengthVx", 8192) {
        return Err(Failure::new(EDGE_LENGTH_EXCEEDED).into());
    }
    Ok(())
}

/// Formatter.formatDateForFilename: SimpleDateFormat("YYYY-MM-dd_HH-mm"). `YYYY`
/// is the week year (weeks start on Sunday; the week containing January 1st is
/// week 1, as for the en_US locale). Rendered in UTC.
fn format_date_for_filename(now: DateTime<Utc>) -> String {
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

#[derive(sqlx::FromRow)]
pub(crate) struct Dataset {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) directory_name: String,
    pub(crate) organization: String,
    pub(crate) data_store: String,
    is_usable: bool,
    has_voxel_size: bool,
    voxel_size_factor: Option<Vec<f64>>,
    voxel_size_unit: Option<String>,
}

impl Dataset {
    /// The data source's voxel size (`dataset.voxelSize`) in nanometers
    /// (VoxelSize.toNanometer; a missing unit is nanometer).
    pub(crate) fn voxel_size_in_nanometers(&self) -> Option<[f64; 3]> {
        let factor = <[f64; 3]>::try_from(self.voxel_size_factor.clone()?).ok()?;
        let per_unit = self
            .voxel_size_unit
            .as_deref()
            .map_or(1.0, crate::dataset_source::nanometers_per_unit);
        Some(factor.map(|component| component * per_unit))
    }
}

/// DatasetDAO.findOne with the user's access; `None` is the empty Fox (callers
/// attach their own message).
pub(crate) async fn find_readable_dataset(
    state: &AppState,
    user: &AuthUser,
    id: &str,
) -> RunResult<Option<Dataset>> {
    let query = format!(
        r#"SELECT d._id AS id, d.name, d.directoryName AS directory_name, d._organization AS organization,
            d._dataStore AS data_store, d.isUsable AS is_usable, d.voxelSizeFactor IS NOT NULL AS has_voxel_size,
            CASE WHEN d.voxelSizeFactor IS NULL THEN NULL ELSE ARRAY[(d.voxelSizeFactor).x, (d.voxelSizeFactor).y,
              (d.voxelSizeFactor).z]::float8[] END AS voxel_size_factor, d.voxelSizeUnit::text AS voxel_size_unit
          FROM webknossos.datasets_ d WHERE d._id = $3 AND {READ_PREDICATE}"#
    );
    Ok(sqlx::query_as(&query)
        .bind(&user.id)
        .bind(Option::<&str>::None)
        .bind(id)
        .fetch_optional(&state.pool)
        .await?)
}

/// DatasetDAO.findOne with the user's access `?~> Msg.Dataset.notFound(id) ~> NOT_FOUND`.
async fn find_dataset(state: &AppState, user: &AuthUser, id: &str) -> RunResult<Dataset> {
    find_readable_dataset(state, user, id)
        .await?
        .ok_or_else(|| {
            Failure::with_status(
                format!("Dataset “{id}” could not be found or accessed."),
                StatusCode::NOT_FOUND,
            )
            .into()
        })
}

/// OrganizationDAO.findOne(dataset._organization) with global access.
async fn find_organization(state: &AppState, organization: &str) -> RunResult<String> {
    sqlx::query_scalar("SELECT _id FROM webknossos.organizations_ WHERE _id = $1")
        .bind(organization)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| {
            Failure::new(format!(
                "Organization “{organization}” could not be found or accessed."
            ))
            .into()
        })
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
    let url: String = sqlx::query_scalar(
        r#"SELECT url FROM webknossos.dataStores_ WHERE name = $1 AND
          (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization IN
            (SELECT _organization FROM webknossos.users_ WHERE _id = $2))"#,
    )
    .bind(dataset.data_store.trim())
    .bind(&user.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| Failure::new(DATA_STORE_NOT_FOUND))?;
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
            "Service returned an invalid JSON response.",
        ))),
    }
}

pub(crate) struct DataLayer {
    pub(crate) name: String,
    pub(crate) bounding_box: BoundingBox,
    pub(crate) finest_mag: Option<[i32; 3]>,
}

#[derive(sqlx::FromRow)]
struct LayerRow {
    name: String,
    bounding_box: Vec<i32>,
    finest_mag: Option<Vec<i32>>,
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
        .ok_or_else(|| Failure::new(format!("Could not find layer “{layer_name}” in dataset.")))?;
    Ok((data_source_box, layer))
}

/// DatasetService.usableDataSourceFor: the data source's bounding box (union of
/// all layers) and its layers, ordered by name.
pub(crate) async fn usable_data_source(
    state: &AppState,
    dataset: &Dataset,
) -> RunResult<(BoundingBox, Vec<DataLayer>)> {
    if !dataset.is_usable {
        return Err(Failure::new(format!(
            "Dataset “{}” is not imported or incomplete.",
            dataset.id
        ))
        .into());
    }
    if !dataset.has_voxel_size {
        return Err(Failure::new(USABLE_BUT_NO_VOXEL_SIZE)
            .wrap(DATA_SOURCE_NOT_FOUND)
            .with_param(StatusCode::NOT_FOUND)
            .into());
    }
    let rows: Vec<LayerRow> = sqlx::query_as(
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
    .bind(&dataset.id)
    .fetch_all(&state.pool)
    .await?;
    let mut layers = Vec::with_capacity(rows.len());
    for row in rows {
        let [x, y, z, width, height, depth] = <[i32; 6]>::try_from(row.bounding_box)
            .map_err(|_| RunError::Api(ApiError::internal()))?;
        let finest_mag = row
            .finest_mag
            .map(<[i32; 3]>::try_from)
            .transpose()
            .map_err(|_| RunError::Api(ApiError::internal()))?;
        layers.push(DataLayer {
            name: row.name,
            bounding_box: BoundingBox {
                x,
                y,
                z,
                width,
                height,
                depth,
            },
            finest_mag,
        });
    }
    let data_source_box = layers
        .iter()
        .map(|layer| layer.bounding_box)
        .reduce(|a, b| a.union(&b))
        .unwrap_or(BoundingBox {
            x: 0,
            y: 0,
            z: 0,
            width: 0,
            height: 0,
            depth: 0,
        });
    Ok((data_source_box, layers))
}

/// All mags of a data layer (DatasetMagsDAO.findMagsForLayer: without pending
/// uploads and, as in Scala, without an ORDER BY).
pub(crate) async fn layer_mags(
    state: &AppState,
    dataset: &Dataset,
    layer_name: &str,
) -> RunResult<Vec<[i32; 3]>> {
    let rows: Vec<(i32, i32, i32)> = sqlx::query_as(
        r#"SELECT (mag).x::int, (mag).y::int, (mag).z::int FROM webknossos.dataset_mags
          WHERE _dataset = $1 AND dataLayerName = $2 AND NOT uploadToPathIsPending AND NOT uploadIsPending"#,
    )
    .bind(&dataset.id)
    .bind(layer_name)
    .fetch_all(&state.pool)
    .await?;
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
    let included: Option<i64> =
        sqlx::query_scalar("SELECT includedStorage FROM webknossos.organizations_ WHERE _id = $1")
            .bind(organization)
            .fetch_optional(&mut *connection)
            .await?
            .ok_or_else(|| {
                Failure::new(format!(
                    "Organization “{organization}” could not be found or accessed."
                ))
            })?;
    let Some(included) = included else {
        return Ok(());
    };
    let used: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(usedStorageBytes), 0)::bigint FROM (
            SELECT usedStorageBytes FROM webknossos.organization_usedStorage_mags WHERE _organization = $1
            UNION ALL
            SELECT usedStorageBytes FROM webknossos.organization_usedStorage_attachments WHERE _organization = $1
          ) combined"#,
    )
    .bind(organization)
    .fetch_one(&mut *connection)
    .await?;
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
) -> RunResult<String> {
    if !enabled {
        return Err(Failure::new(NOT_ENABLED).into());
    }
    // WorkerDAO.findAllByDataStore: union of all workers' supported commands;
    // an unparsable worker row fails the lookup.
    let commands: Vec<Vec<String>> = sqlx::query_scalar(
        "SELECT supportedJobCommands FROM webknossos.workers_ WHERE _dataStore = $1",
    )
    .bind(submission.data_store)
    .fetch_all(&mut *connection)
    .await?;
    let parsable = commands
        .iter()
        .flatten()
        .all(|command| jobs::is_job_command(command));
    if !parsable
        || !commands
            .iter()
            .flatten()
            .any(|command| command == submission.command)
    {
        return Err(Failure::new(NO_WORKER).into());
    }
    assert_storage_not_exceeded(connection, submission.command, &user.organization_id).await?;
    let job_id = ObjectId::new().as_str().to_owned();
    sqlx::query(
        r#"INSERT INTO webknossos.jobs (_id, _owner, _dataStore, command, commandArgs, state, created, isDeleted)
          VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW(), FALSE)"#,
    )
    .bind(&job_id)
    .bind(&user.id)
    .bind(submission.data_store)
    .bind(submission.command)
    .bind(&submission.args)
    .execute(&mut *connection)
    .await?;
    Ok(job_id)
}

enum PaidSubmission {
    Submitted(String),
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
    let cost = jobs::job_cost_in_milli_credits(
        &misc.config().features,
        submission.command,
        bounding_box_in_target_mag.volume(),
    )
    .map_err(Failure::new)?;
    let balance = jobs::milli_credit_balance(connection, &user.id, &user.organization_id).await?;
    if balance < i64::from(cost) {
        return Err(Failure::new(NOT_ENOUGH_CREDITS).into());
    }
    let transaction_id = ObjectId::new().as_str().to_owned();
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id, _organization, milli_credit_delta, comment, _paid_job,
           transaction_state, credit_state, expiration_date, created_at, updated_at, is_deleted)
          VALUES ($1, $2, $3, $4, NULL, 'Pending', 'Pending', NULL, NOW(), NOW(), FALSE)"#,
    )
    .bind(&transaction_id)
    .bind(&user.organization_id)
    .bind(-cost)
    .bind(comment)
    .execute(&mut *connection)
    .await
    .map_err(crate::credit_transactions::balance_error)?;
    let job_id = match submit_job(connection, enabled, user, submission).await {
        Ok(job_id) => job_id,
        Err(RunError::Failure(_)) => {
            sqlx::query(
                r#"INSERT INTO webknossos.credit_transactions
                  (_id, _organization, _related_transaction, milli_credit_delta, comment,
                   transaction_state, credit_state)
                  VALUES ($1, $2, $3, $4, $5, 'Complete', 'Refunding')"#,
            )
            .bind(ObjectId::new().as_str())
            .bind(&user.organization_id)
            .bind(&transaction_id)
            .bind(cost)
            .bind(format!("Refund for transaction {transaction_id}."))
            .execute(&mut *connection)
            .await?;
            sqlx::query(
                r#"UPDATE webknossos.credit_transactions
                  SET transaction_state = 'Complete', credit_state = 'Refunded', updated_at = NOW()
                  WHERE _id = $1"#,
            )
            .bind(&transaction_id)
            .execute(&mut *connection)
            .await?;
            return Ok(PaidSubmission::Refunded(Failure::new(SUBMIT_FAILED)));
        }
        Err(error) => return Err(error),
    };
    sqlx::query(
        "UPDATE webknossos.credit_transactions SET _paid_job = $2, updated_at = NOW() WHERE _id = $1",
    )
    .bind(&transaction_id)
    .bind(&job_id)
    .execute(&mut *connection)
    .await?;
    Ok(PaidSubmission::Submitted(job_id))
}

/// A paid job (job row plus its pending credit reservation) inserted in a still
/// open serializable transaction. Callers that create dependent rows (AI models,
/// AI inferences) insert them through [`PendingPaidJob::connection`] so the job,
/// the reservation and those rows commit or roll back together, then call
/// [`PendingPaidJob::commit`]. Dropping it rolls everything back.
pub(crate) struct PendingPaidJob {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    job_id: String,
    command: &'static str,
}

impl PendingPaidJob {
    pub(crate) fn job_id(&self) -> &str {
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
    ) -> RunResult<String> {
        self.transaction.commit().await?;
        let mut properties = Map::new();
        properties.insert("command".into(), json!(self.command));
        crate::analytics::track(state, misc, user, "run_job".into(), properties);
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
    let mut transaction = jobs::serializable(&state.pool).await?;
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
            crate::analytics::track(state, misc, user, "run_job".into(), properties);
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
    let job = jobs::find_job(&mut connection, &user.id, &job_id)
        .await?
        .ok_or_else(|| Failure::with_status(GENERIC_NOT_FOUND, StatusCode::NOT_FOUND))?;
    Ok(Json(
        jobs::public_writes(&mut connection, &user.id, &job).await?,
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
    let not_found = || RunError::Api(ApiError::not_found(GENERIC_NOT_FOUND));
    let mag1_bounding_box = BoundingBox::from_literal(&bbox).ok_or_else(not_found)?;
    let target_mag = layer.finest_mag.ok_or_else(not_found)?;
    let target_bounding_box = mag1_bounding_box
        .divide(target_mag)
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
    let not_usable = format!("Dataset “{}” is not imported or incomplete.", dataset.id);
    let (data_source_box, layer) = data_source_and_layer(&state, &dataset, &layer_name)
        .await
        .map_err(|error| error.wrap(&not_usable))?;
    let layer_mag = layer.finest_mag.ok_or_else(|| Failure::new(NO_MAGS))?;
    let finest_mag_box = data_source_box
        .divide(layer_mag)
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
    let additional_axes: Vec<(String, i32, i32)> =
        match &layer_name {
            Some(layer_name) => sqlx::query_as(
                r#"SELECT name, lowerBound, upperBound FROM webknossos.dataset_layer_additionalAxes
              WHERE _dataset = $1 AND layerName = $2 ORDER BY index, name"#,
            )
            .bind(&dataset.id)
            .bind(layer_name)
            .fetch_all(&state.pool)
            .await?,
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
    let mut nd_bbox = three_d_box.to_wk_libs_json();
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
        format_date_for_filename(Utc::now()),
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
    mag_for_textures: [i32; 3],
    annotation_id: Option<String>,
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
            .and_then(json_bounding_box)
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
            .and_then(json_vec3)
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
    let pricing_plan: String = sqlx::query_scalar(
        "SELECT pricingPlan::text FROM webknossos.organizations_ WHERE _id = $1",
    )
    .bind(&user.organization_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| RunError::Api(ApiError::not_found(GENERIC_NOT_FOUND)))?;
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
            .wrap(NOT_ALLOWED)
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
        format_date_for_filename(Utc::now()),
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
        "annotation_id": optional_json(options.annotation_id),
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
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn bbox(values: [i32; 6]) -> BoundingBox {
        let [x, y, z, width, height, depth] = values;
        BoundingBox {
            x,
            y,
            z,
            width,
            height,
            depth,
        }
    }

    #[test]
    fn bounding_box_division_and_union_follow_scala() {
        assert_eq!(
            bbox([5, -5, 7, 10, 3, 1]).divide([2, 2, 4]),
            Some(bbox([2, -2, 1, 5, 2, 1]))
        );
        assert_eq!(bbox([0, 0, 0, 1, 1, 1]).divide([0, 1, 1]), None);
        // MathUtils.ceilDiv rounds the magnitude up, then applies the sign.
        assert_eq!(ceil_div(-3, 2), -2);
        assert_eq!(ceil_div(0, 4), 0);
        assert_eq!(
            bbox([0, 0, 0, 10, 10, 10]).union(&bbox([5, -5, 2, 10, 2, 2])),
            bbox([0, -5, 0, 15, 15, 10])
        );
        assert_eq!(bbox([1, 2, 3, 4, 5, 6]).to_literal(), "1,2,3,4,5,6");
        assert_eq!(
            bbox([0, 0, 0, i32::MAX, i32::MAX, i32::MAX]).volume(),
            4_611_686_024_869_838_847
        );
    }

    #[test]
    fn mags_and_play_booleans() {
        assert_eq!(parse_mag("2"), Some([2, 2, 2]));
        assert_eq!(parse_mag("-1"), Some([-1, -1, -1]));
        assert_eq!(parse_mag("1-2-4"), Some([1, 2, 4]));
        assert_eq!(parse_mag("1-2"), None);
        assert_eq!(parse_mag("1-2-4-8"), None);
        assert_eq!(parse_mag("1-+2-4"), None);
        assert_eq!(parse_play_boolean(" true "), Some(true));
        assert_eq!(parse_play_boolean("0"), Some(false));
        assert_eq!(parse_play_boolean("2"), Some(true));
        assert_eq!(parse_play_boolean("yes"), None);
    }

    #[test]
    fn object_ids_accept_either_case_and_prefixes_are_split() {
        assert_eq!(
            parse_object_id("0123456789ABCDEF01234567").as_deref(),
            Some("0123456789abcdef01234567")
        );
        assert_eq!(parse_object_id("0123"), None);
        assert_eq!(json_int(&json!(3.0)), Some(3));
        assert_eq!(json_int(&json!(3.5)), None);
        assert_eq!(json_int(&json!(1u64 << 40)), None);
    }

    #[test]
    fn filename_dates_use_the_week_year() {
        let date = |y, m, d| Utc.with_ymd_and_hms(y, m, d, 13, 7, 0).unwrap();
        assert_eq!(
            format_date_for_filename(date(2026, 10, 9)),
            "2026-10-09_13-07"
        );
        // Sunday 2024-12-29 starts the week containing 2025-01-01.
        assert_eq!(
            format_date_for_filename(date(2024, 12, 29)),
            "2025-12-29_13-07"
        );
        assert_eq!(
            format_date_for_filename(date(2024, 12, 28)),
            "2024-12-28_13-07"
        );
        assert_eq!(
            format_date_for_filename(date(2025, 1, 1)),
            "2025-01-01_13-07"
        );
    }

    #[test]
    fn failure_chains_render_like_play() {
        let failure = Failure::new(ORGANIZATION_STORAGE_EXCEEDED)
            .wrap(STORAGE_EXCEEDED)
            .with_param(StatusCode::FORBIDDEN)
            .wrap(MESH_SUBMIT_FAILED);
        assert_eq!(failure.status, Some(StatusCode::FORBIDDEN));
        assert_eq!(
            failure.cause.unwrap().format_chain(),
            format!("{STORAGE_EXCEEDED} 403 <~ {ORGANIZATION_STORAGE_EXCEEDED}")
        );
        assert_eq!(
            parse_additional_coordinates(r#"[{"name":"t","value":3}]"#),
            Ok(vec![("t".into(), 3)])
        );
        assert!(parse_additional_coordinates("[{\"name\":1}]").is_err());
    }
}
