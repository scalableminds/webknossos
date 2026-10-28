//! Owner-managed annotation private links and database-backed annotation sources.
mod annotation_private_links_dao;

use crate::response::Messages;
use axum::{Json as ResponseJson, Router, extract::State, routing::get};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Executor, FromRow, Postgres};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    util::id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/zarrPrivateLinks", get(list).post(create))
        .route(
            "/zarrPrivateLinks/byAnnotation/{annotationId}",
            get(by_annotation),
        )
        .route(
            "/zarrPrivateLinks/{id}",
            get(read).put(update).delete(delete),
        )
        .route("/annotations/source/{accessTokenOrId}", get(source))
}

#[derive(Deserialize)]
struct Parameters {
    annotation: ObjectId,
    #[serde(
        rename = "expirationDateTime",
        default,
        deserialize_with = "crate::util::instant::optional"
    )]
    expiration: Option<DateTime<Utc>>,
}

/// AnnotationPrivateLinkService.publicWrites.
#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateLink {
    id: ObjectId,
    annotation: ObjectId,
    access_token: String,
    #[serde(
        rename = "expirationDateTime",
        with = "chrono::serde::ts_milliseconds_option"
    )]
    expiration: Option<DateTime<Utc>>,
}
async fn owned_link<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
    user: &AuthUser,
    id: &ObjectId,
    lock: bool,
) -> ApiResult<PrivateLink> {
    annotation_private_links_dao::find_one_owned(executor, user, id, lock)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::annotation::private_link::not_found(id)))
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Vec<PrivateLink>>> {
    let links = annotation_private_links_dao::find_all_for_user(&state.pool, &user).await?;
    Ok(ResponseJson(links))
}
async fn by_annotation(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Vec<PrivateLink>>> {
    let id = ObjectId::parse_path(&id)?;
    let links =
        annotation_private_links_dao::find_all_for_annotation(&state.pool, &user, &id).await?;
    Ok(ResponseJson(links))
}
async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<PrivateLink>> {
    let id = ObjectId::parse_path(&id)?;
    // Play's `findOne(id)` without a message: the generic 404 (update/delete name the link).
    let link = owned_link(&state.pool, &user, &id, false)
        .await
        .map_err(|_| ApiError::not_found(crate::msg::NOT_FOUND))?;
    if link
        .expiration
        .is_some_and(|expiration| expiration <= Utc::now())
    {
        return Err(ApiError::not_found(
            crate::msg::annotation::private_link::EXPIRED,
        ));
    }
    crate::annotation::access::find(&state.pool, Some(&user), &link.annotation, false).await?;
    Ok(ResponseJson(link))
}

fn token() -> ApiResult<String> {
    let mut bytes = [0; 12];
    getrandom::fill(&mut bytes).map_err(|_| ApiError::internal())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(parameters): Json<Parameters>,
) -> ApiResult<ResponseJson<PrivateLink>> {
    let mut tx = state.pool.begin().await?;
    let annotation =
        crate::annotation::access::lock_for_mutation(&mut tx, &user, &parameters.annotation)
            .await?;
    // The subsequent Scala link DAO lookup is owner-only. Keep insertion and
    // lookup atomic so a rejected request cannot leave an inaccessible link.
    if annotation.owner_id != user.id {
        return Err(ApiError::forbidden(
            crate::msg::annotation::private_link::OWNER_ONLY,
        ));
    }
    let id = ObjectId::new();
    annotation_private_links_dao::insert_one(
        &mut tx,
        &id,
        &parameters.annotation,
        token()?,
        parameters.expiration,
    )
    .await?;
    let link = owned_link(&mut *tx, &user, &id, false).await?;
    tx.commit().await?;
    Ok(ResponseJson(link))
}
async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<Parameters>,
) -> ApiResult<ResponseJson<PrivateLink>> {
    let id = ObjectId::parse_path(&id)?;
    let mut tx = state.pool.begin().await?;
    let link = owned_link(&mut *tx, &user, &id, true).await?;
    // Lock annotation references in id order to avoid rebind deadlocks.
    let mut annotation_ids = vec![&link.annotation, &parameters.annotation];
    annotation_ids.sort_unstable();
    annotation_ids.dedup();
    for annotation_id in annotation_ids {
        let annotation =
            crate::annotation::access::lock_for_mutation(&mut tx, &user, annotation_id).await?;
        if annotation.owner_id != user.id {
            return Err(ApiError::forbidden(
                crate::msg::annotation::private_link::OWNER_ONLY,
            ));
        }
    }
    annotation_private_links_dao::update_one(
        &mut tx,
        &id,
        &parameters.annotation,
        parameters.expiration,
    )
    .await?;
    let link = owned_link(&mut *tx, &user, &id, false).await?;
    tx.commit().await?;
    Ok(ResponseJson(link))
}
async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Messages>> {
    let id = ObjectId::parse_path(&id)?;
    let mut tx = state.pool.begin().await?;
    let link = owned_link(&mut *tx, &user, &id, true).await?;
    crate::annotation::access::lock_for_mutation(&mut tx, &user, &link.annotation).await?;
    annotation_private_links_dao::delete_one(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(Messages::success(
        crate::msg::annotation::private_link::DELETE_SUCCESS,
    ))
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceQuery {
    user_token: Option<String>,
}
async fn source(
    State(state): State<AppState>,
    Path(token_or_id): Path<String>,
    Query(query): Query<SourceQuery>,
) -> ApiResult<ResponseJson<Value>> {
    let linked =
        annotation_private_links_dao::find_annotation_id_by_access_token(&state.pool, &token_or_id)
            .await?;
    let via_private_link = linked.is_some();
    let annotation = if let Some(id) = linked {
        crate::annotation::access::find(&state.pool, None, &id, true).await?
    } else {
        let token_or_id = ObjectId::parse(&token_or_id)
            .map_err(|_| ApiError::bad_request(crate::msg::object_id::invalid(&token_or_id)))?;
        // This raw Action uses only userToken, not normal authentication headers.
        // Invalid userToken falls back to anonymous annotation access.
        let user = match query.user_token {
            Some(token) => crate::auth::user_for_service_token(&state.pool, &token).await?,
            None => None,
        };
        // Play: `annotationDAO.findOne(…) ?~> annotation.notFound` on an empty result (400).
        crate::annotation::access::find_optional(&state.pool, user.as_ref(), &token_or_id, false)
            .await?
            .ok_or_else(|| ApiError::bad_request(crate::msg::annotation::NOT_FOUND))?
    };
    let value = annotation_private_links_dao::find_source_json(
        &state.pool,
        &annotation.id,
        via_private_link,
    )
    .await?
    .ok_or_else(|| ApiError::not_found(crate::msg::annotation::SOURCE_MISSING))?;
    if value["tracingStoreUrl"].is_null() {
        return Err(ApiError::not_found(crate::msg::tracing_store::MISSING));
    }
    Ok(ResponseJson(value))
}

#[cfg(test)]
mod tests;
