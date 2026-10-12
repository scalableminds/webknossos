//! TaskController.create (`POST /tasks`, JSON body `List[TaskParameters]`)
//! and the TaskCreationService core shared with `POST /tasks/createFromFiles`.
//!
//! Scala order (errors surface in this order; all whole-request failures):
//! body non-empty (`noTasks`) → one task type (`notOnSameTaskType`) → task
//! type readable (`TaskType.notFound`, 400) → one dataset
//! (`notOnSameDataset`) → dataset readable (`Dataset.notFound`, 400) →
//! usable data source → dataset of the requester's organization
//! (`datasetOfOtherOrga`) → batch limit → new ids → base annotations
//! duplicated/created in the tracing store (serially) → fresh skeleton bases
//! (pure) → fresh volume bases (serially) → [`create_tasks`].
//!
//! # Reuse API for `createFromFiles`
//!
//! The NML route builds one [`RequestedTaskResult`] per uploaded file
//! (`Err(TaskFailure)` for a file that failed to parse, matching Scala's
//! `Box` failures), with [`TaskParameters`] already carrying the new ids
//! ([`add_new_ids`]) and the parsed tracings as `skeleton` / `volume`
//! ([`VolumeBase::initial_data`] = the volume data zip, uploaded with
//! `POST /tracings/volume/:id/initialData`). Missing hybrid halves can be
//! filled with [`skeleton_tracing_base`] / [`volume_tracing_base`]. Then:
//!
//! ```ignore
//! let task_type = find_task_type(&pool, &user, &task_type_id).await?   // None → TaskType.notFound ~> 404
//! assert_batch_limit(files.len(), &task_type)?;
//! let json = create_tasks(&pool, &services, requested, &task_type, &user).await?;
//! ```
//!
//! [`create_tasks`] is `TaskCreationService.createTasks`: it saves the
//! skeletons (`saveMultiple`) and volumes, inserts every task with its
//! TracingBase annotation and returns the `TaskCreationResult` JSON
//! (`{tasks: [{status, success|error}], warnings}`), one item per requested
//! task in request order; per-task failures are items, not request failures.
use axum::{
    Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    routing::post,
};
use chrono::{DateTime, Utc};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::{
    AppState, annotation_access,
    annotation_create::{self, DatasetFacts, UsableSource},
    annotation_duplicate::{NewAnnotation, insert_annotation},
    annotation_provider::{
        AnnotationLayer, AnnotationLayerType, AnnotationProvider, FoxFailure, ProviderError,
    },
    annotation_sandbox::dataset_not_found,
    auth::AuthUser,
    dataset_access,
    error::{ApiError, ApiResult},
    extract::Json,
    id::ObjectId,
    proto::{
        AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto, BoundingBoxProto,
        ColorProto, Vec3DoubleProto, Vec3IntProto,
        datastore::{
            BranchPoint, Node, SkeletonTracing, SkeletonTracingOpt, SkeletonTracingsWithIds,
            StringOpt, Tree, VolumeTracing,
        },
    },
    service_clients::ServiceError,
    tracing_initialization::{
        AnnotationLayerParameters, ExplorationalDataset, MagRestrictions, TracingInitError,
        plan_volume_tracing,
    },
    tracingstore_client::{SaveMultipleResult, TracingStoreClient, VolumeSaveDataSource},
};

// ---------------------------------------------------------------------------
// Messages (Msg.Task.Create and friends)
// ---------------------------------------------------------------------------

pub(crate) const NO_TASKS: &str = "Zero tasks were requested.";
pub(crate) const NOT_ON_SAME_TASK_TYPE: &str =
    "Cannot create tasks with differing task types in one go.";
pub(crate) const NOT_ON_SAME_DATASET: &str = "Cannot create tasks on multiple datasets in one go.";
pub(crate) const DATASET_OF_OTHER_ORGA: &str =
    "Cannot create tasks for datasets of other organizations.";
pub(crate) const NEEDS_EITHER_SKELETON_OR_VOLUME: &str =
    "Each task needs to either be skeleton or volume.";
pub(crate) const SAVE_SKELETON_FAILED: &str = "Could not save skeleton tracing for new task.";
pub(crate) const SAVE_VOLUME_FAILED: &str = "Could not save volume tracing for new task.";
pub(crate) const NOT_ONE_ANNOTATION: &str =
    "The specified base task does not have exactly one (finished) instance.";
/// Msg.Team.adminNotAllowed.
const TEAM_ADMIN_NOT_ALLOWED: &str = "You do not have permission to administrate this team.";
/// Msg.Annotation.multiLayersSkeletonNotImplemented / multiLayersVolumeNotImplemented.
const MULTI_SKELETON: &str =
    "This feature is not implemented for annotations with more than one skeleton layer.";
const MULTI_VOLUME: &str =
    "This feature is not implemented for annotations with more than one volume layer.";

pub(crate) fn batch_limit_exceeded(limit: usize) -> String {
    format!("Cannot create more than {limit} tasks in one request.")
}
pub(crate) fn task_type_not_found(id: &str) -> String {
    format!("Task type “{id}” could not be found or accessed.")
}
pub(crate) fn project_not_found(name: &str) -> String {
    format!("Project with name “{name}” could not be found or accessed.")
}
fn script_not_found(id: &str) -> String {
    format!("Script “{id}” could not be found or accessed.")
}
fn object_id_invalid(literal: &str) -> String {
    format!("The supplied resource id “{literal}” is not a valid ObjectId.")
}

// ---------------------------------------------------------------------------
// TaskParameters (Play Json.format: Option fields missing/null → None)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct Experience {
    pub domain: String,
    pub value: i32,
}

/// `BoundingBox` JSON `{topLeft: [x,y,z], width, height, depth}`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BoundingBox {
    pub top_left: [i32; 3],
    pub width: i32,
    pub height: i32,
    pub depth: i32,
}

impl BoundingBox {
    /// BoundingBox.isEmpty.
    pub(crate) fn is_empty(&self) -> bool {
        self.width <= 0 || self.height <= 0 || self.depth <= 0
    }
    /// BoundingBox.toLiteral.
    fn literal(&self) -> String {
        let [x, y, z] = self.top_left;
        format!("{x},{y},{z},{},{},{}", self.width, self.height, self.depth)
    }
    fn to_proto(self) -> BoundingBoxProto {
        BoundingBoxProto {
            top_left: vec3_int(self.top_left),
            width: self.width,
            height: self.height,
            depth: self.depth,
        }
    }
    /// `boundingBox.flatMap(box => if (box.isEmpty) None else Some(box))`.
    fn non_empty(this: Option<Self>) -> Option<Self> {
        this.filter(|b| !b.is_empty())
    }
}

