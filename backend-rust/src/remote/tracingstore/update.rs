//! Persist the tracing store's annotation layer/description update callback.
//! The tracing store has already checked write access; the service key grants
//! global database access, including finished or soft-deleted annotations.
use std::collections::HashSet;

use axum::{Router, body::Bytes, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;
use sqlx::PgPool;

use crate::{
    AppState,
    annotation::provider::AnnotationLayerType,
    error::ApiResult,
    extract::Query,
    proto::{AnnotationLayerTypeProto, AnnotationProto},
    remote::tracingstore::{
        dao,
        reads::{CallbackError, validate_key},
    },
    stores::tracing_client::decode_annotation_proto,
    util::id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/tracingstores/{name}/updateAnnotation", post(update))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateQuery {
    key: String,
    annotation_id: ObjectId,
}

async fn update(
    State(state): State<AppState>,
    Query(query): Query<UpdateQuery>,
    body: Bytes,
) -> Result<StatusCode, CallbackError> {
    // Play's raw protobuf body parser runs before the service-key action and
    // accepts any content type. Keep its plain-text parse error contract.
    let annotation = decode_annotation_proto(&body).map_err(|_| {
        CallbackError::Plain(StatusCode::BAD_REQUEST, "Invalid protobuf request body")
    })?;
    validate_key(&state.pool, &query.key).await?;
    persist_update(&state.pool, &query.annotation_id, annotation).await?;
    Ok(StatusCode::OK)
}

async fn persist_update(pool: &PgPool, id: &ObjectId, update: AnnotationProto) -> ApiResult<()> {
    let mut transaction = pool.begin().await?;
    dao::lock_annotation_layers(&mut transaction, id).await?;
    dao::lock_annotation(&mut transaction, id).await?;
    let previous: HashSet<String> = dao::find_all_tracing_ids_for_annotation(&mut transaction, id)
        .await?
        .into_iter()
        .collect();
    let incoming: Vec<&str> = update
        .annotation_layers
        .iter()
        .map(|layer| layer.tracing_id.as_str())
        .collect();
    dao::delete_layers_except(&mut transaction, id, &incoming).await?;
    for layer in update.annotation_layers {
        if previous.contains(&layer.tracing_id) {
            // Existing layer type and statistics stay unchanged. Statistics
            // arrive separately in handleTracingUpdateReport, not this RPC.
            dao::update_layer_name(&mut transaction, id, &layer.tracing_id, &layer.name).await?;
        } else {
            let typ = AnnotationLayerType::from(
                AnnotationLayerTypeProto::try_from(layer.typ)
                    .expect("validated protobuf layer type"),
            )
            .as_str();
            dao::insert_layer(&mut transaction, id, &layer.tracing_id, typ, &layer.name).await?;
        }
    }
    dao::update_description(&mut transaction, id, update.description).await?;
    // Deletion, insertion, rename and description are committed together;
    // deferred layer-name constraints are checked before success is returned.
    transaction.commit().await?;
    Ok(())
}
