//! WKRemoteTracingStoreController.createTracing
//! (`POST /tracingstores/:name/createTracing?key&annotationId&previousVersion`,
//! JSON body AnnotationLayerParameters): the tracing store asks for the
//! initial tracing of a layer added to an existing annotation. The tracing
//! is built like AnnotationService.createTracingForExplorational, adapted to
//! the annotation's old precedence layer at `previousVersion`, and returned
//! as protobuf bytes. Nothing is saved here; the tracing store persists it.
use axum::{
    Extension, Router,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use sqlx::PgPool;

use crate::{
    AppState,
    annotation_create::{
        TracingContext, create_tracing, data_store_url, fetch_precedence_properties, find_dataset,
        tracing_store_url, usable_data_source,
    },
    annotation_provider::{AnnotationLayer, AnnotationLayerType, ProviderError},
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    id::ObjectId,
    remote_tracingstore_reads::{CallbackError, validate_key},
    service_clients::{PROTOBUF_CONTENT_TYPE, ServiceClients},
    tracing_initialization::{AnnotationLayerParameters, precedence_fetch_request},
    tracingstore_client::TracingStoreClient,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/tracingstores/{name}/createTracing", post(create))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTracingQuery {
    key: String,
    annotation_id: ObjectId,
    previous_version: i64,
}

/// `annotationDAO.findOne(annotationId)` under GlobalAccessContext (live rows
/// only) with its layers; `None` when missing or deleted.
async fn find_annotation(
    pool: &PgPool,
    id: &ObjectId,
) -> ApiResult<Option<(ObjectId, Vec<AnnotationLayer>)>> {
    let dataset: Option<String> =
        sqlx::query_scalar("SELECT _dataset FROM webknossos.annotations_ WHERE _id=$1")
            .bind(id.as_str())
            .fetch_optional(pool)
            .await?;
    let Some(dataset) = dataset else {
        return Ok(None);
    };
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT tracingId,typ::text,name FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY tracingId",
    )
    .bind(id.as_str())
    .fetch_all(pool)
    .await?;
    let layers = rows
        .into_iter()
        .map(|(tracing_id, typ, name)| {
            let typ = match typ.as_str() {
                "Skeleton" => AnnotationLayerType::Skeleton,
                "Volume" => AnnotationLayerType::Volume,
                _ => return Err(ApiError::internal()),
            };
            Ok(AnnotationLayer {
                tracing_id,
                typ,
                name,
            })
        })
        .collect::<ApiResult<Vec<_>>>()?;
    let dataset = ObjectId::parse(&dataset).map_err(|_| ApiError::internal())?;
    Ok(Some((dataset, layers)))
}

/// The body of the createTracing `for` comprehension after access validation.
async fn build(
    pool: &PgPool,
    clients: &ServiceClients,
    tracing_store: &TracingStoreClient,
    query: &CreateTracingQuery,
    params: &AnnotationLayerParameters,
) -> Result<Vec<u8>, ProviderError> {
    // `?~> Msg.Annotation.notFound` (plain failure, 400 via ProviderError::NotFound).
    let (dataset_id, layers) = find_annotation(pool, &query.annotation_id)
        .await?
        .ok_or(ProviderError::NotFound)?;
    // datasetDAO.findOne(annotation._dataset) without message: Fox.empty (404).
    let dataset = find_dataset(pool, &dataset_id)
        .await?
        .ok_or(ProviderError::Empty)?;
    // createTracingForExplorational: datastore, usable data source, tracing
    // store, old precedence layer, then the type-specific build.
    let data_store_url = data_store_url(pool, &dataset).await?;
    let source = usable_data_source(pool, &dataset).await?;
    let tracing_store_url = tracing_store_url(pool).await?;
    let precedence = match precedence_fetch_request(
        Some(&query.annotation_id),
        &layers,
        Some(query.previous_version),
    ) {
        Ok(Some(request)) => {
            Some(fetch_precedence_properties(tracing_store, &tracing_store_url, &request).await?)
        }
        Ok(None) => None,
        // Unreachable: the annotation id is always present here.
        Err(error) => return Err(ProviderError::Api(ApiError::bad_request(error.to_string()))),
    };
    let context = TracingContext {
        dataset: &dataset,
        source: &source,
        data_store_url: &data_store_url,
    };
    let tracing = create_tracing(clients, &context, params, precedence.as_ref()).await?;
    Ok(tracing.encode_to_vec())
}

/// POST /tracingstores/:name/createTracing
async fn create(
    State(state): State<AppState>,
    Path(_name): Path<String>,
    Query(query): Query<CreateTracingQuery>,
    Extension(clients): Extension<ServiceClients>,
    Extension(tracing_store): Extension<TracingStoreClient>,
    Json(params): Json<AnnotationLayerParameters>,
) -> Result<Response, CallbackError> {
    // Play parses the JSON body (validateJson) before validateAccess; the
    // key grants global access regardless of the path name.
    validate_key(&state.pool, &query.key).await?;
    let bytes = build(&state.pool, &clients, &tracing_store, &query, &params)
        .await
        .map_err(ApiError::from)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, PROTOBUF_CONTENT_TYPE)],
        bytes,
    )
        .into_response())
}
