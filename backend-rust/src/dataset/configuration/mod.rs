mod dao;

use crate::response::Messages;
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use dao::DatasetConfiguration;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sqlx::PgPool;

use crate::{
    AppState,
    auth::{AuthUser, OptionalAuthUser},
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    util::id::{ObjectId, PathObjectId},
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

fn merge(base: &mut Map<String, Value>, configuration: Option<Value>) {
    if let Some(Value::Object(configuration)) = configuration {
        base.extend(configuration);
    }
}

async fn complete(
    pool: &PgPool,
    dataset_id: &ObjectId,
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
        crate::dataset::routes::full_layers(pool, dataset_id).await?
    } else {
        Vec::new()
    };
    let mut layers = Map::new();
    for data_layer in layer_rows {
        let name = data_layer["name"]
            .as_str()
            .ok_or_else(ApiError::internal)?
            .to_owned();
        // The admin view lists only layers that have an admin configuration
        // (Scala getAllLayerAdminViewConfigForDataset flatMaps over the Option).
        if admin_only && !data_layer["adminViewConfiguration"].is_object() {
            continue;
        }
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
        let existing =
            dao::find_user_layer_configurations(pool, &user.id, dataset_id, &names).await?;
        for (name, config) in existing {
            if let Some(Value::Object(layer)) = layers.get_mut(&name) {
                merge(layer, Some(config));
            }
        }
    }
    result.insert("layers".to_owned(), Value::Object(layers));
    Ok(Value::Object(result))
}

async fn dataset(pool: &PgPool, id: &ObjectId) -> ApiResult<Option<DatasetConfiguration>> {
    dao::find_configuration(pool, id).await
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
        dao::find_user_configuration(&state.pool, &user.id, &id).await?
    } else {
        None
    };
    if existing.is_none()
        && !crate::dataset::access::can_read(
            &state.pool,
            user.as_ref(),
            &id,
            query.sharing_token.as_deref(),
        )
        .await?
    {
        return Ok(Json(json!({})));
    }
    let Some(dataset) = dataset(&state.pool, &id).await? else {
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
            &id,
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
    if !crate::dataset::access::can_read(&state.pool, Some(&user), &id, None).await? {
        return Err(ApiError::not_found(crate::msg::dataset::MISSING));
    }
    let dataset = dataset(&state.pool, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::dataset::MISSING))?;
    Ok(Json(
        complete(&state.pool, &id, dataset, None, None, &[], true).await?,
    ))
}

fn success() -> Json<Messages> {
    Messages::success(crate::msg::user::configuration::UPDATE_SUCCESS_FOR_DATASET)
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    RequestJson(mut config): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Messages>> {
    let mut transaction = state.pool.begin().await?;
    // UserService intentionally permits saving a personal configuration for
    // any existing dataset; dataset sharing permissions are not an edit grant.
    dao::lock_dataset_for_share(&mut transaction, &id).await?;
    if let Some(Value::Object(layers)) = config.remove("layers") {
        for (name, layer) in layers {
            if layer.is_object() {
                dao::upsert_user_layer_configuration(&mut transaction, &user.id, &id, name, layer)
                    .await?;
            }
        }
    }
    dao::upsert_user_configuration(&mut transaction, &user.id, &id, Value::Object(config)).await?;
    transaction.commit().await?;
    Ok(success())
}

async fn update_admin(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    RequestJson(mut config): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Messages>> {
    // DatasetDAO.findOne under the requester's access (?~> notFound ~> 404),
    // then DatasetService.assertEditableBy (403 Msg.notAllowed).
    crate::dataset::lifecycle::require_editable(&state, &user, &id).await?;
    let mut transaction = state.pool.begin().await?;
    crate::dataset::access::lock_edit(&mut transaction, &user, &id, true).await?;
    dao::update_admin_view_configuration(
        &mut transaction,
        &id,
        Value::Object({
            let mut dataset = config.clone();
            dataset.remove("layers");
            dataset
        }),
    )
    .await?;
    if let Some(Value::Object(layers)) = config.remove("layers") {
        // The Scala decoder accepts the whole layer map only when every
        // configuration is an object. An invalid entry causes all to be ignored.
        if layers.values().all(Value::is_object) {
            for (name, layer) in layers {
                dao::update_layer_admin_view_configuration(&mut transaction, &id, name, layer)
                    .await?;
            }
        }
    }
    dao::delete_thumbnails(&mut transaction, &id).await?;
    transaction.commit().await?;
    Ok(success())
}
