//! AI model upload-to-path routes.

use axum::{Json as ResponseJson, Router, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    AppState,
    auth::AuthUser,
    dataset::options::UploadToPathsConfig,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    state::JobsEnabled,
    stores::client::ServiceClients,
    util::id::{ObjectId, PathObjectId},
};
use webknossos_common::upath::{UPath, UPathError};

use super::{
    ai_models_dao,
    service::{CATEGORIES, find_model, model_public_writes, name_taken, name_write_failed},
};

const RESERVE_NOT_PENDING: &str =
    "Cannot reserve upload to path for AI model that is not currently marked as pending.";
const RESERVE_WRONG_ORGA: &str =
    "Cannot publish AI model to a different organization than it was reserved for.";
const FINISH_NOT_PENDING: &str =
    "Cannot finish upload to path for AI model that is not currently marked as pending.";
const FINISH_WRONG_ORGA: &str =
    "Cannot finish upload to path for AI models of other organizations.";

/// The AI model upload-to-path routes, which need the upload-to-paths config.
pub fn upload_router() -> Router<AppState> {
    Router::new()
        .route(
            "/aiModels/reserveUploadToPath",
            post(reserve_upload_to_path),
        )
        .route(
            "/aiModels/{id}/finishUploadToPath",
            post(finish_upload_to_path),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReserveUploadToPathParameters {
    /// If empty, a new model entry is created.
    existing_ai_model_id: Option<ObjectId>,
    data_store_name: String,
    name: String,
    comment: Option<String>,
    category: Option<String>,
    path_prefix: Option<String>,
}

/// UploadToPathsService.generateAiModelPath: `<prefix>/<organization>/.aiModels/<id>`
/// (no organization-directory/infix settings, unlike dataset paths).
fn generate_model_path(
    config: &UploadToPathsConfig,
    id: &ObjectId,
    organization: &str,
    requested_prefix: Option<&str>,
) -> ApiResult<String> {
    let prefix = crate::dataset::upload_paths::select_path_prefix(config, requested_prefix)?;
    let prefix = UPath::parse(&prefix).map_err(|_: UPathError| {
        ApiError::bad_request(crate::msg::request::INVALID_STORAGE_PATH)
    })?;
    Ok(prefix
        .join(organization)
        .join(".aiModels")
        .join(id.as_str())
        .to_string())
}

/// Reserve a path for uploading model files, either for a new model or for a
/// pending model of the user's organization (e.g. created by a training job).
/// The model stays pending (unusable) until `finishUploadToPath`.
async fn reserve_upload_to_path(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(config): State<UploadToPathsConfig>,
    State(clients): State<ServiceClients>,
    user: AuthUser,
    Json(body): Json<ReserveUploadToPathParameters>,
) -> ApiResult<ResponseJson<Value>> {
    if body
        .category
        .as_deref()
        .is_some_and(|category| !CATEGORIES.contains(&category))
    {
        return Err(ApiError::bad_request(
            crate::msg::request::INVALID_JSON_BODY,
        ));
    }
    let path_prefix = crate::dataset::upload_paths::parse_prefix(body.path_prefix.as_deref())?;
    let mut tx = state.pool.begin().await?;
    ai_models_dao::find_data_store_url_for_user(&mut tx, &user.id, &body.data_store_name)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))?;
    let model_id = match &body.existing_ai_model_id {
        Some(existing_id) => {
            ai_models_dao::lock_one(&mut tx, existing_id).await?;
            let existing = find_model(&mut tx, &user.id, existing_id)
                .await?
                .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
            if existing.organization.as_deref() != Some(user.organization_id.as_str()) {
                return Err(ApiError::forbidden(RESERVE_WRONG_ORGA));
            }
            if !existing.upload_to_path_is_pending {
                return Err(ApiError::bad_request(RESERVE_NOT_PENDING));
            }
            let path = generate_model_path(
                &config,
                &existing.id,
                &user.organization_id,
                path_prefix.as_deref(),
            )?;
            // AiModelDAO.updatePath, then updateOne (name, comment, modified);
            // the category is kept.
            ai_models_dao::update_path_name_and_comment(
                &mut tx,
                &existing.id,
                &path,
                &body.name,
                body.comment.as_deref(),
            )
            .await
            .map_err(name_write_failed(&body.name))?;
            existing.id
        }
        None => {
            let taken = ai_models_dao::is_name_taken(&mut tx, &user.id, &body.name).await?;
            if taken {
                return Err(ApiError::bad_request(name_taken(&body.name)));
            }
            let id = ObjectId::new();
            let path =
                generate_model_path(&config, &id, &user.organization_id, path_prefix.as_deref())?;
            // AiModelDAO.insertOne writes no shared organizations; the owning
            // organization is implied.
            ai_models_dao::insert_one_with_path(
                &mut tx,
                &id,
                &user.organization_id,
                &body.data_store_name,
                &user.id,
                &path,
                &body.name,
                body.comment.as_deref(),
                body.category.as_deref(),
            )
            .await
            .map_err(name_write_failed(&body.name))?;
            id
        }
    };
    tx.commit().await?;
    let mut connection = state.pool.acquire().await?;
    let model = find_model(&mut connection, &user.id, &model_id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    Ok(ResponseJson(
        model_public_writes(&mut connection, &clients, &user, jobs_enabled, &model).await?,
    ))
}

/// Mark a pending model of the user's organization as uploaded (usable once a
/// training job, if any, succeeded).
async fn finish_upload_to_path(
    State(state): State<AppState>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    ai_models_dao::lock_one(&mut tx, &id).await?;
    let model = find_model(&mut tx, &user.id, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    if !model.upload_to_path_is_pending {
        return Err(ApiError::bad_request(FINISH_NOT_PENDING));
    }
    if model.organization.as_deref() != Some(user.organization_id.as_str()) {
        return Err(ApiError::forbidden(FINISH_WRONG_ORGA));
    }
    ai_models_dao::update_upload_to_path_finished(&mut tx, &model.id).await?;
    tx.commit().await?;
    Ok(StatusCode::OK)
}
