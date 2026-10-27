//! PublicationController: public (UserAwareAction, but identity-independent)
//! publication listing with embedded dataset and annotation JSON.
//!
//! PublicationService.publicWrites renders with GlobalAccessContext and no
//! requesting user, so the result never depends on the caller; the controller
//! also sets `allowRemoteOrigin` (CORS headers on every response).
pub(crate) mod dao;

use crate::util::id::ObjectId;
use crate::{
    AppState,
    error::{ApiError, ApiResult},
    extract::Path,
    state::JobsEnabled,
    util::id::PathObjectId,
};
use axum::{Json, Router, extract::State, middleware, routing::get};
use serde_json::{Value, json};
use sqlx::PgConnection;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/publications", get(list))
        .route("/publications/{id}", get(read))
        .layer(middleware::map_response(
            crate::util::cors::remote_origin_headers,
        ))
}

async fn read(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Value>> {
    let publication = dao::find_one(&state.pool, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::PUBLICATION_NOT_FOUND))?;
    let mut connection = state.pool.acquire().await?;
    Ok(Json(
        publication_json(&mut connection, publication, jobs_enabled).await?,
    ))
}

async fn list(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
) -> ApiResult<Json<Vec<Value>>> {
    let publications = dao::find_all(&state.pool).await?;
    let mut connection = state.pool.acquire().await?;
    let mut result = Vec::with_capacity(publications.len());
    for publication in publications {
        result.push(publication_json(&mut connection, publication, jobs_enabled).await?);
    }
    Ok(Json(result))
}

/// PublicationService.publicWrites.
async fn publication_json(
    connection: &mut PgConnection,
    publication: dao::Publication,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let dataset_ids = dao::find_dataset_ids_for_publication(connection, &publication.id).await?;
    let mut datasets = Vec::with_capacity(dataset_ids.len());
    for id in dataset_ids {
        datasets.push(
            crate::dataset::routes::full_json_on_connection(connection, None, &id, jobs_enabled)
                .await?,
        );
    }
    let annotations = dao::find_annotations_for_publication(connection, &publication.id).await?;
    let mut annotations_json = Vec::with_capacity(annotations.len());
    for (id, name, description, typ, dataset) in annotations {
        annotations_json.push(
            annotation_json(
                connection,
                &id,
                name,
                description,
                typ,
                &dataset,
                jobs_enabled,
            )
            .await?,
        );
    }
    Ok(json!({
        "id": publication.id,
        "publicationDate": publication.publication_date.map(|date| date.timestamp_millis()),
        "imageUrl": publication.image_url,
        "title": publication.title,
        "description": publication.description,
        "created": publication.created.timestamp_millis(),
        "datasets": datasets,
        "annotations": annotations_json,
    }))
}

/// AnnotationService.writesWithDataset (GlobalAccessContext, no requesting user).
async fn annotation_json(
    connection: &mut PgConnection,
    id: &ObjectId,
    name: String,
    description: String,
    typ: String,
    dataset: &ObjectId,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let dataset_exists = dao::dataset_exists(connection, dataset).await?;
    if !dataset_exists {
        return Err(ApiError::bad_request(
            crate::msg::dataset::not_found_for_annotation(dataset, id),
        ));
    }
    // An empty Fox without message (Play's generic 404).
    let (store_name, store_url) = dao::find_first_tracing_store(connection)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let dataset_json =
        crate::dataset::routes::full_json_on_connection(connection, None, dataset, jobs_enabled)
            .await?;
    Ok(json!({
        "id": id,
        "name": name,
        "description": description,
        "typ": typ,
        "tracingStore": {"name": store_name, "url": store_url},
        "dataset": dataset_json,
    }))
}
