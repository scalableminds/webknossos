//! Persist the tracing store's annotation layer/description update callback.
//! The tracing store has already checked write access; the service key grants
//! global database access, including finished or soft-deleted annotations.
use std::collections::HashSet;

use axum::{Router, body::Bytes, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;
use sqlx::PgPool;

use crate::{
    AppState,
    error::ApiResult,
    extract::Query,
    id::ObjectId,
    proto::{AnnotationLayerTypeProto, AnnotationProto},
    remote_tracingstore_reads::{CallbackError, validate_key},
    tracingstore_client::decode_annotation_proto,
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
    // Layers may arrive before their parent annotation: schema185 deliberately
    // has no annotation_layers -> annotations foreign key. Serialize those
    // callbacks too, where no annotation row exists to lock yet.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("annotation-layers:{id}"))
        .execute(&mut *transaction)
        .await?;
    // Serialize replacements of the same annotation across server processes.
    // Global Scala update access deliberately does not require a live row:
    // an empty update for a nonexistent annotation is a successful no-op.
    sqlx::query("SELECT _id FROM webknossos.annotations WHERE _id=$1 FOR UPDATE")
        .bind(id.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
    let previous: HashSet<String> = sqlx::query_scalar(
        "SELECT tracingId FROM webknossos.annotation_layers WHERE _annotation=$1",
    )
    .bind(id.as_str())
    .fetch_all(&mut *transaction)
    .await?
    .into_iter()
    .collect();
    let incoming: Vec<&str> = update
        .annotation_layers
        .iter()
        .map(|layer| layer.tracing_id.as_str())
        .collect();
    sqlx::query(
        "DELETE FROM webknossos.annotation_layers WHERE _annotation=$1 AND NOT (tracingId=ANY($2::text[]))",
    )
    .bind(id.as_str())
    .bind(&incoming)
    .execute(&mut *transaction)
    .await?;
    for layer in update.annotation_layers {
        if previous.contains(&layer.tracing_id) {
            // Existing layer type and statistics stay unchanged. Statistics
            // arrive separately in handleTracingUpdateReport, not this RPC.
            sqlx::query("UPDATE webknossos.annotation_layers SET name=$3 WHERE _annotation=$1 AND tracingId=$2")
                .bind(id.as_str()).bind(&layer.tracing_id).bind(&layer.name)
                .execute(&mut *transaction).await?;
        } else {
            let typ = match AnnotationLayerTypeProto::try_from(layer.typ)
                .expect("validated protobuf layer type")
            {
                AnnotationLayerTypeProto::Skeleton => "Skeleton",
                AnnotationLayerTypeProto::Volume => "Volume",
            };
            // Do not use UPSERT: duplicate new tracing IDs must fail rather
            // than silently becoming repeated updates to the inserted row.
            sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,$3::webknossos.ANNOTATION_LAYER_TYPE,$4,'{}'::jsonb)")
                .bind(id.as_str()).bind(&layer.tracing_id).bind(typ).bind(&layer.name)
                .execute(&mut *transaction).await?;
        }
    }
    sqlx::query("UPDATE webknossos.annotations SET description=$2 WHERE _id=$1")
        .bind(id.as_str())
        .bind(update.description)
        .execute(&mut *transaction)
        .await?;
    // Deletion, insertion, rename and description are committed together;
    // deferred layer-name constraints are checked before success is returned.
    transaction.commit().await?;
    Ok(())
}
