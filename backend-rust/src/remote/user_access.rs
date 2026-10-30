//! Authorization callbacks made by the existing datastore and tracingstore.
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    AppState,
    auth::{self, AuthUser},
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    remote::{remote_dao, tracingstore::remote_tracingstore_dao},
    stores::client::ServiceClients,
    util::id::ObjectId,
};
use axum::extract::FromRef;

#[derive(Clone, Copy)]
struct AccessFeatures {
    allow_delete_datasets: bool,
}

impl FromRef<AppState> for AccessFeatures {
    fn from_ref(state: &AppState) -> Self {
        Self {
            allow_delete_datasets: state.allow_delete_datasets.0,
        }
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datastores/{name}/validateUserAccess", post(datastore))
        .route(
            "/tracingstores/{name}/validateUserAccess",
            post(tracingstore),
        )
}

#[derive(Deserialize)]
struct ServiceQuery {
    key: String,
    token: Option<String>,
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Administrate,
    List,
    Read,
    Write,
    Delete,
}
impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Administrate => "administrate",
            Self::List => "list",
            Self::Read => "read",
            Self::Write => "write",
            Self::Delete => "delete",
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Resource {
    Dataset,
    Tracing,
    Annotation,
    Webknossos,
    JobExport,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessRequest {
    resource_id: Option<String>,
    resource_type: Resource,
    mode: Mode,
}
#[derive(Serialize)]
struct Answer {
    granted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    msg: Option<String>,
}
impl Answer {
    fn granted() -> Self {
        Self {
            granted: true,
            msg: None,
        }
    }
    fn denied(message: impl Into<String>) -> Self {
        Self {
            granted: false,
            msg: Some(message.into()),
        }
    }
    fn condition(allowed: bool, message: &str) -> Self {
        if allowed {
            Self::granted()
        } else {
            Self::denied(message)
        }
    }
}

async fn datastore(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(query): Query<ServiceQuery>,
    State(clients): State<ServiceClients>,
    State(features): State<AccessFeatures>,
    Json(body): Json<AccessRequest>,
) -> ApiResult<Response> {
    let valid = remote_dao::data_store_key_is_valid(&state.pool, name, &query.key).await?;
    if !valid {
        return Ok((
            StatusCode::FORBIDDEN,
            ResponseJson(json!({"granted":false,"msg":crate::msg::data_store::NOT_FOUND})),
        )
            .into_response());
    }
    Ok(
        ResponseJson(validate(&state, &clients, features, body, query.token.as_deref()).await?)
            .into_response(),
    )
}
async fn tracingstore(
    State(state): State<AppState>,
    Path(_name): Path<String>,
    Query(query): Query<ServiceQuery>,
    State(clients): State<ServiceClients>,
    State(features): State<AccessFeatures>,
    Json(body): Json<AccessRequest>,
) -> ApiResult<Response> {
    // TracingStoreService validates the key globally; name is informational.
    let valid = remote_tracingstore_dao::key_is_valid(&state.pool, &query.key).await?;
    if !valid {
        return Ok((StatusCode::FORBIDDEN, crate::msg::tracing_store::NOT_FOUND).into_response());
    }
    Ok(
        ResponseJson(validate(&state, &clients, features, body, query.token.as_deref()).await?)
            .into_response(),
    )
}

fn required_id(id: Option<&str>) -> ApiResult<ObjectId> {
    let id = id.ok_or_else(|| ApiError::bad_request(crate::msg::request::RESOURCE_ID_REQUIRED))?;
    ObjectId::parse(id)
}
async fn validate(
    state: &AppState,
    clients: &ServiceClients,
    features: AccessFeatures,
    body: AccessRequest,
    token: Option<&str>,
) -> ApiResult<Answer> {
    if token.is_some_and(|token| clients.rpc_token_matches(token)) {
        return Ok(Answer::granted());
    }
    let user = match token {
        Some(token) => auth::user_for_service_token(&state.pool, token).await?,
        None => None,
    };
    let id = body.resource_id.as_deref();
    match body.resource_type {
        Resource::Dataset => dataset(state, features, user.as_ref(), id, body.mode, token).await,
        Resource::Annotation => {
            annotation(state, user.as_ref(), &required_id(id)?, body.mode, token).await
        }
        Resource::Tracing => {
            if id == Some("dummyTracingId") {
                return Ok(Answer::granted());
            }
            let id =
                id.ok_or_else(|| ApiError::bad_request(crate::msg::request::TRACING_ID_REQUIRED))?;
            let annotation_id = remote_dao::find_annotation_id_for_tracing(&state.pool, id)
                .await?
                // Play: `annotationForTracing(…) ?~> annotation.notFound` on an empty result (400).
                .ok_or_else(|| ApiError::bad_request(crate::msg::annotation::NOT_FOUND))?;
            annotation(state, user.as_ref(), &annotation_id, body.mode, token).await
        }
        Resource::JobExport => job_export(state, user.as_ref(), id, body.mode).await,
        Resource::Webknossos => Ok(Answer::denied("Invalid access token.")),
    }
}
async fn dataset(
    state: &AppState,
    features: AccessFeatures,
    user: Option<&AuthUser>,
    id: Option<&str>,
    mode: Mode,
    token: Option<&str>,
) -> ApiResult<Answer> {
    match mode {
        Mode::Read => Ok(Answer::condition(
            crate::dataset::access::can_read(&state.pool, user, &required_id(id)?, token).await?,
            "No read access on dataset",
        )),
        Mode::Write | Mode::Delete => {
            if mode == Mode::Delete && !features.allow_delete_datasets {
                return Err(ApiError::bad_request(
                    crate::msg::dataset::delete::NOT_ENABLED_FOR_DATA_STORE,
                ));
            }
            let id = &required_id(id)?;
            let organization = remote_dao::find_dataset_organization(&state.pool, id)
                .await?
                .ok_or_else(|| ApiError::not_found(crate::msg::dataset::MISSING))?;
            let allowed = match user {
                Some(user) if mode == Mode::Write => {
                    crate::dataset::access::can_edit(&state.pool, user, id).await?
                }
                Some(user) => user.is_admin && user.organization_id == organization,
                None => false,
            };
            Ok(Answer::condition(allowed, "Invalid access token"))
        }
        Mode::Administrate => {
            let Some(user) = user else {
                return Ok(Answer::denied("Invalid access token"));
            };
            let organization = id.unwrap_or(&user.organization_id);
            // isTeamManagerOrAdminOfOrg || isDatasetManagerOf: both are scoped to the
            // requested organization.
            let allowed = organization == user.organization_id
                && (user.is_dataset_manager || user.is_team_manager_or_admin(&state.pool).await?);
            Ok(Answer {
                granted: allowed,
                msg: None,
            })
        }
        Mode::List => Ok(Answer::denied("invalid access token")),
    }
}
async fn annotation(
    state: &AppState,
    user: Option<&AuthUser>,
    id: &ObjectId,
    mode: Mode,
    token: Option<&str>,
) -> ApiResult<Answer> {
    if *id == ObjectId::dummy() {
        return Ok(Answer::granted());
    }
    // Play falls back to the (empty) annotation cache, whose empty Fox answers the generic 404.
    let metadata = crate::annotation::access::find_optional(&state.pool, user, id, true)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    // Private links only grant read access, and only until they expire.
    let allowed_by_link =
        mode == Mode::Read && remote_dao::has_valid_private_link(&state.pool, id, token).await?;
    let restrictions = crate::annotation::access::restrictions(&metadata, user);
    let allowed = allowed_by_link
        || match mode {
            Mode::Read => restrictions.allow_access,
            Mode::Write => restrictions.allow_update_with_mutex,
            _ => false,
        };
    Ok(Answer::condition(
        allowed,
        &format!("No {} access to tracing", mode.as_str()),
    ))
}
async fn job_export(
    state: &AppState,
    user: Option<&AuthUser>,
    id: Option<&str>,
    mode: Mode,
) -> ApiResult<Answer> {
    if mode != Mode::Read {
        return Ok(Answer::denied(format!(
            "Unsupported access mode for job exports: {}",
            mode.as_str()
        )));
    }
    let id = required_id(id)?;
    let allowed = remote_dao::can_read_job_export(&state.pool, &id, user).await?;
    Ok(Answer::condition(allowed, "No read access to job export"))
}
