//! AiModelController (batch J5a): list/read/update/delete AI models, the model
//! voxel size, and list/read AI inferences, plus the `AiModelService` and
//! `AiInferenceService` serializers. J5b-1 adds the model upload-to-path routes
//! ([`upload_router`]); J5b-2 adds model training submission and J5b-3
//! inference submission.
use std::collections::HashSet;

use axum::{
    Extension, Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sqlx::PgConnection;

use crate::{
    AppState,
    auth::AuthUser,
    dataset::options::UploadToPathsConfig,
    dataset::routes::{full_json_on_connection, public_datastore_json_on_connection},
    dataset::source::VoxelSize,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    job::routes::Job,
    job::submission::{Failure, RunResult, Submission},
    stores::client::{ServiceClients, ServiceError},
    system::application_info::MiscState,
    util::id::{ObjectId, PathObjectId},
};
use webknossos_common::{
    geometry::{BoundingBox, Vec3Double},
    json::play_f64_value,
    upath::{UPath, UPathError},
};

pub(crate) mod dao;

const MODEL_NOT_FOUND: &str = "Could not find requested AI model.";
const UPDATING_FAILED: &str = "Could not update AI model’s name and comment.";
const UPDATING_SHARED_FAILED: &str =
    "Could not update the organizations that may access the AI model.";
const NOT_OWNED: &str = "Only the owner of the AI model can perform this change.";
const REFERENCED_BY_INFERENCES: &str =
    "Cannot delete AI models that are referenced by existing inferences.";
const RESERVE_NOT_PENDING: &str =
    "Cannot reserve upload to path for AI model that is not currently marked as pending.";
const RESERVE_WRONG_ORGA: &str =
    "Cannot publish AI model to a different organization than it was reserved for.";
const FINISH_NOT_PENDING: &str =
    "Cannot finish upload to path for AI model that is not currently marked as pending.";
const FINISH_WRONG_ORGA: &str =
    "Cannot finish upload to path for AI models of other organizations.";
const NO_AI_PLAN: &str = "Only organizations with an AI plan can start this job.";
const ZERO_TRAINING_ANNOTATIONS: &str = "Need at least one training annotation for model training.";
const TRAIN_WRONG_ORGA: &str =
    "Training AI models is only allowed for datasets of your own organization.";
const TRAIN_SUBMIT_FAILED: &str = "Could not start the AI model training job.";
const NO_BOUNDING_BOX: &str =
    "Dataset has no bounding box. Please make sure this dataset is imported correctly.";
const DATA_STORE_MISMATCH: &str = "Cannot use AI model on a dataset on a different data store.";
/// Not a message key in Play's messages: rendered verbatim.
const MODEL_REQUIRED: &str = "aiModel.required";

/// Msg.AiModel.nameTaken.
pub(crate) fn name_taken(name: &str) -> String {
    format!("An AI model with the name “{name}” already exists. Please choose a different name.")
}

/// AiModelCategory values (webknossos.AI_MODEL_CATEGORY).
pub(crate) const CATEGORIES: [&str; 8] = [
    "em_neurons",
    "em_nuclei",
    "em_synapses",
    "em_neuron_types",
    "em_cell_organelles",
    "em_generic",
    "em_somata",
    "em_mitochondria",
];

/// AiModelService.pretrainedVoxelSizes (all in nanometers).
pub(crate) const PRETRAINED_VOXEL_SIZES: [(&str, [f64; 3]); 4] = [
    ("576500000000000000000001", [7.96, 7.96, 31.2]),
    ("576500000000000000000002", [7.96, 7.96, 31.2]),
    ("576500000000000000000003", [179.84, 179.84, 224.0]),
    ("576500000000000000000004", [179.84, 179.84, 224.0]),
];

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
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
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

/// `webKnossos.datasets.uploadToPaths` prefixes, shared with the dataset
/// upload-to-path routes (UploadToPathsService.generateAiModelPath).
#[derive(Clone)]
struct ModelUploadPaths(UploadToPathsConfig);

/// The AI model upload-to-path routes, which need the upload-to-paths config.
pub fn upload_router(jobs_enabled: bool, upload_to_paths: UploadToPathsConfig) -> Router<AppState> {
    Router::new()
        .route(
            "/aiModels/reserveUploadToPath",
            post(reserve_upload_to_path),
        )
        .route(
            "/aiModels/{id}/finishUploadToPath",
            post(finish_upload_to_path),
        )
        .layer(Extension(JobsEnabled(jobs_enabled)))
        .layer(Extension(ModelUploadPaths(upload_to_paths)))
}

/// A row of webknossos.aiModels_ as parsed by AiModelDAO (training annotations
/// are not needed by any serializer and therefore not loaded).
#[derive(sqlx::FromRow, Clone, Debug)]
pub(crate) struct AiModel {
    pub id: ObjectId,
    pub organization: Option<String>,
    pub data_store: String,
    pub user_id: Option<ObjectId>,
    pub training_job: Option<ObjectId>,
    /// Normalized UPath literal.
    pub path: Option<String>,
    pub upload_to_path_is_pending: bool,
    pub name: String,
    pub comment: Option<String>,
    pub category: Option<String>,
    pub created: DateTime<Utc>,
    pub is_super_user_only: bool,
    pub is_pretrained: bool,
    /// aiModel_organizations plus the owning organization (appended if missing).
    pub shared_organizations: Vec<String>,
}

impl AiModel {
    /// AiModelDAO.parse: the path must be a valid UPath; the owning organization
    /// is always part of the shared organizations.
    fn parse(mut self) -> Result<Self, ()> {
        if let Some(path) = &self.path {
            self.path = Some(UPath::parse(path).map_err(|_| ())?.to_string());
        }
        if let Some(organization) = &self.organization
            && !self.shared_organizations.contains(organization)
        {
            self.shared_organizations.push(organization.clone());
        }
        Ok(self)
    }
}

/// AiModelDAO.findOne with the requesting user's read access. `Ok(None)` is the
/// empty Fox; an unparsable row is the DAO's "Parsing failed" failure (400).
pub(crate) async fn find_model(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    model_id: &ObjectId,
) -> ApiResult<Option<AiModel>> {
    let model = dao::find_one(connection, user_id, model_id).await?;
    model
        .map(|model| {
            model.parse().map_err(|_| {
                ApiError::bad_request(format!(
                    "Parsing failed for row in webknossos.aiModels queried by {model_id}"
                ))
            })
        })
        .transpose()
}

/// AiModelDAO.findAll. Scala has no ORDER BY; creation order is used for stability.
async fn list_all_models(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<Vec<AiModel>> {
    let models = dao::find_all(connection, user_id).await?;
    models
        .into_iter()
        .map(AiModel::parse)
        .collect::<Result<_, _>>()
        .map_err(|_| {
            ApiError::bad_request(crate::msg::request::list_row_parse_failed(
                "webknossos.aiModels",
            ))
        })
}

/// OrganizationDAO.findAll ids (organizations of the user's account, or all for superusers).
async fn accessible_organization_ids(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<HashSet<String>> {
    let ids = dao::find_all_accessible_organization_ids(connection, user_id).await?;
    Ok(ids.into_iter().collect())
}

/// UserDAO.findOne with the requesting user's read access, then UserService.compactWrites.
async fn readable_compact_user(
    connection: &mut PgConnection,
    requesting_user_id: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<Option<Value>> {
    let readable = dao::find_readable_user_id(connection, requesting_user_id, user_id).await?;
    if readable.is_none() {
        return Ok(None);
    }
    dao::find_compact_user(connection, user_id).await
}

/// AiModelService.pathWithFallback: the stored path, or the legacy
/// `<organization base dir on the datastore>/.aiModels/<id>`.
async fn path_with_fallback(
    connection: &mut PgConnection,
    clients: &ServiceClients,
    model: &AiModel,
) -> ApiResult<String> {
    if let Some(path) = &model.path {
        return Ok(path.clone());
    }
    let organization = model
        .organization
        .as_deref()
        .ok_or_else(|| ApiError::bad_request(crate::msg::ai_model::NO_ORGANIZATION))?;
    // DataStoreDAO.findOneByName with GlobalAccessContext.
    let url = crate::job::dao::find_data_store_url(&mut *connection, &model.data_store)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let base: String = clients
        .get_json(
            &url,
            &["data", "datasets", "getOneBaseDirForOrgaAbsolute"],
            &[("organizationId", organization.to_owned())],
        )
        .await?;
    let base = UPath::parse(&base).map_err(|_| ApiError::from(ServiceError::InvalidJson))?;
    Ok(base.join(".aiModels").join(model.id.as_str()).to_string())
}

/// AiModelService.publicWrites with the requesting user's access context.
pub(crate) async fn model_public_writes(
    connection: &mut PgConnection,
    clients: &ServiceClients,
    user: &AuthUser,
    jobs_enabled: bool,
    model: &AiModel,
) -> ApiResult<Value> {
    dao::find_data_store_url_for_user(connection, &user.id, &model.data_store)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    // A user that cannot be read is rendered as null.
    let user_json = match &model.user_id {
        Some(user_id) => readable_compact_user(connection, &user.id, user_id).await?,
        None => None,
    };
    let data_store_json =
        public_datastore_json_on_connection(connection, &model.data_store, jobs_enabled).await?;
    // A training job that cannot be read (or parsed) is rendered as null.
    let training_job: Option<Job> = match &model.training_job {
        Some(job_id) => match crate::job::routes::find_job(connection, &user.id, job_id).await {
            Ok(job) => job,
            Err(error) if error.status == StatusCode::BAD_REQUEST => None,
            Err(error) => return Err(error),
        },
        None => None,
    };
    let training_job_json = match &training_job {
        Some(job) => Some(crate::job::routes::public_writes(connection, &user.id, job).await?),
        None => None,
    };
    let is_owned = model.organization.as_deref() == Some(user.organization_id.as_str());
    let shared_organization_ids = if is_owned {
        let accessible = accessible_organization_ids(connection, &user.id).await?;
        Some(
            model
                .shared_organizations
                .iter()
                .filter(|id| accessible.contains(*id))
                .cloned()
                .collect::<Vec<_>>(),
        )
    } else {
        None
    };
    let path = if model.is_pretrained {
        None
    } else {
        Some(path_with_fallback(connection, clients, model).await?)
    };
    let is_usable = !model.upload_to_path_is_pending
        && training_job
            .as_ref()
            .is_none_or(|job| job.effective_state() == "SUCCESS");
    Ok(json!({
        "id": model.id,
        "name": model.name,
        "isOwnedByUsersOrganization": is_owned,
        "dataStore": data_store_json,
        "user": user_json,
        "comment": model.comment,
        "trainingJob": training_job_json,
        "created": model.created.timestamp_millis(),
        "sharedOrganizationIds": shared_organization_ids,
        "category": model.category,
        "path": path,
        "isUsable": is_usable,
        "isSuperUserOnly": model.is_super_user_only,
        "isPretrained": model.is_pretrained,
    }))
}

/// `?~> Msg.AiModel.notFound ~> crate::msg::NOT_FOUND`: empty and parse failures become 404;
/// database errors stay errors.
async fn find_model_or_404(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    model_id: &ObjectId,
) -> ApiResult<AiModel> {
    match find_model(connection, user_id, model_id).await {
        Ok(Some(model)) => Ok(model),
        Ok(None) => Err(ApiError::not_found(MODEL_NOT_FOUND)),
        Err(error) if error.status == StatusCode::BAD_REQUEST => {
            Err(ApiError::not_found(MODEL_NOT_FOUND))
        }
        Err(error) => Err(error),
    }
}

async fn list_models(
    State(state): State<AppState>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(clients): Extension<ServiceClients>,
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
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(clients): Extension<ServiceClients>,
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
    Extension(clients): Extension<ServiceClients>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let mut connection = state.pool.acquire().await?;
    let model = find_model_or_404(&mut connection, &user.id, &id).await?;
    let store_url = dao::find_data_store_url_for_user(&mut connection, &user.id, &model.data_store)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let voxel_size = find_model_voxel_size(connection, &clients, &store_url, &model).await?;
    Ok(ResponseJson(json!(voxel_size)))
}

/// AiModelService.findModelVoxelSize (and the same lookup in
/// inferenceBBoxToTargetMag): pretrained constants (nanometers), otherwise
/// `POST data/aiModels/effectiveVoxelSize` on the datastore at `store_url` for the
/// model path (with fallback).
async fn find_model_voxel_size(
    mut connection: sqlx::pool::PoolConnection<sqlx::Postgres>,
    clients: &ServiceClients,
    store_url: &str,
    model: &AiModel,
) -> ApiResult<VoxelSize> {
    if model.is_pretrained {
        let factor = PRETRAINED_VOXEL_SIZES
            .iter()
            .find(|(pretrained_id, _)| *pretrained_id == model.id.as_str())
            .map(|(_, factor)| *factor)
            .ok_or_else(|| {
                ApiError::bad_request(format!(
                    "No voxel size known for pretrained model '{}'",
                    model.name
                ))
            })?;
        return Ok(VoxelSize::from_factor_with_default_unit(Vec3Double::from(
            factor,
        )));
    }
    let model_path = path_with_fallback(&mut connection, clients, model).await?;
    drop(connection);
    let response: Value = clients
        .post_json(
            store_url,
            &["data", "aiModels", "effectiveVoxelSize"],
            &[],
            &json!({"modelPath": model_path}),
        )
        .await?;
    VoxelSize::from_json(&response).map_err(|_| ApiError::from(ServiceError::InvalidJson))
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
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(clients): Extension<ServiceClients>,
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
    dao::lock_one(&mut tx, &id).await?;
    let model = find_model_or_404(&mut tx, &user.id, &id).await?;
    if model.organization.as_deref() != Some(user.organization_id.as_str()) {
        return Err(ApiError::bad_request(NOT_OWNED));
    }
    dao::update_name_and_comment(&mut tx, &model.id, &body.name, body.comment.as_deref())
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
            dao::delete_shared_organizations(&mut tx, &model.id)
                .await
                .map_err(write_failed(UPDATING_SHARED_FAILED))?;
            for organization in organizations {
                dao::insert_shared_organization(&mut tx, &model.id, organization)
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
    dao::lock_one(&mut tx, &id).await?;
    let references = dao::count_inferences_of_model(&mut tx, &id).await?;
    if references != 0 {
        return Err(ApiError::bad_request(REFERENCED_BY_INFERENCES));
    }
    find_model_or_404(&mut tx, &user.id, &id).await?;
    dao::delete_one(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(StatusCode::OK)
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

/// Unique (_organization, name) violations (also by soft-deleted models, which
/// Scala reports as a generic SQL failure) are reported as Msg.AiModel.nameTaken.
fn name_write_failed(name: &str) -> impl Fn(sqlx::Error) -> ApiError + '_ {
    move |error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => {
            ApiError::bad_request(name_taken(name))
        }
        _ => ApiError::from(error),
    }
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
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(ModelUploadPaths(config)): Extension<ModelUploadPaths>,
    Extension(clients): Extension<ServiceClients>,
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
    dao::find_data_store_url_for_user(&mut tx, &user.id, &body.data_store_name)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))?;
    let model_id = match &body.existing_ai_model_id {
        Some(existing_id) => {
            dao::lock_one(&mut tx, existing_id).await?;
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
            dao::update_path_name_and_comment(
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
            let taken = dao::is_name_taken(&mut tx, &user.id, &body.name).await?;
            if taken {
                return Err(ApiError::bad_request(name_taken(&body.name)));
            }
            let id = ObjectId::new();
            let path =
                generate_model_path(&config, &id, &user.organization_id, path_prefix.as_deref())?;
            // AiModelDAO.insertOne writes no shared organizations; the owning
            // organization is implied.
            dao::insert_one_with_path(
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
    dao::lock_one(&mut tx, &id).await?;
    let model = find_model(&mut tx, &user.id, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    if !model.upload_to_path_is_pending {
        return Err(ApiError::bad_request(FINISH_NOT_PENDING));
    }
    if model.organization.as_deref() != Some(user.organization_id.as_str()) {
        return Err(ApiError::forbidden(FINISH_WRONG_ORGA));
    }
    dao::update_upload_to_path_finished(&mut tx, &model.id).await?;
    tx.commit().await?;
    Ok(StatusCode::OK)
}

/// TrainingAnnotationSpecification (`mag` is a Vec3Int JSON array).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrainingAnnotationSpecification {
    annotation_id: ObjectId,
    color_layer_name: String,
    segmentation_layer_name: String,
    mag: [i32; 3],
}

/// RunNeuronModelTrainingParameters / RunInstanceModelTrainingParameters.
/// `instanceDiameterNm` is only bound (and validated) by the instance route;
/// Play ignores it for neuron training.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunModelTrainingParameters {
    training_annotations: Vec<TrainingAnnotationSpecification>,
    name: String,
    ai_model_category: Option<String>,
    #[serde(default)]
    instance_diameter_nm: Option<Value>,
    comment: Option<String>,
    workflow_yaml: Option<String>,
    custom_configuration: Option<Map<String, Value>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TrainingKind {
    Neuron,
    Instance,
}

impl TrainingKind {
    fn command(self) -> &'static str {
        match self {
            Self::Neuron => "train_neuron_model",
            Self::Instance => "train_instance_model",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Neuron => "neuron",
            Self::Instance => "instance",
        }
    }
}

async fn run_neuron_model_training(
    State(state): State<AppState>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(misc): Extension<MiscState>,
    Extension(clients): Extension<ServiceClients>,
    user: AuthUser,
    Json(body): Json<RunModelTrainingParameters>,
) -> RunResult<ResponseJson<Value>> {
    run_model_training(
        &state,
        jobs_enabled,
        &misc,
        &clients,
        &user,
        body,
        TrainingKind::Neuron,
    )
    .await
}

async fn run_instance_model_training(
    State(state): State<AppState>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(misc): Extension<MiscState>,
    Extension(clients): Extension<ServiceClients>,
    user: AuthUser,
    Json(body): Json<RunModelTrainingParameters>,
) -> RunResult<ResponseJson<Value>> {
    run_model_training(
        &state,
        jobs_enabled,
        &misc,
        &clients,
        &user,
        body,
        TrainingKind::Instance,
    )
    .await
}

/// AiModelController.runNeuronTraining / runInstanceTraining. The paid training
/// job, its credit reservation and the pending model (with its training
/// annotations) commit atomically; Scala inserts the model after the job.
async fn run_model_training(
    state: &AppState,
    jobs_enabled: bool,
    misc: &MiscState,
    clients: &ServiceClients,
    user: &AuthUser,
    body: RunModelTrainingParameters,
    kind: TrainingKind,
) -> RunResult<ResponseJson<Value>> {
    // Body binding (validateJson): enum category and nullable Double diameter.
    if body
        .ai_model_category
        .as_deref()
        .is_some_and(|category| !CATEGORIES.contains(&category))
    {
        return Err(ApiError::bad_request(crate::msg::request::INVALID_JSON_BODY).into());
    }
    let instance_diameter_nm = match (kind, &body.instance_diameter_nm) {
        (TrainingKind::Neuron, _) | (_, None | Some(Value::Null)) => None,
        (TrainingKind::Instance, Some(Value::Number(number))) => number.as_f64(),
        (TrainingKind::Instance, Some(_)) => {
            return Err(ApiError::bad_request(crate::msg::request::INVALID_JSON_BODY).into());
        }
    };
    let generic_not_found = || Failure::with_status(crate::msg::NOT_FOUND, StatusCode::NOT_FOUND);

    // OrganizationDAO.findOne (global) ?~> Msg.Organization.notFound, then
    // OrganizationService.assertIsSuperUserOrOrganizationHasAiPlan.
    let ai_plan: Option<String> = dao::find_ai_plan(&state.pool, &user.organization_id)
        .await?
        .ok_or_else(|| Failure::new(crate::msg::organization::not_found(&user.organization_id)))?;
    if !user.is_superuser && ai_plan.is_none() {
        return Err(Failure::new(NO_AI_PLAN).into());
    }
    let annotations = &body.training_annotations;
    if annotations.is_empty() && body.workflow_yaml.is_none() {
        return Err(Failure::new(ZERO_TRAINING_ANNOTATIONS).into());
    }
    // headOption.toFox: a workflow without annotations is the empty Fox.
    let first = annotations.first().ok_or_else(generic_not_found)?;
    let annotation = crate::annotation::access::find_optional(
        &state.pool,
        Some(user),
        &first.annotation_id,
        false,
    )
    .await?
    .ok_or_else(generic_not_found)?;
    let dataset =
        crate::job::submission::find_readable_dataset(state, user, &annotation.dataset_id)
            .await?
            .ok_or_else(generic_not_found)?;
    if dataset.organization != user.organization_id {
        return Err(Failure::with_status(TRAIN_WRONG_ORGA, StatusCode::FORBIDDEN).into());
    }
    let (bounding_box, _) = crate::job::submission::usable_data_source(state, &dataset)
        .await
        .map_err(|error| error.wrap(NO_BOUNDING_BOX))?;
    let data_store = dataset.data_store.trim().to_owned();
    {
        let mut connection = state.pool.acquire().await?;
        dao::find_data_store_url_for_user(&mut connection, &user.id, &data_store)
            .await?
            .ok_or_else(|| Failure::new(crate::msg::data_store::NOT_FOUND))?;
    }
    for specification in annotations {
        crate::annotation::access::find_optional(
            &state.pool,
            Some(user),
            &specification.annotation_id,
            false,
        )
        .await?
        .ok_or_else(|| Failure::new(crate::msg::annotation::NOT_FOUND))?;
    }
    // AiModelDAO.countByNameAndOrganization counts soft-deleted models, too.
    let existing =
        dao::count_by_name_and_organization(&state.pool, &body.name, &user.organization_id).await?;
    if existing != 0 {
        return Err(Failure::new(name_taken(&body.name)).into());
    }

    let model_id = ObjectId::new();
    let training_annotations: Vec<Value> = annotations
        .iter()
        .map(|specification| {
            json!({
                "annotationId": specification.annotation_id,
                "colorLayerName": specification.color_layer_name,
                "segmentationLayerName": specification.segmentation_layer_name,
                "mag": specification.mag,
            })
        })
        .collect();
    let mut args = Map::new();
    args.insert("training_annotations".into(), training_annotations.into());
    args.insert("organization_id".into(), json!(user.organization_id));
    args.insert("model_id".into(), json!(model_id));
    args.insert("model_name".into(), json!(body.name));
    if kind == TrainingKind::Instance {
        args.insert(
            "instance_diameter_nm".into(),
            json!(instance_diameter_nm.map(play_f64_value)),
        );
    }
    args.insert(
        "custom_configuration".into(),
        body.custom_configuration
            .clone()
            .map_or(Value::Null, Value::Object),
    );
    let submission = Submission {
        command: kind.command(),
        args: Value::Object(args),
        data_store: &data_store,
    };
    let comment = format!("AI training for {} model {model_id}", kind.label());
    let mut pending = crate::job::submission::begin_paid_job(
        state,
        misc,
        jobs_enabled,
        user,
        &submission,
        bounding_box,
        &comment,
        TRAIN_SUBMIT_FAILED,
    )
    .await?;
    let job_id = pending.job_id().clone();
    // Instant.now has millisecond precision.
    let now = Utc::now();
    let created = DateTime::from_timestamp_millis(now.timestamp_millis()).unwrap_or(now);
    dao::insert_one_for_training(
        pending.connection(),
        &model_id,
        &user.organization_id,
        &data_store,
        &user.id,
        &job_id,
        &body.name,
        body.comment.as_deref(),
        body.ai_model_category.as_deref(),
        created,
    )
    .await
    .map_err(name_write_failed(&body.name))?;
    for specification in annotations {
        // Duplicate annotation ids violate the primary key; everything rolls
        // back (Scala fails after the job was already created).
        dao::insert_training_annotation(
            pending.connection(),
            &model_id,
            &specification.annotation_id,
        )
        .await?;
    }
    pending.commit(state, misc, user).await?;

    // AiModelService.publicWrites of the in-memory model, whose shared
    // organizations are empty (not yet re-read with the owner appended).
    let model = AiModel {
        id: model_id,
        organization: Some(user.organization_id.clone()),
        data_store,
        user_id: Some(user.id.clone()),
        training_job: Some(job_id),
        path: None,
        upload_to_path_is_pending: true,
        name: body.name,
        comment: body.comment,
        category: body.ai_model_category,
        created,
        is_super_user_only: false,
        is_pretrained: false,
        shared_organizations: Vec::new(),
    };
    let mut connection = state.pool.acquire().await?;
    Ok(ResponseJson(
        model_public_writes(&mut connection, clients, user, jobs_enabled, &model).await?,
    ))
}

/// RunInferenceParameters (`boundingBox` is a mag1 literal; `workflowYaml` is
/// bound but unused, as in Scala).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunInferenceParameters {
    dataset_id: ObjectId,
    ai_model_id: Option<ObjectId>,
    color_layer_name: String,
    bounding_box: String,
    annotation_id: Option<ObjectId>,
    mask_annotation_layer_name: Option<String>,
    new_dataset_name: String,
    #[expect(
        dead_code,
        reason = "required in the request like Play's Reads, otherwise unused"
    )]
    workflow_yaml: Option<String>,
    seed_generator_distance_threshold: Option<f64>,
    do_split_merger_evaluation: Option<bool>,
    eval_use_sparse_tracing: Option<bool>,
    eval_max_edge_length: Option<f64>,
    eval_sparse_tube_threshold_nm: Option<f64>,
    eval_min_merger_path_length_nm: Option<f64>,
    custom_configuration: Option<Map<String, Value>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum InferenceKind {
    Neuron,
    Instance,
}

async fn run_neuron_model_inference(
    State(state): State<AppState>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(misc): Extension<MiscState>,
    Extension(clients): Extension<ServiceClients>,
    user: AuthUser,
    Json(body): Json<RunInferenceParameters>,
) -> RunResult<ResponseJson<Value>> {
    run_model_inference(
        &state,
        jobs_enabled,
        &misc,
        &clients,
        &user,
        body,
        InferenceKind::Neuron,
    )
    .await
}

async fn run_instance_model_inference(
    State(state): State<AppState>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(misc): Extension<MiscState>,
    Extension(clients): Extension<ServiceClients>,
    user: AuthUser,
    Json(body): Json<RunInferenceParameters>,
) -> RunResult<ResponseJson<Value>> {
    run_model_inference(
        &state,
        jobs_enabled,
        &misc,
        &clients,
        &user,
        body,
        InferenceKind::Instance,
    )
    .await
}

/// AiModelService.findBestMatchingMag: the first mag whose x voxel size (dataset
/// voxel size times mag, in nm) is closest to the model's on a log scale.
fn find_best_matching_mag(
    model_voxel_size_nm: [f64; 3],
    dataset_voxel_size_nm: [f64; 3],
    mags: &[[i32; 3]],
) -> Option<[i32; 3]> {
    let distance = |mag: &[i32; 3]| {
        ((dataset_voxel_size_nm[0] * f64::from(mag[0])).ln() - model_voxel_size_nm[0].ln()).abs()
    };
    // Seq.minBy keeps the first minimum (NaN never compares lower).
    let (first, rest) = mags.split_first()?;
    let mut best = (*first, distance(first));
    for mag in rest {
        let candidate = distance(mag);
        if candidate < best.1 {
            best = (*mag, candidate);
        }
    }
    Some(best.0)
}

/// AiModelController.runNeuronModelInference / runInstanceModelInference. The
/// paid inference job, its credit reservation and the aiInferences row commit
/// atomically; Scala inserts the inference after the job.
async fn run_model_inference(
    state: &AppState,
    jobs_enabled: bool,
    misc: &MiscState,
    clients: &ServiceClients,
    user: &AuthUser,
    body: RunInferenceParameters,
    kind: InferenceKind,
) -> RunResult<ResponseJson<Value>> {
    let generic_not_found = || Failure::with_status(crate::msg::NOT_FOUND, StatusCode::NOT_FOUND);
    let dataset = crate::job::submission::find_readable_dataset(state, user, &body.dataset_id)
        .await?
        .ok_or_else(generic_not_found)?;
    if dataset.organization != user.organization_id {
        return Err(Failure::with_status(
            crate::job::submission::INFERENCE_WRONG_ORGA,
            StatusCode::FORBIDDEN,
        )
        .into());
    }
    let data_store = dataset.data_store.trim().to_owned();
    // Fox.runOptional(aiModelId)(aiModelDAO.findOne) ?~> Msg.AiModel.notFound
    // (read access includes models shared with the user's organization).
    let model = match &body.ai_model_id {
        Some(model_id) => {
            let mut connection = state.pool.acquire().await?;
            match find_model(&mut connection, &user.id, model_id).await {
                Ok(Some(model)) => Some(model),
                Ok(None) => return Err(Failure::new(MODEL_NOT_FOUND).into()),
                Err(error) => {
                    return Err(crate::job::submission::RunError::from(error).wrap(MODEL_NOT_FOUND));
                }
            }
        }
        None => None,
    };
    let model = model.ok_or_else(|| Failure::new(MODEL_REQUIRED))?;
    if !model.is_pretrained && model.data_store != data_store {
        return Err(Failure::new(DATA_STORE_MISMATCH).into());
    }
    let (_, layer) =
        crate::job::submission::data_source_and_layer(state, &dataset, &body.color_layer_name)
            .await?;
    let mut connection = state.pool.acquire().await?;
    let store_url = dao::find_data_store_url_for_user(&mut connection, &user.id, &data_store)
        .await?
        .ok_or_else(|| Failure::new(crate::msg::data_store::NOT_FOUND))?;
    crate::dataset::create::validate_dataset_name(&body.new_dataset_name)?;
    // BoundingBox.fromLiteral(..).toFox: the empty Fox.
    let mag1_bounding_box =
        BoundingBox::from_literal(&body.bounding_box).ok_or_else(generic_not_found)?;

    // AiModelService.inferenceBBoxToTargetMag (model voxel size via the dataset's datastore).
    let model_voxel_size_nm = find_model_voxel_size(connection, clients, &store_url, &model)
        .await?
        .to_nanometer()
        .to_array();
    let dataset_voxel_size_nm = dataset
        .voxel_size_in_nanometers()
        .ok_or_else(|| crate::job::submission::RunError::Api(ApiError::internal()))?;
    let mags = crate::job::submission::layer_mags(state, &dataset, &layer.name).await?;
    let target_mag = find_best_matching_mag(model_voxel_size_nm, dataset_voxel_size_nm, &mags)
        .ok_or_else(|| Failure::new(crate::msg::dataset::NO_MAGS))?;
    let target_mag_bounding_box = mag1_bounding_box
        .checked_div_mag(target_mag.into())
        .ok_or_else(|| crate::job::submission::RunError::Api(ApiError::internal()))?;

    let model_id = body.ai_model_id.as_ref();
    let model_organization_id = if model.is_pretrained {
        None
    } else {
        model.organization.clone()
    };
    let custom_configuration = body
        .custom_configuration
        .clone()
        .map_or(Value::Null, Value::Object);
    let mut args = Map::new();
    args.insert("dataset_id".into(), json!(dataset.id));
    args.insert("organization_id".into(), json!(dataset.organization));
    args.insert("dataset_name".into(), json!(dataset.name));
    args.insert("layer_name".into(), json!(body.color_layer_name));
    args.insert("bbox".into(), json!(mag1_bounding_box.to_literal()));
    args.insert("model_id".into(), json!(model_id));
    args.insert("model_organization_id".into(), json!(model_organization_id));
    if kind == InferenceKind::Neuron {
        args.insert("annotation_id".into(), json!(body.annotation_id));
    }
    args.insert(
        "dataset_directory_name".into(),
        json!(dataset.directory_name),
    );
    args.insert("new_dataset_name".into(), json!(body.new_dataset_name));
    let (command, label) = match kind {
        InferenceKind::Neuron => {
            args.insert(
                "do_split_merger_evaluation".into(),
                json!(body.do_split_merger_evaluation.unwrap_or(false)),
            );
            args.insert(
                "eval_use_sparse_tracing".into(),
                json!(body.eval_use_sparse_tracing),
            );
            args.insert(
                "eval_max_edge_length".into(),
                json!(body.eval_max_edge_length.map(play_f64_value)),
            );
            args.insert(
                "eval_sparse_tube_threshold_nm".into(),
                json!(body.eval_sparse_tube_threshold_nm.map(play_f64_value)),
            );
            args.insert(
                "eval_min_merger_path_length_nm".into(),
                json!(body.eval_min_merger_path_length_nm.map(play_f64_value)),
            );
            ("infer_neurons", "neuron")
        }
        InferenceKind::Instance => {
            args.insert(
                "seed_generator_distance_threshold".into(),
                json!(body.seed_generator_distance_threshold.map(play_f64_value)),
            );
            ("infer_instances", "instance")
        }
    };
    args.insert("custom_configuration".into(), custom_configuration);
    let model_label = model_id
        .map(|id| format!(" with model {id}"))
        .unwrap_or_default();
    let comment = format!(
        "AI custom {label} segmentation{model_label} for dataset {}",
        dataset.name
    );
    let submission = Submission {
        command,
        args: Value::Object(args),
        data_store: &data_store,
    };
    let mut pending = crate::job::submission::begin_paid_job(
        state,
        misc,
        jobs_enabled,
        user,
        &submission,
        target_mag_bounding_box,
        &comment,
        crate::job::submission::INFERENCE_SUBMIT_FAILED,
    )
    .await?;
    let inference_id = ObjectId::new();
    let job_id = pending.job_id().clone();
    // Instant.now has millisecond precision.
    let now = Utc::now();
    let created = DateTime::from_timestamp_millis(now.timestamp_millis()).unwrap_or(now);
    // An unknown annotation id violates the foreign key; everything rolls back
    // (Scala fails after the job was already created).
    dao::insert_one_inference(
        pending.connection(),
        &inference_id,
        &user.organization_id,
        &model.id,
        body.annotation_id.as_ref(),
        &job_id,
        &mag1_bounding_box.to_literal(),
        body.mask_annotation_layer_name.as_deref(),
        created,
    )
    .await?;
    pending.commit(state, misc, user).await?;

    let inference = AiInference {
        id: inference_id,
        ai_model: Some(model.id),
        new_dataset: None,
        inference_job: job_id,
        new_segmentation_layer_name: "segmentation".to_owned(),
        mask_annotation_layer_name: body.mask_annotation_layer_name,
        created,
    };
    let mut connection = state.pool.acquire().await?;
    Ok(ResponseJson(
        inference_public_writes(&mut connection, clients, user, jobs_enabled, &inference).await?,
    ))
}

/// A row of webknossos.aiInferences_ (fields needed by the serializer).
#[derive(sqlx::FromRow, Clone, Debug)]
pub(crate) struct AiInference {
    pub id: ObjectId,
    pub ai_model: Option<ObjectId>,
    pub new_dataset: Option<ObjectId>,
    pub inference_job: ObjectId,
    pub new_segmentation_layer_name: String,
    pub mask_annotation_layer_name: Option<String>,
    pub created: DateTime<Utc>,
}

/// AiInferenceService.publicWrites. Every lookup here is mandatory: an inference
/// whose job, model, dataset or job owner the user cannot read fails (404).
pub(crate) async fn inference_public_writes(
    connection: &mut PgConnection,
    clients: &ServiceClients,
    user: &AuthUser,
    jobs_enabled: bool,
    inference: &AiInference,
) -> ApiResult<Value> {
    let empty = || ApiError::not_found(crate::msg::NOT_FOUND);
    let job = crate::job::routes::find_job(connection, &user.id, &inference.inference_job)
        .await?
        .ok_or_else(empty)?;
    let job_json = crate::job::routes::public_writes(connection, &user.id, &job).await?;
    dao::find_data_store_url_for_user(connection, &user.id, &job.data_store)
        .await?
        .ok_or_else(empty)?;
    let data_store_json =
        public_datastore_json_on_connection(connection, &job.data_store, jobs_enabled).await?;
    let model_json = match &inference.ai_model {
        Some(model_id) => {
            let model = find_model(connection, &user.id, model_id)
                .await?
                .ok_or_else(empty)?;
            Some(model_public_writes(connection, clients, user, jobs_enabled, &model).await?)
        }
        None => None,
    };
    let dataset_json = match &inference.new_dataset {
        Some(dataset_id) => {
            let readable = dao::is_dataset_readable(connection, &user.id, dataset_id).await?;
            if !readable {
                return Err(empty());
            }
            Some(full_json_on_connection(connection, Some(user), dataset_id, jobs_enabled).await?)
        }
        None => None,
    };
    let owner_json = readable_compact_user(connection, &user.id, &job.owner)
        .await?
        .ok_or_else(empty)?;
    Ok(json!({
        "id": inference.id,
        "dataStore": data_store_json,
        "newSegmentationLayerName": inference.new_segmentation_layer_name,
        "maskAnnotationLayerName": inference.mask_annotation_layer_name,
        "inferenceJob": job_json,
        "aiModel": model_json,
        "user": owner_json,
        "newDataset": dataset_json,
        "created": inference.created.timestamp_millis(),
    }))
}

async fn list_inferences(
    State(state): State<AppState>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(clients): Extension<ServiceClients>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Vec<Value>>> {
    let mut connection = state.pool.acquire().await?;
    let inferences = dao::find_all_inferences(&mut connection, &user.id).await?;
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
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(clients): Extension<ServiceClients>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let mut connection = state.pool.acquire().await?;
    let inference: AiInference = dao::find_one_inference(&mut connection, &user.id, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::ai_inference::NOT_FOUND))?;
    Ok(ResponseJson(
        inference_public_writes(&mut connection, &clients, &user, jobs_enabled, &inference).await?,
    ))
}

#[cfg(test)]
mod tests;
