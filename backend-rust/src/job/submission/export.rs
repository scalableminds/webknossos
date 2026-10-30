//! TIFF export and volume annotation materialization jobs.
use axum::{Json, extract::State, http::request::Parts};
use chrono::Local;
use serde_json::{Value, json};

use super::lookups::{
    find_dataset, find_organization, organization_base_directory, own_organization,
};
use super::params::{
    Params, assert_bounding_box_limits, authenticate, dataset_id, format_date_for_filename,
    json_int, to_wk_libs_json,
};
use super::service::{Submission, run_submission};
use super::{
    failure::{Failure, RunResult},
    job_submission_dao::{self},
};
use crate::{
    AppState,
    dataset::create::{validate_dataset_name, validate_layer_name_lax},
    job::routes::JobCompactInfo,
    state::JobsEnabled,
    stores::client::ServiceClients,
    system::application_info::MiscState,
};
use webknossos_common::geometry::BoundingBox;

const INVALID_BOUNDING_BOX: &str =
    "The selected bounding box could not be parsed, must be x,y,z,width,height,depth.";

const INVALID_EXPORT_FORMAT: &str =
    "Invalid export format. Must be one of ome_tiff, tiff_stack, ozx.";
const INVALID_ADDITIONAL_COORDINATES: &str = "Invalid additional coordinates for this data layer.";

const EXPORT_SUBMIT_FAILED: &str = "Could not start data export job.";
const MATERIALIZE_WRONG_ORGA: &str =
    "Materializing volume annotations is only allowed for datasets of your own organization.";
const MATERIALIZE_SUBMIT_FAILED: &str = "Could not start the materialize volume annotation job.";

/// AdditionalCoordinate list (JsonHelper.parseAs[Seq[AdditionalCoordinate]]).
pub(super) fn parse_additional_coordinates(text: &str) -> Result<Vec<(String, i32)>, &'static str> {
    let value: Value = serde_json::from_str(text).map_err(|_| "Failed to parse json")?;
    let invalid = "Failed to validate json against schema";
    let array = value.as_array().ok_or(invalid)?;
    array
        .iter()
        .map(|coordinate| {
            let object = coordinate.as_object().ok_or(invalid)?;
            let name = object.get("name").and_then(Value::as_str).ok_or(invalid)?;
            let value = object.get("value").and_then(json_int).ok_or(invalid)?;
            match object.get("length") {
                None | Some(Value::Null) => {}
                Some(length) if json_int(length).is_some() => {}
                Some(_) => return Err(invalid),
            }
            Ok((name.to_owned(), value))
        })
        .collect()
}

