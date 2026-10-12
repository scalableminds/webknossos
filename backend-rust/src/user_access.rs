//! Authorization callbacks made by the existing datastore and tracingstore.
use axum::{
    Extension, Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    AppState, annotation_access,
    auth::{self, AuthUser},
    dataset_access,
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    id::ObjectId,
    service_clients::ServiceClients,
};

#[derive(Clone, Copy)]
struct AccessFeatures {
    allow_delete_datasets: bool,
}

pub fn router(allow_delete_datasets: bool) -> Router<AppState> {
    Router::new()
        .route("/datastores/{name}/validateUserAccess", post(datastore))
        .route(
            "/tracingstores/{name}/validateUserAccess",
            post(tracingstore),
        )
        .layer(Extension(AccessFeatures {
            allow_delete_datasets,
        }))
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
    Extension(clients): Extension<ServiceClients>,
    Extension(features): Extension<AccessFeatures>,
    Json(body): Json<AccessRequest>,
) -> ApiResult<Response> {
    let valid: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.dataStores_ WHERE name=$1 AND key=$2)",
    )
    .bind(name)
    .bind(&query.key)
    .fetch_one(&state.pool)
    .await?;
    if !valid {
        return Ok((
            StatusCode::FORBIDDEN,
            ResponseJson(
                json!({"granted":false,"msg":"Data store could not be found or accessed."}),
            ),
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
    Extension(clients): Extension<ServiceClients>,
    Extension(features): Extension<AccessFeatures>,
    Json(body): Json<AccessRequest>,
) -> ApiResult<Response> {
    // TracingStoreService validates the key globally; name is informational.
    let valid: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.tracingStores_ WHERE key=$1)")
            .bind(&query.key)
            .fetch_one(&state.pool)
            .await?;
    if !valid {
        return Ok((
            StatusCode::FORBIDDEN,
            "Tracing store could not be found or accessed.",
        )
            .into_response());
    }
    Ok(
        ResponseJson(validate(&state, &clients, features, body, query.token.as_deref()).await?)
            .into_response(),
    )
}

fn required_id(id: Option<&str>) -> ApiResult<ObjectId> {
    let id = id.ok_or_else(|| ApiError::bad_request("Resource identifier is required."))?;
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
        Resource::Annotation => annotation(state, user.as_ref(), id, body.mode, token).await,
        Resource::Tracing => {
            if id == Some("dummyTracingId") {
                return Ok(Answer::granted());
            }
            let id = id.ok_or_else(|| ApiError::bad_request("Tracing identifier is required."))?;
            let annotation_id:String=sqlx::query_scalar("SELECT a._id FROM webknossos.annotations_ a JOIN webknossos.annotation_layers layer ON layer._annotation=a._id WHERE layer.tracingId=$1 LIMIT 1")
                .bind(id).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::not_found("Annotation not found."))?;
            annotation(state, user.as_ref(), Some(&annotation_id), body.mode, token).await
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
            dataset_access::can_read(&state.pool, user, required_id(id)?.as_str(), token).await?,
            "No read access on dataset",
        )),
        Mode::Write | Mode::Delete => {
            if mode == Mode::Delete && !features.allow_delete_datasets {
                return Err(ApiError::bad_request("Dataset deletion is not enabled."));
            }
            let id = required_id(id)?;
            let id = id.as_str();
            let organization: String =
                sqlx::query_scalar("SELECT _organization FROM webknossos.datasets_ WHERE _id=$1")
                    .bind(id)
                    .fetch_optional(&state.pool)
                    .await?
                    .ok_or_else(|| ApiError::not_found("Dataset not found."))?;
            let allowed = match user {
                Some(user) if mode == Mode::Write => {
                    dataset_access::can_edit(&state.pool, user, id).await?
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
            let allowed = user.is_dataset_manager
                || (organization == user.organization_id
                    && user.is_team_manager_or_admin(&state.pool).await?);
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
    id: Option<&str>,
    mode: Mode,
    token: Option<&str>,
) -> ApiResult<Answer> {
    if id == Some("000000000000000000000000") {
        return Ok(Answer::granted());
    }
    let id = required_id(id)?;
    let id = id.as_str();
    let metadata = annotation_access::find(&state.pool, user, id, true).await?;
    // Preserve the existing private-link grant used by datastore requests;
    // the dedicated source endpoint separately enforces link expiration.
    let allowed_by_link:bool=sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.annotation_privateLinks_ WHERE _annotation=$1 AND accessToken=$2)")
        .bind(id).bind(token).fetch_one(&state.pool).await?;
    let restrictions = annotation_access::restrictions(&metadata, user);
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
    let id = id.as_str();
    let allowed:bool=sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM webknossos.jobs_ j WHERE j._id=$1 AND
      (j._owner=$2 OR $3 OR ($4 AND EXISTS (SELECT 1 FROM webknossos.users_ owner WHERE owner._id=j._owner AND owner._organization=$5))
      OR EXISTS(SELECT 1 FROM webknossos.user_team_roles requester JOIN webknossos.user_team_roles owner_role ON owner_role._team=requester._team
        JOIN webknossos.teams_ team ON team._id=requester._team AND team._organization=$5
        JOIN webknossos.users_ owner ON owner._id=owner_role._user AND owner._organization=$5
        WHERE requester._user=$2 AND requester.isTeamManager AND owner._id=j._owner)))"#)
        .bind(id).bind(user.map(|u|u.id.as_str())).bind(user.is_some_and(|u|u.is_superuser))
        .bind(user.is_some_and(|u|u.is_admin)).bind(user.map(|u|u.organization_id.as_str())).fetch_one(&state.pool).await?;
    Ok(Answer::condition(allowed, "No read access to job export"))
}
