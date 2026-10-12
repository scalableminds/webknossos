//! User access validation (Scala `AccessTokenService`, `UserAccessRequest`, `RequestTokenHelper`).
//!
//! Controllers extract a [`TokenContext`] and call [`AccessTokenService::validate_access`] before
//! doing any work:
//!
//! ```ignore
//! async fn handler(State(state): State<AppState>, tc: TokenContext, Path(id): Path<String>)
//!     -> AccessResult<Json<Value>> {
//!     state.access.validate_access(UserAccessRequest::read_dataset(&id), &tc).await?;
//!     let value = load(&id).await?; // DsError converts into AccessError
//!     Ok(Json(value))
//! }
//! ```
//!
//! Answers (granted or not) are cached for two minutes per (request, user token); failed RPCs
//! are not cached. A negative answer is `403 text/plain` (Play `Forbidden(String)`), an RPC
//! failure is the Scala JSON error carrying WEBKNOSSOS' status.

use std::{convert::Infallible, fmt, sync::Arc, time::Duration};

use axum::{
    extract::FromRequestParts,
    http::{StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{DsError, DsResult},
    wk_client::{AlfuCache, WkClient},
};

/// Scala `AccessMode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccessMode {
    Administrate,
    List,
    Read,
    Write,
    Delete,
}

/// Scala `AccessResourceType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccessResourceType {
    Dataset,
    Tracing,
    Annotation,
    Webknossos,
    JobExport,
}

/// Scala `UserAccessRequest` (`resourceId` is omitted when `None`, like Play's `writeNullable`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAccessRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    pub resource_type: AccessResourceType,
    pub mode: AccessMode,
}

impl UserAccessRequest {
    fn new(
        resource_id: Option<String>,
        resource_type: AccessResourceType,
        mode: AccessMode,
    ) -> Self {
        Self {
            resource_id,
            resource_type,
            mode,
        }
    }

    pub fn administrate_datasets() -> Self {
        Self::new(None, AccessResourceType::Dataset, AccessMode::Administrate)
    }

    pub fn administrate_datasets_of(organization_id: &str) -> Self {
        Self::new(
            Some(organization_id.to_owned()),
            AccessResourceType::Dataset,
            AccessMode::Administrate,
        )
    }

    pub fn read_dataset(dataset_id: impl fmt::Display) -> Self {
        Self::new(
            Some(dataset_id.to_string()),
            AccessResourceType::Dataset,
            AccessMode::Read,
        )
    }

    pub fn delete_dataset(dataset_id: impl fmt::Display) -> Self {
        Self::new(
            Some(dataset_id.to_string()),
            AccessResourceType::Dataset,
            AccessMode::Delete,
        )
    }

    pub fn write_dataset(dataset_id: impl fmt::Display) -> Self {
        Self::new(
            Some(dataset_id.to_string()),
            AccessResourceType::Dataset,
            AccessMode::Write,
        )
    }

    pub fn read_tracing(tracing_id: &str) -> Self {
        Self::new(
            Some(tracing_id.to_owned()),
            AccessResourceType::Tracing,
            AccessMode::Read,
        )
    }

    pub fn write_tracing(tracing_id: &str) -> Self {
        Self::new(
            Some(tracing_id.to_owned()),
            AccessResourceType::Tracing,
            AccessMode::Write,
        )
    }

    pub fn read_annotation(annotation_id: impl fmt::Display) -> Self {
        Self::new(
            Some(annotation_id.to_string()),
            AccessResourceType::Annotation,
            AccessMode::Read,
        )
    }

    pub fn write_annotation(annotation_id: impl fmt::Display) -> Self {
        Self::new(
            Some(annotation_id.to_string()),
            AccessResourceType::Annotation,
            AccessMode::Write,
        )
    }

    pub fn download_job_export(job_id: impl fmt::Display) -> Self {
        Self::new(
            Some(job_id.to_string()),
            AccessResourceType::JobExport,
            AccessMode::Read,
        )
    }

    pub fn webknossos() -> Self {
        Self::new(
            None,
            AccessResourceType::Webknossos,
            AccessMode::Administrate,
        )
    }
}

/// Scala `UserAccessAnswer`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserAccessAnswer {
    pub granted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub msg: Option<String>,
}

/// Scala `TokenContext` built by `RequestTokenHelper.tokenContextForRequest`: the first `token`
/// query parameter, else the `X-Auth-Token` header. Extracting it never fails.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct TokenContext {
    pub user_token: Option<String>,
}

impl TokenContext {
    pub fn new(user_token: Option<String>) -> Self {
        Self { user_token }
    }

    pub fn from_parts(parts: &Parts) -> Self {
        let from_query = parts.uri.query().and_then(|query| {
            url::form_urlencoded::parse(query.as_bytes())
                .find(|(name, _)| name == "token")
                .map(|(_, value)| value.into_owned())
        });
        let user_token = from_query.or_else(|| {
            parts
                .headers
                .get("X-Auth-Token")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        });
        Self { user_token }
    }
}

impl<S: Send + Sync> FromRequestParts<S> for TokenContext {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self::from_parts(parts))
    }
}

/// Outer message of a failed access RPC (Scala `?~>` in `validateAccessFromTokenContext`).
pub const ACCESS_CHECK_FAILED: &str =
    "Failed to check data access, token may be expired, consider reloading.";
/// Prefix of the `403` body when WEBKNOSSOS denies access with a message.
pub const ACCESS_FORBIDDEN_PREFIX: &str =
    "Token may be expired, consider reloading. Access forbidden: ";
