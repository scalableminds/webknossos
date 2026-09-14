mod auth;
mod db;
mod fossildb;
mod models;

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::Html,
    routing::{get, post},
    Json, Router,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::env;
use std::str::FromStr;
use tonic::transport::{Channel, Endpoint};

use models::CurrentUser;

#[derive(Clone)]
struct AppState {
    pool: sqlx::PgPool,
    fossildb: Channel,
}

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    token: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

type ApiError = (StatusCode, Json<ErrorResponse>);

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect_with(connect_options_from_env())
        .await
        .expect("failed to connect to Postgres");

    // Lazy: doesn't dial FossilDB until the first request needs it, matching the
    // Scala client's single long-lived Netty channel (`FossilDBClient.scala`).
    let fossildb = fossildb_endpoint_from_env().connect_lazy();

    let state = AppState { pool, fossildb };

    let app = Router::new()
        .route("/", get(index))
        .route("/health", get(health))
        .route("/login", post(login))
        .route("/me", get(me))
        .route("/annotation/{id}/proto", get(annotation_proto))
        .with_state(state)
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000")
        .await
        .expect("failed to bind :8000");
    tracing::info!("wk-auth-poc listening on :8000");
    axum::serve(listener, app).await.expect("server error");
}

/// Same env vars and defaults as `conf/slick.conf` (`POSTGRES_URL`/`POSTGRES_USER`/
/// `POSTGRES_PASSWORD`), so this can point at the same Postgres the Play app uses with
/// zero config translation. `POSTGRES_URL` may be copy-pasted as-is from the Play
/// config, including its `jdbc:` prefix, which sqlx doesn't understand — stripped here.
fn connect_options_from_env() -> PgConnectOptions {
    let raw_url =
        env::var("POSTGRES_URL").unwrap_or_else(|_| "postgresql://localhost/webknossos".to_string());
    let url = raw_url.strip_prefix("jdbc:").unwrap_or(&raw_url);

    PgConnectOptions::from_str(url)
        .expect("invalid POSTGRES_URL")
        .username(&env::var("POSTGRES_USER").unwrap_or_else(|_| "postgres".to_string()))
        .password(&env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "postgres".to_string()))
}

/// Same env vars and default (`localhost:7155`, plaintext) as
/// `tracingstore.fossildb.address`/`port` in `conf/application.conf`.
fn fossildb_endpoint_from_env() -> Endpoint {
    let address = env::var("FOSSILDB_ADDRESS").unwrap_or_else(|_| "localhost".to_string());
    let port = env::var("FOSSILDB_PORT").unwrap_or_else(|_| "7155".to_string());
    Endpoint::from_shared(format!("http://{address}:{port}")).expect("invalid FossilDB endpoint")
}

async fn health() -> &'static str {
    "ok"
}

// Minimal browser UI for manually exercising /login and /me — not part of the PoC's
// actual scope, just makes it easy to click through the flow instead of scripting it.
async fn index() -> Html<&'static str> {
    Html(include_str!("../static/index.html"))
}

async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let multiuser = db::find_multiuser_by_email(&state.pool, &payload.email)
        .await
        .map_err(internal_error)?
        .ok_or_else(unauthorized)?;

    // 'Empty' hasher means an OIDC/SSO-only account with no usable password.
    if multiuser.password_hasher != "SCrypt" {
        return Err(unauthorized());
    }
    if !auth::verify_password(&payload.password, &multiuser.password_hash) {
        return Err(unauthorized());
    }

    let user = db::find_user_for_multiuser(&state.pool, &multiuser._id)
        .await
        .map_err(internal_error)?
        .ok_or_else(unauthorized)?;
    if user.is_deactivated {
        return Err(unauthorized());
    }

    let token_value = auth::generate_token_value();
    let token_id = auth::generate_object_id();
    let expiration = Utc::now() + Duration::days(14);

    db::insert_token(&state.pool, &token_id, &token_value, &user._id, expiration)
        .await
        .map_err(internal_error)?;

    Ok(Json(LoginResponse { token: token_value }))
}

async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CurrentUser>, ApiError> {
    let token_value = extract_bearer_token(&headers).ok_or_else(unauthorized)?;

    let user_id = db::find_valid_token_user(&state.pool, &token_value)
        .await
        .map_err(internal_error)?
        .ok_or_else(unauthorized)?;

    let user = db::find_user_by_id(&state.pool, &user_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(unauthorized)?;

    let multiuser = db::find_multiuser_by_id(&state.pool, &user._multiuser)
        .await
        .map_err(internal_error)?
        .ok_or_else(unauthorized)?;

    Ok(Json(CurrentUser {
        id: user._id,
        email: multiuser.email,
        first_name: multiuser.first_name,
        last_name: multiuser.last_name,
        organization: user._organization,
        is_admin: user.is_admin,
    }))
}

/// Forwards the raw stored bytes of an annotation's FossilDB entry (collection
/// `"annotations"`, keyed by annotation id) as-is — no decoding, no update-action
/// replay. Mirrors the raw-fetch half of the Scala tracingstore's
/// `TSAnnotationService.getNewestMatchingMaterializedAnnotation`, minus version
/// reconstruction, and deliberately skips the datastore/tracingstore access-token
/// check the real endpoint has.
async fn annotation_proto(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Bytes), ApiError> {
    let value = fossildb::get_raw(state.fossildb, "annotations", &id)
        .await
        .map_err(fossildb_error)?
        .ok_or_else(not_found)?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/x-protobuf".parse().unwrap());
    // Forces a save-as-file download rather than relying on the browser's guess for an
    // unrecognized mime type. Falls back to a fixed filename if `id` (path input)
    // doesn't form a valid header value, rather than panicking on it.
    let disposition = format!("attachment; filename=\"{id}.proto\"")
        .parse()
        .unwrap_or_else(|_| header::HeaderValue::from_static("attachment; filename=\"annotation.proto\""));
    headers.insert(header::CONTENT_DISPOSITION, disposition);
    Ok((headers, Bytes::from(value)))
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    value.strip_prefix("Bearer ").map(|s| s.to_string())
}

fn unauthorized() -> ApiError {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            error: "invalid credentials or token".to_string(),
        }),
    )
}

fn internal_error(err: sqlx::Error) -> ApiError {
    tracing::error!("db error: {err}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "internal error".to_string(),
        }),
    )
}

fn not_found() -> ApiError {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "not found".to_string(),
        }),
    )
}

fn fossildb_error(err: tonic::Status) -> ApiError {
    tracing::error!("fossildb error: {err}");
    (
        StatusCode::BAD_GATEWAY,
        Json(ErrorResponse {
            error: "fossildb unavailable".to_string(),
        }),
    )
}
