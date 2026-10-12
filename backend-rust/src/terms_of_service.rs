//! OrganizationController: operator data and terms of service.
use axum::{
    Extension, Router,
    extract::State,
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;

use crate::{
    AppState,
    application_info::{MiscState, ok_empty},
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Query,
};

pub(crate) mod messages {
    pub const NOT_ENABLED: &str =
        "Cannot accept terms of service, as it is not configured for this WEBKNOSSOS instance.";
    pub const ONLY_ORGANIZATION_OWNER: &str =
        "Only the organization owner can accept terms of service.";
    pub fn version_mismatch(required: i32, version: i32) -> String {
        format!(
            "Terms of service version mismatch. Current version is {required}, received acceptance for {version}."
        )
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/operatorData", get(operator_data))
        .route("/termsOfService", get(terms_of_service))
        .route("/termsOfService/accept", post(accept))
        .route("/termsOfService/acceptanceNeeded", get(acceptance_needed))
}

/// Play's addNoCacheHeaderFallback on a plain Action.
fn no_cache(body: serde_json::Value) -> Response {
    (
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"))],
        axum::Json(body),
    )
        .into_response()
}

async fn operator_data(Extension(misc): Extension<MiscState>) -> Response {
    no_cache(json!(misc.config().operator_data))
}

async fn terms_of_service(Extension(misc): Extension<MiscState>) -> Response {
    let config = &misc.config().terms_of_service;
    no_cache(json!({
        "version": config.version,
        "enabled": config.enabled,
        "url": config.url,
    }))
}

async fn acceptance_needed(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    user: AuthUser,
) -> ApiResult<axum::Json<serde_json::Value>> {
    let config = &misc.config().terms_of_service;
    let accepted_version: i32 = sqlx::query_scalar(
        "SELECT lastTermsOfServiceAcceptanceVersion FROM webknossos.organizations_ WHERE _id = $1",
    )
    .bind(&user.organization_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        ApiError::bad_request(
            crate::browser_auth_onboarding::organization_messages::not_found(&user.organization_id),
        )
    })?;
    let deadline = config.acceptance_deadline;
    Ok(axum::Json(json!({
        "acceptanceNeeded": config.enabled && accepted_version < config.version,
        "acceptanceDeadline": deadline.timestamp_millis(),
        "acceptanceDeadlinePassed": deadline < Utc::now(),
    })))
}

#[derive(Deserialize)]
struct AcceptParameters {
    version: i32,
}

async fn accept(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    user: AuthUser,
    Query(parameters): Query<AcceptParameters>,
) -> ApiResult<Response> {
    let is_owner: bool =
        sqlx::query_scalar("SELECT isOrganizationOwner FROM webknossos.users_ WHERE _id = $1")
            .bind(&user.id)
            .fetch_optional(&state.pool)
            .await?
            .unwrap_or(false);
    if !is_owner {
        return Err(ApiError::bad_request(messages::ONLY_ORGANIZATION_OWNER));
    }
    let config = &misc.config().terms_of_service;
    if !config.enabled {
        return Err(ApiError::bad_request(messages::NOT_ENABLED));
    }
    if parameters.version != config.version {
        return Err(ApiError::bad_request(messages::version_mismatch(
            config.version,
            parameters.version,
        )));
    }
    sqlx::query(
        r#"UPDATE webknossos.organizations
           SET lastTermsOfServiceAcceptanceTime = statement_timestamp(),
               lastTermsOfServiceAcceptanceVersion = $2
           WHERE _id = $1 AND NOT isDeleted"#,
    )
    .bind(&user.organization_id)
    .bind(parameters.version)
    .execute(&state.pool)
    .await?;
    tracing::info!(organization = %user.organization_id, version = parameters.version, "Terms of service accepted.");
    Ok(ok_empty())
}