/// `BaseAnnotation(baseId, skeletonId, volumeId)`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BaseAnnotation {
    pub base_id: String,
    pub skeleton_id: Option<String>,
    pub volume_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskParameters {
    pub task_type_id: ObjectId,
    pub needed_experience: Experience,
    pub pending_instances: i32,
    pub project_name: String,
    pub script_id: Option<ObjectId>,
    pub bounding_box: Option<BoundingBox>,
    pub dataset_id: ObjectId,
    pub edit_position: [i32; 3],
    pub edit_rotation: [f64; 3],
    pub creation_info: Option<String>,
    pub description: Option<String>,
    pub base_annotation: Option<BaseAnnotation>,
    pub new_skeleton_tracing_id: Option<String>,
    pub new_volume_tracing_id: Option<String>,
    pub new_annotation_id: Option<ObjectId>,
}

// ---------------------------------------------------------------------------
// Task type
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TracingType {
    Skeleton,
    Volume,
    Hybrid,
}

/// The task type columns task creation reads.
#[derive(Clone, Debug)]
pub(crate) struct TaskTypeFacts {
    pub id: ObjectId,
    pub tracing_type: TracingType,
    pub mag_restrictions: MagRestrictions,
}

/// TaskTypeDAO.findOne under the requester's access (team member or admin
/// of the task type's organization). `None` when missing or not readable.
pub(crate) async fn find_task_type(
    pool: &PgPool,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Option<TaskTypeFacts>> {
    let row: Option<(String, Option<i32>, Option<i32>)> = sqlx::query_as(
        "SELECT tt.tracingType::text, tt.settings_magRestrictions_min, tt.settings_magRestrictions_max
         FROM webknossos.taskTypes_ tt
         WHERE tt._id=$1 AND (tt._team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
           OR tt._organization=(SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
    )
    .bind(id.as_str())
    .bind(&user.id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(typ, min, max)| TaskTypeFacts {
        id: id.clone(),
        tracing_type: match typ.as_str() {
            "volume" => TracingType::Volume,
            "hybrid" => TracingType::Hybrid,
            _ => TracingType::Skeleton,
        },
        mag_restrictions: MagRestrictions { min, max },
    }))
}

/// TaskCreationService.assertBatchLimit: 100 for volume/hybrid, else 1000.
pub(crate) fn assert_batch_limit(batch_size: usize, task_type: &TaskTypeFacts) -> ApiResult<()> {
    let limit = match task_type.tracing_type {
        TracingType::Volume | TracingType::Hybrid => 100,
        TracingType::Skeleton => 1000,
    };
    if batch_size <= limit {
        Ok(())
    } else {
        Err(ApiError::bad_request(batch_limit_exceeded(limit)))
    }
}

/// addIdsToSingleTaskParameters: a fresh annotation id and fresh tracing ids
/// (`TracingId.generate`) for the task type's layer types.
pub(crate) fn add_new_ids(params: &mut TaskParameters, task_type: &TaskTypeFacts) {
    let skeleton = matches!(
        task_type.tracing_type,
        TracingType::Skeleton | TracingType::Hybrid
    );
    let volume = matches!(
        task_type.tracing_type,
        TracingType::Volume | TracingType::Hybrid
    );
    params.new_skeleton_tracing_id = skeleton.then(|| uuid::Uuid::new_v4().to_string());
    params.new_volume_tracing_id = volume.then(|| uuid::Uuid::new_v4().to_string());
    params.new_annotation_id = Some(ObjectId::new());
}

// ---------------------------------------------------------------------------
// Fox failures and per-task results
// ---------------------------------------------------------------------------

fn failure(message: impl Into<String>, status: Option<StatusCode>) -> ProviderError {
    ProviderError::Failure(FoxFailure {
        message: message.into(),
        chain: Vec::new(),
        status,
    })
}

/// RPC failure: a Fox failure keeping an upstream status (ParamFailure).
fn service_failure(error: ServiceError) -> ProviderError {
    let status = match error {
        ServiceError::UpstreamStatus(code) => StatusCode::from_u16(code).ok(),
        _ => None,
    };
    failure(error.to_string(), status)
}

fn init_failure(error: TracingInitError) -> ProviderError {
    match error.message() {
        Some(message) => failure(message, None),
        None => ProviderError::Empty,
    }
}

/// A failed `Box` of one requested task, rendered by
/// TaskCreationResult.fromBoxResults as `{status, error}`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TaskFailure {
    pub message: String,
    pub status: StatusCode,
}

impl TaskFailure {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: StatusCode::BAD_REQUEST,
        }
    }

    /// Box → item: Failure keeps its message (ParamFailure its status), Empty
    /// is `"Empty"`. Infrastructure (5xx) errors are not task results: they
    /// fail the whole request (crate convention for database faults).
    fn from_provider(error: ProviderError) -> ApiResult<Self> {
        Ok(match error {
            ProviderError::Empty => Self::new("Empty"),
            ProviderError::Failure(FoxFailure {
                message, status, ..
            }) => Self {
                message,
                status: status.unwrap_or(StatusCode::BAD_REQUEST),
            },
            ProviderError::Api(error) if error.status.is_server_error() => return Err(error),
            ProviderError::Api(error) => Self {
                message: error.message,
                status: error.status,
            },
            other => Self::new(other.to_string()),
        })
    }

    fn into_provider(self) -> ProviderError {
        failure(self.message, Some(self.status))
    }
}

/// One fresh volume base: the tracing and optional initial volume data (the
/// data zip of an uploaded volume layer, createFromFiles only).
#[derive(Clone, Debug)]
pub(crate) struct VolumeBase {
    pub tracing: VolumeTracing,
    pub initial_data: Option<Vec<u8>>,
}

/// `(TaskParameters, Option[SkeletonTracing], Option[(VolumeTracing, Option[File])])`.
#[derive(Clone, Debug)]
pub(crate) struct RequestedTask {
    pub params: TaskParameters,
    pub skeleton: Option<SkeletonTracing>,
    pub volume: Option<VolumeBase>,
}

pub(crate) type RequestedTaskResult = Result<RequestedTask, TaskFailure>;

/// The router extensions task creation needs.
#[derive(Clone)]
pub(crate) struct CreationServices {
    pub tracing_store: TracingStoreClient,
    pub provider: AnnotationProvider,
    pub slack: crate::slack::SlackNotificationService,
}

fn extension<T: Clone + Send + Sync + 'static>(parts: &Parts) -> ApiResult<T> {
    parts
        .extensions
        .get::<T>()
        .cloned()
        .ok_or_else(ApiError::internal)
}

impl<S: Send + Sync> FromRequestParts<S> for CreationServices {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            tracing_store: extension(parts)?,
            provider: extension(parts)?,
            slack: parts
                .extensions
                .get::<crate::slack::SlackNotificationService>()
                .cloned()
                .unwrap_or_default(),
        })
    }
}

