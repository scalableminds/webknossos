//! AiModelController: list/read/update/delete AI models, the model voxel size, and list/read
//! AI inferences.
use std::collections::HashSet;

use axum::{
    Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    state::JobsEnabled,
    stores::client::ServiceClients,
    util::id::PathObjectId,
};

use super::{
    ai_models_dao,
    inference::{run_instance_model_inference, run_neuron_model_inference},
    service::{
        AiInference, accessible_organization_ids, find_model_or_404, find_model_voxel_size,
        inference_public_writes, list_all_models, model_public_writes,
    },
    training::{run_instance_model_training, run_neuron_model_training},
};

const UPDATING_FAILED: &str = "Could not update AI model’s name and comment.";
const UPDATING_SHARED_FAILED: &str =
    "Could not update the organizations that may access the AI model.";
const NOT_OWNED: &str = "Only the owner of the AI model can perform this change.";
const REFERENCED_BY_INFERENCES: &str =
    "Cannot delete AI models that are referenced by existing inferences.";

pub fn router() -> Router<AppState> {
    // Static segments win over `{id}` in axum's router, as the earlier Play routes do.
    Router::new()
        .route("/aiModels", get(list_models))
        .route("/aiModels/inferences", get(list_inferences))
        .route("/aiModels/inferences/{id}", get(read_inference))
        .route(
            "/aiModels/{id}",
            get(read_model).put(update_model).delete(delete_model),
        )
        .route("/aiModels/{id}/voxelSize", get(model_voxel_size))
        .route(
            "/aiModels/runNeuronModelTraining",
            post(run_neuron_model_training),
        )
        .route(
            "/aiModels/runInstanceModelTraining",
            post(run_instance_model_training),
        )
        .route(
            "/aiModels/inferences/runNeuronModelInference",
            post(run_neuron_model_inference),
        )
        .route(
            "/aiModels/inferences/runInstanceModelInference",
            post(run_instance_model_inference),
        )
}

