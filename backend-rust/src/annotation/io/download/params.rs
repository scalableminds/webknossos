//! Request binding: download parameters and the services a download needs.
use axum::extract::FromRef;

use axum::{extract::FromRequestParts, http::request::Parts};
use sqlx::PgPool;

use crate::{
    AppState,
    annotation::nml::writer::VolumeDataZipFormat,
    annotation::provider::AnnotationProvider,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    stores::tracing_client::TracingStoreClient,
    system::application_info::MiscState,
};

/// `version: Option[Long], skipVolumeData: Option[Boolean],
/// volumeDataZipFormat: Option[String]`, bound in route order (first value
/// wins) before the action runs.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct DownloadParams {
    pub version: Option<i64>,
    pub skip_volume_data: bool,
    /// Unknown or absent formats fall back to `wkw` (`fromString` + getOrElse).
    pub volume_data_zip_format: VolumeDataZipFormat,
}

pub(super) fn parse_download_params(query: Option<&str>) -> ApiResult<DownloadParams> {
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
pub(super) struct Services {
    pub(super) provider: AnnotationProvider,
    pub(super) tracing_store: TracingStoreClient,
    pub(super) misc: MiscState,
}

impl<S: Send + Sync> FromRequestParts<S> for Services
where
    MiscState: FromRef<S>,
    TracingStoreClient: FromRef<S>,
    AnnotationProvider: FromRef<S>,
{
    type Rejection = ApiError;
    async fn from_request_parts(_parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: AnnotationProvider::from_ref(state),
            tracing_store: TracingStoreClient::from_ref(state),
            misc: MiscState::from_ref(state),
        })
    }
}

pub(super) struct Context<'a> {
    pub(super) state: &'a AppState,
    pub(super) services: &'a Services,
    pub(super) user: Option<&'a AuthUser>,
}

impl Context<'_> {
    pub(super) fn pool(&self) -> &PgPool {
        &self.state.pool
    }
}