// ---------------------------------------------------------------------------
// Tracing bases
// ---------------------------------------------------------------------------

fn vec3_int([x, y, z]: [i32; 3]) -> Vec3IntProto {
    Vec3IntProto { x, y, z }
}
fn vec3_double([x, y, z]: [f64; 3]) -> Vec3DoubleProto {
    Vec3DoubleProto { x, y, z }
}

/// SkeletonTracingDefaults.zoomLevel.
const SKELETON_ZOOM_LEVEL: f64 = 2.0;

/// AnnotationService.createSkeletonTracingBase: one tree with one node at the
/// start position (id 1, also a branch point), red, datasetName "unused".
pub(crate) fn skeleton_tracing_base(
    bounding_box: Option<BoundingBox>,
    start_position: [i32; 3],
    start_rotation: [f64; 3],
) -> SkeletonTracing {
    let now = Utc::now().timestamp_millis();
    let node = Node {
        id: 1,
        position: vec3_int(start_position),
        rotation: vec3_double(start_rotation),
        radius: 1.0,
        viewport: 1,
        mag: 1,
        bit_depth: 0,
        interpolation: false,
        created_timestamp: now,
        ..Default::default()
    };
    let tree = Tree {
        tree_id: 1,
        nodes: vec![node],
        color: Some(ColorProto {
            r: 1.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        }),
        branch_points: vec![BranchPoint {
            node_id: 1,
            created_timestamp: now,
        }],
        name: String::new(),
        created_timestamp: now,
        ..Default::default()
    };
    SkeletonTracing {
        dataset_name: "unused".into(),
        trees: vec![tree],
        created_timestamp: now,
        bounding_box: BoundingBox::non_empty(bounding_box).map(BoundingBox::to_proto),
        active_node_id: Some(1),
        edit_position: vec3_int(start_position),
        edit_rotation: vec3_double(start_rotation),
        zoom_level: SKELETON_ZOOM_LEVEL,
        version: 0,
        ..Default::default()
    }
}

/// AnnotationService.createVolumeTracingBase with `volumeShowFallbackLayer =
/// false`: datastore lookup (missing → Fox.empty), mags restricted by the
/// task type (`magRestrictionsTooTight`), bounding box = the non-empty task
/// box else the data source box, edit position/rotation = start values. No
/// datastore RPC (no fallback layer). The caller has resolved the dataset
/// (readable) and its usable data source.
pub(crate) async fn volume_tracing_base(
    pool: &PgPool,
    dataset: &DatasetFacts,
    source: &UsableSource,
    bounding_box: Option<BoundingBox>,
    start_position: [i32; 3],
    start_rotation: [f64; 3],
    mag_restrictions: MagRestrictions,
) -> Result<VolumeTracing, ProviderError> {
    let data_store: Option<String> =
        sqlx::query_scalar("SELECT name FROM webknossos.dataStores_ WHERE name=$1")
            .bind(&dataset.data_store)
            .fetch_optional(pool)
            .await?;
    if data_store.is_none() {
        return Err(ProviderError::Empty);
    }
    let explorational = ExplorationalDataset {
        data_source: &source.source,
        dataset_name: &dataset.name,
        organization_id: &dataset.organization_id,
    };
    let params = AnnotationLayerParameters {
        typ: AnnotationLayerType::Volume,
        fallback_layer_name: None,
        auto_fallback_layer: false,
        mapping_name: None,
        mag_restrictions: Some(mag_restrictions),
        name: None,
        additional_axes: None,
    };
    let plan = plan_volume_tracing(&explorational, &params).map_err(init_failure)?;
    let mut tracing = plan
        .build(false, Utc::now().timestamp_millis())
        .map_err(init_failure)?;
    if let Some(bounding_box) = BoundingBox::non_empty(bounding_box) {
        tracing.bounding_box = bounding_box.to_proto();
    }
    tracing.edit_position = vec3_int(start_position);
    tracing.edit_rotation = vec3_double(start_rotation);
    Ok(tracing)
}

// ---------------------------------------------------------------------------
// Tracing store RPCs specific to task creation (all `withLongTimeout` except
// the plain volume save inside TracingStoreClient)
// ---------------------------------------------------------------------------

/// Java `Double.toString` (shared, JDK-verified).
fn java_double(value: f64) -> String {
    crate::java_format::java_double(value)
}

fn vec3_int_literal([x, y, z]: [i32; 3]) -> String {
    format!("{x},{y},{z}")
}
fn vec3_double_literal([x, y, z]: [f64; 3]) -> String {
    format!("{},{},{}", java_double(x), java_double(y), java_double(z))
}

/// Tracing-store duplicate of one base layer (duplicateSkeletonTracing /
/// duplicateVolumeTracing). History is dropped; the new version is zero.
struct DuplicateTracing<'a> {
    source_tracing_id: &'a str,
    new_annotation_id: &'a ObjectId,
    new_tracing_id: &'a str,
    owner_id: &'a str,
    requesting_user_id: &'a str,
    edit_position: [i32; 3],
    edit_rotation: [f64; 3],
}

impl DuplicateTracing<'_> {
    fn query(&self) -> Vec<(&'static str, String)> {
        vec![
            ("newAnnotationId", self.new_annotation_id.to_string()),
            ("newTracingId", self.new_tracing_id.to_owned()),
            ("ownerId", self.owner_id.to_owned()),
            ("requestingUserId", self.requesting_user_id.to_owned()),
            ("editPosition", vec3_int_literal(self.edit_position)),
            ("editRotation", vec3_double_literal(self.edit_rotation)),
        ]
    }
}

/// `POST /tracings/skeleton/:id/duplicate` (empty body, long timeout).
async fn duplicate_skeleton_tracing(
    tracing_store: &TracingStoreClient,
    url: &str,
    request: &DuplicateTracing<'_>,
    bounding_box: Option<BoundingBox>,
) -> Result<(), ProviderError> {
    let mut query = request.query();
    query.extend(bounding_box.map(|b| ("boundingBox", b.literal())));
    tracing_store
        .long_clients()
        .request(
            Method::POST,
            url,
            &[
                "tracings",
                "skeleton",
                request.source_tracing_id,
                "duplicate",
            ],
            &query,
            None,
        )
        .await
        .map_err(service_failure)?;
    Ok(())
}

