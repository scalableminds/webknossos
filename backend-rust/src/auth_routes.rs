//! Authentication lifecycle for existing credentials (bearer tokens and
//! Silhouette browser cookies). Password login lives in `browser_auth`.
use std::time::Duration;

use axum::{
    Extension, Json, Router,
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
    auth::{AuthCredential, AuthUser, authenticate_request},
    browser_auth::{BrowserAuthConfig, cookie_still_valid, discarding_cookie_header},
    error::{ApiError, ApiResult},
    extract::Path,
    id::{ObjectId, PathObjectId},
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

pub fn router(config: AuthRouteConfig) -> Router<AppState> {
    Router::new()
        .route("/auth/token", get(get_token).delete(delete_token))
        .route("/userToken/generate", post(generate_datastore_token))
        .route("/auth/logout", post(logout))
        .route("/auth/logoutEverywhere", post(logout_everywhere))
        .route("/auth/webauthn/keys", get(list_keys))
        .route("/auth/webauthn/keys/{id}", delete(remove_key))
        .layer(Extension(config))
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
) -> ApiResult<String> {
    let multi_user: String = sqlx::query_scalar(
        "SELECT multi._id FROM webknossos.multiUsers AS multi JOIN webknossos.users AS usr ON usr._multiUser = multi._id WHERE usr._id = $1 AND NOT usr.isDeleted AND NOT usr.isDeactivated AND NOT multi.isDeleted FOR UPDATE OF multi",
    )
    .bind(&auth.user.id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(ApiError::unauthorized)?;
    sqlx::query("SELECT _id FROM webknossos.users WHERE _id = $1 FOR UPDATE")
        .bind(&auth.user.id)
        .fetch_one(&mut **tx)
        .await?;
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
    let valid: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (
          SELECT 1 FROM webknossos.tokens AS token
          JOIN webknossos.users AS usr ON usr._id = token._user
          JOIN webknossos.organizations AS org ON org._id = usr._organization
          WHERE token.value = $1 AND usr._id = $2
            AND NOT token.isDeleted AND NOT usr.isDeleted AND NOT usr.isDeactivated
            AND NOT org.isDeleted AND token.tokenType IN ('Authentication', 'DataStore')
            AND token.expirationDateTime > statement_timestamp()
            AND (token.idleTimeout IS NULL OR (token.idleTimeout > 0 AND
              EXTRACT(EPOCH FROM (statement_timestamp() - token.lastUsedDateTime)) * 1000 < token.idleTimeout))
            AND (usr.loggedOutEverywhereTime IS NULL OR token.created > usr.loggedOutEverywhereTime)
            AND (SELECT COUNT(*) FROM webknossos.tokens WHERE value = $1 AND NOT isDeleted) = 1
        )"#,
    )
    .bind(token)
    .bind(&auth.user.id)
    .fetch_one(&mut **tx)
    .await?;
    if !valid {
        return Err(ApiError::unauthorized());
    }
    Ok(multi_user)
}

async fn insert_token(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &str,
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
    sqlx::query(
        r#"INSERT INTO webknossos.tokens
          (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
          VALUES ($1, $2, $3, statement_timestamp(),
            statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
            $6::webknossos.TOKEN_TYPES, statement_timestamp())"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(&value)
    .bind(user_id)
    .bind(expiry_ms)
    .bind(idle_ms)
    .bind(token_type)
    .execute(&mut **tx)
    .await?;
    Ok(value)
}

async fn get_token(
    State(state): State<AppState>,
    Extension(config): Extension<AuthRouteConfig>,
    auth: LifecycleAuth,
) -> ApiResult<Json<Value>> {
    let mut tx = state.pool.begin().await?;
    lock_account(&mut tx, &auth).await?;
    // Only return usable tokens. Unlike the legacy DAO's unfiltered lookup,
    // this excludes expired, idle-expired and account-revoked credentials.
    let existing: Option<String> = sqlx::query_scalar(
        r#"SELECT token.value FROM webknossos.tokens AS token
          JOIN webknossos.users AS usr ON usr._id = token._user
          WHERE token._user = $1 AND token.tokenType = 'Authentication' AND NOT token.isDeleted
            AND token.expirationDateTime > statement_timestamp()
            AND (token.idleTimeout IS NULL OR (token.idleTimeout > 0 AND
              EXTRACT(EPOCH FROM (statement_timestamp() - token.lastUsedDateTime)) * 1000 < token.idleTimeout))
            AND (usr.loggedOutEverywhereTime IS NULL OR token.created > usr.loggedOutEverywhereTime)
            AND (SELECT COUNT(*) FROM webknossos.tokens AS matching WHERE matching.value = token.value AND NOT matching.isDeleted) = 1
          ORDER BY token.created, token._id LIMIT 1"#,
    )
    .bind(&auth.user.id)
    .fetch_optional(&mut *tx)
    .await?;
    let token = match existing {
        Some(token) => token,
        None => {
            sqlx::query("UPDATE webknossos.tokens SET isDeleted = TRUE WHERE _user = $1 AND tokenType = 'Authentication' AND NOT isDeleted")
                .bind(&auth.user.id)
                .execute(&mut *tx)
                .await?;
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
    let deleted = sqlx::query(
        "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE _id = (SELECT _id FROM webknossos.tokens WHERE _user = $1 AND tokenType = 'Authentication' AND NOT isDeleted ORDER BY created, _id LIMIT 1)",
    )
    .bind(&auth.user.id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    tx.commit().await?;
    Ok(if deleted == 0 {
        StatusCode::OK.into_response()
    } else {
        Json(json!({"messages": "Token was deleted."})).into_response()
    })
}

async fn generate_datastore_token(
    State(state): State<AppState>,
    Extension(config): Extension<AuthRouteConfig>,
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
    Extension(config): Extension<AuthRouteConfig>,
    browser: Option<Extension<BrowserAuthConfig>>,
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
            if let Some(Extension(browser)) = browser {
                response
                    .headers_mut()
                    .append(header::SET_COOKIE, discarding_cookie_header(&browser));
            }
            tracing::info!(user = %user.id, "User logged out.");
        }
        Some(auth) => {
            let mut tx = state.pool.begin().await?;
            lock_account(&mut tx, &auth).await?;
            if let AuthCredential::Token(token) = &auth.credential {
                sqlx::query(
                    "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE value = $1 AND _user = $2 AND NOT isDeleted",
                )
                .bind(token)
                .bind(&auth.user.id)
                .execute(&mut *tx)
                .await?;
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
    sqlx::query(
        "UPDATE webknossos.users SET loggedOutEverywhereTime = GREATEST(loggedOutEverywhereTime, statement_timestamp()) WHERE _multiUser = $1",
    )
    .bind(&multi_user)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE tokenType = 'DataStore' AND _user IN (SELECT _id FROM webknossos.users WHERE _multiUser = $1)",
    )
    .bind(&multi_user)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::OK)
}

fn check_passkeys(config: &AuthRouteConfig) -> ApiResult<()> {
    if !config.passkeys_enabled {
        return Err(ApiError::bad_request(
            "Passkeys are not enabled for this WEBKNOSSOS instance.",
        ));
    }
    if !config.uses_https {
        return Err(ApiError::bad_request(
            "Passkeys are only supported with HTTPS.",
        ));
    }
    Ok(())
}

#[derive(Serialize, sqlx::FromRow)]
struct KeyDescriptor {
    id: String,
    name: String,
}

async fn list_keys(
    State(state): State<AppState>,
    Extension(config): Extension<AuthRouteConfig>,
    auth: LifecycleAuth,
) -> ApiResult<Json<Vec<KeyDescriptor>>> {
    check_passkeys(&config)?;
    let mut tx = state.pool.begin().await?;
    let multi_user = lock_account(&mut tx, &auth).await?;
    let keys = sqlx::query_as::<_, KeyDescriptor>(
        "SELECT _id AS id, name FROM webknossos.webauthnCredentials WHERE _multiUser = $1 AND NOT isDeleted ORDER BY _id",
    )
    .bind(&multi_user)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(keys))
}

async fn remove_key(
    State(state): State<AppState>,
    Extension(config): Extension<AuthRouteConfig>,
    auth: LifecycleAuth,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Value>> {
    check_passkeys(&config)?;
    let mut tx = state.pool.begin().await?;
    let multi_user = lock_account(&mut tx, &auth).await?;
    sqlx::query(
        "UPDATE webknossos.webauthnCredentials SET isDeleted = TRUE WHERE _id = $1 AND _multiUser = $2 AND NOT isDeleted",
    )
    .bind(id.as_str())
    .bind(&multi_user)
    .execute(&mut *tx)
    .await?;
    // Match the Scala DAO's idempotent scoped UPDATE: a missing, foreign or
    // already deleted credential changes nothing and still returns {}.
    tx.commit().await?;
    Ok(Json(json!({})))
}
