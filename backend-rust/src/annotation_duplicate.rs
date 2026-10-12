//! AnnotationController.duplicate (`POST /annotations/:typ/:id/duplicate`)
//! and its private `duplicateAnnotation`: the provided (saved or compound)
//! annotation is copied in the tracing store
//! (WKRemoteTracingStoreClient.duplicateAnnotation) and a NEW Explorational
//! owned by the requester is inserted (AnnotationService.createFrom +
//! AnnotationDAO.insertOne), then serialized with the ORIGINAL annotation's
//! restrictions (Scala passes `restrictionsFor(typ, id)` to publicWrites).
//!
//! The tracing-store step is shared with task assignment
//! (AnnotationService.createAnnotationFor), see [`duplicate_in_tracing_store`].
use axum::{
    Extension, Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    routing::post,
};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};

use crate::{
    AppState,
    annotation_access::Restrictions,
    annotation_lists,
    annotation_metadata::PUBLIC_WRITES_FAILED,
    annotation_provider::{
        AccessContext, AnnotationIdentifier, AnnotationLayer, AnnotationLayerType,
        AnnotationProvider, DATA_SOURCE_NOT_FOUND, FoxFailure, ProvidedAnnotation, ProviderError,
        RESTRICTIONS_NOT_FOUND, USABLE_BUT_NO_VOXEL_SIZE, dataset_not_found_for_annotation,
        dataset_not_usable,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Path,
    id::ObjectId,
    proto::{AnnotationLayerTypeProto, AnnotationProto},
    service_clients::ServiceError,
    tracingstore_client::{
        self, DuplicateAnnotationRequest, TRACING_STORE_NOT_FOUND, TracingStoreClient,
        TracingStoreError,
    },
};

/// Msg.Annotation.duplicateFailed.
pub const DUPLICATE_FAILED: &str = "Could not duplicate annotation.";

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/annotations/{typ}/{id}/duplicate", post(duplicate))
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

struct Services {
    provider: AnnotationProvider,
    tracing_store: TracingStoreClient,
    jobs_enabled: bool,
}

fn extension<T: Clone + Send + Sync + 'static>(parts: &Parts) -> ApiResult<T> {
    parts
        .extensions
        .get::<T>()
        .cloned()
        .ok_or_else(ApiError::internal)
}

impl<S: Send + Sync> FromRequestParts<S> for Services {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: extension(parts)?,
            tracing_store: extension(parts)?,
            jobs_enabled: extension::<JobsEnabled>(parts)?.0,
        })
    }
}

/// AnnotationLayer.fromProto for every layer (statistics `unknown` = `{}`).
pub(crate) fn layers_from_proto(proto: &AnnotationProto) -> Vec<AnnotationLayer> {
    proto
        .annotation_layers
        .iter()
        .map(|layer| AnnotationLayer {
            tracing_id: layer.tracing_id.clone(),
            typ: match layer.typ() {
                AnnotationLayerTypeProto::Skeleton => AnnotationLayerType::Skeleton,
                AnnotationLayerTypeProto::Volume => AnnotationLayerType::Volume,
            },
            name: layer.name.clone(),
        })
        .collect()
}

fn failure(message: impl Into<String>, status: Option<StatusCode>) -> ProviderError {
    ProviderError::Failure(FoxFailure {
        message: message.into(),
        chain: Vec::new(),
        status,
    })
}

/// RPC failures are Fox failures; only an unsuccessful upstream HTTP status
/// is kept as ParamFailure status (RPCRequest `~> result.status`).
fn tracing_store_failure(error: TracingStoreError) -> ProviderError {
    let status = match &error {
        TracingStoreError::Service(ServiceError::UpstreamStatus(code)) => {
            StatusCode::from_u16(*code).ok()
        }
        _ => None,
    };
    failure(error.to_string(), status)
}