/// `annotationDataSourceTemporaryStore.store(newAnnotationId, ..)` then
/// `POST /tracings/volume/:id/duplicate` (empty body, long timeout).
async fn duplicate_volume_tracing(
    services: &CreationServices,
    url: &str,
    request: &DuplicateTracing<'_>,
    mag_restrictions: MagRestrictions,
    source: &UsableSource,
    dataset_id: &ObjectId,
) -> Result<(), ProviderError> {
    services.provider.data_sources().store(
        request.new_annotation_id.clone(),
        source.rendered.clone(),
        dataset_id.clone(),
    );
    let mut query = request.query();
    query.extend(mag_restrictions.min.map(|m| ("minMag", m.to_string())));
    query.extend(mag_restrictions.max.map(|m| ("maxMag", m.to_string())));
    services
        .tracing_store
        .long_clients()
        .request(
            Method::POST,
            url,
            &["tracings", "volume", request.source_tracing_id, "duplicate"],
            &query,
            None,
        )
        .await
        .map_err(service_failure)?;
    Ok(())
}

/// WKRemoteTracingStoreClient.saveVolumeTracing: temporary data source,
/// `POST /tracings/volume/save` and, with initial data,
/// `POST /tracings/volume/:id/initialData?annotationId&minMag&maxMag` (long).
#[allow(clippy::too_many_arguments)]
async fn save_volume_tracing(
    services: &CreationServices,
    url: &str,
    annotation_id: &ObjectId,
    tracing_id: &str,
    volume: &VolumeBase,
    mag_restrictions: MagRestrictions,
    source: &UsableSource,
    dataset_id: &ObjectId,
) -> Result<(), ProviderError> {
    services
        .tracing_store
        .save_volume_tracing(
            url,
            annotation_id,
            tracing_id,
            &volume.tracing,
            VolumeSaveDataSource {
                store: services.provider.data_sources(),
                data_source: &source.rendered,
                dataset_id,
            },
        )
        .await
        .map_err(service_failure)?;
    if let Some(data) = &volume.initial_data {
        services
            .tracing_store
            .upload_volume_initial_data(
                url,
                annotation_id,
                tracing_id,
                mag_restrictions.min,
                mag_restrictions.max,
                data.clone(),
            )
            .await
            .map_err(service_failure)?;
    }
    Ok(())
}

/// A `Box[Boolean]` of the saveMultiple JSON response (JsonHelper.boxFormat).
#[derive(Clone, Debug, PartialEq, Eq)]
enum SaveBox {
    Full,
    Empty,
    Failure(TaskFailure),
}

