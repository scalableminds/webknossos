//! TaskController.createFromFiles (`POST /tasks/createFromFiles`): one task
//! per uploaded base annotation (NML, or zip with NMLs and volume data).
//!
//! Multipart body: file parts (only names ending in `.nml`/`.zip`,
//! case-insensitive, are used) and the data part `formJSON` holding
//! `NmlTaskParameters` (`taskTypeId`, `neededExperience`, `pendingInstances`,
//! `projectName`, optional `scriptId`, optional `boundingBox`).
//!
//! Scala order (whole-request failures): 401 → multipart body
//! (`multipartPayloadInvalid`, 400) → at least one input file
//! (`Nml.fileNotFound`, 400) → `formJSON` present (`formJsonMissing`, 400) →
//! parameters parse (`Task.Create.failed`, 400) → task type readable
//! (`TaskType.notFound ~> 404`) → batch limit over the number of uploaded
//! files → project by name in the user's organization (`Project.notFound ~>
//! 404`) → `Fox.assertTrue(isTeamManagerOrAdminOf(user, project._team))`
//! (missing team → `Team.adminNotAllowed` 400, false → Fox.empty 404) →
//! extraction (`extractFromFiles`, `useZipName=false`, `isTaskUpload=true`)
//! → `toBoxes` → addVolumeFallbackBoundingBoxes → buildFullParamsFromFiles →
//! new ids → fillInMissingTracings → combineParamsWithTracings →
//! [`create_tasks`]. Files that fail to parse become failed task items
//! (skeleton/volume task types); for hybrid task types any failed file fails
//! the whole request (Scala `Fox.serialCombined` in fillInMissingTracings).
//!
//! Body limit: Play buffers multipart files on disk up to `maxDiskBuffer =
//! 1G` (application.conf), so this router raises the crate-wide default body
//! limit to 1 GiB for this route only. Unlike Play, the parts are held in
//! memory.
use std::collections::HashMap;

use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Multipart, State, multipart::MultipartRejection},
    http::StatusCode,
    routing::post,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;

use crate::{
    AppState,
    annotation_create::{self, DatasetFacts, UsableSource},
    annotation_provider::ProviderError,
    annotation_sandbox::dataset_not_found,
    annotation_upload_service::{
        ExtractionLimits, MSG_FILE_NOT_FOUND, PgDatasetLookup, TracingBoxContainer,
        extract_from_files,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    id::ObjectId,
    nml_parser::SharedParsingParameters,
    proto::BoundingBoxProto,
    task_creation::{
        BoundingBox, CreationServices, Experience, RequestedTask, RequestedTaskResult, TaskFailure,
        TaskParameters, TaskTypeFacts, TracingType, VolumeBase, add_new_ids, assert_batch_limit,
        create_tasks, find_project, find_readable_dataset, find_task_type, project_not_found,
        skeleton_tracing_base, task_type_not_found, volume_tracing_base,
    },
    tracing_initialization::data_source_bounding_box,
};

/// Play `parser.maxDiskBuffer` (multipart files).
const PLAY_MAX_DISK_BUFFER: usize = 1024 * 1024 * 1024;

const MULTIPART_PAYLOAD_INVALID: &str = "Could not parse task creation multipart request.";
const FORM_JSON_MISSING: &str = "Could not parse task creation multipart request: no form data.";
const CREATE_FAILED: &str = "Could not create task.";
const TEAM_ADMIN_NOT_ALLOWED: &str = "You do not have permission to administrate this team.";
const NO_DATASET: &str = "Could not find dataset for task creation.";

/// `NmlTaskParameters` (Play Json format: Option fields missing/null → None).
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct NmlTaskParameters {
    task_type_id: ObjectId,
    needed_experience: Experience,
    pending_instances: i32,
    project_name: String,
    script_id: Option<ObjectId>,
    bounding_box: Option<BoundingBox>,
}

pub fn router(_jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/tasks/createFromFiles", post(create_from_files))
        .layer(DefaultBodyLimit::max(PLAY_MAX_DISK_BUFFER))
}

/// Play's `MultipartFormData`: file parts (with a file name) in request
/// order and data parts by name.
struct MultipartBody {
    files: Vec<(String, Bytes)>,
    data_parts: HashMap<String, Vec<String>>,
}

async fn read_multipart(
    multipart: Result<Multipart, MultipartRejection>,
) -> ApiResult<MultipartBody> {
    let invalid = || ApiError::bad_request(MULTIPART_PAYLOAD_INVALID);
    let mut multipart = multipart.map_err(|_| invalid())?;
    let mut body = MultipartBody {
        files: Vec::new(),
        data_parts: HashMap::new(),
    };
    let field_error = |error: axum::extract::multipart::MultipartError| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::new(StatusCode::PAYLOAD_TOO_LARGE, "Request Entity Too Large")
        } else {
            invalid()
        }
    };
    while let Some(field) = multipart.next_field().await.map_err(field_error)? {
        let name = field.name().unwrap_or_default().to_owned();
        match field.file_name().map(str::to_owned) {
            Some(file_name) => {
                let bytes = field.bytes().await.map_err(field_error)?;
                body.files.push((file_name, bytes));
            }
            None => {
                let text = field.text().await.map_err(field_error)?;
                body.data_parts.entry(name).or_default().push(text);
            }
        }
    }
    Ok(body)
}

