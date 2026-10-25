use axum::{
    Extension, Json, Router,
    extract::State,
    routing::{get, put},
};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::{
    AppState,
    auth::{AuthUser, OptionalAuthUser},
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    sql::Sql,
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
    let (usable, has_voxel, base): (bool, bool, String) = sqlx::query_as(
        "SELECT d.isUsable,d.voxelSizeFactor IS NOT NULL,s.url FROM webknossos.datasets_ \
            d JOIN webknossos.dataStores_ s ON s.name=trim(d._dataStore) WHERE d._id=$1",
    )
    .bind(id.as_str())
    .fetch_one(&state.pool)
    .await?;
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
    sqlx::query("SELECT _id FROM webknossos.datasets_ WHERE _id=$1 FOR UPDATE")
        .bind(id.as_str())
        .fetch_one(&mut *transaction)
        .await?;
    let mut q = Sql::new("SELECT ");
    crate::dataset::access::push_read_predicate(&mut q, user.id.as_str().into(), None);
    q.push(" FROM webknossos.datasets_ d WHERE d._id=")
        .push_bind(id.as_str());
    let readable: bool = q.build_query_scalar().fetch_one(&mut *transaction).await?;
    if !readable {
        return Err(ApiError::not_found(crate::msg::dataset::MISSING));
    }
    // Unlike Scala's secured-only handler, require a live readable dataset.
    // Reading is sufficient; this operation changes no dataset settings.
    sqlx::query("DELETE FROM webknossos.dataset_thumbnails WHERE _dataset=$1")
        .bind(id.as_str())
        .execute(&mut *transaction)
        .await?;
    sqlx::query("UPDATE webknossos.datasets SET thumbnailCacheVersion=thumbnailCacheVersion+1 WHERE _id=$1 AND NOT isDeleted")
        .bind(id.as_str()).execute(&mut *transaction).await?;
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
    let usable: bool = sqlx::query_scalar("SELECT isUsable FROM webknossos.datasets_ WHERE _id=$1")
        .bind(id.as_str())
        .fetch_one(&state.pool)
        .await?;
    if !usable {
        return Err(unusable(&id));
    }
    let mut rows = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('layerName',layerName,
      'name',concat((mag).x::int,'-',(mag).y::int,'-',(mag).z::int),'usedStorageBytes',usedStorageBytes,
      'lastUpdated',floor(extract(epoch from lastUpdated)*1000)::bigint)
      FROM webknossos.organization_usedStorage_mags WHERE _dataset=$1"#,
    )
    .bind(id.as_str())
    .fetch_all(&state.pool)
    .await?;
    let attachments = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('layerName',layerName,'name',name,
      'attachmentType',type,'usedStorageBytes',usedStorageBytes,'lastUpdated',floor(extract(epoch from lastUpdated)*1000)::bigint)
      FROM webknossos.organization_usedStorage_attachments WHERE _dataset=$1"#,
    )
    .bind(id.as_str())
    .fetch_all(&state.pool)
    .await?;
    rows.extend(attachments);
    Ok(Json(rows))
}
