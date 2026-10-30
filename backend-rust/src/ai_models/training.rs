//! AI model training submission.

use axum::{Json as ResponseJson, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    error::ApiError,
    extract::Json,
    job::submission::{Failure, RunResult, Submission},
    state::JobsEnabled,
    stores::client::ServiceClients,
    system::application_info::MiscState,
    util::id::ObjectId,
};
use webknossos_common::json::play_f64_value;

use super::{
    ai_models_dao,
    service::{AiModel, CATEGORIES, model_public_writes, name_taken, name_write_failed},
};

const NO_AI_PLAN: &str = "Only organizations with an AI plan can start this job.";
const ZERO_TRAINING_ANNOTATIONS: &str = "Need at least one training annotation for model training.";
const TRAIN_WRONG_ORGA: &str =
    "Training AI models is only allowed for datasets of your own organization.";
const TRAIN_SUBMIT_FAILED: &str = "Could not start the AI model training job.";
const NO_BOUNDING_BOX: &str =
    "Dataset has no bounding box. Please make sure this dataset is imported correctly.";

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
pub(super) struct RunModelTrainingParameters {
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

pub(super) async fn run_neuron_model_training(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(misc): State<MiscState>,
    State(clients): State<ServiceClients>,
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

pub(super) async fn run_instance_model_training(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(misc): State<MiscState>,
    State(clients): State<ServiceClients>,
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
    let ai_plan: Option<String> = ai_models_dao::find_ai_plan(&state.pool, &user.organization_id)
        .await?
        .ok_or_else(|| Failure::new(crate::msg::organization::not_found(&user.organization_id)))?;
    if !user.is_superuser && ai_plan.is_none() {
        return Err(Failure::new(NO_AI_PLAN).into());
    }
    crate::job::submission::assert_custom_configuration_allowed(
        body.custom_configuration.as_ref(),
        user,
    )?;
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
        ai_models_dao::find_data_store_url_for_user(&mut connection, &user.id, &data_store)
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
    let existing = ai_models_dao::count_by_name_and_organization(
        &state.pool,
        &body.name,
        &user.organization_id,
    )
    .await?;
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
    ai_models_dao::insert_one_for_training(
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
        ai_models_dao::insert_training_annotation(
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