async fn create_from_files(
    State(state): State<AppState>,
    user: AuthUser,
    services: CreationServices,
    multipart: Result<Multipart, MultipartRejection>,
) -> ApiResult<axum::Json<Value>> {
    let pool = &state.pool;
    let body = read_multipart(multipart).await?;
    let input_files: Vec<(String, Bytes)> = body
        .files
        .into_iter()
        .filter(|(name, _)| {
            let lower = name.to_lowercase();
            lower.ends_with(".nml") || lower.ends_with(".zip")
        })
        .collect();
    if input_files.is_empty() {
        return Err(ApiError::bad_request(MSG_FILE_NOT_FOUND));
    }
    let json = body
        .data_parts
        .get("formJSON")
        .and_then(|values| values.first())
        .ok_or_else(|| ApiError::bad_request(FORM_JSON_MISSING))?;
    let params: NmlTaskParameters =
        serde_json::from_str(json).map_err(|_| ApiError::bad_request(CREATE_FAILED))?;
    let task_type = find_task_type(pool, &user, &params.task_type_id)
        .await?
        .ok_or_else(|| ApiError::not_found(task_type_not_found(params.task_type_id.as_str())))?;
    assert_batch_limit(input_files.len(), &task_type)?;
    let project = find_project(pool, &user, &params.project_name)
        .await?
        .ok_or_else(|| ApiError::not_found(project_not_found(&params.project_name)))?;
    assert_team_manager_or_admin_of(pool, &user, &project.team).await?;

    let extracted = extract_from_files(
        input_files,
        SharedParsingParameters {
            overwriting_dataset_id: None,
            user_organization_id: user.organization_id.clone(),
            is_task_upload: true,
            fallback_edit_position: None,
            fallback_edit_rotation: None,
            fallback_zoom_level: None,
        },
        false,
        ExtractionLimits::default(),
        &PgDatasetLookup {
            pool: pool.clone(),
            user_id: user.id.clone(),
        },
    )
    .await?;
    let mut boxes = extracted.to_boxes();
    drop(extracted);
    add_volume_fallback_bounding_boxes(pool, &mut boxes).await?;
    let full_params: Vec<Result<TaskParameters, TaskFailure>> = boxes
        .iter()
        .map(|container| {
            let mut full = build_full_params(&params, container)?;
            add_new_ids(&mut full, &task_type);
            Ok(full)
        })
        .collect();
    let requested = fill_in_missing_tracings(pool, &user, boxes, full_params, &task_type).await?;
    let result = create_tasks(pool, &services, requested, &task_type, &user).await?;
    Ok(axum::Json(result))
}

/// `Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, team))`: the team
/// is read globally (missing → `Team.adminNotAllowed`); the user manages it or
/// administers its organization, else Fox.empty (404).
async fn assert_team_manager_or_admin_of(
    pool: &PgPool,
    user: &AuthUser,
    team_id: &str,
) -> ApiResult<()> {
    let team: Option<(String, bool)> = sqlx::query_as(
        "SELECT t._organization, EXISTS (SELECT 1 FROM webknossos.user_team_roles r
           WHERE r._user=$2 AND r._team=t._id AND r.isTeamManager)
         FROM webknossos.teams_ t WHERE t._id=$1",
    )
    .bind(team_id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await?;
    let (organization, manages) =
        team.ok_or_else(|| ApiError::bad_request(TEAM_ADMIN_NOT_ALLOWED))?;
    if manages || (user.is_admin && organization == user.organization_id) {
        Ok(())
    } else {
        Err(ProviderError::Empty.into())
    }
}

/// TaskCreationService.addVolumeFallbackBoundingBoxes: every parsed volume
/// layer (with a parsed dataset) whose bounding box is empty gets the data
/// source bounding box of its dataset (read globally; missing → Fox.empty,
/// unusable → usableDataSourceFor failure; both fail the whole request).
async fn add_volume_fallback_bounding_boxes(
    pool: &PgPool,
    boxes: &mut [TracingBoxContainer],
) -> ApiResult<()> {
    for container in boxes {
        let (Ok(Some((layer, _))), Ok(dataset_id)) = (&mut container.volume, &container.dataset_id)
        else {
            continue;
        };
        let bbox = &layer.tracing.bounding_box;
        if bbox.width > 0 && bbox.height > 0 && bbox.depth > 0 {
            continue;
        }
        let id = ObjectId::parse(dataset_id)?;
        let dataset = annotation_create::find_dataset(pool, &id)
            .await?
            .ok_or(ProviderError::Empty)?;
        let source = annotation_create::usable_data_source(pool, &dataset).await?;
        let [x, y, z, width, height, depth] = data_source_bounding_box(&source.source);
        layer.tracing.bounding_box = BoundingBoxProto {
            top_left: crate::proto::Vec3IntProto { x, y, z },
            width,
            height,
            depth,
        };
    }
    Ok(())
}

