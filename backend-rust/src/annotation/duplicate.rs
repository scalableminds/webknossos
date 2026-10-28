//! AnnotationController.duplicate (`POST /annotations/:typ/:id/duplicate`)
//! and its private `duplicateAnnotation`: the provided (saved or compound)
//! annotation is copied in the tracing store
//! (WKRemoteTracingStoreClient.duplicateAnnotation) and a NEW Explorational
//! owned by the requester is inserted (AnnotationService.createFrom +
//! AnnotationDAO.insertOne), then serialized with the ORIGINAL annotation's
//! restrictions (Scala passes `restrictionsFor(typ, id)` to publicWrites).
//! The requester needs `allowAccess` on the original.
//!
//! The tracing-store step is shared with task assignment
//! (AnnotationService.createAnnotationFor), see [`duplicate_in_tracing_store`].
mod annotation_duplicate_dao;

use axum::extract::FromRef;
use axum::{
    Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    routing::post,
};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::{
    AppState,
    annotation::metadata::PUBLIC_WRITES_FAILED,
    annotation::provider::{
        AccessContext, AnnotationIdentifier, AnnotationLayer, AnnotationProvider,
        ProvidedAnnotation, ProviderError, RESTRICTIONS_NOT_FOUND,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Path,
    state::JobsEnabled,
    stores::tracing_client::{DuplicateAnnotationRequest, TracingStoreClient},
    util::id::ObjectId,
    util::instant::now_millis,
};

/// Msg.Annotation.duplicateFailed.
pub const DUPLICATE_FAILED: &str = "Could not duplicate annotation.";

pub fn router() -> Router<AppState> {
    Router::new().route("/annotations/{typ}/{id}/duplicate", post(duplicate))
}

struct Services {
    provider: AnnotationProvider,
    tracing_store: TracingStoreClient,
    jobs_enabled: bool,
}

impl<S: Send + Sync> FromRequestParts<S> for Services
where
    JobsEnabled: FromRef<S>,
    TracingStoreClient: FromRef<S>,
    AnnotationProvider: FromRef<S>,
{
    type Rejection = ApiError;
    async fn from_request_parts(_parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: AnnotationProvider::from_ref(state),
            tracing_store: TracingStoreClient::from_ref(state),
            jobs_enabled: JobsEnabled::from_ref(state).0,
        })
    }
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
    let url = crate::stores::tracing_client::find_first_tracing_store_url(pool)
        .await?
        .ok_or_else(|| ProviderError::failure(crate::msg::tracing_store::NOT_FOUND))?;
    let proto = tracing_store
        .duplicate_annotation(&url, request)
        .await
        .map_err(ProviderError::from)?;
    Ok(crate::annotation::provider::layers_from_proto(&proto))
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/// Columns of a new annotation row (AnnotationDAO.insertOne). Unlisted
/// columns use the Annotation defaults: no publication, Active, unlocked,
/// no tags, no tracing time, not deleted.
pub(crate) struct NewAnnotation<'a> {
    pub id: &'a ObjectId,
    pub dataset_id: &'a ObjectId,
    pub task_id: Option<&'a ObjectId>,
    pub owner_id: &'a ObjectId,
    pub description: &'a str,
    pub name: &'a str,
    /// `Explorational`, `Task`, `TracingBase` or `Orphan`.
    pub annotation_type: &'a str,
    pub visibility: &'a str,
    pub collaboration_mode: &'a str,
    /// created = modified (Instant.now, millisecond precision).
    pub created: DateTime<Utc>,
}

/// AnnotationDAO.insertOne: annotation row + layers (statistics `{}`). Run
/// it inside the caller's transaction (Scala `.transactionally`).
pub(crate) async fn insert_annotation(
    connection: &mut PgConnection,
    annotation: &NewAnnotation<'_>,
    layers: &[AnnotationLayer],
) -> ApiResult<()> {
    crate::annotation::annotation_dao::insert_one(connection, annotation).await?;
    for layer in layers {
        crate::annotation::annotation_dao::insert_layer(
            connection,
            annotation.id,
            &layer.tracing_id,
            layer.typ.as_str(),
            &layer.name,
        )
        .await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// duplicateAnnotation
// ---------------------------------------------------------------------------

/// The fields of the provided annotation that duplicateAnnotation reads.
pub(crate) struct DuplicateSource<'a> {
    pub id: &'a ObjectId,
    pub dataset_id: &'a ObjectId,
    pub owner_id: &'a ObjectId,
    pub task_id: Option<&'a ObjectId>,
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
                task_id: saved.task_id.as_ref(),
                description: &saved.description,
            },
            ProvidedAnnotation::Compound(compound) => Self {
                id: &compound.id,
                dataset_id: &compound.dataset_id,
                owner_id: &compound.owner_id,
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
    dataset_id: &ObjectId,
    has_voxel_size: bool,
) -> Result<[i32; 6], ProviderError> {
    if !has_voxel_size {
        return Err(ProviderError::failure(
            crate::msg::dataset::data_source::USABLE_BUT_NO_VOXEL_SIZE,
        )
        .wrap(crate::msg::dataset::data_source::NOT_FOUND)
        .with_status(StatusCode::NOT_FOUND));
    }
    let boxes = annotation_duplicate_dao::find_layer_bounding_boxes(pool, dataset_id).await?;
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
    let dataset = annotation_duplicate_dao::find_dataset_usability(pool, source.dataset_id).await?;
    let (is_usable, has_voxel_size) = dataset.ok_or_else(|| {
        ProviderError::failure(crate::msg::dataset::not_found_for_annotation(
            source.dataset_id,
            source.id,
        ))
        .with_status(StatusCode::NOT_FOUND)
    })?;
    if !is_usable {
        return Err(ProviderError::failure(crate::msg::dataset::not_usable(
            source.dataset_id,
        )));
    }
    let is_from_task = source.task_id.is_some();
    let dataset_bounding_box = if is_from_task {
        Some(usable_data_source_bounding_box(pool, source.dataset_id, has_voxel_size).await?)
    } else {
        None
    };
    let request = DuplicateAnnotationRequest {
        source_annotation_id: source.id.clone(),
        new_annotation_id: new_annotation_id.clone(),
        owner_id: source.owner_id.clone(),
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
    // restrictionsFor(typ, id) of the ORIGINAL annotation ?~> notFound ~> 404,
    // then allowAccess ?~> Msg.notAllowed ~> 403, both before duplicating.
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
    if !restrictions.allow_access {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let source = DuplicateSource::from_provided(&annotation);
    let new_id = ObjectId::new();
    // duplicateAnnotation(..) ?~> Msg.Annotation.duplicateFailed: failures
    // keep a ParamFailure status (404 dataset/data source, upstream RPC
    // status), otherwise 400. Database faults stay 5xx.
    let layers = duplicate_source_in_tracing_store(
        &state.pool,
        &services.tracing_store,
        &source,
        &new_id,
        &user.id,
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
    // publicWrites(new, user, original restrictions) ?~> publicWritesFailed,
    // before commit so a failure leaves no row behind.
    let mut json = crate::annotation::lists::full_json(
        &mut transaction,
        &user,
        &new_id,
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
    json["restrictions"] = restrictions.public_json();
    transaction.commit().await?;
    Ok(Json(json))
}

#[cfg(test)]
mod tests;
