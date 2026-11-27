//! OrganizationController: operator data and terms of service.
use axum::{
    Router,
    extract::State,
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;

use super::organization_dao;
use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Query,
    system::application_info::{MiscState, ok_empty},
};

pub(crate) mod messages {
    pub const NOT_ENABLED: &str =
        "Cannot accept terms of service, as it is not configured for this WEBKNOSSOS instance.";
    pub const ONLY_ORGANIZATION_OWNER: &str =
        "Only the organization owner can accept terms of service.";
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

async fn operator_data(State(misc): State<MiscState>) -> Response {
    no_cache(json!(misc.config().operator_data))
}

async fn terms_of_service(State(misc): State<MiscState>) -> Response {
    let config = &misc.config().terms_of_service;
    no_cache(json!({
        "version": config.version,
        "enabled": config.enabled,
        "url": config.url,
    }))
}

async fn acceptance_needed(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    user: AuthUser,
) -> ApiResult<axum::Json<serde_json::Value>> {
    let config = &misc.config().terms_of_service;
    let accepted_version = organization_dao::find_last_terms_of_service_acceptance_version(
        &state.pool,
        &user.organization_id,
    )
    .await?
    .ok_or_else(|| {
        ApiError::bad_request(crate::msg::organization::not_found(&user.organization_id))
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
    State(misc): State<MiscState>,
    user: AuthUser,
    Query(parameters): Query<AcceptParameters>,
) -> ApiResult<Response> {
    let is_owner = organization_dao::is_organization_owner(&state.pool, &user.id).await?;
    if !is_owner {
        return Err(ApiError::bad_request(messages::ONLY_ORGANIZATION_OWNER));
    }
    let config = &misc.config().terms_of_service;
    if !config.enabled {
        return Err(ApiError::bad_request(messages::NOT_ENABLED));
    }
    if parameters.version != config.version {
        return Err(ApiError::bad_request(
            crate::msg::organization::terms_of_service::version_mismatch(
                config.version,
                parameters.version,
            ),
        ));
    }
    organization_dao::update_terms_of_service_acceptance(
        &state.pool,
        &user.organization_id,
        parameters.version,
    )
    .await?;
    tracing::info!(organization = %user.organization_id, version = parameters.version, "Terms of service accepted.");
    Ok(ok_empty())
}
