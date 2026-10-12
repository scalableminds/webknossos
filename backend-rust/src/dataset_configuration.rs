use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sqlx::PgPool;

use crate::{
    AppState,
    auth::{AuthUser, OptionalAuthUser},
    dataset_access, datasets,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    id::PathObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datasetConfigurations/{datasetId}", post(read).put(update))
        .route(
            "/datasetConfigurations/default/{datasetId}",
            get(read_admin).put(update_admin),
        )
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharingQuery {
    sharing_token: Option<String>,
}

#[derive(sqlx::FromRow)]
struct DatasetConfiguration {
    is_usable: bool,
    has_voxel_size: bool,
    default_configuration: Option<Value>,
    admin_configuration: Option<Value>,
}

fn merge(base: &mut Map<String, Value>, configuration: Option<Value>) {
    if let Some(Value::Object(configuration)) = configuration {
        base.extend(configuration);
    }
}

async fn complete(
    pool: &PgPool,
    dataset_id: &str,
    dataset: DatasetConfiguration,
    existing: Option<Value>,
    user: Option<&AuthUser>,
    requested: &[String],
    admin_only: bool,
) -> ApiResult<Value> {
    let mut result = Map::new();
    if let Some(existing) = existing {
        merge(&mut result, Some(existing));
    } else {
        merge(&mut result, dataset.default_configuration);
        merge(&mut result, dataset.admin_configuration);
    }
    let layer_rows = if dataset.is_usable {
        if !dataset.has_voxel_size {
            return Err(ApiError::internal());
        }
        datasets::full_layers(pool, dataset_id).await?
    } else {
        Vec::new()
    };
    let mut layers = Map::new();
    for data_layer in layer_rows {
        let name = data_layer["name"]
            .as_str()
            .ok_or_else(ApiError::internal)?
            .to_owned();
        let mut layer = Map::new();
        if !admin_only {
            merge(
                &mut layer,
                data_layer.get("defaultViewConfiguration").cloned(),
            );
        }
        merge(
            &mut layer,
            data_layer.get("adminViewConfiguration").cloned(),
        );
        layers.insert(name, Value::Object(layer));
    }
    if !admin_only {
        for name in requested {
            layers.entry(name.clone()).or_insert_with(|| json!({}));
        }
    }
    if let Some(user) = user {
        let names: Vec<&str> = layers.keys().map(String::as_str).collect();
        let existing:Vec<(String,Value)> = sqlx::query_as("SELECT layerName, viewConfiguration FROM webknossos.user_datasetLayerConfigurations WHERE _user = $1 AND _dataset = $2 AND layerName = ANY($3::text[])")
            .bind(&user.id).bind(dataset_id).bind(&names).fetch_all(pool).await?;
        for (name, config) in existing {
            if let Some(Value::Object(layer)) = layers.get_mut(&name) {
                merge(layer, Some(config));
            }
        }
    }
    result.insert("layers".to_owned(), Value::Object(layers));
    Ok(Value::Object(result))
}

async fn dataset(pool: &PgPool, id: &str) -> ApiResult<Option<DatasetConfiguration>> {
    Ok(sqlx::query_as("SELECT isUsable AS is_usable, voxelSizeFactor IS NOT NULL AS has_voxel_size, defaultViewConfiguration AS default_configuration, adminViewConfiguration AS admin_configuration FROM webknossos.datasets_ WHERE _id = $1")
        .bind(id).fetch_optional(pool).await?)
}

async fn read(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(id): Path<PathObjectId>,
    Query(query): Query<SharingQuery>,
    RequestJson(requested): RequestJson<Vec<String>>,
) -> ApiResult<Json<Value>> {
    // Scala first attempts the authenticated user's saved configuration with
    // GlobalAccessContext. Only if it does not exist does it fall back to the
    // dataset default configuration through normal sharing-aware read access.
    let existing = if let Some(user) = user.as_ref() {
        sqlx::query_scalar::<_,Value>("SELECT viewConfiguration FROM webknossos.user_datasetConfigurations WHERE _user = $1 AND _dataset = $2")
            .bind(&user.id).bind(id.as_str()).fetch_optional(&state.pool).await?
    } else {
        None
    };
    if existing.is_none()
        && !dataset_access::can_read(
            &state.pool,
            user.as_ref(),
            id.as_str(),
            query.sharing_token.as_deref(),
        )
        .await?
    {
        return Ok(Json(json!({})));
    }
    let Some(dataset) = dataset(&state.pool, id.as_str()).await? else {
        return Ok(Json(json!({})));
    };
    let configured_user = if existing.is_some() {
        user.as_ref()
    } else {
        None
    };
    Ok(Json(
        complete(
            &state.pool,
            id.as_str(),
            dataset,
            existing,
            configured_user,
            &requested,
            false,
        )
        .await
        .unwrap_or_else(|_| json!({})),
    ))
}

async fn read_admin(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<Json<Value>> {
    if !dataset_access::can_read(&state.pool, Some(&user), id.as_str(), None).await? {
        return Err(ApiError::not_found("Dataset not found."));
    }
    let dataset = dataset(&state.pool, id.as_str())
        .await?
        .ok_or_else(|| ApiError::not_found("Dataset not found."))?;
    Ok(Json(
        complete(&state.pool, id.as_str(), dataset, None, None, &[], true).await?,
    ))
}

fn success() -> Json<Value> {
    Json(json!({"messages":[{"success":"Dataset configuration was successfully updated."}]}))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    RequestJson(mut config): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Value>> {
    let mut transaction = state.pool.begin().await?;
    // UserService intentionally permits saving a personal configuration for
    // any existing dataset; dataset sharing permissions are not an edit grant.
    sqlx::query("SELECT _id FROM webknossos.datasets_ WHERE _id = $1 FOR SHARE")
        .bind(id.as_str())
        .fetch_one(&mut *transaction)
        .await?;
    if let Some(Value::Object(layers)) = config.remove("layers") {
        for (name, layer) in layers {
            if layer.is_object() {
                sqlx::query("INSERT INTO webknossos.user_datasetLayerConfigurations (_user,_dataset,layerName,viewConfiguration) VALUES ($1,$2,$3,$4) ON CONFLICT (_user,_dataset,layerName) DO UPDATE SET viewConfiguration = EXCLUDED.viewConfiguration")
                .bind(&user.id).bind(id.as_str()).bind(name).bind(layer).execute(&mut *transaction).await?;
            }
        }
    }
    sqlx::query("INSERT INTO webknossos.user_datasetConfigurations (_user,_dataset,viewConfiguration) VALUES ($1,$2,$3) ON CONFLICT (_user,_dataset) DO UPDATE SET viewConfiguration = EXCLUDED.viewConfiguration")
        .bind(&user.id).bind(id.as_str()).bind(Value::Object(config)).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(success())
}

async fn update_admin(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    RequestJson(mut config): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Value>> {
    if !dataset_access::can_edit(&state.pool, &user, id.as_str()).await? {
        return Err(ApiError::forbidden("Not allowed."));
    }
    let mut transaction = state.pool.begin().await?;
    dataset_access::lock_edit(&mut transaction, &user, id.as_str(), true).await?;
    sqlx::query("UPDATE webknossos.datasets SET adminViewConfiguration = $2, thumbnailCacheVersion = thumbnailCacheVersion + 1 WHERE _id = $1 AND NOT isDeleted")
        .bind(id.as_str()).bind(Value::Object({let mut dataset=config.clone();dataset.remove("layers");dataset})).execute(&mut *transaction).await?;
    if let Some(Value::Object(layers)) = config.remove("layers") {
        // The Scala decoder accepts the whole layer map only when every
        // configuration is an object. An invalid entry causes all to be ignored.
        if layers.values().all(Value::is_object) {
            for (name, layer) in layers {
                sqlx::query("UPDATE webknossos.dataset_layers SET adminViewConfiguration = $3 WHERE _dataset = $1 AND name = $2")
                .bind(id.as_str()).bind(name).bind(layer).execute(&mut *transaction).await?;
            }
        }
    }
    sqlx::query("DELETE FROM webknossos.dataset_thumbnails WHERE _dataset = $1")
        .bind(id.as_str())
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(success())
}