/// saveSkeletonTracings (`TracingStoreClient::save_skeleton_tracings`) with
/// SkeletonTracingsWithIds: one entry per requested task, `None` where there
/// is nothing to save.
async fn save_skeleton_tracings(
    tracing_store: &TracingStoreClient,
    url: &str,
    requested: &[RequestedTaskResult],
) -> Result<Vec<SaveBox>, ProviderError> {
    fn ok(r: &RequestedTaskResult) -> Option<&RequestedTask> {
        r.as_ref().ok()
    }
    let body = SkeletonTracingsWithIds {
        tracings: requested
            .iter()
            .map(|r| SkeletonTracingOpt {
                tracing: ok(r).and_then(|t| t.skeleton.clone()),
            })
            .collect(),
        annotation_id: requested
            .iter()
            .map(|r| StringOpt {
                string_value: ok(r)
                    .and_then(|t| t.params.new_annotation_id.as_ref().map(ToString::to_string)),
            })
            .collect(),
        tracing_id: requested
            .iter()
            .map(|r| StringOpt {
                string_value: ok(r).and_then(|t| t.params.new_skeleton_tracing_id.clone()),
            })
            .collect(),
    };
    Ok(tracing_store
        .save_skeleton_tracings(url, &body)
        .await
        .map_err(service_failure)?
        .into_iter()
        .map(|result| match result {
            SaveMultipleResult::Full => SaveBox::Full,
            SaveMultipleResult::Empty => SaveBox::Empty,
            SaveMultipleResult::Failure(message) => SaveBox::Failure(TaskFailure::new(message)),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Base annotations (createTracingsFromBaseAnnotations)
// ---------------------------------------------------------------------------

struct ResolvedBase {
    owner_id: String,
    skeleton_ids: Vec<String>,
    volume_ids: Vec<String>,
}

/// Annotation.skeletonTracingId / volumeTracingId: at most one layer of the
/// type (else the multiLayers… failure), checked only when requested.
fn single_layer(ids: &[String], message: &str) -> Result<Option<String>, ProviderError> {
    match ids {
        [] => Ok(None),
        [id] => Ok(Some(id.clone())),
        _ => Err(failure(message, None)),
    }
}

async fn base_from_annotation_row(
    pool: &PgPool,
    annotation_id: &str,
    owner_id: String,
) -> Result<ResolvedBase, ProviderError> {
    let layers: Vec<(String, String)> = sqlx::query_as(
        "SELECT tracingId, typ::text FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY tracingId",
    )
    .bind(annotation_id)
    .fetch_all(pool)
    .await?;
    let of_type = |typ: &str| -> Vec<String> {
        layers
            .iter()
            .filter(|(_, t)| t == typ)
            .map(|(id, _)| id.clone())
            .collect()
    };
    Ok(ResolvedBase {
        owner_id,
        skeleton_ids: of_type("Skeleton"),
        volume_ids: of_type("Volume"),
    })
}

/// resolveBaseAnnotationId: an annotation readable by the requester (any
/// type/state), else resolveBaseTaskId: a readable task with
/// totalInstances = 1, pendingInstances = 0 whose first non-cancelled
/// readable Task annotation is Finished (`notOneAnnotation`); a missing task
/// is Fox.empty.
async fn resolve_base(
    pool: &PgPool,
    user: &AuthUser,
    id: &ObjectId,
) -> Result<ResolvedBase, ProviderError> {
    let read = annotation_access::READ_PREDICATE;
    let annotation: Option<String> = sqlx::query_scalar(&format!(
        "SELECT a._user FROM webknossos.annotations_ a WHERE a._id=$4 AND {read}"
    ))
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(id.as_str())
    .fetch_optional(pool)
    .await?;
    if let Some(owner) = annotation {
        return base_from_annotation_row(pool, id.as_str(), owner).await;
    }
    let task: Option<(i64, i64)> = sqlx::query_as(
        "SELECT t.totalInstances, t.pendingInstances FROM webknossos.tasks_ t
         WHERE t._id=$1 AND ((SELECT p._team FROM webknossos.projects p WHERE p._id=t._project)
             IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
           OR (SELECT team._organization FROM webknossos.teams team WHERE team._id=(SELECT p._team FROM webknossos.projects p WHERE p._id=t._project))
             IN (SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
    )
    .bind(id.as_str())
    .bind(&user.id)
    .fetch_optional(pool)
    .await?;
    let Some((total, pending)) = task else {
        return Err(ProviderError::Empty);
    };
    let annotations: Vec<(String, String, String)> = sqlx::query_as(&format!(
        "SELECT a._id, a._user, a.state::text FROM webknossos.annotations_ a
         WHERE a._task=$4 AND a.typ='Task' AND a.state<>'Cancelled' AND {read}
         ORDER BY a.created, a._id"
    ))
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(id.as_str())
    .fetch_all(pool)
    .await?;
    match annotations.first() {
        Some((annotation_id, owner, state))
            if total == 1 && pending == 0 && state == "Finished" =>
        {
            base_from_annotation_row(pool, annotation_id, owner.clone()).await
        }
        _ => Err(failure(NOT_ONE_ANNOTATION, None)),
    }
}

/// createTracingsFromBaseAnnotation for one task: duplicate the base's
/// skeleton/volume (or create fresh ones where the base has none) under the
/// task's new tracing ids, then rewrite `baseAnnotation` to
/// `BaseAnnotation(baseId, newSkeletonTracingId, newVolumeTracingId)`.
async fn create_tracings_from_base_annotation(
    pool: &PgPool,
    services: &CreationServices,
    user: &AuthUser,
    params: &mut TaskParameters,
    task_type: &TaskTypeFacts,
    dataset: &DatasetFacts,
    source: &UsableSource,
) -> Result<(), ProviderError> {
    let Some(base) = params.base_annotation.clone() else {
        return Ok(());
    };
    let base_id = ObjectId::parse(&base.base_id)
        .map_err(|_| failure(object_id_invalid(&base.base_id), None))?;
    let resolved = resolve_base(pool, user, &base_id).await?;
    let url = annotation_create::tracing_store_url(pool).await?;
    let new_annotation_id = params
        .new_annotation_id
        .clone()
        .ok_or(ProviderError::Empty)?;
    if let Some(new_skeleton_id) = &params.new_skeleton_tracing_id {
        match single_layer(&resolved.skeleton_ids, MULTI_SKELETON)? {
            Some(source_id) => {
                let request = DuplicateTracing {
                    source_tracing_id: &source_id,
                    new_annotation_id: &new_annotation_id,
                    new_tracing_id: new_skeleton_id,
                    owner_id: &resolved.owner_id,
                    requesting_user_id: &user.id,
                    edit_position: params.edit_position,
                    edit_rotation: params.edit_rotation,
                };
                duplicate_skeleton_tracing(
                    &services.tracing_store,
                    &url,
                    &request,
                    params.bounding_box,
                )
                .await?;
            }
            None => {
                let skeleton = skeleton_tracing_base(
                    params.bounding_box,
                    params.edit_position,
                    params.edit_rotation,
                );
                services
                    .tracing_store
                    .save_skeleton_tracing(&url, &skeleton, new_skeleton_id)
                    .await
                    .map_err(service_failure)?;
            }
        }
    }
    if let Some(new_volume_id) = &params.new_volume_tracing_id {
        match single_layer(&resolved.volume_ids, MULTI_VOLUME)? {
            Some(source_id) => {
                let request = DuplicateTracing {
                    source_tracing_id: &source_id,
                    new_annotation_id: &new_annotation_id,
                    new_tracing_id: new_volume_id,
                    owner_id: &resolved.owner_id,
                    requesting_user_id: &user.id,
                    edit_position: params.edit_position,
                    edit_rotation: params.edit_rotation,
                };
                duplicate_volume_tracing(
                    services,
                    &url,
                    &request,
                    task_type.mag_restrictions,
                    source,
                    &params.dataset_id,
                )
                .await?;
            }
            None => {
                let tracing = volume_tracing_base(
                    pool,
                    dataset,
                    source,
                    params.bounding_box,
                    params.edit_position,
                    params.edit_rotation,
                    task_type.mag_restrictions,
                )
                .await?;
                save_volume_tracing(
                    services,
                    &url,
                    &new_annotation_id,
                    new_volume_id,
                    &VolumeBase {
                        tracing,
                        initial_data: None,
                    },
                    task_type.mag_restrictions,
                    source,
                    &params.dataset_id,
                )
                .await?;
            }
        }
    }
    params.base_annotation = Some(BaseAnnotation {
        base_id: base_id.to_string(),
        skeleton_id: params.new_skeleton_tracing_id.clone(),
        volume_id: params.new_volume_tracing_id.clone(),
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// createTasks
// ---------------------------------------------------------------------------

/// DatasetDAO.findOne under the requester's access: global row + read
/// predicate. `None` when missing or unreadable.
pub(crate) async fn find_readable_dataset(
    pool: &PgPool,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Option<DatasetFacts>> {
    let Some(dataset) = annotation_create::find_dataset(pool, id).await? else {
        return Ok(None);
    };
    if !dataset_access::can_read(pool, Some(user), id.as_str(), None).await? {
        return Ok(None);
    }
    Ok(Some(dataset))
}

/// SequenceUtils.findUniqueElement.
fn unique<T: PartialEq + Clone>(mut items: impl Iterator<Item = T>) -> Option<T> {
    let first = items.next()?;
    items.all(|item| item == first).then_some(first)
}

/// Instant.now (millisecond precision).
fn now_millis() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap_or_else(Utc::now)
}

pub(crate) struct ProjectFacts {
    pub id: String,
    pub team: String,
}

/// ProjectDAO.findOneByNameAndOrganization under the requester's access
/// (project team member, project owner or organization admin).
pub(crate) async fn find_project(
    pool: &PgPool,
    user: &AuthUser,
    name: &str,
) -> ApiResult<Option<ProjectFacts>> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT p._id, p._team FROM webknossos.projects_ p
         WHERE p.name=$1 AND p._organization=$2
           AND (p._team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$3)
             OR p._owner=$3
             OR p._organization=(SELECT _organization FROM webknossos.users_ WHERE _id=$3 AND isAdmin))
         ORDER BY p.created, p._id LIMIT 1",
    )
    .bind(name)
    .bind(&user.organization_id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id, team)| ProjectFacts { id, team }))
}

/// One task of createTasks: createTaskWithoutAnnotationBase +
/// createAndSaveAnnotationBase + publicWrites. `Ok(Err(..))` is a per-task
/// failure item.
#[allow(clippy::too_many_arguments)]
async fn create_one(
    pool: &PgPool,
    services: &CreationServices,
    tracing_store_url: &str,
    requested: &RequestedTaskResult,
    skeleton_save: &SaveBox,
    volume_save: &SaveBox,
    task_type: &TaskTypeFacts,
    user: &AuthUser,
    dataset: &DatasetFacts,
) -> ApiResult<Result<Value, TaskFailure>> {
    let attempt = async {
        let requested = requested.as_ref().map_err(|f| f.clone().into_provider())?;
        let params = &requested.params;
        if params.new_skeleton_tracing_id.is_none() && params.new_volume_tracing_id.is_none() {
            return Err(failure(NEEDS_EITHER_SKELETON_OR_VOLUME, None));
        }
        let base = params.base_annotation.as_ref();
        let check = |save: &SaveBox, message: &str| match save {
            SaveBox::Full => Ok(()),
            SaveBox::Empty => Err(failure(message, None)),
            SaveBox::Failure(f) => Err(f.clone().into_provider().wrap(message)),
        };
        if params.new_skeleton_tracing_id.is_some()
            && !base.is_some_and(|b| b.skeleton_id.is_some())
        {
            check(skeleton_save, SAVE_SKELETON_FAILED)?;
        }
        if params.new_volume_tracing_id.is_some() && !base.is_some_and(|b| b.volume_id.is_some()) {
            check(volume_save, SAVE_VOLUME_FAILED)?;
        }
        let project = find_project(pool, user, &params.project_name)
            .await?
            .ok_or_else(|| failure(project_not_found(&params.project_name), None))?;
        if let Some(script) = &params.script_id {
            let readable: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM webknossos.scripts_ s
                   JOIN webknossos.users_ owner ON owner._id=s._owner
                   WHERE s._id=$1 AND owner._organization=$2)",
            )
            .bind(script.as_str())
            .bind(&user.organization_id)
            .fetch_one(pool)
            .await?;
            if !readable {
                return Err(failure(script_not_found(script.as_str()), None));
            }
        }
        // Fox.assertTrue(isTeamManagerOrAdminOf(user, project._team)):
        // missing team → adminNotAllowed; false → Fox.empty.
        let team: Option<(String, bool)> = sqlx::query_as(
            "SELECT t._organization, EXISTS (SELECT 1 FROM webknossos.user_team_roles r
               WHERE r._user=$2 AND r._team=t._id AND r.isTeamManager)
             FROM webknossos.teams_ t WHERE t._id=$1",
        )
        .bind(&project.team)
        .bind(&user.id)
        .fetch_optional(pool)
        .await?;
        let (team_organization, is_manager) =
            team.ok_or_else(|| failure(TEAM_ADMIN_NOT_ALLOWED, None))?;
        if !(is_manager || (user.is_admin && team_organization == user.organization_id)) {
            return Err(ProviderError::Empty);
        }

        // AnnotationLayer.layersFromIds + the TracingBase AnnotationProto.
        let mut layers = Vec::new();
        if let Some(id) = &params.new_skeleton_tracing_id {
            layers.push(AnnotationLayer {
                tracing_id: id.clone(),
                typ: AnnotationLayerType::Skeleton,
                name: "Skeleton".into(),
            });
        }
        if let Some(id) = &params.new_volume_tracing_id {
            layers.push(AnnotationLayer {
                tracing_id: id.clone(),
                typ: AnnotationLayerType::Volume,
                name: "Volume".into(),
            });
        }
        let base_annotation_id = ObjectId::new();
        let proto = AnnotationProto {
            description: String::new(),
            version: 0,
            annotation_layers: layers
                .iter()
                .map(|layer| AnnotationLayerProto {
                    tracing_id: layer.tracing_id.clone(),
                    name: layer.name.clone(),
                    typ: match layer.typ {
                        AnnotationLayerType::Skeleton => AnnotationLayerTypeProto::Skeleton,
                        AnnotationLayerType::Volume => AnnotationLayerTypeProto::Volume,
                    } as i32,
                })
                .collect(),
            earliest_accessible_version: 0,
            ..Default::default()
        };
        services
            .tracing_store
            .save_annotation_proto(tracing_store_url, &base_annotation_id, &proto)
            .await
            .map_err(service_failure)?;

        // taskDAO.insertOne + insertExperienceToListing + annotationDAO.insertOne,
        // in one transaction (Scala: separate statements).
        let task_id = ObjectId::new();
        let created = now_millis();
        let domain = params.needed_experience.domain.trim();
        let bbox = BoundingBox::non_empty(params.bounding_box);
        let mut tx = pool.begin().await?;
        sqlx::query(
            "INSERT INTO webknossos.tasks(_id,_project,_script,_taskType,neededExperience_domain,neededExperience_value,
               totalInstances,pendingInstances,tracingTime,boundingBox,editPosition,editRotation,creationInfo,created,isDeleted)
             VALUES($1,$2,$3,$4,$5,$6,$7,$7,NULL,
               CASE WHEN $8::float8 IS NULL THEN NULL ELSE ROW($8,$9,$10,$11,$12,$13)::webknossos.BOUNDING_BOX END,
               ROW($14,$15,$16)::webknossos.VECTOR3,ROW($17,$18,$19)::webknossos.VECTOR3,$20,$21,false)",
        )
        .bind(task_id.as_str())
        .bind(&project.id)
        .bind(params.script_id.as_ref().map(ObjectId::as_str))
        .bind(task_type.id.as_str())
        .bind(domain)
        .bind(params.needed_experience.value)
        .bind(i64::from(params.pending_instances))
        .bind(bbox.map(|b| f64::from(b.top_left[0])))
        .bind(bbox.map(|b| f64::from(b.top_left[1])))
        .bind(bbox.map(|b| f64::from(b.top_left[2])))
        .bind(bbox.map(|b| f64::from(b.width)))
        .bind(bbox.map(|b| f64::from(b.height)))
        .bind(bbox.map(|b| f64::from(b.depth)))
        .bind(f64::from(params.edit_position[0]))
        .bind(f64::from(params.edit_position[1]))
        .bind(f64::from(params.edit_position[2]))
        .bind(params.edit_rotation[0])
        .bind(params.edit_rotation[1])
        .bind(params.edit_rotation[2])
        .bind(&params.creation_info)
        .bind(created)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO webknossos.experienceDomains(domain,_organization) VALUES($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(domain)
        .bind(&user.organization_id)
        .execute(&mut *tx)
        .await?;
        insert_annotation(
            &mut tx,
            &NewAnnotation {
                id: &base_annotation_id,
                dataset_id: dataset.id.as_str(),
                task_id: Some(task_id.as_str()),
                owner_id: &user.id,
                description: params.description.as_deref().unwrap_or(""),
                name: "",
                annotation_type: "TracingBase",
                visibility: "Internal",
                collaboration_mode: "OwnerOnly",
                created,
            },
            &layers,
        )
        .await?;
        tx.commit().await?;

        let mut connection = pool.acquire().await?;
        Ok(crate::tasks::public_json(&mut connection, user, task_id.as_str(), false).await?)
    };
    match attempt.await {
        Ok(json) => Ok(Ok(json)),
        Err(error) => TaskFailure::from_provider(error).map(Err),
    }
}

/// warnIfTeamHasNoAccess: one warning per project team (of the requested
/// projects, in order) that is neither an allowed team of the dataset (or
/// its folders, cumulative) nor fully covered by them (non-admin, active
/// members). A missing project or unreadable team fails the request.
async fn warnings(
    pool: &PgPool,
    user: &AuthUser,
    dataset: &DatasetFacts,
    project_names: &[&str],
) -> Result<Vec<String>, ProviderError> {
    let mut names: Vec<&str> = Vec::new();
    for name in project_names {
        if !names.contains(name) {
            names.push(name);
        }
    }
    let mut project_teams = Vec::new();
    for name in names {
        let project = find_project(pool, user, name)
            .await?
            .ok_or_else(|| failure(project_not_found(name), None))?;
        project_teams.push(project.team);
    }
    let dataset_teams: Vec<String> = sqlx::query_scalar(
        "SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset=$1
         UNION
         SELECT DISTINCT at._team FROM webknossos.folder_allowedTeams at
           JOIN webknossos.folder_paths fp ON at._folder=fp._ancestor
           JOIN webknossos.datasets_ d ON fp._descendant=d._folder
           WHERE d._id=$1",
    )
    .bind(dataset.id.as_str())
    .fetch_all(pool)
    .await?;
    let mut warnings = Vec::new();
    for team in project_teams {
        if dataset_teams.contains(&team) {
            continue;
        }
        if !dataset_teams.is_empty() {
            let uncovered: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM webknossos.users_ u
                   JOIN webknossos.user_team_roles tr ON u._id=tr._user
                   WHERE NOT u.isAdmin AND NOT u.isDeactivated AND tr._team=$1
                     AND u._id NOT IN (SELECT _user FROM webknossos.user_team_roles WHERE _team = ANY($2)))",
            )
            .bind(&team)
            .bind(&dataset_teams)
            .fetch_one(pool)
            .await?;
            if !uncovered {
                continue;
            }
        }
        let name: Option<String> = sqlx::query_scalar(
            "SELECT t.name FROM webknossos.teams_ t WHERE t._id=$1
               AND (t._id IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
                 OR t._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
        )
        .bind(&team)
        .bind(&user.id)
        .fetch_optional(pool)
        .await?;
        let name = name.ok_or(ProviderError::Empty)?;
        warnings.push(format!(
            "Project team “{name}” has no read permission to dataset “{}”.",
            dataset.name
        ));
    }
    Ok(warnings)
}

