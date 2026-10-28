//! Mitochondria inference and section alignment jobs.
use axum::{
    Json,
    body::Bytes,
    extract::{State, rejection::BytesRejection},
    http::request::Parts,
};
use serde_json::json;

use super::params::{
    Params, authenticate, dataset_id, json_body, json_int, json_object_id, read_optional,
    read_string,
};
use super::service::{Submission, run_submission};
use super::{
    failure::{Failure, RunError, RunResult},
    lookups::{data_source_and_layer, find_dataset, own_organization},
};
use crate::{
    AppState,
    dataset::create::{validate_dataset_name, validate_layer_name_lax},
    error::ApiError,
    job::routes::JobCompactInfo,
    state::JobsEnabled,
    system::application_info::MiscState,
};
use webknossos_common::geometry::BoundingBox;

pub(crate) const INFERENCE_WRONG_ORGA: &str =
    "Running AI models is only allowed for datasets of your own organization.";
pub(crate) const INFERENCE_SUBMIT_FAILED: &str = "Could not start the AI inference job.";
const ALIGN_WRONG_ORGA: &str =
    "Aligning sections is only allowed for datasets of your own organization.";
const ALIGN_SUBMIT_FAILED: &str = "Could not start the section alignment job.";

pub(super) async fn infer_mitochondria(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    mut parts: Parts,
) -> RunResult<Json<JobCompactInfo>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let layer_name = params.required("layerName")?;
    let bbox = params.required("bbox")?;
    let new_dataset_name = params.required("newDatasetName")?;
    let user = authenticate(&parts, &state).await?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    own_organization(&state, &user, &dataset, INFERENCE_WRONG_ORGA).await?;
    validate_dataset_name(&new_dataset_name)?;
    validate_layer_name_lax(&layer_name)?;
    let (_, layer) = data_source_and_layer(&state, &dataset, &layer_name).await?;
    // `.toFox` on an empty Option: Play's generic 404.
    let not_found = || RunError::Api(ApiError::not_found(crate::msg::NOT_FOUND));
    let mag1_bounding_box = BoundingBox::from_literal(&bbox).ok_or_else(not_found)?;
    let target_mag = layer.finest_mag.ok_or_else(not_found)?;
    let target_bounding_box = mag1_bounding_box
        .checked_div_mag(target_mag.into())
        .ok_or_else(|| RunError::Api(ApiError::internal()))?;
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": dataset.organization,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "new_dataset_name": new_dataset_name,
        "layer_name": layer_name,
        "bbox": bbox,
    });
    let comment = format!(
        "Run for AI mitochondria segmentation for dataset {}",
        dataset.name
    );
    let submission = Submission {
        command: "infer_mitochondria",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        jobs_enabled,
        &user,
        submission,
        Some((target_bounding_box, comment)),
        INFERENCE_SUBMIT_FAILED,
    )
    .await
}

pub(super) async fn align_sections(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    mut parts: Parts,
    body: Result<Bytes, BytesRejection>,
) -> RunResult<Json<JobCompactInfo>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    // AlignSectionsJobOptions
    let body = json_body(&parts, body)?;
    let layer_name = read_string(&body, "layerName")?;
    let new_dataset_name = read_string(&body, "newDatasetName")?;
    let annotation_id = read_optional(&body, "annotationId", json_object_id)?;
    let custom_configuration = read_optional(&body, "customConfiguration", |value| {
        value.is_object().then(|| value.clone())
    })?;
    let fine_alignment_max_jump_size = read_optional(&body, "fineAlignmentMaxJumpSize", json_int)?;
    let user = authenticate(&parts, &state).await?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization = own_organization(&state, &user, &dataset, ALIGN_WRONG_ORGA).await?;
    validate_dataset_name(&new_dataset_name)?;
    validate_layer_name_lax(&layer_name)?;
    let not_usable = crate::msg::dataset::not_usable(&dataset.id);
    let (data_source_box, layer) = data_source_and_layer(&state, &dataset, &layer_name)
        .await
        .map_err(|error| error.wrap(&not_usable))?;
    let layer_mag = layer
        .finest_mag
        .ok_or_else(|| Failure::new(crate::msg::dataset::NO_MAGS))?;
    let finest_mag_box = data_source_box
        .checked_div_mag(layer_mag.into())
        .ok_or_else(|| RunError::Api(ApiError::internal()))?;
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": organization,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "new_dataset_name": new_dataset_name,
        "layer_name": layer_name,
        "annotation_id": annotation_id,
        "custom_configuration": custom_configuration,
        "fine_alignment_max_jump_size": fine_alignment_max_jump_size,
    });
    let comment = format!("Align dataset {}", dataset.name);
    let submission = Submission {
        command: "align_sections",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        jobs_enabled,
        &user,
        submission,
        Some((finest_mag_box, comment)),
        ALIGN_SUBMIT_FAILED,
    )
    .await
}
