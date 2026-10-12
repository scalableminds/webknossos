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
    AppState, annotation_access,
    application_info::MiscState,
    auth::AuthUser,
    dataset_access,
    dataset_options::UploadToPathsConfig,
    dataset_source::{
        nanometers_per_unit, normalize_upath, upath_join, voxel_size as parse_voxel_size,
    },
    datasets::{full_json_on_connection, public_datastore_json_on_connection},
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    id::{ObjectId, PathObjectId},
    job_submission::{self, Failure, RunResult, Submission},
    jobs::{self, Job},
    service_clients::{ServiceClients, ServiceError},
    users,
};

/// Msg.notFound: Play's response for an empty Fox.
const NOT_FOUND: &str = "Could not find or access the requested resource.";
const MODEL_NOT_FOUND: &str = "Could not find requested AI model.";
const INFERENCE_NOT_FOUND: &str = "Could not find requested AI inference.";
const UPDATING_FAILED: &str = "Could not update AI model’s name and comment.";
const UPDATING_SHARED_FAILED: &str =
    "Could not update the organizations that may access the AI model.";
const NOT_OWNED: &str = "Only the owner of the AI model can perform this change.";
const REFERENCED_BY_INFERENCES: &str =
    "Cannot delete AI models that are referenced by existing inferences.";
const DATA_STORE_NOT_FOUND: &str = "Data store could not be found or accessed.";
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
const ANNOTATION_NOT_FOUND: &str = "Annotation could not be found or accessed.";
const INVALID_BODY: &str = "Invalid JSON request body.";
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

/// AiModelDAO.readAccessQ for alias `m` ($1 = requesting user): models shared with
/// or owned by the user's organization, or pretrained; superuser-only models only
/// for superusers. AiModelDAO has no deleteAccessQ, so this is also delete access.
pub(crate) const MODEL_READ_ACCESS: &str = r#"((m._id IN (
      SELECT a._aiModel FROM webknossos.aiModel_organizations AS a
      INNER JOIN webknossos.organizations AS o ON a._organization = o._id
      WHERE o._id IN (SELECT _organization FROM webknossos.users_ WHERE _id = $1))
    OR m._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $1)
    OR m.isPretrained)
  AND (NOT m.isSuperUserOnly OR TRUE IN (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN
    (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1))))"#;

/// AiInferenceDAO.readAccessQ for alias `i` ($1 = requesting user).
const INFERENCE_READ_ACCESS: &str =
    "i._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $1)";

/// Column list for [`AiModel`] (alias `m`, `_dataStore` trimmed as in AiModelDAO.parse;
/// shared organizations ordered as in findSharedOrganizationsFor).
pub(crate) const MODEL_COLUMNS: &str = r#"m._id AS id, m._organization AS organization,
  TRIM(m._dataStore) AS data_store, m._user AS user_id, m._trainingJob AS training_job, m.path,
  m.uploadToPathIsPending AS upload_to_path_is_pending, m.name, m.comment, m.category::text AS category,
  m.created, m.isSuperUserOnly AS is_super_user_only, m.isPretrained AS is_pretrained,
  ARRAY(SELECT ao._organization FROM webknossos.aiModel_organizations ao WHERE ao._aiModel = m._id
    ORDER BY ao._organization) AS shared_organizations"#;

const INFERENCE_COLUMNS: &str = r#"i._id AS id, i._aiModel AS ai_model, i._newDataset AS new_dataset,
  i._inferenceJob AS inference_job, i.newSegmentationLayerName AS new_segmentation_layer_name,
  i.maskAnnotationLayerName AS mask_annotation_layer_name, i.created"#;

