//! DataSourceController connectome routes; authorization precedes lookup and every cached read.
use super::helpers::{dataset_id, validated_body};
use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    error::DsError,
    models::{
        JsResult, StaticLayer, UsableDataSource,
        datasource::{read_unsigned_long, unsigned_long_envelope},
        json::{Fields, read_i64, read_list, read_string},
    },
    services::connectome::{ConnectomeFileKey, ConnectomeService, Direction},
};
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::Value;
use std::sync::Arc;
pub fn router() -> Router<AppState> {
    controller(Router::new()
        .route("/data/datasets/{datasetId}/layers/{dataLayerName}/connectomes",get(list))
        .route("/data/datasets/{datasetId}/layers/{dataLayerName}/connectomes/synapses/positions",post(positions))
        .route("/data/datasets/{datasetId}/layers/{dataLayerName}/connectomes/synapses/types",post(types))
        .route("/data/datasets/{datasetId}/layers/{dataLayerName}/connectomes/synapses/{direction}",post(partners))
        .route("/data/datasets/{datasetId}/layers/{dataLayerName}/connectomes/synapses",post(synapses)),true)
}
async fn layer(
    state: &AppState,
    tc: &TokenContext,
    id: &str,
    name: &str,
) -> AccessResult<(Arc<UsableDataSource>, Arc<StaticLayer>)> {
    let id = dataset_id(id)?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), tc)
        .await?;
    Ok(state
        .datasets
        .get_with_layer(&id, name)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?)
}
async fn list(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
) -> AccessResult<Response> {
    let (source, layer) = layer(&state, &tc, &id, &name).await?;
    Ok(Json(
        state
            .connectomes
            .list(&source.id, &layer, tc.user_token.as_deref())
            .await,
    )
    .into_response())
}
struct Query {
    file: String,
    ids: Vec<i64>,
}
fn parse(value: &Value, agglomerates: bool) -> JsResult<Query> {
    let mut f = Fields::new(value);
    let file = f.req("connectomeFile", read_string);
    let ids = if agglomerates {
        f.req("agglomerateIds", |v| {
            read_list(v, |v| read_unsigned_long(v).map(|id| id as i64))
        })
    } else {
        f.req("synapseIds", |v| read_list(v, read_i64))
    };
    f.finish()?;
    Ok(Query {
        file: file?,
        ids: ids?,
    })
}
async fn key(
    state: &AppState,
    tc: &TokenContext,
    id: &str,
    name: &str,
    file: &str,
) -> AccessResult<ConnectomeFileKey> {
    let (source, layer) = layer(state, tc, id, name).await?;
    Ok(ConnectomeService::look_up(&source.id, &layer, file)?)
}
async fn positions(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let body = match validated_body(body, |v| parse(v, false)) {
        Ok(v) => v,
        Err(r) => return Ok(*r),
    };
    let key = key(&state, &tc, &id, &name, &body.file).await?;
    Ok(Json(
        state
            .connectomes
            .positions(&key, &body.ids, tc.user_token.as_deref())
            .await?,
    )
    .into_response())
}
async fn types(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let body = match validated_body(body, |v| parse(v, false)) {
        Ok(v) => v,
        Err(r) => return Ok(*r),
    };
    let key = key(&state, &tc, &id, &name, &body.file).await?;
    Ok(Json(
        state
            .connectomes
            .types(&key, &body.ids, tc.user_token.as_deref())
            .await?,
    )
    .into_response())
}
async fn partners(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name, direction)): Path<(String, String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let body = match validated_body(body, |v| parse(v, false)) {
        Ok(v) => v,
        Err(r) => return Ok(*r),
    };
    // Scala validates access before parsing direction, and parses direction before loading data.
    let dataset = dataset_id(&id)?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&dataset), &tc)
        .await?;
    let direction = match direction.as_str() {
        "src" => Direction::Src,
        "dst" => Direction::Dst,
        _ => return Err(DsError::failure("could not parse synaptic partner direction").into()),
    };
    let (source, layer) = state
        .datasets
        .get_with_layer(&dataset, &name)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?;
    let key = ConnectomeService::look_up(&source.id, &layer, &body.file)?;
    let values = state
        .connectomes
        .partners(&key, &body.ids, direction, tc.user_token.as_deref())
        .await?;
    Ok(Json(
        values
            .into_iter()
            .map(|id| unsigned_long_envelope(id as u64))
            .collect::<Vec<_>>(),
    )
    .into_response())
}
async fn synapses(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let body = match validated_body(body, |v| parse(v, true)) {
        Ok(v) => v,
        Err(r) => return Ok(*r),
    };
    let key = key(&state, &tc, &id, &name, &body.file).await?;
    Ok(Json(
        state
            .connectomes
            .synapses(&key, &body.ids, tc.user_token.as_deref())
            .await?,
    )
    .into_response())
}
