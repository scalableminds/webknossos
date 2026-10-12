//! Main application's datastore registry. Actual dataset storage runs in the
//! separately deployed datastore service.
use axum::{
    Extension, Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    routing::{delete, get},
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::{Postgres, Transaction};

use crate::{
    AppState,
    auth::{AuthUser, OptionalAuthUser},
    datasets::public_datastore_json_on_connection,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
};

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/datastores", get(list).post(create))
        .route("/datastores/{name}", delete(remove))
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

async fn list(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
) -> ApiResult<ResponseJson<Vec<Value>>> {
    // DataStoreDAO has no anonymousReadAccessQ override, so anonymous requests
    // receive an empty list. Superuser status does not bypass this read scope.
    let Some(user) = user else {
        return Ok(ResponseJson(Vec::new()));
    };
    let mut tx = state.pool.begin().await?;
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM webknossos.dataStores WHERE NOT isDeleted AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $1) ORDER BY name FOR SHARE",
    ).bind(&user.organization_id).fetch_all(&mut *tx).await?;
    let mut values = Vec::with_capacity(names.len());
    for name in names {
        values.push(public_datastore_json_on_connection(&mut tx, &name, jobs_enabled).await?);
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
    is_scratch: Option<bool>,
    allows_upload: Option<bool>,
    allows_upload_to_paths: Option<bool>,
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Json(body): Json<DataStoreParameters>,
) -> ApiResult<ResponseJson<Value>> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(
            "This feature is currently only available for superusers.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    lock_superuser(
        &mut tx,
        &user,
        "This feature is currently only available for superusers.",
    )
    .await?;
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.dataStores WHERE name = $1 AND NOT isDeleted AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $2))",
    ).bind(&body.name).bind(&user.organization_id).fetch_one(&mut *tx).await?;
    if taken {
        return Err(ApiError::bad_request(format!(
            "A data store named “{}” already exists. Please choose a different name.",
            body.name
        )));
    }
    // The original DTO does not accept onlyAllowedOrganization or storage
    // reporting configuration. Unknown fields cannot set those private flags.
    sqlx::query(
        "INSERT INTO webknossos.dataStores (name, url, publicUrl, key, isScratch, allowsUpload, allowsUploadToPaths, reportUsedStorageEnabled) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)",
    ).bind(&body.name).bind(&body.url).bind(&body.public_url).bind(&body.key)
        .bind(body.is_scratch.unwrap_or(false)).bind(body.allows_upload.unwrap_or(true)).bind(body.allows_upload_to_paths.unwrap_or(true))
        .execute(&mut *tx).await?;
    let response = public_datastore_json_on_connection(&mut tx, &body.name, jobs_enabled).await?;
    tx.commit().await?;
    Ok(ResponseJson(response))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(name): Path<String>,
) -> ApiResult<StatusCode> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(
            "You are not authorized to view or edit this resource.",
        ));
    }
    // Preserve the existing idempotent soft-delete. Referencing datasets,
    // workers and credentials keep their records; nothing cascades here.
    let mut tx = state.pool.begin().await?;
    lock_superuser(
        &mut tx,
        &user,
        "You are not authorized to view or edit this resource.",
    )
    .await?;
    sqlx::query("UPDATE webknossos.dataStores SET isDeleted = TRUE WHERE name = $1")
        .bind(name)
        .execute(&mut *tx)
        .await?;
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
    let live: Option<String> = sqlx::query_scalar(
        r#"SELECT usr._id FROM webknossos.users AS usr
          JOIN webknossos.multiUsers AS multi ON multi._id = usr._multiUser
          JOIN webknossos.organizations AS org ON org._id = usr._organization
          WHERE usr._id = $1 AND usr._organization = $2 AND multi.isSuperUser
            AND NOT usr.isDeleted AND NOT usr.isDeactivated AND NOT multi.isDeleted AND NOT org.isDeleted
          FOR SHARE OF multi, usr, org"#,
    ).bind(&user.id).bind(&user.organization_id).fetch_optional(&mut **tx).await?;
    if live.is_none() {
        return Err(ApiError::forbidden(message));
    }
    Ok(())
}