/// UserService.compactWrites for `$1` (teams of the user's organization).
const COMPACT_USER: &str = r#"SELECT jsonb_build_object('id',u._id,'email',m.email,'firstName',m.firstName,'lastName',m.lastName,
    'isAdmin',u.isAdmin,'isDatasetManager',u.isDatasetManager,'isActive',NOT u.isDeactivated,'isAnonymous',false,
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',team._id,'name',team.name,'isTeamManager',role.isTeamManager) ORDER BY team._id)
      FROM webknossos.user_team_roles role JOIN webknossos.teams_ team ON team._id=role._team WHERE role._user=u._id AND team._organization=u._organization),'[]'::jsonb))
    FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id=u._multiUser WHERE u._id=$1"#;

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
    pub id: String,
    pub organization: Option<String>,
    pub data_store: String,
    pub user_id: Option<String>,
    pub training_job: Option<String>,
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
            self.path = Some(normalize_upath(path).map_err(|_| ())?);
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
    user_id: &str,
    model_id: &str,
) -> ApiResult<Option<AiModel>> {
    let query = format!(
        "SELECT {MODEL_COLUMNS} FROM webknossos.aiModels_ m WHERE m._id = $2 AND {MODEL_READ_ACCESS}"
    );
    let model: Option<AiModel> = sqlx::query_as(&query)
        .bind(user_id)
        .bind(model_id)
        .fetch_optional(&mut *connection)
        .await?;
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
async fn list_all_models(connection: &mut PgConnection, user_id: &str) -> ApiResult<Vec<AiModel>> {
    let query = format!(
        "SELECT {MODEL_COLUMNS} FROM webknossos.aiModels_ m WHERE {MODEL_READ_ACCESS} ORDER BY m.created, m._id"
    );
    let models: Vec<AiModel> = sqlx::query_as(&query)
        .bind(user_id)
        .fetch_all(&mut *connection)
        .await?;
    models
        .into_iter()
        .map(AiModel::parse)
        .collect::<Result<_, _>>()
        .map_err(|_| {
            ApiError::bad_request(
                "Parsing failed for a row in webknossos.aiModels during list query",
            )
        })
}

/// DataStoreDAO.findOneByName with the user's access (onlyAllowedOrganization); returns the internal URL.
async fn find_data_store_url(
    connection: &mut PgConnection,
    user_id: &str,
    name: &str,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        r#"SELECT url FROM webknossos.dataStores_ WHERE name = $2 AND ((onlyAllowedOrganization IS NULL)
          OR (onlyAllowedOrganization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $1)))"#,
    )
    .bind(user_id)
    .bind(name)
    .fetch_optional(&mut *connection)
    .await?)
}

/// OrganizationDAO.findAll ids (organizations of the user's account, or all for superusers).
async fn accessible_organization_ids(
    connection: &mut PgConnection,
    user_id: &str,
) -> ApiResult<HashSet<String>> {
    let ids: Vec<String> = sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.organizations_ WHERE
          (_id IN (SELECT _organization FROM webknossos.users_ WHERE _multiUser =
            (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1)))
          OR TRUE IN (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN
            (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1))"#,
    )
    .bind(user_id)
    .fetch_all(&mut *connection)
    .await?;
    Ok(ids.into_iter().collect())
}

/// UserDAO.findOne with the requesting user's read access, then UserService.compactWrites.
async fn readable_compact_user(
    connection: &mut PgConnection,
    requesting_user_id: &str,
    user_id: &str,
) -> ApiResult<Option<Value>> {
    let query = format!(
        "SELECT usr._id FROM webknossos.users_ usr WHERE usr._id = $2 AND {}",
        users::READ_ACCESS_PREDICATE
    );
    let readable: Option<String> = sqlx::query_scalar(&query)
        .bind(requesting_user_id)
        .bind(user_id)
        .fetch_optional(&mut *connection)
        .await?;
    if readable.is_none() {
        return Ok(None);
    }
    Ok(sqlx::query_scalar(COMPACT_USER)
        .bind(user_id)
        .fetch_optional(&mut *connection)
        .await?)
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
        .ok_or_else(|| ApiError::bad_request("aiModel.noOrganization"))?;
    // DataStoreDAO.findOneByName with GlobalAccessContext.
    let url: String = sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ WHERE name = $1")
        .bind(&model.data_store)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    let base: String = clients
        .get_json(
            &url,
            &["data", "datasets", "getOneBaseDirForOrgaAbsolute"],
            &[("organizationId", organization.to_owned())],
        )
        .await?;
    let invalid = |_| ApiError::from(ServiceError::InvalidJson);
    let base = normalize_upath(&base).map_err(invalid)?;
    let models_dir = upath_join(&base, ".aiModels").map_err(invalid)?;
    upath_join(&models_dir, &model.id).map_err(invalid)
}

