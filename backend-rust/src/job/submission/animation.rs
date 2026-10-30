//! Render animation jobs.
use axum::{
    Json,
    body::Bytes,
    extract::{State, rejection::BytesRejection},
    http::{StatusCode, request::Parts},
};
use chrono::Local;
use serde_json::{Map, Value, json};

use super::params::{
    authenticate, dataset_id, format_date_for_filename, invalid_body, json_body, json_object_id,
    optional_json, read_bool, read_enum, read_optional, read_string,
};
use super::service::{Submission, run_submission};
use super::{
    failure::{Failure, RunError, RunResult},
    job_submission_dao::{self},
    lookups::{find_dataset, find_organization, organization_base_directory},
};
use crate::{
    AppState, dataset::create::validate_layer_name_lax, error::ApiError,
    job::routes::JobCompactInfo, state::JobsEnabled, stores::client::ServiceClients,
    system::application_info::MiscState, util::id::ObjectId,
};
use webknossos_common::geometry::{BoundingBox, Vec3Int};

const SUPER_USER_ONLY: &str = "Only super users can perform this action.";
const MUST_INCLUDE_WATERMARK: &str =
    "Render animation jobs for free plans must include the WEBKNOSSOS watermark.";
const RESOLUTION_MUST_BE_SD: &str = "Render animation jobs for free plans must use SD resolution.";

const ANIMATION_SUBMIT_FAILED: &str = "Could not start render animation job.";

/// AnimationJobOptions (JsonAutoFormat).
struct AnimationOptions {
    layer_name: String,
    bounding_box: BoundingBox,
    include_watermark: bool,
    meshes: Value,
    movie_resolution: String,
    movie_duration: String,
    camera_position: String,
    mag_for_textures: Vec3Int,
    annotation_id: Option<ObjectId>,
    include_skeletons: bool,
    hide_image_data: bool,
    save_blender_file: bool,
    segmentation_layer_name: Option<String>,
}

fn read_animation_options(body: &Map<String, Value>) -> RunResult<AnimationOptions> {
    Ok(AnimationOptions {
        layer_name: read_string(body, "layerName")?,
        bounding_box: body
            .get("boundingBox")
            .and_then(|value| BoundingBox::from_json(value).ok())
            .ok_or_else(invalid_body)?,
        include_watermark: read_bool(body, "includeWatermark")?,
        meshes: body.get("meshes").cloned().ok_or_else(invalid_body)?,
        movie_resolution: read_enum(body, "movieResolution", &["SD", "HD"])?,
        movie_duration: read_enum(body, "movieDuration", &["SHORT", "STANDARD", "LONG"])?,
        camera_position: read_enum(
            body,
            "cameraPosition",
            &[
                "MOVING",
                "STATIC_ISOMETRIC",
                "STATIC_XY",
                "STATIC_XZ",
                "STATIC_YZ",
            ],
        )?,
        mag_for_textures: body
            .get("magForTextures")
            .and_then(|value| Vec3Int::from_json(value).ok())
            .ok_or_else(invalid_body)?,
        annotation_id: read_optional(body, "annotationId", json_object_id)?,
        include_skeletons: read_bool(body, "includeSkeletons")?,
        hide_image_data: read_bool(body, "hideImageData")?,
        save_blender_file: read_bool(body, "saveBlenderFile")?,
        segmentation_layer_name: read_optional(body, "segmentationLayerName", |value| {
            value.as_str().map(str::to_owned)
        })?,
    })
}

pub(super) async fn render_animation(
    State(state): State<AppState>,
    State(clients): State<ServiceClients>,
    State(misc): State<MiscState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    mut parts: Parts,
    body: Result<Bytes, BytesRejection>,
) -> RunResult<Json<JobCompactInfo>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let body = json_body(&parts, body)?;
    let options = read_animation_options(&body)?;
    let user = authenticate(&parts, &state).await?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization = find_organization(&state, &dataset.organization).await?;
    let pricing_plan: String =
        job_submission_dao::find_pricing_plan(&state.pool, &user.organization_id)
            .await?
            .ok_or_else(|| RunError::Api(ApiError::not_found(crate::msg::NOT_FOUND)))?;
    // PricingPlan.isPaidPlan: everything but Personal.
    if pricing_plan == "Personal" {
        if !options.include_watermark {
            return Err(Failure::new(MUST_INCLUDE_WATERMARK).into());
        }
        if options.movie_resolution != "SD" {
            return Err(Failure::new(RESOLUTION_MUST_BE_SD).into());
        }
    }
    if options.save_blender_file && !user.is_superuser {
        return Err(Failure::new(SUPER_USER_ONLY)
            .wrap(crate::msg::NOT_ALLOWED)
            .with_param(StatusCode::FORBIDDEN)
            .into());
    }
    validate_layer_name_lax(&options.layer_name)?;
    if let Some(segmentation_layer_name) = &options.segmentation_layer_name {
        validate_layer_name_lax(segmentation_layer_name)?;
    }
    let base_directory = organization_base_directory(&state, &clients, &user, &dataset).await?;
    let export_file_name = format!(
        "webknossos_animation_{}__{}__{}.mp4",
        format_date_for_filename(Local::now()),
        dataset.name,
        options.layer_name
    );
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": organization,
        "user_organization_base_directory": base_directory,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "export_file_name": export_file_name,
        "layer_name": options.layer_name,
        "segmentation_layer_name": optional_json(options.segmentation_layer_name),
        "bounding_box": options.bounding_box.to_literal(),
        "include_watermark": options.include_watermark,
        "meshes": options.meshes,
        "movie_resolution": options.movie_resolution,
        "movie_duration": options.movie_duration,
        "camera_position": options.camera_position,
        "mag_for_textures": options.mag_for_textures,
        "annotation_id": options.annotation_id,
        "include_skeletons": options.include_skeletons,
        "hide_image_data": options.hide_image_data,
        "save_blender_file": options.save_blender_file,
    });
    let submission = Submission {
        command: "render_animation",
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
        ANIMATION_SUBMIT_FAILED,
    )
    .await
}
