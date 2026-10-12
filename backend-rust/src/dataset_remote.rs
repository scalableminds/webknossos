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
    dataset_access, datasets,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    id::{ObjectId, PathObjectId},
    service_clients::ServiceClients,
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
    if !dataset_access::can_read(&state.pool, user, id.as_str(), sharing_token).await? {
        return Err(ApiError::not_found("Dataset not found."));
    }
    Ok(())
}

fn unusable(id: &ObjectId) -> ApiError {
    ApiError::bad_request(format!("Dataset “{id}” is not imported or incomplete."))
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
    let (usable,has_voxel,base):(bool,bool,String)=sqlx::query_as("SELECT d.isUsable,d.voxelSizeFactor IS NOT NULL,s.url FROM webknossos.datasets_ d JOIN webknossos.dataStores_ s ON s.name=trim(d._dataStore) WHERE d._id=$1")
        .bind(id.as_str()).fetch_one(&state.pool).await?;
    if !usable {
        return Err(unusable(&id));
    }
    if !has_voxel {
        return Err(ApiError::internal());
    }
    let layers = datasets::full_layers(&state.pool, id.as_str()).await?;
    let name = layers
        .first()
        .and_then(|layer| layer["name"].as_str())
        .ok_or_else(|| ApiError::bad_request("Dataset has no data layers."))?;
    let result: Map<String, Value> = clients
        .get_json(
            &base,
            &["data", "datasets", id.as_str(), "layers", name, "findData"],
            &[],
        )
        .await?;
    if result.get("position").is_none_or(Value::is_null) {
        return Err(ApiError::bad_request(
            "Could not load data for the requested dataset.",
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
    let readable: bool = sqlx::query_scalar(&format!(
        "SELECT {} FROM webknossos.datasets_ d WHERE d._id=$3",
        dataset_access::READ_PREDICATE
    ))
    .bind(&user.id)
    .bind(Option::<&str>::None)
    .bind(id.as_str())
    .fetch_one(&mut *transaction)
    .await?;
    if !readable {
        return Err(ApiError::not_found("Dataset not found."));
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
    if !dataset_access::can_edit(&state.pool, &user, id.as_str()).await? {
        return Err(ApiError::forbidden("Not allowed."));
    }
    let usable: bool = sqlx::query_scalar("SELECT isUsable FROM webknossos.datasets_ WHERE _id=$1")
        .bind(id.as_str())
        .fetch_one(&state.pool)
        .await?;
    if !usable {
        return Err(unusable(&id));
    }
    let mut rows=sqlx::query_scalar::<_,Value>(r#"SELECT jsonb_build_object('layerName',layerName,
      'name',concat((mag).x::int,'-',(mag).y::int,'-',(mag).z::int),'usedStorageBytes',usedStorageBytes,
      'lastUpdated',floor(extract(epoch from lastUpdated)*1000)::bigint)
      FROM webknossos.organization_usedStorage_mags WHERE _dataset=$1"#)
        .bind(id.as_str()).fetch_all(&state.pool).await?;
    let attachments=sqlx::query_scalar::<_,Value>(r#"SELECT jsonb_build_object('layerName',layerName,'name',name,
      'attachmentType',type,'usedStorageBytes',usedStorageBytes,'lastUpdated',floor(extract(epoch from lastUpdated)*1000)::bigint)
      FROM webknossos.organization_usedStorage_attachments WHERE _dataset=$1"#)
        .bind(id.as_str()).fetch_all(&state.pool).await?;
    rows.extend(attachments);
    Ok(Json(rows))
}
