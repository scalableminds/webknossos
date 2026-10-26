pub(crate) mod dao;

use crate::response::Messages;
use axum::{Json as ResponseJson, Router, extract::State, routing::get};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    util::id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/taskTypes", get(list).post(create))
        .route("/taskTypes/{id}", get(read).put(update).delete(delete))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum TracingType {
    Skeleton,
    Volume,
    Hybrid,
}
impl TracingType {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Skeleton => "skeleton",
            Self::Volume => "volume",
            Self::Hybrid => "hybrid",
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum TracingMode {
    Orthogonal,
    Flight,
}
impl TracingMode {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Orthogonal => "orthogonal",
            Self::Flight => "flight",
        }
    }
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
struct MagRestrictions {
    #[serde(skip_serializing_if = "Option::is_none")]
    min: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max: Option<i32>,
}
fn true_value() -> bool {
    true
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationSettings {
    allowed_modes: Vec<TracingMode>,
    preferred_mode: Option<TracingMode>,
    #[serde(default = "true_value")]
    branch_points_allowed: bool,
    #[serde(default = "true_value")]
    soma_clicking_allowed: bool,
    #[serde(default = "true_value")]
    volume_interpolation_allowed: bool,
    #[serde(default)]
    merger_mode: bool,
    #[serde(default)]
    mag_restrictions: MagRestrictions,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskTypeParameters {
    summary: String,
    description: String,
    team_id: ObjectId,
    settings: AnnotationSettings,
    recommended_configuration: Option<Value>,
    tracing_type: TracingType,
}

fn validate(parameters: &TaskTypeParameters) -> ApiResult<()> {
    let length = parameters.summary.encode_utf16().count();
    if length < 2 {
        return Err(ApiError::bad_request(
            crate::msg::task_type::SUMMARY_TOO_SHORT,
        ));
    }
    if length > 50 {
        return Err(ApiError::bad_request(
            crate::msg::task_type::SUMMARY_TOO_LONG,
        ));
    }
    // The database requires JSON objects even though the controller accepts JsValue.
    if parameters
        .recommended_configuration
        .as_ref()
        .is_some_and(|v| !v.is_object())
    {
        return Err(ApiError::bad_request(
            crate::msg::task_type::RECOMMENDED_CONFIGURATION_INVALID,
        ));
    }
    Ok(())
}

async fn public_json<'e, E: sqlx::Executor<'e, Database = sqlx::Postgres>>(
    executor: E,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Value> {
    dao::find_one_json(executor, user, id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::task_type::not_found(id)))
}
async fn check_manage(pool: &PgPool, user: &AuthUser, team: &ObjectId) -> ApiResult<()> {
    if !user.can_manage_team(pool, team).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    Ok(())
}

async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<ResponseJson<Value>> {
    let values = dao::find_all_json(&state.pool, &user).await?;
    Ok(ResponseJson(Value::Array(values)))
}
async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let value = public_json(&state.pool, &user, &id).await?;
    let team = ObjectId::parse(value["teamId"].as_str().ok_or_else(ApiError::internal)?)?;
    check_manage(&state.pool, &user, &team).await?;
    Ok(ResponseJson(value))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(parameters): Json<TaskTypeParameters>,
) -> ApiResult<ResponseJson<Value>> {
    validate(&parameters)?;
    let id = ObjectId::new();
    let mut tx = state.pool.begin().await?;
    if !crate::projects::can_manage_team_in_tx(&mut tx, &user, &parameters.team_id).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    dao::lock_summary(&mut tx, &user.organization_id, &parameters.summary).await?;
    let exists = dao::is_summary_taken(&mut tx, &user.organization_id, &parameters.summary).await?;
    if exists {
        return Err(ApiError::bad_request(crate::msg::task_type::summary_taken(
            &parameters.summary,
        )));
    }
    dao::insert_one(&mut tx, &id, &user.organization_id, &parameters).await?;
    let response = public_json(&mut *tx, &user, &id).await?;
    tx.commit().await?;
    Ok(ResponseJson(response))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<TaskTypeParameters>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    validate(&parameters)?;
    let mut tx = state.pool.begin().await?;
    let team = lock_task_type(&mut tx, &id, &user.organization_id).await?;
    let existing = public_json(&mut *tx, &user, &id).await?;
    if !crate::projects::can_manage_team_in_tx(&mut tx, &user, &team).await?
        || !crate::projects::can_manage_team_in_tx(&mut tx, &user, &parameters.team_id).await?
    {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    if existing["tracingType"] != json!(parameters.tracing_type) {
        return Err(ApiError::bad_request(
            crate::msg::task_type::TRACING_TYPE_IMMUTABLE,
        ));
    }
    if existing["settings"]["magRestrictions"] != json!(parameters.settings.mag_restrictions) {
        return Err(ApiError::bad_request(
            crate::msg::task_type::MAG_RESTRICTIONS_IMMUTABLE,
        ));
    }
    dao::lock_summary(&mut tx, &user.organization_id, &parameters.summary).await?;
    let exists =
        dao::is_summary_taken_by_other(&mut tx, &user.organization_id, &parameters.summary, &id)
            .await?;
    if exists {
        return Err(ApiError::bad_request(crate::msg::task_type::summary_taken(
            &parameters.summary,
        )));
    }
    dao::update_one(&mut tx, &id, &parameters).await?;
    let mut value = public_json(&mut *tx, &user, &id).await?;
    tx.commit().await?;
    value["messages"] = json!([{"success":crate::msg::task_type::EDIT_SUCCESS}]);
    Ok(ResponseJson(value))
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Messages>> {
    let id = ObjectId::parse_path(&id)?;
    let mut tx = state.pool.begin().await?;
    let team = lock_task_type(&mut tx, &id, &user.organization_id).await?;
    let existing = public_json(&mut *tx, &user, &id).await?;
    if !crate::projects::can_manage_team_in_tx(&mut tx, &user, &team).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    dao::delete_one(&mut tx, &id).await?;
    crate::projects::dao::delete_tasks(&mut tx, "_tasktype", &id).await?;
    tx.commit().await?;
    Ok(Messages::success(crate::msg::task_type::delete_success(
        existing["summary"].as_str().unwrap_or_default(),
    )))
}

async fn lock_task_type(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: &ObjectId,
    organization: &str,
) -> ApiResult<ObjectId> {
    dao::lock_one(tx, id, organization)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::task_type::not_found(id)))
}

#[cfg(test)]
mod tests;
