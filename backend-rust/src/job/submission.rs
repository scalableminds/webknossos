//! JobController job submission (`POST /jobs/run/*`) with JobService.submitJob /
//! submitPaidJob: worker selection, storage quota, credit reservation and job
//! creation in one database transaction.
//!
//! Like Play, route parameters and request bodies are validated before the
//! request is authenticated. Failures inside a submission are wrapped by the
//! route's "Could not start …" message; the cause is reported in Play's `chain`
//! entry (see [`Failure`]).
use axum::{Router, routing::post};

use crate::AppState;

mod animation;
mod dataset_files;
mod export;
mod failure;
mod job_submission_dao;
mod lookups;
mod params;
mod processing;
mod service;

use animation::render_animation;
use dataset_files::{compute_mesh_file, compute_segment_index_file, find_largest_segment_id};
use export::{export_tiff, materialize_volume_annotation};
pub(crate) use failure::{Failure, RunError, RunResult};
pub(crate) use lookups::{
    data_source_and_layer, find_readable_dataset, layer_mags, usable_data_source,
};
pub(crate) use processing::{INFERENCE_SUBMIT_FAILED, INFERENCE_WRONG_ORGA};
use processing::{align_sections, infer_mitochondria};
pub(crate) use service::{
    Submission, assert_custom_configuration_allowed, begin_paid_job, submit_job,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/jobs/run/computeMeshFile/{datasetId}",
            post(compute_mesh_file),
        )
        .route(
            "/jobs/run/computeSegmentIndexFile/{datasetId}",
            post(compute_segment_index_file),
        )
        .route("/jobs/run/exportTiff/{datasetId}", post(export_tiff))
        .route(
            "/jobs/run/inferMitochondria/{datasetId}",
            post(infer_mitochondria),
        )
        .route("/jobs/run/alignSections/{datasetId}", post(align_sections))
        .route(
            "/jobs/run/materializeVolumeAnnotation/{datasetId}",
            post(materialize_volume_annotation),
        )
        .route(
            "/jobs/run/findLargestSegmentId/{datasetId}",
            post(find_largest_segment_id),
        )
        .route(
            "/jobs/run/renderAnimation/{datasetId}",
            post(render_animation),
        )
}

#[cfg(test)]
mod job_submission_tests;