/// AiModelService.publicWrites with the requesting user's access context.
pub(crate) async fn model_public_writes(
    connection: &mut PgConnection,
    clients: &ServiceClients,
    user: &AuthUser,
    jobs_enabled: bool,
    model: &AiModel,
) -> ApiResult<Value> {
    find_data_store_url(connection, &user.id, &model.data_store)
        .await?
        .ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    // A user that cannot be read is rendered as null.
    let user_json = match &model.user_id {
        Some(user_id) => readable_compact_user(connection, &user.id, user_id).await?,
        None => None,
    };
    let data_store_json =
        public_datastore_json_on_connection(connection, &model.data_store, jobs_enabled).await?;
    // A training job that cannot be read (or parsed) is rendered as null.
    let training_job: Option<Job> = match &model.training_job {
        Some(job_id) => match jobs::find_job(connection, &user.id, job_id).await {
            Ok(job) => job,
            Err(error) if error.status == StatusCode::BAD_REQUEST => None,
            Err(error) => return Err(error),
        },
        None => None,
    };
    let training_job_json = match &training_job {
        Some(job) => Some(jobs::public_writes(connection, &user.id, job).await?),
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

/// `?~> Msg.AiModel.notFound ~> NOT_FOUND`: empty and parse failures become 404;
/// database errors stay errors.
async fn find_model_or_404(
    connection: &mut PgConnection,
    user_id: &str,
    model_id: &str,
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
    let model = find_model_or_404(&mut connection, &user.id, id.as_str()).await?;
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
    let model = find_model_or_404(&mut connection, &user.id, id.as_str()).await?;
    let store_url = find_data_store_url(&mut connection, &user.id, &model.data_store)
        .await?
        .ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    let (factor, unit) = find_model_voxel_size(connection, &clients, &store_url, &model).await?;
    Ok(ResponseJson(json!({"factor": factor, "unit": unit})))
}

/// AiModelService.findModelVoxelSize (and the same lookup in
/// inferenceBBoxToTargetMag): pretrained constants (nanometers), otherwise
/// `POST data/aiModels/effectiveVoxelSize` on the datastore at `store_url` for the
/// model path (with fallback). Returns (factor, unit).
async fn find_model_voxel_size(
    mut connection: sqlx::pool::PoolConnection<sqlx::Postgres>,
    clients: &ServiceClients,
    store_url: &str,
    model: &AiModel,
) -> ApiResult<([f64; 3], String)> {
    if model.is_pretrained {
        let factor = PRETRAINED_VOXEL_SIZES
            .iter()
            .find(|(pretrained_id, _)| *pretrained_id == model.id)
            .map(|(_, factor)| *factor)
            .ok_or_else(|| {
                ApiError::bad_request(format!(
                    "No voxel size known for pretrained model '{}'",
                    model.name
                ))
            })?;
        return Ok((factor, "nanometer".to_owned()));
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
    parse_voxel_size(&response).map_err(|_| ApiError::from(ServiceError::InvalidJson))
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
    sqlx::query("SELECT _id FROM webknossos.aiModels WHERE _id = $1 FOR UPDATE")
        .bind(id.as_str())
        .fetch_optional(&mut *tx)
        .await?;
    let model = find_model_or_404(&mut tx, &user.id, id.as_str()).await?;
    if model.organization.as_deref() != Some(user.organization_id.as_str()) {
        return Err(ApiError::bad_request(NOT_OWNED));
    }
    sqlx::query(
        "UPDATE webknossos.aiModels SET name = $1, comment = $2, modified = NOW() WHERE _id = $3",
    )
    .bind(&body.name)
    .bind(&body.comment)
    .bind(&model.id)
    .execute(&mut *tx)
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
            sqlx::query("DELETE FROM webknossos.aiModel_organizations WHERE _aiModel = $1")
                .bind(&model.id)
                .execute(&mut *tx)
                .await
                .map_err(write_failed(UPDATING_SHARED_FAILED))?;
            for organization in organizations {
                sqlx::query(
                    "INSERT INTO webknossos.aiModel_organizations (_aiModel, _organization) VALUES ($1, $2)",
                )
                .bind(&model.id)
                .bind(organization)
                .execute(&mut *tx)
                .await
                .map_err(write_failed(UPDATING_SHARED_FAILED))?;
            }
        }
    }
    tx.commit().await?;
    let mut connection = state.pool.acquire().await?;
    let updated = find_model_or_404(&mut connection, &user.id, id.as_str()).await?;
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
    sqlx::query("SELECT _id FROM webknossos.aiModels WHERE _id = $1 FOR UPDATE")
        .bind(id.as_str())
        .fetch_optional(&mut *tx)
        .await?;
    let references: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.aiInferences_ WHERE _aiModel = $1")
            .bind(id.as_str())
            .fetch_one(&mut *tx)
            .await?;
    if references != 0 {
        return Err(ApiError::bad_request(REFERENCED_BY_INFERENCES));
    }
    find_model_or_404(&mut tx, &user.id, id.as_str()).await?;
    sqlx::query("UPDATE webknossos.aiModels SET isDeleted = TRUE WHERE _id = $1")
        .bind(id.as_str())
        .execute(&mut *tx)
        .await?;
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
    id: &str,
    organization: &str,
    requested_prefix: Option<&str>,
) -> ApiResult<String> {
    let prefix = crate::dataset_upload_paths::select_path_prefix(config, requested_prefix)?;
    let invalid = |_| ApiError::bad_request("Invalid path.");
    let organization_dir = upath_join(&prefix, organization).map_err(invalid)?;
    let models_dir = upath_join(&organization_dir, ".aiModels").map_err(invalid)?;
    upath_join(&models_dir, id).map_err(invalid)
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
        return Err(ApiError::bad_request("Invalid JSON request body."));
    }
    let path_prefix = crate::dataset_upload_paths::parse_prefix(body.path_prefix.as_deref())?;
    let mut tx = state.pool.begin().await?;
    find_data_store_url(&mut tx, &user.id, &body.data_store_name)
        .await?
        .ok_or_else(|| ApiError::bad_request(DATA_STORE_NOT_FOUND))?;
    let model_id = match &body.existing_ai_model_id {
        Some(existing_id) => {
            sqlx::query("SELECT _id FROM webknossos.aiModels WHERE _id = $1 FOR UPDATE")
                .bind(existing_id.as_str())
                .fetch_optional(&mut *tx)
                .await?;
            let existing = find_model(&mut tx, &user.id, existing_id.as_str())
                .await?
                .ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
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
            sqlx::query(
                "UPDATE webknossos.aiModels SET path = $2, name = $3, comment = $4, modified = NOW() WHERE _id = $1",
            )
            .bind(&existing.id)
            .bind(&path)
            .bind(&body.name)
            .bind(&body.comment)
            .execute(&mut *tx)
            .await
            .map_err(name_write_failed(&body.name))?;
            existing.id
        }
        None => {
            // AiModelDAO.findOneByName(name).reverse: any model readable by the
            // user (also of other organizations or pretrained) blocks the name.
            let query = format!(
                "SELECT EXISTS (SELECT 1 FROM webknossos.aiModels_ m WHERE m.name = $2 AND {MODEL_READ_ACCESS})"
            );
            let taken: bool = sqlx::query_scalar(&query)
                .bind(&user.id)
                .bind(&body.name)
                .fetch_one(&mut *tx)
                .await?;
            if taken {
                return Err(ApiError::bad_request(name_taken(&body.name)));
            }
            let id = ObjectId::new().as_str().to_owned();
            let path =
                generate_model_path(&config, &id, &user.organization_id, path_prefix.as_deref())?;
            // AiModelDAO.insertOne writes no shared organizations; the owning
            // organization is implied.
            sqlx::query(
                r#"INSERT INTO webknossos.aiModels (_id, _organization, _dataStore, _user, _trainingJob, path,
                  uploadToPathIsPending, name, comment, category, created, modified, isDeleted, isSuperUserOnly, isPretrained)
                  VALUES ($1, $2, $3, $4, NULL, $5, TRUE, $6, $7, $8::webknossos.AI_MODEL_CATEGORY, NOW(), NOW(), FALSE, FALSE, FALSE)"#,
            )
            .bind(&id)
            .bind(&user.organization_id)
            .bind(&body.data_store_name)
            .bind(&user.id)
            .bind(&path)
            .bind(&body.name)
            .bind(&body.comment)
            .bind(&body.category)
            .execute(&mut *tx)
            .await
            .map_err(name_write_failed(&body.name))?;
            id
        }
    };
    tx.commit().await?;
    let mut connection = state.pool.acquire().await?;
    let model = find_model(&mut connection, &user.id, &model_id)
        .await?
        .ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
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
    sqlx::query("SELECT _id FROM webknossos.aiModels WHERE _id = $1 FOR UPDATE")
        .bind(id.as_str())
        .fetch_optional(&mut *tx)
        .await?;
    let model = find_model(&mut tx, &user.id, id.as_str())
        .await?
        .ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    if !model.upload_to_path_is_pending {
        return Err(ApiError::bad_request(FINISH_NOT_PENDING));
    }
    if model.organization.as_deref() != Some(user.organization_id.as_str()) {
        return Err(ApiError::forbidden(FINISH_WRONG_ORGA));
    }
    sqlx::query("UPDATE webknossos.aiModels SET uploadToPathIsPending = FALSE WHERE _id = $1")
        .bind(&model.id)
        .execute(&mut *tx)
        .await?;
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
        return Err(ApiError::bad_request(INVALID_BODY).into());
    }
    let instance_diameter_nm = match (kind, &body.instance_diameter_nm) {
        (TrainingKind::Neuron, _) | (_, None | Some(Value::Null)) => None,
        (TrainingKind::Instance, Some(Value::Number(number))) => number.as_f64(),
        (TrainingKind::Instance, Some(_)) => {
            return Err(ApiError::bad_request(INVALID_BODY).into());
        }
    };
    let generic_not_found = || Failure::with_status(NOT_FOUND, StatusCode::NOT_FOUND);

    // OrganizationDAO.findOne (global) ?~> Msg.Organization.notFound, then
    // OrganizationService.assertIsSuperUserOrOrganizationHasAiPlan.
    let ai_plan: Option<String> =
        sqlx::query_scalar("SELECT aiPlan::text FROM webknossos.organizations_ WHERE _id = $1")
            .bind(&user.organization_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| {
                Failure::new(format!(
                    "Organization “{}” could not be found or accessed.",
                    user.organization_id
                ))
            })?;
    if !user.is_superuser && ai_plan.is_none() {
        return Err(Failure::new(NO_AI_PLAN).into());
    }
    let annotations = &body.training_annotations;
    if annotations.is_empty() && body.workflow_yaml.is_none() {
        return Err(Failure::new(ZERO_TRAINING_ANNOTATIONS).into());
    }
    // headOption.toFox: a workflow without annotations is the empty Fox.
    let first = annotations.first().ok_or_else(generic_not_found)?;
    let annotation = annotation_access::find_optional(
        &state.pool,
        Some(user),
        first.annotation_id.as_str(),
        false,
    )
    .await?
    .ok_or_else(generic_not_found)?;
    let dataset = job_submission::find_readable_dataset(state, user, &annotation.dataset_id)
        .await?
        .ok_or_else(generic_not_found)?;
    if dataset.organization != user.organization_id {
        return Err(Failure::with_status(TRAIN_WRONG_ORGA, StatusCode::FORBIDDEN).into());
    }
    let (bounding_box, _) = job_submission::usable_data_source(state, &dataset)
        .await
        .map_err(|error| error.wrap(NO_BOUNDING_BOX))?;
    let data_store = dataset.data_store.trim().to_owned();
    {
        let mut connection = state.pool.acquire().await?;
        find_data_store_url(&mut connection, &user.id, &data_store)
            .await?
            .ok_or_else(|| Failure::new(DATA_STORE_NOT_FOUND))?;
    }
    for specification in annotations {
        annotation_access::find_optional(
            &state.pool,
            Some(user),
            specification.annotation_id.as_str(),
            false,
        )
        .await?
        .ok_or_else(|| Failure::new(ANNOTATION_NOT_FOUND))?;
    }
    // AiModelDAO.countByNameAndOrganization counts soft-deleted models, too.
    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.aiModels WHERE name = $1 AND _organization = $2",
    )
    .bind(&body.name)
    .bind(&user.organization_id)
    .fetch_one(&state.pool)
    .await?;
    if existing != 0 {
        return Err(Failure::new(name_taken(&body.name)).into());
    }

    let model_id = ObjectId::new().as_str().to_owned();
    let training_annotations: Vec<Value> = annotations
        .iter()
        .map(|specification| {
            json!({
                "annotationId": specification.annotation_id.as_str(),
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
        args.insert("instance_diameter_nm".into(), json!(instance_diameter_nm));
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
    let mut pending = job_submission::begin_paid_job(
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
    let job_id = pending.job_id().to_owned();
    // Instant.now has millisecond precision.
    let now = Utc::now();
    let created = DateTime::from_timestamp_millis(now.timestamp_millis()).unwrap_or(now);
    sqlx::query(
        r#"INSERT INTO webknossos.aiModels (_id, _organization, _dataStore, _user, _trainingJob, path,
          uploadToPathIsPending, name, comment, category, created, modified, isDeleted, isSuperUserOnly, isPretrained)
          VALUES ($1, $2, $3, $4, $5, NULL, TRUE, $6, $7, $8::webknossos.AI_MODEL_CATEGORY, $9, $9, FALSE, FALSE, FALSE)"#,
    )
    .bind(&model_id)
    .bind(&user.organization_id)
    .bind(&data_store)
    .bind(&user.id)
    .bind(&job_id)
    .bind(&body.name)
    .bind(&body.comment)
    .bind(&body.ai_model_category)
    .bind(created)
    .execute(pending.connection())
    .await
    .map_err(name_write_failed(&body.name))?;
    for specification in annotations {
        // Duplicate annotation ids violate the primary key; everything rolls
        // back (Scala fails after the job was already created).
        sqlx::query(
            "INSERT INTO webknossos.aiModel_trainingAnnotations (_aiModel, _annotation) VALUES ($1, $2)",
        )
        .bind(&model_id)
        .bind(specification.annotation_id.as_str())
        .execute(pending.connection())
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
    #[allow(dead_code)]
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
    let generic_not_found = || Failure::with_status(NOT_FOUND, StatusCode::NOT_FOUND);
    let dataset = job_submission::find_readable_dataset(state, user, body.dataset_id.as_str())
        .await?
        .ok_or_else(generic_not_found)?;
    if dataset.organization != user.organization_id {
        return Err(Failure::with_status(
            job_submission::INFERENCE_WRONG_ORGA,
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
            match find_model(&mut connection, &user.id, model_id.as_str()).await {
                Ok(Some(model)) => Some(model),
                Ok(None) => return Err(Failure::new(MODEL_NOT_FOUND).into()),
                Err(error) => {
                    return Err(job_submission::RunError::from(error).wrap(MODEL_NOT_FOUND));
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
        job_submission::data_source_and_layer(state, &dataset, &body.color_layer_name).await?;
    let mut connection = state.pool.acquire().await?;
    let store_url = find_data_store_url(&mut connection, &user.id, &data_store)
        .await?
        .ok_or_else(|| Failure::new(DATA_STORE_NOT_FOUND))?;
    crate::dataset_create::validate_dataset_name(&body.new_dataset_name)?;
    // BoundingBox.fromLiteral(..).toFox: the empty Fox.
    let mag1_bounding_box = job_submission::BoundingBox::from_literal(&body.bounding_box)
        .ok_or_else(generic_not_found)?;

    // AiModelService.inferenceBBoxToTargetMag (model voxel size via the dataset's datastore).
    let (model_factor, model_unit) =
        find_model_voxel_size(connection, clients, &store_url, &model).await?;
    let model_voxel_size_nm =
        model_factor.map(|component| component * nanometers_per_unit(&model_unit));
    let dataset_voxel_size_nm = dataset
        .voxel_size_in_nanometers()
        .ok_or_else(|| job_submission::RunError::Api(ApiError::internal()))?;
    let mags = job_submission::layer_mags(state, &dataset, &layer.name).await?;
    let target_mag = find_best_matching_mag(model_voxel_size_nm, dataset_voxel_size_nm, &mags)
        .ok_or_else(|| Failure::new(job_submission::NO_MAGS))?;
    let target_mag_bounding_box = mag1_bounding_box
        .divide(target_mag)
        .ok_or_else(|| job_submission::RunError::Api(ApiError::internal()))?;

    let model_id = body.ai_model_id.as_ref().map(ObjectId::as_str);
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
        args.insert(
            "annotation_id".into(),
            json!(body.annotation_id.as_ref().map(ObjectId::as_str)),
        );
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
                json!(body.eval_max_edge_length),
            );
            args.insert(
                "eval_sparse_tube_threshold_nm".into(),
                json!(body.eval_sparse_tube_threshold_nm),
            );
            args.insert(
                "eval_min_merger_path_length_nm".into(),
                json!(body.eval_min_merger_path_length_nm),
            );
            ("infer_neurons", "neuron")
        }
        InferenceKind::Instance => {
            args.insert(
                "seed_generator_distance_threshold".into(),
                json!(body.seed_generator_distance_threshold),
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
    let mut pending = job_submission::begin_paid_job(
        state,
        misc,
        jobs_enabled,
        user,
        &submission,
        target_mag_bounding_box,
        &comment,
        job_submission::INFERENCE_SUBMIT_FAILED,
    )
    .await?;
    let inference_id = ObjectId::new().as_str().to_owned();
    let job_id = pending.job_id().to_owned();
    // Instant.now has millisecond precision.
    let now = Utc::now();
    let created = DateTime::from_timestamp_millis(now.timestamp_millis()).unwrap_or(now);
    let annotation_id = body.annotation_id.as_ref().map(ObjectId::as_str);
    // An unknown annotation id violates the foreign key; everything rolls back
    // (Scala fails after the job was already created).
    sqlx::query(
        r#"INSERT INTO webknossos.aiInferences (_id, _organization, _aiModel, _newDataset, _annotation,
          _inferenceJob, boundingBox, newSegmentationLayerName, maskAnnotationLayerName, created, modified, isDeleted)
          VALUES ($1, $2, $3, NULL, $4, $5, ('(' || $6 || ')')::webknossos.BOUNDING_BOX, 'segmentation', $7, $8, $8, FALSE)"#,
    )
    .bind(&inference_id)
    .bind(&user.organization_id)
    .bind(&model.id)
    .bind(annotation_id)
    .bind(&job_id)
    .bind(mag1_bounding_box.to_literal())
    .bind(&body.mask_annotation_layer_name)
    .bind(created)
    .execute(pending.connection())
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
    pub id: String,
    pub ai_model: Option<String>,
    pub new_dataset: Option<String>,
    pub inference_job: String,
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
    let empty = || ApiError::not_found(NOT_FOUND);
    let job = jobs::find_job(connection, &user.id, &inference.inference_job)
        .await?
        .ok_or_else(empty)?;
    let job_json = jobs::public_writes(connection, &user.id, &job).await?;
    find_data_store_url(connection, &user.id, &job.data_store)
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
            let readable: bool = sqlx::query_scalar(&format!(
                "SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = $3 AND {})",
                dataset_access::READ_PREDICATE
            ))
            .bind(&user.id)
            .bind(None::<String>)
            .bind(dataset_id)
            .fetch_one(&mut *connection)
            .await?;
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
    // AiInferenceDAO.findAll has no ORDER BY; creation order is used for stability.
    let query = format!(
        "SELECT {INFERENCE_COLUMNS} FROM webknossos.aiInferences_ i WHERE {INFERENCE_READ_ACCESS} ORDER BY i.created, i._id"
    );
    let inferences: Vec<AiInference> = sqlx::query_as(&query)
        .bind(&user.id)
        .fetch_all(&mut *connection)
        .await?;
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
    let query = format!(
        "SELECT {INFERENCE_COLUMNS} FROM webknossos.aiInferences_ i WHERE i._id = $2 AND {INFERENCE_READ_ACCESS}"
    );
    let inference: AiInference = sqlx::query_as(&query)
        .bind(&user.id)
        .bind(id.as_str())
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| ApiError::not_found(INFERENCE_NOT_FOUND))?;
    Ok(ResponseJson(
        inference_public_writes(&mut connection, &clients, &user, jobs_enabled, &inference).await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(path: Option<&str>, organization: Option<&str>, shared: &[&str]) -> AiModel {
        AiModel {
            id: "576500000000000000000001".into(),
            organization: organization.map(str::to_owned),
            data_store: "store".into(),
            user_id: None,
            training_job: None,
            path: path.map(str::to_owned),
            upload_to_path_is_pending: false,
            name: "model".into(),
            comment: None,
            category: None,
            created: Utc::now(),
            is_super_user_only: false,
            is_pretrained: false,
            shared_organizations: shared.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    #[test]
    fn best_matching_mag_compares_x_on_a_log_scale_and_keeps_the_first_minimum() {
        let mags = [[1, 1, 1], [2, 2, 1], [4, 4, 2], [4, 4, 1], [8, 8, 4]];
        assert_eq!(
            find_best_matching_mag([4000.0, 1.0, 1.0], [1000.0, 9.0, 9.0], &mags),
            Some([4, 4, 2])
        );
        // 11 nm is closer to 8 than to 16 on a log scale (ratio 1.375 vs 1.45).
        assert_eq!(
            find_best_matching_mag([11.0, 0.0, 0.0], [4.0, 4.0, 4.0], &mags),
            Some([2, 2, 1])
        );
        assert_eq!(
            find_best_matching_mag([7.96, 7.96, 31.2], [1000.0, 1000.0, 1000.0], &mags),
            Some([1, 1, 1])
        );
        assert_eq!(find_best_matching_mag([1.0; 3], [1.0; 3], &[]), None);
    }

    #[test]
    fn parse_normalizes_path_and_appends_owner() {
        let parsed = model(Some("s3://bucket/a/../models"), Some("org"), &["a"])
            .parse()
            .unwrap();
        assert_eq!(parsed.path.as_deref(), Some("s3://bucket/models"));
        assert_eq!(parsed.shared_organizations, ["a", "org"]);
        let parsed = model(None, Some("org"), &["org", "z"]).parse().unwrap();
        assert_eq!(parsed.shared_organizations, ["org", "z"]);
        let parsed = model(None, None, &[]).parse().unwrap();
        assert!(parsed.shared_organizations.is_empty());
        assert!(model(Some("a|zip|zip"), None, &[]).parse().is_err());
    }
}
