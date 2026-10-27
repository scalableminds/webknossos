//! Authentication lifecycle for existing credentials (bearer tokens and
//! Silhouette browser cookies). Password login lives in `browser_auth`.
use std::time::Duration;

use axum::{
    Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};

use crate::{
    AppState,
    auth::browser::{BrowserAuthConfig, cookie_still_valid, discarding_cookie_header},
    auth::{AuthCredential, AuthUser, authenticate_request, dao},
    error::{ApiError, ApiResult},
    extract::Path,
    util::id::{ObjectId, PathObjectId},
};

#[derive(Clone, Debug)]
pub struct AuthRouteConfig {
    pub auth_expiry: Duration,
    pub datastore_expiry: Duration,
    pub auth_idle_timeout: Duration,
    pub passkeys_enabled: bool,
    pub uses_https: bool,
    pub logout_redirect_url: String,
}

impl Default for AuthRouteConfig {
    fn default() -> Self {
        Self {
            auth_expiry: Duration::from_secs(23_000 * 86_400),
            datastore_expiry: Duration::from_secs(86_400),
            auth_idle_timeout: Duration::from_secs(23_000 * 86_400),
            passkeys_enabled: false,
            uses_https: false,
            logout_redirect_url: "/".into(),
        }
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/token", get(get_token).delete(delete_token))
        .route("/userToken/generate", post(generate_datastore_token))
        .route("/auth/logout", post(logout))
        .route("/auth/logoutEverywhere", post(logout_everywhere))
        .route("/auth/webauthn/keys", get(list_keys))
        .route("/auth/webauthn/keys/{id}", delete(remove_key))
}

struct LifecycleAuth {
    user: AuthUser,
    credential: AuthCredential,
}

impl FromRequestParts<AppState> for LifecycleAuth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        let (user, credential) = authenticate_request(parts, state)
            .await?
            .ok_or_else(ApiError::unauthorized)?;
        Ok(Self { user, credential })
    }
}

struct OptionalLifecycleAuth(Option<LifecycleAuth>);

impl FromRequestParts<AppState> for OptionalLifecycleAuth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        // Keep absence separate from an invalid or ambiguous credential.
        Ok(Self(authenticate_request(parts, state).await?.map(
            |(user, credential)| LifecycleAuth { user, credential },
        )))
    }
}

/// Serialize issuance and revocation across every identity of the account.
/// Recheck after acquiring the lock: an extractor may have authenticated just
/// before a concurrent logout acquired it.
async fn lock_account(
    tx: &mut Transaction<'_, Postgres>,
    auth: &LifecycleAuth,
) -> ApiResult<ObjectId> {
    let multi_user: ObjectId = dao::lock_multi_user_of_active_user(tx, &auth.user.id)
        .await?
        .ok_or_else(ApiError::unauthorized)?;
    dao::lock_user(tx, &auth.user.id).await?;
    let token = match &auth.credential {
        AuthCredential::Token(token) => token,
        AuthCredential::Cookie(cookie) => {
            // Stateless cookies are revoked only by the account-wide cutoff.
            if !cookie_still_valid(tx, &auth.user.id, cookie).await? {
                return Err(ApiError::unauthorized());
            }
            return Ok(multi_user);
        }
    };
    let valid = dao::is_token_valid_for_user(tx, token, &auth.user.id).await?;
    if !valid {
        return Err(ApiError::unauthorized());
    }
    Ok(multi_user)
}

async fn insert_token(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &ObjectId,
    token_type: &str,
    expiry: Duration,
    idle_timeout: Option<Duration>,
) -> ApiResult<String> {
    let expiry_ms = i64::try_from(expiry.as_millis()).map_err(|_| ApiError::internal())?;
    let idle_ms = idle_timeout
        .map(|duration| i64::try_from(duration.as_millis()))
        .transpose()
        .map_err(|_| ApiError::internal())?;
    if expiry_ms <= 0 || idle_ms.is_some_and(|duration| duration <= 0) {
        return Err(ApiError::internal());
    }
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| ApiError::internal())?;
    let value = URL_SAFE_NO_PAD.encode(random);
    dao::insert_token(tx, user_id, &value, expiry_ms, idle_ms, token_type).await?;
    Ok(value)
}

async fn get_token(
    State(state): State<AppState>,
    State(config): State<AuthRouteConfig>,
    auth: LifecycleAuth,
) -> ApiResult<Json<Value>> {
    let mut tx = state.pool.begin().await?;
    lock_account(&mut tx, &auth).await?;
    // Only return usable tokens. Unlike the legacy DAO's unfiltered lookup,
    // this excludes expired, idle-expired and account-revoked credentials.
    let existing = dao::find_one_usable_authentication_token(&mut tx, &auth.user.id).await?;
    let token = match existing {
        Some(token) => token,
        None => {
            dao::delete_authentication_tokens_for_user(&mut tx, &auth.user.id).await?;
            insert_token(
                &mut tx,
                &auth.user.id,
                "Authentication",
                config.auth_expiry,
                Some(config.auth_idle_timeout),
            )
            .await?
        }
    };
    tx.commit().await?;
    Ok(Json(json!({ "token": token })))
}

