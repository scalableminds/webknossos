//! PublicationController: public (UserAwareAction, but identity-independent)
//! publication listing with embedded dataset and annotation JSON.
//!
//! PublicationService.publicWrites renders with GlobalAccessContext and no
//! requesting user, so the result never depends on the caller; the controller
//! also sets `allowRemoteOrigin` (CORS headers on every response).
use crate::{
    AppState,
    error::{ApiError, ApiResult},
    extract::Path,
    id::PathObjectId,
};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderValue, header},
    middleware,
    response::Response,
    routing::get,
};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::PgConnection;

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/publications", get(list))
        .route("/publications/{id}", get(read))
        .layer(Extension(JobsEnabled(jobs_enabled)))
        .layer(middleware::map_response(remote_origin_headers))
}

/// ExtendedController.addRemoteOriginHeaders.
async fn remote_origin_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    response
}

#[derive(sqlx::FromRow)]
struct Publication {
    id: String,
    publication_date: Option<DateTime<Utc>>,
    image_url: Option<String>,
    title: Option<String>,
    description: Option<String>,
    created: DateTime<Utc>,
}

const COLUMNS: &str = "_id AS id, publicationDate AS publication_date, imageUrl AS image_url, title, description, created";

async fn read(
    State(state): State<AppState>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Value>> {
    let query = format!("SELECT {COLUMNS} FROM webknossos.publications_ WHERE _id = $1");
    let publication: Publication = sqlx::query_as(&query)
        .bind(id.as_str())
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("Publication could not be found."))?;
    let mut connection = state.pool.acquire().await?;
    Ok(Json(
        publication_json(&mut connection, publication, jobs_enabled).await?,
    ))
}

async fn list(
    State(state): State<AppState>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
) -> ApiResult<Json<Vec<Value>>> {
    // Scala has no ORDER BY; creation order is the deterministic equivalent.
    let query = format!("SELECT {COLUMNS} FROM webknossos.publications_ ORDER BY created, _id");
    let publications: Vec<Publication> = sqlx::query_as(&query).fetch_all(&state.pool).await?;
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
    publication: Publication,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let dataset_ids: Vec<String> = sqlx::query_scalar(
        "SELECT _id FROM webknossos.datasets_ WHERE _publication = $1 ORDER BY created, _id",
    )
    .bind(&publication.id)
    .fetch_all(&mut *connection)
    .await?;
    let mut datasets = Vec::with_capacity(dataset_ids.len());
    for id in dataset_ids {
        datasets.push(
            crate::datasets::full_json_on_connection(connection, None, &id, jobs_enabled).await?,
        );
    }
    let annotations: Vec<(String, String, String, String, String)> = sqlx::query_as(
        r#"SELECT _id, name, description, typ::text, _dataset FROM webknossos.annotations_
          WHERE _publication = $1 ORDER BY created, _id"#,
    )
    .bind(&publication.id)
    .fetch_all(&mut *connection)
    .await?;
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
    id: &str,
    name: String,
    description: String,
    typ: String,
    dataset: &str,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let dataset_exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id = $1)")
            .bind(dataset)
            .fetch_one(&mut *connection)
            .await?;
    if !dataset_exists {
        return Err(ApiError::bad_request(format!(
            "Dataset “{dataset}” for annotation “{id}” does not exist or could not be accessed."
        )));
    }
    // TracingStoreDAO.findFirst: an empty Fox without message (Play's generic 404).
    let (store_name, store_url): (String, String) =
        sqlx::query_as("SELECT name, publicUrl FROM webknossos.tracingStores_ LIMIT 1")
            .fetch_optional(&mut *connection)
            .await?
            .ok_or_else(|| {
                ApiError::not_found("Could not find or access the requested resource.")
            })?;
    let dataset_json =
        crate::datasets::full_json_on_connection(connection, None, dataset, jobs_enabled).await?;
    Ok(json!({
        "id": id,
        "name": name,
        "description": description,
        "typ": typ,
        "tracingStore": {"name": store_name, "url": store_url},
        "dataset": dataset_json,
    }))
}
