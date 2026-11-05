//! AI model inference submission.

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
use webknossos_common::{geometry::BoundingBox, json::play_f64_value};

use super::{
    ai_models_dao,
    service::{
        AiInference, MODEL_NOT_FOUND, find_model, find_model_voxel_size, inference_public_writes,
    },
};

const DATA_STORE_MISMATCH: &str = "Cannot use AI model on a dataset on a different data store.";
/// Not a message key in Play's messages: rendered verbatim.
const MODEL_REQUIRED: &str = "aiModel.required";
const AFFINITY_THRESHOLD_KEY: &str = "tasks.segment.config.segmenter.absolute_affinity_threshold";

/// RunInferenceParameters (`boundingBox` is a mag1 literal; `workflowYaml` is
/// bound but unused, as in Scala).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RunInferenceParameters {
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
    absolute_affinity_threshold: Option<f64>,
    custom_configuration: Option<Map<String, Value>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum InferenceKind {
    Neuron,
    Instance,
}

pub(super) async fn run_neuron_model_inference(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(misc): State<MiscState>,
    State(clients): State<ServiceClients>,
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

pub(super) async fn run_instance_model_inference(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(misc): State<MiscState>,
    State(clients): State<ServiceClients>,
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

/// The `custom_configuration` job argument. Neuron inference passes the affinity
/// threshold to the worker as a regular config override; explicit (super user)
/// overrides of the same key take precedence.
pub(super) fn custom_configuration(
    absolute_affinity_threshold: Option<f64>,
    custom_configuration: Option<Map<String, Value>>,
) -> Value {
    let affinity_threshold_override = absolute_affinity_threshold.map(|threshold| {
        Map::from_iter([(AFFINITY_THRESHOLD_KEY.to_owned(), play_f64_value(threshold))])
    });
    match (affinity_threshold_override, custom_configuration) {
        (None, None) => Value::Null,
        (Some(configuration), None) | (None, Some(configuration)) => Value::Object(configuration),
        (Some(mut configuration), Some(overrides)) => {
            configuration.extend(overrides);
            Value::Object(configuration)
        }
    }
}

/// AiModelService.findBestMatchingMag: the first mag whose x voxel size (dataset
/// voxel size times mag, in nm) is closest to the model's on a log scale.
pub(super) fn find_best_matching_mag(
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
    let store_url =
        ai_models_dao::find_data_store_url_for_user(&mut connection, &user.id, &data_store)
            .await?
            .ok_or_else(|| Failure::new(crate::msg::data_store::NOT_FOUND))?;
    crate::dataset::create::validate_dataset_name(&body.new_dataset_name)?;
    crate::job::submission::assert_custom_configuration_allowed(
        body.custom_configuration.as_ref(),
        user,
    )?;
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
    let custom_configuration = custom_configuration(
        body.absolute_affinity_threshold
            .filter(|_| kind == InferenceKind::Neuron),
        body.custom_configuration.clone(),
    );
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
    ai_models_dao::insert_one_inference(
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