/// Shared core: `tracingStoreService.clientFor(dataset)` (first live tracing
/// store, `?~> Msg.TracingStore.notFound`) + duplicateAnnotation RPC +
/// AnnotationLayer.fromProto. Writes nothing to the database.
///
/// Callers:
/// - AnnotationController.duplicateAnnotation: owner = source owner,
///   requester = request user, version None, `is_from_task = source._task.isDefined`,
///   bounding box = usable data source box only when `is_from_task`; then
///   [`insert_annotation`] as a new Explorational.
/// - AnnotationService.createAnnotationFor (task assignment): source = the
///   task's TracingBase id, new id = the Initializing annotation id, owner =
///   TracingBase owner, requester = assignee, version None,
///   `is_from_task = false`, no bounding box; then AnnotationDAO.updateInitialized
///   (UPDATE the Initializing row to Task/Active with the new layers).
pub(crate) async fn duplicate_in_tracing_store(
    pool: &PgPool,
    tracing_store: &TracingStoreClient,
    request: &DuplicateAnnotationRequest,
) -> Result<Vec<AnnotationLayer>, ProviderError> {
    let url = tracingstore_client::find_first_tracing_store_url(pool)
        .await?
        .ok_or_else(|| failure(TRACING_STORE_NOT_FOUND, None))?;
    let proto = tracing_store
        .duplicate_annotation(&url, request)
        .await
        .map_err(tracing_store_failure)?;
    Ok(layers_from_proto(&proto))
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/// Columns of a new annotation row (AnnotationDAO.insertOne). Unlisted
/// columns use the Annotation defaults: no publication, Active, unlocked,
/// no tags, no tracing time, not deleted.
pub(crate) struct NewAnnotation<'a> {
    pub id: &'a ObjectId,
    pub dataset_id: &'a str,
    pub task_id: Option<&'a str>,
    pub owner_id: &'a str,
    pub description: &'a str,
    pub name: &'a str,
    /// `Explorational`, `Task`, `TracingBase` or `Orphan`.
    pub annotation_type: &'a str,
    pub visibility: &'a str,
    pub collaboration_mode: &'a str,
    /// created = modified (Instant.now, millisecond precision).
    pub created: DateTime<Utc>,
}

fn layer_type(typ: AnnotationLayerType) -> &'static str {
    match typ {
        AnnotationLayerType::Skeleton => "Skeleton",
        AnnotationLayerType::Volume => "Volume",
    }
}

/// AnnotationDAO.insertOne: annotation row + layers (statistics `{}`). Run
/// it inside the caller's transaction (Scala `.transactionally`).
pub(crate) async fn insert_annotation(
    connection: &mut PgConnection,
    annotation: &NewAnnotation<'_>,
    layers: &[AnnotationLayer],
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,description,visibility,name,state,tags,tracingTime,typ,collaborationMode,created,modified,isDeleted)
         VALUES($1,$2,$3,$4,$5,$6::webknossos.ANNOTATION_VISIBILITY,$7,'Active','{}',NULL,$8::webknossos.ANNOTATION_TYPE,$9::webknossos.ANNOTATION_COLLABORATION_MODE,$10,$10,false)",
    )
    .bind(annotation.id.as_str())
    .bind(annotation.dataset_id)
    .bind(annotation.task_id)
    .bind(annotation.owner_id)
    .bind(annotation.description)
    .bind(annotation.visibility)
    .bind(annotation.name)
    .bind(annotation.annotation_type)
    .bind(annotation.collaboration_mode)
    .bind(annotation.created)
    .execute(&mut *connection)
    .await?;
    for layer in layers {
        sqlx::query(
            "INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics)
             VALUES($1,$2,$3::webknossos.ANNOTATION_LAYER_TYPE,$4,'{}'::jsonb)",
        )
        .bind(annotation.id.as_str())
        .bind(&layer.tracing_id)
        .bind(layer_type(layer.typ))
        .bind(&layer.name)
        .execute(&mut *connection)
        .await?;
    }
    Ok(())
}

/// Instant.now (millisecond precision).
fn now_millis() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap_or_else(Utc::now)
}

// ---------------------------------------------------------------------------
// duplicateAnnotation
// ---------------------------------------------------------------------------

/// The fields of the provided annotation that duplicateAnnotation reads.
pub(crate) struct DuplicateSource<'a> {
    pub id: &'a str,
    pub dataset_id: &'a str,
    pub owner_id: &'a str,
    pub task_id: Option<&'a str>,
    pub description: &'a str,
}