/// TaskCreationResult JSON: `{status: 200, success: <task>}` or
/// `{status, error}` per requested task, plus warnings.
fn result_json(items: Vec<Result<Value, TaskFailure>>, warnings: Vec<String>) -> Value {
    let tasks: Vec<Value> = items
        .into_iter()
        .map(|item| match item {
            Ok(task) => json!({"status": 200, "success": task}),
            Err(f) => json!({"status": f.status.as_u16(), "error": f.message}),
        })
        .collect();
    json!({"tasks": tasks, "warnings": warnings})
}

/// TaskCreationService.createTasks. Whole-request failures (in order): one
/// dataset among the successful requests (`notOnSameDataset`), readable
/// (`Dataset.notFound`), usable data source, every task has a base, a
/// skeleton or a volume (`needsEitherSkeletonOrVolume`), a tracing store,
/// the saveMultiple RPC, then (after all tasks were created, as in Scala)
/// the warnings' project/team lookups. Everything else is a per-task item.
pub(crate) async fn create_tasks(
    pool: &PgPool,
    services: &CreationServices,
    requested: Vec<RequestedTaskResult>,
    task_type: &TaskTypeFacts,
    user: &AuthUser,
) -> ApiResult<Value> {
    let successful: Vec<&RequestedTask> =
        requested.iter().filter_map(|r| r.as_ref().ok()).collect();
    if successful.is_empty() {
        let items = requested
            .into_iter()
            .map(|r| r.map(|_| json!({})))
            .collect();
        return Ok(result_json(items, Vec::new()));
    }
    let dataset_id = unique(successful.iter().map(|t| t.params.dataset_id.clone()))
        .ok_or_else(|| ApiError::bad_request(NOT_ON_SAME_DATASET))?;
    let dataset = find_readable_dataset(pool, user, &dataset_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(dataset_not_found(dataset_id.as_str())))?;
    let source = annotation_create::usable_data_source(pool, &dataset).await?;
    if !successful
        .iter()
        .all(|t| t.params.base_annotation.is_some() || t.skeleton.is_some() || t.volume.is_some())
    {
        return Err(ApiError::bad_request(NEEDS_EITHER_SKELETON_OR_VOLUME));
    }
    let with_base = successful
        .iter()
        .filter(|t| t.params.base_annotation.is_some())
        .count();
    if with_base > 0 {
        services
            .slack
            .notice_base_annotation_task_creation(task_type.id.as_str(), with_base);
    }
    let url = annotation_create::tracing_store_url(pool).await?;
    let skeleton_saves = save_skeleton_tracings(&services.tracing_store, &url, &requested).await?;
    // Volume tracings are saved sequentially to reduce server load.
    let mut volume_saves = Vec::with_capacity(requested.len());
    for item in &requested {
        volume_saves.push(match item {
            Ok(RequestedTask {
                params,
                volume: Some(volume),
                ..
            }) => {
                let saved = match (&params.new_annotation_id, &params.new_volume_tracing_id) {
                    (Some(annotation_id), Some(tracing_id)) => {
                        save_volume_tracing(
                            services,
                            &url,
                            annotation_id,
                            tracing_id,
                            volume,
                            task_type.mag_restrictions,
                            &source,
                            &params.dataset_id,
                        )
                        .await
                    }
                    _ => Err(ProviderError::Empty),
                };
                match saved {
                    Ok(()) => SaveBox::Full,
                    Err(ProviderError::Empty) => SaveBox::Empty,
                    Err(error) => SaveBox::Failure(TaskFailure::from_provider(error)?),
                }
            }
            Err(failure) => SaveBox::Failure(failure.clone()),
            Ok(_) => SaveBox::Empty,
        });
    }
    let mut items = Vec::with_capacity(requested.len());
    for (index, item) in requested.iter().enumerate() {
        let skeleton_save = skeleton_saves.get(index).unwrap_or(&SaveBox::Empty);
        items.push(
            create_one(
                pool,
                services,
                &url,
                item,
                skeleton_save,
                &volume_saves[index],
                task_type,
                user,
                &dataset,
            )
            .await?,
        );
    }
    let project_names: Vec<&str> = successful
        .iter()
        .map(|t| t.params.project_name.as_str())
        .collect();
    let warnings = warnings(pool, user, &dataset, &project_names).await?;
    Ok(result_json(items, warnings))
}