async fn list_models(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(clients): State<ServiceClients>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Vec<Value>>> {
    let mut connection = state.pool.acquire().await?;
    let models = list_all_models(&mut connection, &user.id).await?;
    let mut values = Vec::with_capacity(models.len());
    for model in &models {
        values.push(
            model_public_writes(&mut connection, &clients, &user, jobs_enabled, model).await?,
        );
    }
    Ok(ResponseJson(values))
}

async fn read_model(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(clients): State<ServiceClients>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let mut connection = state.pool.acquire().await?;
    let model = find_model_or_404(&mut connection, &user.id, &id).await?;
    Ok(ResponseJson(
        model_public_writes(&mut connection, &clients, &user, jobs_enabled, &model).await?,
    ))
}

/// AiModelService.findModelVoxelSize: a fixed size for pretrained models, otherwise
/// the datastore reads it from the model directory (VoxelSize JSON).
async fn model_voxel_size(
    State(state): State<AppState>,
    State(clients): State<ServiceClients>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let mut connection = state.pool.acquire().await?;
    let model = find_model_or_404(&mut connection, &user.id, &id).await?;
    let store_url =
        ai_models_dao::find_data_store_url_for_user(&mut connection, &user.id, &model.data_store)
            .await?
            .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let voxel_size = find_model_voxel_size(connection, &clients, &store_url, &model).await?;
    Ok(ResponseJson(json!(voxel_size)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAiModelParameters {
    name: String,
    comment: Option<String>,
    shared_organization_ids: Option<Vec<String>>,
}

/// `?~> message` on a DAO write: database failures get the given 400 message.
fn write_failed(message: &'static str) -> impl Fn(sqlx::Error) -> ApiError {
    move |error| match error {
        sqlx::Error::Database(_) => ApiError::bad_request(message),
        other => ApiError::from(other),
    }
}

async fn update_model(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(clients): State<ServiceClients>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
    Json(body): Json<UpdateAiModelParameters>,
) -> ApiResult<ResponseJson<Value>> {
    // The owning organization is always kept among the shared organizations.
    let requested_shared = body.shared_organization_ids.map(|mut ids| {
        if !ids.contains(&user.organization_id) {
            ids.push(user.organization_id.clone());
        }
        ids
    });
    // Deviation: Scala commits the name/comment update even if the sharing update
    // fails afterwards; here both happen in one transaction.
    let mut tx = state.pool.begin().await?;
    ai_models_dao::lock_one(&mut tx, &id).await?;
    let model = find_model_or_404(&mut tx, &user.id, &id).await?;
    if model.organization.as_deref() != Some(user.organization_id.as_str()) {
        return Err(ApiError::bad_request(NOT_OWNED));
    }
    ai_models_dao::update_name_and_comment(&mut tx, &model.id, &body.name, body.comment.as_deref())
        .await
        .map_err(write_failed(UPDATING_FAILED))?;
    let current: HashSet<&String> = model.shared_organizations.iter().collect();
    let requested: HashSet<&String> = requested_shared.iter().flatten().collect();
    if requested != current
        && let Some(newly_shared) = &requested_shared
    {
        // Keep organizations with access that the current user cannot see.
        let accessible = accessible_organization_ids(&mut tx, &user.id).await?;
        let organizations: Vec<&String> = newly_shared
            .iter()
            .chain(
                model
                    .shared_organizations
                    .iter()
                    .filter(|id| !accessible.contains(*id)),
            )
            .collect();
        if organizations.iter().copied().collect::<HashSet<_>>() != current {
            ai_models_dao::delete_shared_organizations(&mut tx, &model.id)
                .await
                .map_err(write_failed(UPDATING_SHARED_FAILED))?;
            for organization in organizations {
                ai_models_dao::insert_shared_organization(&mut tx, &model.id, organization)
                    .await
                    .map_err(write_failed(UPDATING_SHARED_FAILED))?;
            }
        }
    }
    tx.commit().await?;
    let mut connection = state.pool.acquire().await?;
    let updated = find_model_or_404(&mut connection, &user.id, &id).await?;
    Ok(ResponseJson(
        model_public_writes(&mut connection, &clients, &user, jobs_enabled, &updated).await?,
    ))
}

/// Soft delete. Any user who can read the model may delete it (AiModelDAO has no
/// separate delete access); models referenced by non-deleted inferences are kept.
async fn delete_model(
    State(state): State<AppState>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    // FOR UPDATE conflicts with the KEY SHARE lock of a concurrent inference
    // insert (foreign key), so the reference count below cannot go stale.
    ai_models_dao::lock_one(&mut tx, &id).await?;
    let references = ai_models_dao::count_inferences_of_model(&mut tx, &id).await?;
    if references != 0 {
        return Err(ApiError::bad_request(REFERENCED_BY_INFERENCES));
    }
    find_model_or_404(&mut tx, &user.id, &id).await?;
    ai_models_dao::delete_one(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(StatusCode::OK)
}

async fn list_inferences(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(clients): State<ServiceClients>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Vec<Value>>> {
    let mut connection = state.pool.acquire().await?;
    let inferences = ai_models_dao::find_all_inferences(&mut connection, &user.id).await?;
    let mut values = Vec::with_capacity(inferences.len());
    for inference in &inferences {
        values.push(
            inference_public_writes(&mut connection, &clients, &user, jobs_enabled, inference)
                .await?,
        );
    }
    Ok(ResponseJson(values))
}

async fn read_inference(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(clients): State<ServiceClients>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let mut connection = state.pool.acquire().await?;
    let inference: AiInference = ai_models_dao::find_one_inference(&mut connection, &user.id, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::ai_inference::NOT_FOUND))?;
    Ok(ResponseJson(
        inference_public_writes(&mut connection, &clients, &user, jobs_enabled, &inference).await?,
    ))
}