impl<'a> DuplicateSource<'a> {
    /// Saved rows use their stored fields; compounds have no task and an
    /// empty description (AnnotationMerger.mergeN defaults).
    pub fn from_provided(annotation: &'a ProvidedAnnotation) -> Self {
        match annotation {
            ProvidedAnnotation::Saved(saved) => Self {
                id: &saved.id,
                dataset_id: &saved.dataset_id,
                owner_id: &saved.owner_id,
                task_id: saved.task_id.as_deref(),
                description: &saved.description,
            },
            ProvidedAnnotation::Compound(compound) => Self {
                id: compound.id.as_str(),
                dataset_id: compound.dataset_id.as_str(),
                owner_id: compound.owner_id.as_str(),
                task_id: None,
                description: "",
            },
        }
    }
}

/// DatasetService.usableDataSourceFor(dataset).boundingBox for a usable
/// dataset: missing voxel size → `usableButNoVoxelSize ?~> DataSource.notFound
/// ~> 404`; otherwise BoundingBox.union of all layer boxes (empty = zeros).
async fn usable_data_source_bounding_box(
    pool: &PgPool,
    dataset_id: &str,
    has_voxel_size: bool,
) -> Result<[i32; 6], ProviderError> {
    if !has_voxel_size {
        return Err(failure(USABLE_BUT_NO_VOXEL_SIZE, None)
            .wrap(DATA_SOURCE_NOT_FOUND)
            .with_status(StatusCode::NOT_FOUND));
    }
    let boxes: Vec<Vec<i32>> = sqlx::query_scalar(
        "SELECT ARRAY[(boundingBox).x::int,(boundingBox).y::int,(boundingBox).z::int,
           (boundingBox).width::int,(boundingBox).height::int,(boundingBox).depth::int]
         FROM webknossos.dataset_layers WHERE _dataset=$1 ORDER BY name",
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await?;
    let mut union: Option<[i32; 6]> = None;
    for bbox in boxes {
        let bbox = <[i32; 6]>::try_from(bbox).map_err(|_| ApiError::internal())?;
        union = Some(match union {
            None => bbox,
            Some(acc) => bbox_union(&acc, &bbox),
        });
    }
    Ok(union.unwrap_or([0; 6]))
}

/// BoundingBox.union (JVM Int wrapping arithmetic).
fn bbox_union(a: &[i32; 6], b: &[i32; 6]) -> [i32; 6] {
    let bottom_right = |v: &[i32; 6]| {
        [
            v[0].wrapping_add(v[3]),
            v[1].wrapping_add(v[4]),
            v[2].wrapping_add(v[5]),
        ]
    };
    let (br_a, br_b) = (bottom_right(a), bottom_right(b));
    let (x, y, z) = (a[0].min(b[0]), a[1].min(b[1]), a[2].min(b[2]));
    [
        x,
        y,
        z,
        br_a[0].max(br_b[0]).wrapping_sub(x),
        br_a[1].max(br_b[1]).wrapping_sub(y),
        br_a[2].max(br_b[2]).wrapping_sub(z),
    ]
}

trait WithStatus {
    fn with_status(self, status: StatusCode) -> Self;
}

impl WithStatus for ProviderError {
    /// Fox `~> status` on a failure (ParamFailure).
    fn with_status(self, status: StatusCode) -> Self {
        match self {
            Self::Failure(failure) => Self::Failure(FoxFailure {
                status: Some(status),
                ..failure
            }),
            other => other,
        }
    }
}

