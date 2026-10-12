//! Read callbacks from WKRemoteTracingStoreController. A tracing-store key
//! grants global access; the caller's path name is informational.
use axum::{
    Extension, Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    AppState, annotation_access,
    annotation_provider::{
        AccessContext, AnnotationProvider, AnnotationType, USABLE_BUT_NO_VOXEL_SIZE,
        dataset_not_found_for_annotation,
    },
    datasets,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    id::{ObjectId, PathObjectId},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/tracingstores/{name}/dataSource",
            get(data_source_for_annotation),
        )
        .route(
            "/tracingstores/{name}/datasetId",
            get(dataset_id_for_annotation),
        )
        .route(
            "/tracingstores/{name}/annotationId",
            get(annotation_id_for_tracing),
        )
        .route(
            "/tracingstores/{name}/dataStoreUri/{datasetId}",
            get(data_store_uri_for_dataset),
        )
        .route(
            "/tracingstores/{name}/datasources/{datasetId}",
            get(get_data_source),
        )
}

/// Shared service authentication for tracing-store callbacks. Put this after
/// route-specific binding and before reading any request body.
pub(crate) struct ValidatedTracingStore;

#[derive(Deserialize)]
struct KeyQuery {
    key: String,
}

impl FromRequestParts<AppState> for ValidatedTracingStore {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        let Query(query) = Query::<KeyQuery>::from_request_parts(parts, state)
            .await
            .map_err(IntoResponse::into_response)?;
        validate_key(&state.pool, &query.key)
            .await
            .map_err(IntoResponse::into_response)?;
        Ok(Self)
    }
}

