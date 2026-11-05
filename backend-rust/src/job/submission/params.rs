//! Request binding (route parameters and bodies precede authentication), JSON reads with
//! Play semantics and geometry (com.scalableminds.util.geometry with JVM Int arithmetic).
use axum::{
    body::Bytes,
    extract::{
        FromRequestParts,
        rejection::{BytesRejection, PathRejection},
    },
    http::{StatusCode, header, request::Parts},
};
use chrono::{DateTime, Datelike, Duration, TimeZone};
use serde_json::{Map, Value, json};

use super::failure::{Failure, RunError, RunResult};
use crate::{
    AppState,
    auth::{AuthUser, authenticate_request},
    error::ApiError,
    system::application_info::MiscState,
    util::id::ObjectId,
};
use webknossos_common::geometry::{BoundingBox, Vec3Int};

const INVALID_BOUNDING_BOX_OR_MAG: &str = "Either the selected bounding box could not be parsed (must be x,y,z,width,height,depth) or the mag is wrong or does not exist.";

const VOLUME_EXCEEDED: &str = "The volume of the selected bounding box is too large.";
const EDGE_LENGTH_EXCEEDED: &str = "An edge length of the selected bounding box is too large.";

/// ObjectId.fromStringSync: 24 hex digits in either case, normalized to lowercase.
pub(super) fn parse_object_id(literal: &str) -> Option<ObjectId> {
    ObjectId::parse(literal).ok()
}

/// ObjectId.pathBinder (fromStringWithPrefixSync): `anything-<ObjectId>` is accepted.
pub(super) async fn dataset_id(parts: &mut Parts, state: &AppState) -> RunResult<ObjectId> {
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
pub(super) struct Params(Vec<(String, String)>);

impl Params {
    pub(super) fn from_parts(parts: &Parts) -> RunResult<Self> {
        let query = parts.uri.query().unwrap_or_default();
        let pairs: Vec<(String, String)> = serde_urlencoded::from_str(query)
            .map_err(|_| Failure::new(crate::msg::request::INVALID_QUERY))?;
        Ok(Self(pairs))
    }

    pub(super) fn optional(&self, key: &str) -> Option<String> {
        self.0
            .iter()
            .find(|(candidate, _)| candidate == key)
            .map(|(_, value)| value.clone())
    }

    pub(super) fn required(&self, key: &str) -> RunResult<String> {
        self.optional(key)
            .ok_or_else(|| Failure::new(crate::msg::request::missing_parameter(key)).into())
    }

    /// QueryStringBindable.bindableBoolean: true/false, or any integer (non-zero is true).
    pub(super) fn boolean(&self, key: &str) -> RunResult<bool> {
        let value = self.required(key)?;
        parse_play_boolean(&value)
            .ok_or_else(|| Failure::new(crate::msg::request::invalid_boolean(key)).into())
    }

    pub(super) fn object_id(&self, key: &str) -> RunResult<ObjectId> {
        let value = self.required(key)?;
        parse_object_id(&value).ok_or_else(|| invalid_query_object_id(key, &value))
    }

    pub(super) fn optional_object_id(&self, key: &str) -> RunResult<Option<ObjectId>> {
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

pub(super) fn parse_play_boolean(value: &str) -> Option<bool> {
    match value.trim() {
        "true" => Some(true),
        "false" => Some(false),
        other => other.parse::<i32>().ok().map(|number| number != 0),
    }
}

/// `validateJson`: Play's json body parser (text/json or application/json) and Reads.
pub(super) fn json_body(
    parts: &Parts,
    body: Result<Bytes, BytesRejection>,
) -> RunResult<Map<String, Value>> {
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

pub(super) async fn authenticate(parts: &Parts, state: &AppState) -> RunResult<AuthUser> {
    authenticate_request(parts, state)
        .await
        .map_err(RunError::Api)?
        .map(|(user, _)| user)
        .ok_or_else(|| RunError::Api(ApiError::unauthorized()))
}

// ---------------------------------------------------------------------------
// JSON Reads with Play semantics
// ---------------------------------------------------------------------------

pub(super) fn invalid_body() -> RunError {
    Failure::new(crate::msg::request::INVALID_JSON_BODY).into()
}

/// Reads[Int]: a JSON number that is a valid Int (BigDecimal.isValidInt).
pub(super) fn json_int(value: &Value) -> Option<i32> {
    if let Some(number) = value.as_i64() {
        return i32::try_from(number).ok();
    }
    let number = value.as_f64()?;
    (number.fract() == 0.0 && number >= f64::from(i32::MIN) && number <= f64::from(i32::MAX))
        .then_some(number as i32)
}

pub(super) fn read_string(body: &Map<String, Value>, key: &str) -> RunResult<String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(invalid_body)
}

pub(super) fn read_bool(body: &Map<String, Value>, key: &str) -> RunResult<bool> {
    body.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(invalid_body)
}

/// readNullable: missing or null is None, anything else must parse.
pub(super) fn read_optional<T>(
    body: &Map<String, Value>,
    key: &str,
    parse: impl FnOnce(&Value) -> Option<T>,
) -> RunResult<Option<T>> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => parse(value).map(Some).ok_or_else(invalid_body),
    }
}

pub(super) fn read_enum(
    body: &Map<String, Value>,
    key: &str,
    values: &[&str],
) -> RunResult<String> {
    let value = read_string(body, key)?;
    if values.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(invalid_body())
    }
}

pub(super) fn json_object_id(value: &Value) -> Option<ObjectId> {
    value.as_str().and_then(parse_object_id)
}

pub(super) fn optional_json<T: Into<Value>>(value: Option<T>) -> Value {
    value.map_or(Value::Null, Into::into)
}

// ---------------------------------------------------------------------------
// Geometry (com.scalableminds.util.geometry with JVM Int arithmetic)
// ---------------------------------------------------------------------------

/// The `BoundingBox` JSON wkLibs reads: topLeft, width, height, depth.
pub(super) fn to_wk_libs_json(bounding_box: BoundingBox) -> Map<String, Value> {
    let mut object = Map::new();
    object.insert("topLeft".into(), json!(bounding_box.top_left));
    object.insert("width".into(), json!(bounding_box.width));
    object.insert("height".into(), json!(bounding_box.height));
    object.insert("depth".into(), json!(bounding_box.depth));
    object
}

/// JobService.assertBoundingBoxLimits.
pub(super) fn assert_bounding_box_limits(
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
pub(super) fn format_date_for_filename<Tz: TimeZone>(now: DateTime<Tz>) -> String
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