/// AnnotationController.duplicateAnnotation up to (not including) the insert:
/// dataset read globally (`?~> notFoundForAnnotation ~> 404`), `isUsable`
/// (`?~> notUsable`), data source box only for task annotations, then the
/// shared tracing-store step. Returns the new layers.
pub(crate) async fn duplicate_source_in_tracing_store(
    pool: &PgPool,
    tracing_store: &TracingStoreClient,
    source: &DuplicateSource<'_>,
    new_annotation_id: &ObjectId,
    requesting_user_id: &ObjectId,
) -> Result<Vec<AnnotationLayer>, ProviderError> {
    // GlobalAccessContext: the requester was already allowed to see the annotation.
    let dataset: Option<(bool, bool)> = sqlx::query_as(
        "SELECT isUsable, voxelSizeFactor IS NOT NULL FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(source.dataset_id)
    .fetch_optional(pool)
    .await?;
    let (is_usable, has_voxel_size) = dataset.ok_or_else(|| {
        failure(
            dataset_not_found_for_annotation(source.dataset_id, source.id),
            Some(StatusCode::NOT_FOUND),
        )
    })?;
    if !is_usable {
        return Err(failure(dataset_not_usable(source.dataset_id), None));
    }
    let is_from_task = source.task_id.is_some();
    let dataset_bounding_box = if is_from_task {
        Some(usable_data_source_bounding_box(pool, source.dataset_id, has_voxel_size).await?)
    } else {
        None
    };
    let request = DuplicateAnnotationRequest {
        source_annotation_id: ObjectId::parse(source.id)?,
        new_annotation_id: new_annotation_id.clone(),
        owner_id: ObjectId::parse(source.owner_id)?,
        requesting_user_id: requesting_user_id.clone(),
        version: None,
        is_from_task,
        dataset_bounding_box,
    };
    duplicate_in_tracing_store(pool, tracing_store, &request).await
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

fn restrictions_json(restrictions: &Restrictions) -> Value {
    json!({
        "allowAccess": restrictions.allow_access,
        "allowUpdate": restrictions.allow_update,
        "allowFinish": restrictions.allow_finish,
        "allowDownload": restrictions.allow_download,
    })
}

/// POST /annotations/:typ/:id/duplicate
async fn duplicate(
    State(state): State<AppState>,
    services: Services,
    Path((typ, id)): Path<(String, String)>,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let access = AccessContext::requester(Some(&user));
    // provideAnnotation(typ, id, user) ~> NOT_FOUND (invalid types included).
    let annotation = services
        .provider
        .provide(access, &typ, &id)
        .await
        .map_err(|error| error.into_api_error(StatusCode::NOT_FOUND))?;
    let source = DuplicateSource::from_provided(&annotation);
    let requester_id = ObjectId::parse(&user.id)?;
    let new_id = ObjectId::new();
    // duplicateAnnotation(..) ?~> Msg.Annotation.duplicateFailed: failures
    // keep a ParamFailure status (404 dataset/data source, upstream RPC
    // status), otherwise 400. Database faults stay 5xx.
    let layers = duplicate_source_in_tracing_store(
        &state.pool,
        &services.tracing_store,
        &source,
        &new_id,
        &requester_id,
    )
    .await
    .map_err(|error| ApiError::from(error.wrap(DUPLICATE_FAILED)))?;

    // AnnotationService.createFrom(user, dataset, layers, Explorational,
    // name None → "", source description, newId) + insertOne, atomically.
    let mut transaction = state.pool.begin().await?;
    insert_annotation(
        &mut transaction,
        &NewAnnotation {
            id: &new_id,
            dataset_id: source.dataset_id,
            task_id: None,
            owner_id: &user.id,
            description: source.description,
            name: "",
            annotation_type: "Explorational",
            visibility: "Internal",
            collaboration_mode: "OwnerOnly",
            created: now_millis(),
        },
        &layers,
    )
    .await?;
    // restrictionsFor(typ, id) of the ORIGINAL annotation ?~> notFound ~> 404.
    let identifier = AnnotationIdentifier::parse(&typ, &id)
        .map_err(|error| error.into_api_error(StatusCode::NOT_FOUND))?;
    let restrictions = services
        .provider
        .restrictions_for(access, &identifier)
        .await
        .map_err(|error| {
            error
                .wrap(RESTRICTIONS_NOT_FOUND)
                .into_api_error(StatusCode::NOT_FOUND)
        })?;
    // publicWrites(new, user, original restrictions) ?~> publicWritesFailed,
    // before commit so a failure leaves no row behind.
    let mut json = annotation_lists::full_json(
        &mut transaction,
        &user,
        new_id.as_str(),
        services.jobs_enabled,
    )
    .await
    .map_err(|error| {
        if error.status.is_server_error() {
            error
        } else {
            ApiError::bad_request(PUBLIC_WRITES_FAILED)
        }
    })?;
    json["restrictions"] = restrictions_json(&restrictions);
    transaction.commit().await?;
    Ok(Json(json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounding_box_union_matches_scala() {
        assert_eq!(
            bbox_union(&[0, 0, 0, 10, 10, 10], &[5, -5, 2, 10, 10, 1]),
            [0, -5, 0, 15, 15, 10]
        );
    }
}
