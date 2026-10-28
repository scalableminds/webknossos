//! `AiModelService` and `AiInferenceService`: model and inference rows and their serializers.
use std::collections::HashSet;

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::PgConnection;

use crate::{
    auth::AuthUser,
    dataset::routes::{full_json_on_connection, public_datastore_on_connection},
    dataset::source::VoxelSize,
    error::{ApiError, ApiResult},
    job::routes::Job,
    stores::client::{ServiceClients, ServiceError},
    util::id::ObjectId,
};
use webknossos_common::{geometry::Vec3Double, upath::UPath};

use super::ai_models_dao;

pub(super) const MODEL_NOT_FOUND: &str = "Could not find requested AI model.";

/// Msg.AiModel.nameTaken.
pub(super) fn name_taken(name: &str) -> String {
    format!("An AI model with the name “{name}” already exists. Please choose a different name.")
}

/// AiModelCategory values (webknossos.AI_MODEL_CATEGORY).
pub(super) const CATEGORIES: [&str; 8] = [
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
pub(super) const PRETRAINED_VOXEL_SIZES: [(&str, [f64; 3]); 4] = [
    ("576500000000000000000001", [7.96, 7.96, 31.2]),
    ("576500000000000000000002", [7.96, 7.96, 31.2]),
    ("576500000000000000000003", [179.84, 179.84, 224.0]),
    ("576500000000000000000004", [179.84, 179.84, 224.0]),
];

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
    pub(super) fn parse(mut self) -> Result<Self, ()> {
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
pub(super) async fn find_model(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    model_id: &ObjectId,
) -> ApiResult<Option<AiModel>> {
    let model = ai_models_dao::find_one(connection, user_id, model_id).await?;
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
pub(super) async fn list_all_models(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<Vec<AiModel>> {
    let models = ai_models_dao::find_all(connection, user_id).await?;
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
pub(super) async fn accessible_organization_ids(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<HashSet<String>> {
    let ids = ai_models_dao::find_all_accessible_organization_ids(connection, user_id).await?;
    Ok(ids.into_iter().collect())
}

/// UserDAO.findOne with the requesting user's read access, then UserService.compactWrites.
pub(super) async fn readable_compact_user(
    connection: &mut PgConnection,
    requesting_user_id: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<Option<Value>> {
    let readable =
        ai_models_dao::find_readable_user_id(connection, requesting_user_id, user_id).await?;
    if readable.is_none() {
        return Ok(None);
    }
    Ok(ai_models_dao::find_compact_user(connection, user_id).await?)
}

/// AiModelService.pathWithFallback: the stored path, or the legacy
/// `<organization base dir on the datastore>/.aiModels/<id>`.
pub(super) async fn path_with_fallback(
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
    let url = crate::job::job_dao::find_data_store_url(&mut *connection, &model.data_store)
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
pub(super) async fn model_public_writes(
    connection: &mut PgConnection,
    clients: &ServiceClients,
    user: &AuthUser,
    jobs_enabled: bool,
    model: &AiModel,
) -> ApiResult<Value> {
    ai_models_dao::find_data_store_url_for_user(connection, &user.id, &model.data_store)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    // A user that cannot be read is rendered as null.
    let user_json = match &model.user_id {
        Some(user_id) => readable_compact_user(connection, &user.id, user_id).await?,
        None => None,
    };
    let data_store_json =
        public_datastore_on_connection(connection, &model.data_store, jobs_enabled).await?;
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
pub(super) async fn find_model_or_404(
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

/// AiModelService.findModelVoxelSize (and the same lookup in
/// inferenceBBoxToTargetMag): pretrained constants (nanometers), otherwise
/// `POST data/aiModels/effectiveVoxelSize` on the datastore at `store_url` for the
/// model path (with fallback).
pub(super) async fn find_model_voxel_size(
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

/// Unique (_organization, name) violations (also by soft-deleted models, which
/// Scala reports as a generic SQL failure) are reported as Msg.AiModel.nameTaken.
pub(super) fn name_write_failed(name: &str) -> impl Fn(sqlx::Error) -> ApiError + '_ {
    move |error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => {
            ApiError::bad_request(name_taken(name))
        }
        _ => ApiError::from(error),
    }
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
pub(super) async fn inference_public_writes(
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
    ai_models_dao::find_data_store_url_for_user(connection, &user.id, &job.data_store)
        .await?
        .ok_or_else(empty)?;
    let data_store_json =
        public_datastore_on_connection(connection, &job.data_store, jobs_enabled).await?;
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
            let readable =
                ai_models_dao::is_dataset_readable(connection, &user.id, dataset_id).await?;
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
