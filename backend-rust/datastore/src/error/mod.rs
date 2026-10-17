//! Datastore error type, rendered like Scala `FoxToResultHelpers.boxToResult`.
//!
//! Scala shape (`JsonResult(status)(msg, chain)`):
//! `{"messages":[{"error":"<msg>"},{"chain":"[Server Time <ISO instant>] <cause> <~ <older cause>"}]}`
//! The `chain` entry is present only when the failure wraps earlier failures. `Failure`s without an
//! explicit status use the controller default `400 Bad Request`; `Empty` maps to `404` with
//! `Msg.notFound`.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Map, Value};

pub type DsResult<T> = Result<T, DsError>;

/// Scala `Msg.notFound`, used for `Empty` boxes.
pub const MSG_NOT_FOUND: &str = "Could not find or access the requested resource.";

/// A failed datastore action (Scala `Failure` / `ParamFailure[Int]`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DsError {
    pub status: StatusCode,
    /// Route/query binder failures are handled by Play's HTTP error handler, not Fox JSON.
    pub binding_error: bool,
    pub message: String,
    /// Text of the exception attached to this failure (Scala `Failure.exception`), shown only
    /// once the failure becomes part of a chain.
    pub exception: Option<String>,
    /// Causes, newest first, already formatted like Scala `formatOneFailure + formatStackTrace`.
    pub chain: Vec<String>,
    /// Scala `ParamFailure` from `Failure ~> status`: its chain entries read `<message> <status>`,
    /// and wrapping keeps the param (`ParamFailure ?~> msg` is a `ParamFailure` again).
    pub param_failure: bool,
}

impl DsError {
    /// Route/query binding failure, rendered by the outer Play HTTP error handler.
    pub fn binding(message: impl Into<String>) -> Self {
        Self {
            binding_error: true,
            ..Self::failure(message)
        }
    }

    /// Scala `Fox.failure(msg)`: defaults to `400 Bad Request` (controller `defaultErrorCode`).
    pub fn failure(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            binding_error: false,
            message: message.into(),
            exception: None,
            chain: Vec::new(),
            param_failure: false,
        }
    }

    /// Scala `Fox.failure(e.toString, Full(e))` as produced by `Fox.fromFuture` for a failed future.
    pub fn from_exception(exception: impl std::fmt::Display) -> Self {
        let text = exception.to_string();
        Self {
            exception: Some(text.clone()),
            ..Self::failure(text)
        }
    }

    /// Scala `tryo(literal.toInt)`: the `NumberFormatException` message, with the exception
    /// attached so a wrapping failure's chain shows both.
    pub fn number_format(literal: &str) -> Self {
        let message = format!("For input string: \"{literal}\"");
        Self {
            exception: Some(format!("java.lang.NumberFormatException: {message}")),
            ..Self::failure(message)
        }
    }

    /// Scala `Empty` → `404` with `Msg.notFound`.
    pub fn empty() -> Self {
        Self::failure(MSG_NOT_FOUND).with_status(StatusCode::NOT_FOUND)
    }

    /// Scala `~> status`.
    pub fn with_status(mut self, status: StatusCode) -> Self {
        self.status = status;
        self
    }

    /// Scala `~> status` (failed RPCs, controller statuses): the failure becomes a
    /// `ParamFailure`. On a failure that already is one, Scala nests it
    /// (`ParamFailure(msg, exception, Full(this), status)`), so the previous failure with its old
    /// status becomes the newest chain entry. `with_status` models statuses that Scala does not
    /// attach with `~>` (router fallbacks, `Empty`).
    pub fn with_param_status(mut self, status: StatusCode) -> Self {
        if self.param_failure {
            let mut previous = format!("{} {}", self.message, self.status.as_str());
            if let Some(exception) = &self.exception {
                previous.push(' ');
                previous.push_str(exception);
            }
            self.chain.insert(0, previous);
        }
        self.status = status;
        self.param_failure = true;
        self
    }

    /// Scala `?~> msg` / `?-> msg` on a failure: the new message becomes the outer message and the
    /// current failure moves to the front of the chain. An explicit status is preserved.
    pub fn wrap(mut self, message: impl Into<String>) -> Self {
        let mut previous = std::mem::replace(&mut self.message, message.into());
        if self.param_failure {
            previous.push(' ');
            previous.push_str(self.status.as_str());
        }
        if let Some(exception) = self.exception.take() {
            previous.push(' ');
            previous.push_str(&exception);
        }
        self.chain.insert(0, previous);
        self
    }

    /// Router fallback for unknown paths.
    pub fn route_not_found() -> Self {
        Self::failure("Route not implemented by the Rust datastore.")
            .with_status(StatusCode::NOT_FOUND)
    }

    pub fn internal() -> Self {
        Self::failure("Internal server error.").with_status(StatusCode::INTERNAL_SERVER_ERROR)
    }

    /// The JSON body (`messages` array) at the given wall-clock time.
    pub fn body_at(&self, now: SystemTime) -> Value {
        let mut messages = vec![single("error", &self.message)];
        if !self.chain.is_empty() {
            let chain = format!(
                "[Server Time {}] {}",
                format_iso_instant(now),
                self.chain.join(" <~ ")
            );
            messages.push(single("chain", &chain));
        }
        let mut body = Map::new();
        body.insert("messages".into(), Value::Array(messages));
        Value::Object(body)
    }
}

fn single(key: &str, value: &str) -> Value {
    let mut entry = Map::new();
    entry.insert(key.into(), Value::String(value.into()));
    Value::Object(entry)
}

impl std::fmt::Display for DsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)?;
        for cause in &self.chain {
            write!(f, " <~ {cause}")?;
        }
        Ok(())
    }
}

impl std::error::Error for DsError {}

impl From<webknossos_common::upath::UPathError> for DsError {
    fn from(error: webknossos_common::upath::UPathError) -> Self {
        Self {
            exception: error.exception,
            ..Self::failure(error.message)
        }
    }
}

/// Response extension: the status came from a Scala `ParamFailure` (`~> status`), so Play
/// answers with it instead of the controller's `defaultErrorCode`.
#[derive(Debug, Clone, Copy)]
pub struct ExplicitStatus;

impl IntoResponse for DsError {
    fn into_response(self) -> Response {
        if self.binding_error {
            return crate::binding_errors::ClientError {
                status: self.status,
                message: self.message,
            }
            .into_response();
        }
        let explicit = self.param_failure;
        let mut response = (self.status, Json(self.body_at(SystemTime::now()))).into_response();
        if explicit {
            response.extensions_mut().insert(ExplicitStatus);
        }
        response
    }
}

/// Java `DateTimeFormatter.ISO_INSTANT` for a millisecond-precision instant (Scala util `Instant`):
/// `2026-10-11T08:15:30Z` or `2026-10-11T08:15:30.120Z`.
pub fn format_iso_instant(time: SystemTime) -> String {
    let millis_total = time
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(|e| -(e.duration().as_millis() as i64));
    let secs = millis_total.div_euclid(1000);
    let millis = millis_total.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let second_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let time = format!(
        "{:02}:{:02}:{:02}",
        second_of_day / 3600,
        second_of_day % 3600 / 60,
        second_of_day % 60
    );
    let fraction = if millis == 0 {
        String::new()
    } else {
        format!(".{millis:03}")
    };
    format!("{year:04}-{month:02}-{day:02}T{time}{fraction}Z")
}

/// Howard Hinnant's days-to-civil algorithm (proleptic Gregorian calendar).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests;
