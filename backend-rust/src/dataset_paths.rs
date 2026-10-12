//! PathDeletionController and PathDeletionService.
use axum::{
    Extension, Json, Router,
    extract::State,
    routing::{get, post},
};
use reqwest::Method;
use serde::Deserialize;
use subtle::ConstantTimeEq;

use crate::{
    AppState,
    dataset_options::DatasetRouteConfig,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Query},
    service_clients::ServiceClients,
};

pub fn router(config: DatasetRouteConfig) -> Router<AppState> {
    Router::new()
        .route("/datasets/pathsToDelete", get(list_paths_to_delete))
        .route(
            "/datasets/pathsToDelete/markAsDeleted",
            post(mark_as_deleted),
        )
        .layer(Extension(config))
}

#[derive(Deserialize)]
struct KeyQuery {
    key: String,
}

fn authenticate(config: &DatasetRouteConfig, key: &str) -> ApiResult<()> {
    let valid = config
        .external_path_deletion_key
        .as_deref()
        .is_some_and(|expected| bool::from(expected.as_bytes().ct_eq(key.as_bytes())));
    if valid {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "Wrong key for external path deletion service.",
        ))
    }
}

async fn list_paths_to_delete(
    State(state): State<AppState>,
    Extension(config): Extension<DatasetRouteConfig>,
    Query(query): Query<KeyQuery>,
) -> ApiResult<Json<Vec<String>>> {
    authenticate(&config, &query.key)?;
    Ok(Json(
        sqlx::query_scalar("SELECT path FROM webknossos.remote_paths_to_delete ORDER BY created")
            .fetch_all(&state.pool)
            .await?,
    ))
}

async fn mark_as_deleted(
    State(state): State<AppState>,
    Extension(config): Extension<DatasetRouteConfig>,
    Query(query): Query<KeyQuery>,
    RequestJson(paths): RequestJson<Vec<String>>,
) -> ApiResult<()> {
    authenticate(&config, &query.key)?;
    // Scala deletes in batches of 100 without a transaction; a single bound
    // statement is equivalent and atomic.
    sqlx::query("DELETE FROM webknossos.remote_paths_to_delete WHERE path = ANY($1)")
        .bind(&paths)
        .execute(&state.pool)
        .await?;
    Ok(())
}

/// UPath.toZipEntryUPath succeeds for `outer|zip:inner` and `outer|zip`.
fn is_zip_entry(path: &str) -> bool {
    path.contains("|zip:") || path.ends_with("|zip")
}

/// PathDeletionService.deletePaths: the datastore deletes local paths and
/// returns the managed-S3 paths, which are queued for the external service.
pub(crate) async fn delete_paths(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    store_url: &str,
    paths: &[String],
) -> ApiResult<()> {
    let filtered: Vec<&String> = paths.iter().filter(|p| !is_zip_entry(p)).collect();
    let response = clients
        .request(
            Method::DELETE,
            store_url,
            &["data", "datasets", "deletePaths"],
            &[],
            Some(&serde_json::json!(filtered)),
        )
        .await?;
    let external: Vec<String> = serde_json::from_slice(&response.bytes)
        .map_err(|_| ApiError::from(crate::service_clients::ServiceError::InvalidJson))?;
    if !external.is_empty() {
        sqlx::query("INSERT INTO webknossos.remote_paths_to_delete (path) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING")
            .bind(&external)
            .execute(pool)
            .await?;
    }
    Ok(())
}