/// `403` body when WEBKNOSSOS denies access without a message.
pub const TOKEN_AUTHENTICATION_FAILED: &str =
    "Token may be expired, consider reloading. Token authentication failed.";

/// Error of an access-checked action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessError {
    /// Access denied: `403` with this plain-text body (Scala `Forbidden(msg)`, a successful Fox,
    /// so the controller wrapper still adds `Cache-Control: no-cache`).
    Forbidden(String),
    /// The access RPC (or the guarded action) failed: Scala JSON error.
    Failed(DsError),
}

pub type AccessResult<T> = Result<T, AccessError>;

impl From<DsError> for AccessError {
    fn from(error: DsError) -> Self {
        Self::Failed(error)
    }
}

impl fmt::Display for AccessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden(message) => f.write_str(message),
            Self::Failed(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for AccessError {}

impl IntoResponse for AccessError {
    fn into_response(self) -> Response {
        match self {
            Self::Forbidden(message) => (
                StatusCode::FORBIDDEN,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                message,
            )
                .into_response(),
            Self::Failed(error) => error.into_response(),
        }
    }
}

/// Scala `AccessExpiration`.
pub const ACCESS_EXPIRATION: Duration = Duration::from_secs(2 * 60);

type AccessCacheKey = (UserAccessRequest, Option<String>);

/// Scala `DataStoreAccessTokenService`. Cheap to clone (shared cache).
#[derive(Clone)]
pub struct AccessTokenService {
    client: WkClient,
    cache: Arc<AlfuCache<AccessCacheKey, UserAccessAnswer>>,
}

impl AccessTokenService {
    pub fn new(client: WkClient) -> Self {
        Self {
            client,
            cache: Arc::new(AlfuCache::new(1000, ACCESS_EXPIRATION, ACCESS_EXPIRATION)),
        }
    }

    /// Scala `validateAccessFromTokenContext(accessRequest)` (cached): `Ok(())` when granted.
    pub async fn validate_access(
        &self,
        request: UserAccessRequest,
        tc: &TokenContext,
    ) -> AccessResult<()> {
        self.validate(request, tc, true).await
    }

    /// Scala `validateAccessFromTokenContext(accessRequest, useCaching = false)`.
    pub async fn validate_access_uncached(
        &self,
        request: UserAccessRequest,
        tc: &TokenContext,
    ) -> AccessResult<()> {
        self.validate(request, tc, false).await
    }

    async fn validate(
        &self,
        request: UserAccessRequest,
        tc: &TokenContext,
        use_caching: bool,
    ) -> AccessResult<()> {
        let answer = self
            .has_user_access(request, tc, use_caching)
            .await
            .map_err(|e| e.wrap(ACCESS_CHECK_FAILED))?;
        match answer {
            UserAccessAnswer { granted: true, .. } => Ok(()),
            UserAccessAnswer {
                granted: false,
                msg: Some(msg),
            } => Err(AccessError::Forbidden(format!(
                "{ACCESS_FORBIDDEN_PREFIX}{msg}"
            ))),
            UserAccessAnswer { msg: None, .. } => Err(AccessError::Forbidden(
                TOKEN_AUTHENTICATION_FAILED.to_owned(),
            )),
        }
    }

    /// Scala `hasUserAccess`: the raw answer (positive or negative) without the 403 mapping.
    pub async fn has_user_access(
        &self,
        request: UserAccessRequest,
        tc: &TokenContext,
        use_caching: bool,
    ) -> DsResult<UserAccessAnswer> {
        if !use_caching {
            return self.client.request_user_access(&request, tc).await;
        }
        let key = (request, tc.user_token.clone());
        self.cache
            .get_or_load(key.clone(), || async {
                self.client.request_user_access(&key.0, tc).await
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use serde_json::json;

    fn parts(uri: &str, header: Option<&str>) -> Parts {
        let mut builder = Request::get(uri);
        if let Some(value) = header {
            builder = builder.header("X-Auth-Token", value);
        }
        builder.body(()).unwrap().into_parts().0
    }

    #[test]
    fn token_comes_from_query_then_header() {
        let tc = TokenContext::from_parts(&parts("/x?a=1&token=q%20t&token=second", Some("h")));
        assert_eq!(tc.user_token.as_deref(), Some("q t"));
        let tc = TokenContext::from_parts(&parts("/x?a=1", Some("h")));
        assert_eq!(tc.user_token.as_deref(), Some("h"));
        let tc = TokenContext::from_parts(&parts("/x", None));
        assert_eq!(tc.user_token, None);
        let tc = TokenContext::from_parts(&parts("/x?token=", Some("h")));
        assert_eq!(tc.user_token.as_deref(), Some(""));
    }

    #[test]
    fn access_request_json_matches_play_format() {
        assert_eq!(
            serde_json::to_value(UserAccessRequest::read_dataset("abc")).unwrap(),
            json!({"resourceId": "abc", "resourceType": "dataset", "mode": "read"})
        );
        assert_eq!(
            serde_json::to_value(UserAccessRequest::webknossos()).unwrap(),
            json!({"resourceType": "webknossos", "mode": "administrate"})
        );
        assert_eq!(
            serde_json::to_value(UserAccessRequest::download_job_export("j")).unwrap(),
            json!({"resourceId": "j", "resourceType": "jobExport", "mode": "read"})
        );
        let answer: UserAccessAnswer =
            serde_json::from_value(json!({"granted": false, "msg": null})).unwrap();
        assert_eq!(
            answer,
            UserAccessAnswer {
                granted: false,
                msg: None
            }
        );
    }
}
