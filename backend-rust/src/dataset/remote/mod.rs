use axum::{
    Extension, Json, Router,
    extract::State,
    routing::{get, put},
};
use serde::Deserialize;
use serde_json::{Map, Value};

mod dao;

use crate::{
    AppState,
    auth::{AuthUser, OptionalAuthUser},
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    stores::client::ServiceClients,
    util::id::{ObjectId, PathObjectId},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datasets/{datasetId}/health", get(health))
        .route(
            "/datasets/{datasetId}/clearThumbnailCache",
            put(clear_thumbnail_cache),
        )
        .route(
            "/datasets/{datasetId}/usedStorageDetails",
            get(used_storage_details),
        )
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharingQuery {
    sharing_token: Option<String>,
}

async fn require_read(
    state: &AppState,
    user: Option<&AuthUser>,
    id: &ObjectId,
    sharing_token: Option<&str>,
) -> ApiResult<()> {
    if !crate::dataset::access::can_read(&state.pool, user, id, sharing_token).await? {
        return Err(ApiError::not_found(crate::msg::dataset::MISSING));
    }
    Ok(())
}

fn unusable(id: &ObjectId) -> ApiError {
    ApiError::bad_request(crate::msg::dataset::not_usable(id))
}

async fn health(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(id): Path<PathObjectId>,
    Query(query): Query<SharingQuery>,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<&'static str> {
    require_read(&state, user.as_ref(), &id, query.sharing_token.as_deref()).await?;
    // Global datastore lookup after the dataset grant allows public/shared
    // datasets to use a service restricted to another organization.
    let (usable, has_voxel, base) = dao::find_health_fields(&state.pool, &id).await?;
    if !usable {
        return Err(unusable(&id));
    }
    if !has_voxel {
        return Err(ApiError::internal());
    }
    let layers = crate::dataset::routes::full_layers(&state.pool, &id).await?;
    let name = layers
        .first()
        .and_then(|layer| layer["name"].as_str())
        .ok_or_else(|| ApiError::bad_request(crate::msg::dataset::NO_LAYERS))?;
    let result: Map<String, Value> = clients
        .get_json(
            &base,
            &["data", "datasets", id.as_str(), "layers", name, "findData"],
            &[],
        )
        .await?;
    if result.get("position").is_none_or(Value::is_null) {
        return Err(ApiError::bad_request(
            crate::msg::dataset::LOADING_DATA_FAILED,
        ));
    }
    Ok("Ok")
}

async fn clear_thumbnail_cache(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<()> {
    require_read(&state, Some(&user), &id, None).await?;
    let mut transaction = state.pool.begin().await?;
    dao::lock_dataset(&mut transaction, &id).await?;
    let readable =
        crate::dataset::dao::is_readable_on_connection(&mut transaction, &user.id, &id).await?;
    if !readable {
        return Err(ApiError::not_found(crate::msg::dataset::MISSING));
    }
    // Unlike Scala's secured-only handler, require a live readable dataset.
    // Reading is sufficient; this operation changes no dataset settings.
    dao::delete_thumbnails(&mut transaction, &id).await?;
    dao::increment_thumbnail_cache_version(&mut transaction, &id).await?;
    transaction.commit().await?;
    Ok(())
}

async fn used_storage_details(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Vec<Value>>> {
    require_read(&state, Some(&user), &id, None).await?;
    if !crate::dataset::access::can_edit(&state.pool, &user, &id).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let usable = dao::is_usable(&state.pool, &id).await?;
    if !usable {
        return Err(unusable(&id));
    }
    let mut rows = dao::find_used_storage_of_mags(&state.pool, &id).await?;
    let attachments = dao::find_used_storage_of_attachments(&state.pool, &id).await?;
    rows.extend(attachments);
    Ok(Json(rows))
}