async fn delete_token(State(state): State<AppState>, auth: LifecycleAuth) -> ApiResult<Response> {
    let mut tx = state.pool.begin().await?;
    lock_account(&mut tx, &auth).await?;
    let deleted = dao::delete_oldest_authentication_token(&mut tx, &auth.user.id).await?;
    tx.commit().await?;
    Ok(if deleted == 0 {
        StatusCode::OK.into_response()
    } else {
        Json(json!({"messages": "Token was deleted."})).into_response()
    })
}

async fn generate_datastore_token(
    State(state): State<AppState>,
    State(config): State<AuthRouteConfig>,
    OptionalLifecycleAuth(auth): OptionalLifecycleAuth,
) -> ApiResult<Json<Value>> {
    let token = if let Some(auth) = auth {
        let mut tx = state.pool.begin().await?;
        lock_account(&mut tx, &auth).await?;
        let token = insert_token(
            &mut tx,
            &auth.user.id,
            "DataStore",
            config.datastore_expiry,
            Some(config.auth_idle_timeout),
        )
        .await?;
        tx.commit().await?;
        token
    } else {
        String::new()
    };
    Ok(Json(json!({ "token": token })))
}

async fn logout(
    State(state): State<AppState>,
    State(config): State<AuthRouteConfig>,
    State(browser): State<BrowserAuthConfig>,
    OptionalLifecycleAuth(auth): OptionalLifecycleAuth,
) -> ApiResult<Response> {
    let mut response = Json(config.logout_redirect_url).into_response();
    match auth {
        Some(LifecycleAuth {
            credential: AuthCredential::Cookie(_),
            user,
        }) => {
            // Silhouette discard for a repository-less cookie authenticator:
            // only the browser cookie is cleared; bearer tokens stay valid.
            response
                .headers_mut()
                .append(header::SET_COOKIE, discarding_cookie_header(&browser));
            tracing::info!(user = %user.id, "User logged out.");
        }
        Some(auth) => {
            let mut tx = state.pool.begin().await?;
            lock_account(&mut tx, &auth).await?;
            if let AuthCredential::Token(token) = &auth.credential {
                dao::delete_token_for_user(&mut tx, token, &auth.user.id).await?;
            }
            tx.commit().await?;
            tracing::info!(user = %auth.user.id, "User logged out.");
        }
        None => {}
    }
    Ok(response)
}

async fn logout_everywhere(
    State(state): State<AppState>,
    auth: LifecycleAuth,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let multi_user = lock_account(&mut tx, &auth).await?;
    dao::update_logged_out_everywhere_time(&mut tx, &multi_user).await?;
    dao::delete_datastore_tokens_for_multi_user(&mut tx, &multi_user).await?;
    tx.commit().await?;
    Ok(StatusCode::OK)
}

fn check_passkeys(config: &AuthRouteConfig) -> ApiResult<()> {
    if !config.passkeys_enabled {
        return Err(ApiError::bad_request(crate::msg::passkeys::NOT_ENABLED));
    }
    if !config.uses_https {
        return Err(ApiError::bad_request(crate::msg::passkeys::REQUIRES_HTTPS));
    }
    Ok(())
}

#[derive(Serialize, sqlx::FromRow)]
pub(crate) struct KeyDescriptor {
    pub(crate) id: String,
    pub(crate) name: String,
}

async fn list_keys(
    State(state): State<AppState>,
    State(config): State<AuthRouteConfig>,
    auth: LifecycleAuth,
) -> ApiResult<Json<Vec<KeyDescriptor>>> {
    check_passkeys(&config)?;
    let mut tx = state.pool.begin().await?;
    let multi_user = lock_account(&mut tx, &auth).await?;
    let keys = dao::find_all_webauthn_credentials(&mut tx, &multi_user).await?;
    tx.commit().await?;
    Ok(Json(keys))
}

async fn remove_key(
    State(state): State<AppState>,
    State(config): State<AuthRouteConfig>,
    auth: LifecycleAuth,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Value>> {
    check_passkeys(&config)?;
    let mut tx = state.pool.begin().await?;
    let multi_user = lock_account(&mut tx, &auth).await?;
    dao::delete_webauthn_credential(&mut tx, &id, &multi_user).await?;
    // Match the Scala DAO's idempotent scoped UPDATE: a missing, foreign or
    // already deleted credential changes nothing and still returns {}.
    tx.commit().await?;
    Ok(Json(json!({})))
}