pub(super) async fn export_tiff(
    State(state): State<AppState>,
    State(clients): State<ServiceClients>,
    State(misc): State<MiscState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    mut parts: Parts,
) -> RunResult<Json<JobCompactInfo>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let bbox = params.required("bbox")?;
    let additional_coordinates = params.optional("additionalCoordinates");
    let layer_name = params.optional("layerName");
    let mag = params.optional("mag");
    let annotation_layer_name = params.optional("annotationLayerName");
    let annotation_id = params.optional_object_id("annotationId")?;
    let export_format = params.required("exportFormat")?;
    let user = authenticate(&parts, &state).await?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let dataset_organization = find_organization(&state, &dataset.organization).await?;
    if let Some(layer_name) = &layer_name {
        validate_layer_name_lax(layer_name)?;
    }
    if let Some(annotation_layer_name) = &annotation_layer_name {
        validate_layer_name_lax(annotation_layer_name)?;
    }
    let file_extension = match export_format.as_str() {
        "ome_tiff" => "ome.tif",
        "tiff_stack" => "zip",
        "ozx" => "ozx",
        _ => return Err(Failure::new(INVALID_EXPORT_FORMAT).into()),
    };
    assert_bounding_box_limits(&misc, &bbox, mag.as_deref())?;
    // DatasetLayerAdditionalAxesDAO + Zarr3OutputHelper.reorderAdditionalAxes:
    // sorted by index and renumbered after the channel axis.
    let additional_axes: Vec<(String, i32, i32)> = match &layer_name {
        Some(layer_name) => {
            job_submission_dao::find_additional_axes(&state.pool, &dataset.id, layer_name).await?
        }
        None => Vec::new(),
    };
    let rank = i32::try_from(additional_axes.len()).unwrap_or(i32::MAX - 4) + 4;
    let three_d_box =
        BoundingBox::from_literal(&bbox).ok_or_else(|| Failure::new(INVALID_BOUNDING_BOX))?;
    let coordinates = additional_coordinates
        .as_deref()
        .map(parse_additional_coordinates)
        .transpose()
        .map_err(|cause| Failure::new(cause).wrap(INVALID_ADDITIONAL_COORDINATES))?
        .unwrap_or_default();
    // AdditionalAxis.intersectWithAdditionalCoordinates: width-1 bounds at the
    // requested coordinate, else at the lower bound.
    let axes_json: Vec<Value> = additional_axes
        .iter()
        .zip(1..)
        .map(
            |((name, lower_bound, _), index): (&(String, i32, i32), i32)| {
                let start = coordinates
                    .iter()
                    .find(|(coordinate, _)| coordinate == name)
                    .map_or(*lower_bound, |(_, value)| *value);
                json!({"name": name, "bounds": [start, start.wrapping_add(1)], "index": index})
            },
        )
        .collect();
    let mut nd_bbox = to_wk_libs_json(three_d_box);
    nd_bbox.insert("additionalAxes".into(), Value::Array(axes_json));
    nd_bbox.insert(
        "axisOrder".into(),
        json!({"x": rank - 3, "y": rank - 2, "z": rank - 1}),
    );
    let base_directory = organization_base_directory(&state, &clients, &user, &dataset).await?;
    let layer_label = if annotation_layer_name.is_some() {
        "volume"
    } else {
        layer_name.as_deref().unwrap_or_default()
    };
    let export_file_name = format!(
        "{}__{}__{layer_label}.{file_extension}",
        format_date_for_filename(Local::now()),
        dataset.name
    );
    let args = json!({
        "dataset_id": dataset.id,
        "dataset_directory_name": dataset.directory_name,
        "organization_id": dataset_organization,
        "user_organization_base_directory": base_directory,
        "dataset_name": dataset.name,
        "nd_bbox": nd_bbox,
        "export_file_name": export_file_name,
        "export_format": export_format,
        "layer_name": layer_name,
        "mag": mag,
        "annotation_layer_name": annotation_layer_name,
        "annotation_id": annotation_id,
    });
    let submission = Submission {
        command: "export_tiff",
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
        EXPORT_SUBMIT_FAILED,
    )
    .await
}

pub(super) async fn materialize_volume_annotation(
    State(state): State<AppState>,
    State(clients): State<ServiceClients>,
    State(misc): State<MiscState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    mut parts: Parts,
) -> RunResult<Json<JobCompactInfo>> {
    let dataset_id = dataset_id(&mut parts, &state).await?;
    let params = Params::from_parts(&parts)?;
    let fallback_layer_name = params.required("fallbackLayerName")?;
    let annotation_id = params.object_id("annotationId")?;
    let annotation_type = params.required("annotationType")?;
    let new_dataset_name = params.required("newDatasetName")?;
    let output_segmentation_layer_name = params.required("outputSegmentationLayerName")?;
    let merge_segments = params.boolean("mergeSegments")?;
    let volume_layer_name = params.optional("volumeLayerName");
    let includes_editable_mapping = params.boolean("includesEditableMapping")?;
    let bounding_box = params.optional("boundingBox");
    let user = authenticate(&parts, &state).await?;
    let dataset = find_dataset(&state, &user, &dataset_id).await?;
    let organization = own_organization(&state, &user, &dataset, MATERIALIZE_WRONG_ORGA).await?;
    validate_layer_name_lax(&fallback_layer_name)?;
    validate_dataset_name(&new_dataset_name)?;
    validate_layer_name_lax(&output_segmentation_layer_name)?;
    let base_directory = organization_base_directory(&state, &clients, &user, &dataset).await?;
    if !user.is_superuser
        && includes_editable_mapping
        && let Some(bounding_box) = &bounding_box
    {
        assert_bounding_box_limits(&misc, bounding_box, None)?;
    }
    let args = json!({
        "dataset_id": dataset.id,
        "organization_id": organization,
        "organization_base_directory": base_directory,
        "dataset_name": dataset.name,
        "dataset_directory_name": dataset.directory_name,
        "fallback_layer_name": fallback_layer_name,
        "annotation_id": annotation_id,
        "output_segmentation_layer_name": output_segmentation_layer_name,
        "annotation_type": annotation_type,
        "new_dataset_name": new_dataset_name,
        "merge_segments": merge_segments,
        "volume_layer_name": volume_layer_name,
        "use_zarr_streaming": includes_editable_mapping,
        "bounding_box": bounding_box,
    });
    let submission = Submission {
        command: "materialize_volume_annotation",
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
        MATERIALIZE_SUBMIT_FAILED,
    )
    .await
}
