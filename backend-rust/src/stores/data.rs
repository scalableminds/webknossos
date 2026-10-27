//! Main application's datastore registry. Actual dataset storage runs in the
//! separately deployed datastore service.
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    routing::{delete, get},
};
use serde::Deserialize;
use sqlx::{Postgres, Transaction};

use crate::{
    AppState,
    auth::{AuthUser, OptionalAuthUser},
    dataset::routes::{PublicDataStore, public_datastore_on_connection},
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    state::JobsEnabled,
};

use super::dao;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datastores", get(list).post(create))
        .route("/datastores/{name}", delete(remove))
}

async fn list(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
) -> ApiResult<ResponseJson<Vec<PublicDataStore>>> {
    // DataStoreDAO has no anonymousReadAccessQ override, so anonymous requests
    // receive an empty list. Superuser status does not bypass this read scope.
    let Some(user) = user else {
        return Ok(ResponseJson(Vec::new()));
    };
    let mut tx = state.pool.begin().await?;
    let names = dao::find_all_names_for_organization(&mut tx, &user.organization_id).await?;
    let mut values = Vec::with_capacity(names.len());
    for name in names {
        values.push(public_datastore_on_connection(&mut tx, &name, jobs_enabled).await?);
    }
    tx.commit().await?;
    Ok(ResponseJson(values))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataStoreParameters {
    name: String,
    url: String,
    public_url: String,
    key: String,
    allows_upload: Option<bool>,
    allows_upload_to_paths: Option<bool>,
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    Json(body): Json<DataStoreParameters>,
) -> ApiResult<ResponseJson<PublicDataStore>> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(crate::msg::user::SUPER_USER_ONLY));
    }
    let mut tx = state.pool.begin().await?;
    lock_superuser(&mut tx, &user, crate::msg::user::SUPER_USER_ONLY).await?;
    let taken = dao::name_is_taken(&mut tx, &body.name, &user.organization_id).await?;
    if taken {
        return Err(ApiError::bad_request(format!(
            "A data store named “{}” already exists. Please choose a different name.",
            body.name
        )));
    }
    // The original DTO does not accept onlyAllowedOrganization or storage
    // reporting configuration. Unknown fields cannot set those private flags.
    dao::insert_one(
        &mut tx,
        &body.name,
        &body.url,
        &body.public_url,
        &body.key,
        body.allows_upload.unwrap_or(true),
        body.allows_upload_to_paths.unwrap_or(true),
    )
    .await?;
    let response = public_datastore_on_connection(&mut tx, &body.name, jobs_enabled).await?;
    tx.commit().await?;
    Ok(ResponseJson(response))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(name): Path<String>,
) -> ApiResult<StatusCode> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    // Preserve the existing idempotent soft-delete. Referencing datasets,
    // workers and credentials keep their records; nothing cascades here.
    let mut tx = state.pool.begin().await?;
    lock_superuser(&mut tx, &user, crate::msg::NOT_ALLOWED).await?;
    dao::delete_one(&mut tx, name).await?;
    tx.commit().await?;
    Ok(StatusCode::OK)
}

// Stabilize the live account's superuser privilege for each mutation, using the
// same multiuser -> user -> organization lock order as credential insertion.
async fn lock_superuser(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    message: &str,
) -> ApiResult<()> {
    let live = dao::lock_live_superuser(tx, &user.id, &user.organization_id).await?;
    if live.is_none() {
        return Err(ApiError::forbidden(message));
    }
    Ok(())
}
