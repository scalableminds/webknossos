//! Jobs computing files for a dataset: mesh files, segment index files and the largest segment id.
use axum::{Json, extract::State, http::request::Parts};
use serde_json::json;

use super::{
    failure::RunResult,
    lookups::{find_dataset, own_organization},
    params::{Params, authenticate, dataset_id},
    service::{Submission, run_submission},
};
use crate::{
    AppState, dataset::create::validate_layer_name_lax, job::routes::JobCompactInfo,
    state::JobsEnabled, system::application_info::MiscState,
};

/// Per-route messages: Msg.Job.<Route>.wrongOrga and submitFailed.
const MESH_WRONG_ORGA: &str =
    "Computing mesh files is only allowed for datasets of your own organization.";
pub(super) const MESH_SUBMIT_FAILED: &str = "Could not start mesh file computation job.";
const SEGMENT_INDEX_WRONG_ORGA: &str =
    "Computing segment index files is only allowed for datasets of your own organization.";
const SEGMENT_INDEX_SUBMIT_FAILED: &str = "Could not start segment index file computation job.";

const LARGEST_SEGMENT_WRONG_ORGA: &str =
    "Finding the largest segment id is only allowed for datasets of your own organization.";
const LARGEST_SEGMENT_SUBMIT_FAILED: &str = "Could not start find largest segment id job.";

pub(super) async fn compute_mesh_file(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    mut parts: Parts,
) -> RunResult<Json<JobCompactInfo>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let layer_name = params.required("layerName")?;
    let mag = params.required("mag")?;
    let agglomerate_view = params.optional("agglomerateView");
    let user = authenticate(&parts, &state).await?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization = own_organization(&state, &user, &dataset, MESH_WRONG_ORGA).await?;
    validate_layer_name_lax(&layer_name)?;
    let args = json!({
        "organization_id": organization,
        "dataset_name": dataset.name,
        "dataset_id": dataset.id,
        "dataset_directory_name": dataset.directory_name,
        "layer_name": layer_name,
        "mag": mag,
        "agglomerate_view": agglomerate_view,
    });
    let submission = Submission {
        command: "compute_mesh_file",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        jobs_enabled,
        &user,
        submission,
        None,
        MESH_SUBMIT_FAILED,
    )
    .await
}

pub(super) async fn compute_segment_index_file(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    mut parts: Parts,
) -> RunResult<Json<JobCompactInfo>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let layer_name = params.required("layerName")?;
    let user = authenticate(&parts, &state).await?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    own_organization(&state, &user, &dataset, SEGMENT_INDEX_WRONG_ORGA).await?;
    validate_layer_name_lax(&layer_name)?;
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": dataset.organization,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "segmentation_layer_name": layer_name,
    });
    let submission = Submission {
        command: "compute_segment_index_file",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        jobs_enabled,
        &user,
        submission,
        None,
        SEGMENT_INDEX_SUBMIT_FAILED,
    )
    .await
}

pub(super) async fn find_largest_segment_id(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    mut parts: Parts,
) -> RunResult<Json<JobCompactInfo>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let layer_name = params.required("layerName")?;
    let user = authenticate(&parts, &state).await?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization =
        own_organization(&state, &user, &dataset, LARGEST_SEGMENT_WRONG_ORGA).await?;
    validate_layer_name_lax(&layer_name)?;
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": organization,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "layer_name": layer_name,
    });
    let submission = Submission {
        command: "find_largest_segment_id",
        args,
        data_store: &dataset.data_store,
    };
    run_submission(
        &state,
        &misc,
        jobs_enabled,
        &user,
        submission,
        None,
        LARGEST_SEGMENT_SUBMIT_FAILED,
    )
    .await
}