// ---------------------------------------------------------------------------
// POST /tasks
// ---------------------------------------------------------------------------

pub fn router(_jobs_enabled: bool) -> Router<AppState> {
    Router::new().route("/tasks", post(create))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    services: CreationServices,
    Json(body): Json<Vec<TaskParameters>>,
) -> ApiResult<axum::Json<Value>> {
    let pool = &state.pool;
    if body.is_empty() {
        return Err(ApiError::bad_request(NO_TASKS));
    }
    let task_type_id = unique(body.iter().map(|p| p.task_type_id.clone()))
        .ok_or_else(|| ApiError::bad_request(NOT_ON_SAME_TASK_TYPE))?;
    let task_type = find_task_type(pool, &user, &task_type_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(task_type_not_found(task_type_id.as_str())))?;
    let dataset_id = unique(body.iter().map(|p| p.dataset_id.clone()))
        .ok_or_else(|| ApiError::bad_request(NOT_ON_SAME_DATASET))?;
    let dataset = find_readable_dataset(pool, &user, &dataset_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(dataset_not_found(dataset_id.as_str())))?;
    let source = annotation_create::usable_data_source(pool, &dataset).await?;
    if dataset.organization_id != user.organization_id {
        return Err(ApiError::bad_request(DATASET_OF_OTHER_ORGA));
    }
    assert_batch_limit(body.len(), &task_type)?;

    let mut all_params = body;
    for params in &mut all_params {
        add_new_ids(params, &task_type);
    }
    for params in &mut all_params {
        create_tracings_from_base_annotation(
            pool, &services, &user, params, &task_type, &dataset, &source,
        )
        .await?;
    }
    let skeletons: Vec<Option<SkeletonTracing>> = all_params
        .iter()
        .map(|params| {
            (params.base_annotation.is_none() && params.new_skeleton_tracing_id.is_some()).then(
                || {
                    skeleton_tracing_base(
                        params.bounding_box,
                        params.edit_position,
                        params.edit_rotation,
                    )
                },
            )
        })
        .collect();
    let mut volumes = Vec::with_capacity(all_params.len());
    for params in &all_params {
        volumes.push(
            if params.new_volume_tracing_id.is_some() && params.base_annotation.is_none() {
                Some(VolumeBase {
                    tracing: volume_tracing_base(
                        pool,
                        &dataset,
                        &source,
                        params.bounding_box,
                        params.edit_position,
                        params.edit_rotation,
                        task_type.mag_restrictions,
                    )
                    .await?,
                    initial_data: None,
                })
            } else {
                None
            },
        );
    }
    let requested = all_params
        .into_iter()
        .zip(skeletons)
        .zip(volumes)
        .map(|((params, skeleton), volume)| {
            Ok(RequestedTask {
                params,
                skeleton,
                volume,
            })
        })
        .collect();
    let result = create_tasks(pool, &services, requested, &task_type, &user).await?;
    Ok(axum::Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn java_double_literals() {
        assert_eq!(java_double(0.0), "0.0");
        assert_eq!(java_double(-0.0), "-0.0");
        assert_eq!(java_double(90.0), "90.0");
        assert_eq!(java_double(1.5), "1.5");
        assert_eq!(java_double(1e7), "1.0E7");
        assert_eq!(java_double(1.25e-5), "1.25E-5");
        assert_eq!(vec3_double_literal([0.0, 12.5, 360.0]), "0.0,12.5,360.0");
        assert_eq!(
            BoundingBox {
                top_left: [1, -2, 3],
                width: 4,
                height: 5,
                depth: 6
            }
            .literal(),
            "1,-2,3,4,5,6"
        );
    }

    #[test]
    fn task_parameters_follow_play_format() {
        let body = json!({
            "taskTypeId": "5a5f2f4d2b00002b00b4b2a1", "neededExperience": {"domain": "d", "value": 1},
            "pendingInstances": 2, "projectName": "p", "datasetId": "5a5f2f4d2b00002b00b4b2a2",
            "editPosition": [1, 2, 3], "editRotation": [0, 0.5, 1], "scriptId": null,
            "baseAnnotation": {"baseId": "x"}
        });
        let params: TaskParameters = serde_json::from_value(body.clone()).unwrap();
        assert_eq!(params.base_annotation.unwrap().skeleton_id, None);
        assert_eq!(params.edit_rotation, [0.0, 0.5, 1.0]);
        let mut missing = body;
        missing.as_object_mut().unwrap().remove("editPosition");
        assert!(serde_json::from_value::<TaskParameters>(missing).is_err());
    }

    #[test]
    fn batch_limit_and_ids_follow_tracing_type() {
        let mut task_type = TaskTypeFacts {
            id: ObjectId::new(),
            tracing_type: TracingType::Skeleton,
            mag_restrictions: MagRestrictions::default(),
        };
        assert!(assert_batch_limit(1000, &task_type).is_ok());
        assert!(assert_batch_limit(1001, &task_type).is_err());
        task_type.tracing_type = TracingType::Hybrid;
        let error = assert_batch_limit(101, &task_type).unwrap_err();
        assert_eq!(
            error.message,
            "Cannot create more than 100 tasks in one request."
        );
        let mut params: TaskParameters = serde_json::from_value(json!({
            "taskTypeId": "5a5f2f4d2b00002b00b4b2a1", "neededExperience": {"domain": "d", "value": 1},
            "pendingInstances": 2, "projectName": "p", "datasetId": "5a5f2f4d2b00002b00b4b2a2",
            "editPosition": [1, 2, 3], "editRotation": [0, 0, 0]
        }))
        .unwrap();
        add_new_ids(&mut params, &task_type);
        assert!(params.new_skeleton_tracing_id.is_some() && params.new_volume_tracing_id.is_some());
        task_type.tracing_type = TracingType::Volume;
        add_new_ids(&mut params, &task_type);
        assert!(params.new_skeleton_tracing_id.is_none() && params.new_volume_tracing_id.is_some());
    }

    #[test]
    fn skeleton_base_has_one_node_tree() {
        let empty = BoundingBox {
            top_left: [0, 0, 0],
            width: 0,
            height: 1,
            depth: 1,
        };
        let tracing = skeleton_tracing_base(Some(empty), [1, 2, 3], [0.0, 90.0, 0.0]);
        assert_eq!(tracing.bounding_box, None);
        assert_eq!(tracing.dataset_name, "unused");
        assert_eq!(tracing.active_node_id, Some(1));
        assert_eq!(tracing.trees.len(), 1);
        let tree = &tracing.trees[0];
        assert_eq!(
            (tree.tree_id, tree.nodes.len(), tree.nodes[0].id),
            (1, 1, 1)
        );
        assert_eq!(tree.nodes[0].position, Vec3IntProto { x: 1, y: 2, z: 3 });
        assert_eq!(tree.branch_points[0].node_id, 1);
        assert_eq!(tree.color.unwrap().r, 1.0);
    }
}