/// Also usable after protobuf body parsing to preserve Play's parser ordering.
pub(crate) enum CallbackError {
    Api(ApiError),
    Plain(StatusCode, &'static str),
}

impl From<ApiError> for CallbackError {
    fn from(error: ApiError) -> Self {
        Self::Api(error)
    }
}

impl IntoResponse for CallbackError {
    fn into_response(self) -> Response {
        match self {
            Self::Api(error) => error.into_response(),
            Self::Plain(status, message) => (status, message).into_response(),
        }
    }
}

pub(crate) async fn validate_key(pool: &sqlx::PgPool, key: &str) -> Result<(), CallbackError> {
    let valid: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.tracingStores_ WHERE key=$1)")
            .bind(key)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
    if valid {
        Ok(())
    } else {
        Err(CallbackError::Plain(
            StatusCode::FORBIDDEN,
            "Tracing store could not be found or accessed.",
        ))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationQuery {
    annotation_id: ObjectId,
}

async fn annotation_dataset(
    state: &AppState,
    provider: &AnnotationProvider,
    annotation_id: &ObjectId,
) -> ApiResult<String> {
    let annotation = provider
        .provide_saved(AccessContext::global(None), annotation_id)
        .await
        .map_err(|error| error.into_api_error(StatusCode::BAD_REQUEST))?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id=$1)")
            .bind(&annotation.dataset_id)
            .fetch_one(&state.pool)
            .await?;
    if !exists {
        return Err(ApiError::bad_request(dataset_not_found_for_annotation(
            &annotation.dataset_id,
            annotation_id.as_str(),
        )));
    }
    Ok(annotation.dataset_id)
}

async fn data_source_for_annotation(
    State(state): State<AppState>,
    Query(query): Query<AnnotationQuery>,
    _store: ValidatedTracingStore,
    Extension(provider): Extension<AnnotationProvider>,
) -> ApiResult<Json<Value>> {
    if let Some(temporary) = provider.data_sources().find(&query.annotation_id) {
        return Ok(Json(temporary.data_source));
    }
    let dataset_id = annotation_dataset(&state, &provider, &query.annotation_id).await?;
    Ok(Json(data_source(&state, &dataset_id).await?))
}

async fn dataset_id_for_annotation(
    State(state): State<AppState>,
    Query(query): Query<AnnotationQuery>,
    _store: ValidatedTracingStore,
    Extension(provider): Extension<AnnotationProvider>,
) -> ApiResult<Json<String>> {
    if let Some(temporary) = provider.data_sources().find(&query.annotation_id) {
        return Ok(Json(temporary.dataset_id.to_string()));
    }
    Ok(Json(
        annotation_dataset(&state, &provider, &query.annotation_id).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TracingQuery {
    tracing_id: String,
}

async fn annotation_id_for_tracing(
    State(state): State<AppState>,
    Query(query): Query<TracingQuery>,
    _store: ValidatedTracingStore,
    Extension(provider): Extension<AnnotationProvider>,
) -> ApiResult<Json<String>> {
    if query.tracing_id == "dummyTracingId" {
        return Ok(Json("000000000000000000000000".to_owned()));
    }
    // AnnotationInformationProvider shifts the saved lookup's Box and falls
    // back to the existing compound cache on Empty or Failure. Never merge.
    let saved_id: Option<String> = sqlx::query_scalar(
        "SELECT _annotation FROM webknossos.annotation_layers WHERE tracingId=$1",
    )
    .bind(&query.tracing_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    if let Some(id) = saved_id
        && let Ok(Some(annotation)) =
            annotation_access::find_optional(&state.pool, None, &id, true).await
        && ObjectId::parse(&annotation.dataset_id).is_ok()
        && ObjectId::parse(&annotation.owner_id).is_ok()
        && annotation.annotation_type.parse::<AnnotationType>().is_ok()
        && annotation.task_id.as_deref().is_none_or(|id| ObjectId::parse(id).is_ok())
        && matches!(annotation.state.as_str(), "Active" | "Finished" | "Cancelled" | "Initializing")
        && matches!(annotation.visibility.as_str(), "Private" | "Internal" | "Public")
        && matches!(annotation.collaboration_mode.as_str(), "OwnerOnly" | "Exclusive" | "Concurrent")
        && let Ok(false) = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM webknossos.annotation_layers WHERE _annotation=$1 AND (typ::text NOT IN ('Skeleton','Volume') OR jsonb_typeof(statistics)<>'object'))",
        ).bind(&annotation.id).fetch_one(&state.pool).await
    {
        return Ok(Json(annotation.id));
    }
    if let Some(compound) = provider.find_cached_by_tracing_id(&query.tracing_id) {
        return Ok(Json(compound.id.to_string()));
    }
    Err(ApiError::bad_request(format!(
        "No annotation for tracing {}",
        query.tracing_id
    )))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetPath {
    dataset_id: PathObjectId,
}

async fn require_dataset(state: &AppState, dataset_id: &str) -> ApiResult<()> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id=$1)")
            .bind(dataset_id)
            .fetch_one(&state.pool)
            .await?;
    if !exists {
        return Err(ApiError::not_found(format!(
            "Dataset “{dataset_id}” could not be found or accessed."
        )));
    }
    Ok(())
}

async fn data_source(state: &AppState, dataset_id: &str) -> ApiResult<Value> {
    let missing_voxel: bool = sqlx::query_scalar(
        "SELECT isUsable AND voxelSizeFactor IS NULL FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(dataset_id)
    .fetch_one(&state.pool)
    .await?;
    if missing_voxel {
        return Err(ApiError::bad_request(USABLE_BUT_NO_VOXEL_SIZE));
    }
    datasets::data_source_for_rpc(&state.pool, dataset_id, true).await
}

async fn data_store_uri_for_dataset(
    State(state): State<AppState>,
    Path(path): Path<DatasetPath>,
    _store: ValidatedTracingStore,
) -> ApiResult<Json<String>> {
    require_dataset(&state, path.dataset_id.as_str()).await?;
    let url: Option<String> = sqlx::query_scalar(
        "SELECT store.url FROM webknossos.datasets_ dataset JOIN webknossos.dataStores_ store ON store.name=TRIM(dataset._dataStore) WHERE dataset._id=$1",
    )
    .bind(path.dataset_id.as_str())
    .fetch_optional(&state.pool)
    .await?;
    Ok(Json(url.ok_or_else(|| {
        ApiError::bad_request("Data store could not be found or accessed.")
    })?))
}

async fn get_data_source(
    State(state): State<AppState>,
    Path(path): Path<DatasetPath>,
    _store: ValidatedTracingStore,
) -> ApiResult<Json<Value>> {
    require_dataset(&state, path.dataset_id.as_str()).await?;
    Ok(Json(data_source(&state, path.dataset_id.as_str()).await?))
}