/// TaskCreationService.buildFullParamsFromFilesForSingleTask. The parser
/// always yields a skeleton for a successful file, so the volume-only branch
/// of Scala is unreachable; the box (as parsed, not emptiness-filtered), edit
/// position and rotation come from the skeleton. The form's bounding box wins
/// over the parsed one; the file name becomes `creationInfo`.
fn build_full_params(
    form: &NmlTaskParameters,
    container: &TracingBoxContainer,
) -> Result<TaskParameters, TaskFailure> {
    let skeleton = container.skeleton.as_ref().map_err(TaskFailure::new)?;
    let dataset_id = container.dataset_id.as_ref().map_err(TaskFailure::new)?;
    let dataset_id = ObjectId::parse(dataset_id).map_err(|_| TaskFailure::new(NO_DATASET))?;
    let parsed_box = skeleton.bounding_box.as_ref().map(|b| BoundingBox {
        top_left: [b.top_left.x, b.top_left.y, b.top_left.z],
        width: b.width,
        height: b.height,
        depth: b.depth,
    });
    let position = &skeleton.edit_position;
    let rotation = &skeleton.edit_rotation;
    Ok(TaskParameters {
        task_type_id: form.task_type_id.clone(),
        needed_experience: form.needed_experience.clone(),
        pending_instances: form.pending_instances,
        project_name: form.project_name.clone(),
        script_id: form.script_id.clone(),
        bounding_box: form.bounding_box.or(parsed_box),
        dataset_id,
        edit_position: [position.x, position.y, position.z],
        edit_rotation: [rotation.x, rotation.y, rotation.z],
        creation_info: container.file_name.as_ref().ok().cloned(),
        description: container.description.as_ref().ok().cloned(),
        base_annotation: None,
        new_skeleton_tracing_id: None,
        new_volume_tracing_id: None,
        new_annotation_id: None,
    })
}

/// fillInMissingTracings + combineParamsWithTracings. Skeleton task types
/// drop uploaded volumes and volume types drop skeletons (a dropped half's
/// failure does not matter). Hybrid types fill a missing volume with a fresh
/// volume base (createVolumeTracingBase under the requester's dataset
/// access); any failed file then fails the whole request with its message,
/// as Scala's `Fox.serialCombined` does.
async fn fill_in_missing_tracings(
    pool: &PgPool,
    user: &AuthUser,
    boxes: Vec<TracingBoxContainer>,
    full_params: Vec<Result<TaskParameters, TaskFailure>>,
    task_type: &TaskTypeFacts,
) -> ApiResult<Vec<RequestedTaskResult>> {
    let mut sources: HashMap<ObjectId, (DatasetFacts, UsableSource)> = HashMap::new();
    let mut requested = Vec::with_capacity(boxes.len());
    for (container, params) in boxes.into_iter().zip(full_params) {
        let volume = container.volume.map(|volume| {
            volume.map(|(layer, data)| VolumeBase {
                tracing: layer.tracing,
                initial_data: data.map(|bytes| bytes.to_vec()),
            })
        });
        let item = match task_type.tracing_type {
            TracingType::Skeleton => params.and_then(|params| {
                let skeleton = container.skeleton.map_err(TaskFailure::new)?;
                Ok(RequestedTask {
                    params,
                    skeleton: Some(skeleton),
                    volume: None,
                })
            }),
            TracingType::Volume => params.and_then(|params| {
                let volume = volume.map_err(TaskFailure::new)?;
                Ok(RequestedTask {
                    params,
                    skeleton: None,
                    volume,
                })
            }),
            TracingType::Hybrid => {
                let params = params.map_err(|failure| ApiError::bad_request(failure.message))?;
                let skeleton = container.skeleton.unwrap_or_else(|_| {
                    skeleton_tracing_base(
                        params.bounding_box,
                        params.edit_position,
                        params.edit_rotation,
                    )
                });
                let volume = match volume {
                    Ok(Some(volume)) => volume,
                    _ => {
                        if !sources.contains_key(&params.dataset_id) {
                            let dataset = find_readable_dataset(pool, user, &params.dataset_id)
                                .await?
                                .ok_or_else(|| {
                                    ApiError::bad_request(dataset_not_found(
                                        params.dataset_id.as_str(),
                                    ))
                                })?;
                            let source =
                                annotation_create::usable_data_source(pool, &dataset).await?;
                            sources.insert(params.dataset_id.clone(), (dataset, source));
                        }
                        let (dataset, source) = &sources[&params.dataset_id];
                        VolumeBase {
                            tracing: volume_tracing_base(
                                pool,
                                dataset,
                                source,
                                params.bounding_box,
                                params.edit_position,
                                params.edit_rotation,
                                task_type.mag_restrictions,
                            )
                            .await?,
                            initial_data: None,
                        }
                    }
                };
                Ok(RequestedTask {
                    params,
                    skeleton: Some(skeleton),
                    volume: Some(volume),
                })
            }
        };
        requested.push(item);
    }
    Ok(requested)
}
