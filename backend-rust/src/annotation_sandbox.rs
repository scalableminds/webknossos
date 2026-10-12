//! AnnotationController.getSandbox: a synthetic, never persisted skeleton
//! annotation (dummy annotation/owner IDs and the `dummyTracingId` layer)
//! serialized like AnnotationService.publicWrites.
use axum::{Extension, Json, Router, extract::State, routing::get};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;

use crate::{
    AppState, annotation_access, annotation_lists,
    annotation_metadata::PUBLIC_WRITES_FAILED,
    annotation_provider::RESOURCE_NOT_FOUND,
    auth::{AuthUser, OptionalAuthUser},
    dataset_access,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    id::ObjectId,
};

/// Msg.Annotation.sandboxSkeletonOnly.
pub const SANDBOX_SKELETON_ONLY: &str =
    "Sandbox annotations are currently available as skeleton only.";
/// ObjectId.dummyId, used for both the annotation and its owner.
pub const DUMMY_ID: &str = "000000000000000000000000";
/// TracingId.dummy.
pub const DUMMY_TRACING_ID: &str = "dummyTracingId";

/// Msg.Dataset.notFound(id).
pub fn dataset_not_found(id: &str) -> String {
    format!("Dataset “{id}” could not be found or accessed.")
}

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/datasets/{datasetId}/sandbox/{typ}", get(sandbox))
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxQuery {
    sharing_token: Option<String>,
}

/// TracingType (skeleton, volume, hybrid); `fromString(..).toFox` on an
/// unknown value is Fox.Empty, rendered as 404 Msg.notFound.
fn require_skeleton(typ: &str) -> ApiResult<()> {
    match typ {
        "skeleton" => Ok(()),
        "volume" | "hybrid" => Err(ApiError::bad_request(SANDBOX_SKELETON_ONLY)),
        _ => Err(ApiError::not_found(RESOURCE_NOT_FOUND)),
    }
}

/// The Scala Annotation constructed by getSandbox, with its defaults
/// (Internal, Active, Explorational, OwnerOnly, unlocked, empty name and
/// description, no task, no tags, no tracing time).
fn sandbox_metadata(dataset_id: &str, now: DateTime<Utc>) -> annotation_access::AnnotationMetadata {
    annotation_access::AnnotationMetadata {
        id: DUMMY_ID.to_owned(),
        dataset_id: dataset_id.to_owned(),
        task_id: None,
        owner_id: DUMMY_ID.to_owned(),
        // userService.findOneCached(dummyId) fails, so every restriction
        // that needs the owner's organization falls back to false.
        owner_organization: None,
        name: String::new(),
        description: String::new(),
        visibility: "Internal".to_owned(),
        state: "Active".to_owned(),
        annotation_type: "Explorational".to_owned(),
        collaboration_mode: "OwnerOnly".to_owned(),
        is_locked_by_owner: false,
        tags: Vec::new(),
        tracing_time: None,
        created: now,
        modified: now,
        requester_manages_task_team: false,
        task_context_available: true,
        requester_has_mutex: false,
    }
}

/// AnnotationService.publicWrites for the never persisted annotation. The
/// dataset, organization, datastore and tracing store are read globally;
/// owner/user JSON is null for the dummy owner; shared teams, contributors
/// and the per-user view configuration are empty because no row references
/// the dummy annotation ID.
async fn public_json(
    connection: &mut PgConnection,
    user: Option<&AuthUser>,
    dataset_id: &str,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let annotation = sandbox_metadata(dataset_id, Utc::now());
    let dataset: Option<(String, String, String)> = sqlx::query_as(
        "SELECT d.name,o._id,trim(d._dataStore) FROM webknossos.datasets_ d
         JOIN webknossos.organizations_ o ON o._id=d._organization WHERE d._id=$1",
    )
    .bind(dataset_id)
    .fetch_optional(&mut *connection)
    .await?;
    let (dataset_name, organization, datastore) =
        dataset.ok_or_else(|| ApiError::not_found("Annotation dataset not found."))?;
    let data_store =
        crate::datasets::public_datastore_json_on_connection(connection, &datastore, jobs_enabled)
            .await?;
    let tracing_store: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object('name',store.name,'url',store.publicUrl) FROM webknossos.tracingStores_ store LIMIT 1",
    )
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| ApiError::not_found("Tracing store not found."))?;
    let restrictions = annotation_access::restrictions(&annotation, user);
    let timestamp = annotation.created.timestamp_millis();
    Ok(json!({
        "modified": annotation.modified.timestamp_millis(),
        "created": timestamp,
        "state": annotation.state,
        "isLockedByOwner": annotation.is_locked_by_owner,
        "id": annotation.id,
        "name": annotation.name,
        "description": annotation.description,
        "viewConfiguration": Value::Null,
        "typ": annotation.annotation_type,
        "task": Value::Null,
        "stats": {},
        "restrictions": {
            "allowAccess": restrictions.allow_access,
            "allowUpdate": restrictions.allow_update,
            "allowFinish": restrictions.allow_finish,
            "allowDownload": restrictions.allow_download,
        },
        "annotationLayers": [{
            "tracingId": DUMMY_TRACING_ID,
            "typ": "Skeleton",
            "name": "Skeleton",
            "stats": {},
        }],
        "datasetId": dataset_id,
        "dataSetName": dataset_name,
        "organization": organization,
        "dataStore": data_store,
        "tracingStore": tracing_store,
        "visibility": annotation.visibility,
        "settings": annotation_lists::default_settings(true),
        "tracingTime": annotation.tracing_time,
        "teams": [],
        "tags": [dataset_name],
        "user": Value::Null,
        "owner": Value::Null,
        "contributors": [],
        "collaborationMode": annotation.collaboration_mode,
    }))
}

async fn sandbox(
    State(state): State<AppState>,
    Extension(JobsEnabled(jobs)): Extension<JobsEnabled>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path((dataset_id, typ)): Path<(String, String)>,
    Query(query): Query<SandboxQuery>,
) -> ApiResult<Json<Value>> {
    let dataset_id = ObjectId::parse_path(&dataset_id)?;
    // URLSharing.fallbackTokenAccessContext: the user's grants and the
    // optional sharing token are additive.
    if !dataset_access::can_read(
        &state.pool,
        user.as_ref(),
        dataset_id.as_str(),
        query.sharing_token.as_deref(),
    )
    .await?
    {
        return Err(ApiError::not_found(dataset_not_found(dataset_id.as_str())));
    }
    require_skeleton(&typ)?;
    let mut connection = state.pool.acquire().await?;
    let json = public_json(&mut connection, user.as_ref(), dataset_id.as_str(), jobs)
        .await
        .map_err(|error| {
            if error.status.is_server_error() {
                error
            } else {
                ApiError::bad_request(PUBLIC_WRITES_FAILED)
            }
        })?;
    Ok(Json(json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracing_type_is_case_sensitive_and_skeleton_only() {
        assert!(require_skeleton("skeleton").is_ok());
        for typ in ["volume", "hybrid"] {
            let error = require_skeleton(typ).unwrap_err();
            assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
            assert_eq!(error.message, SANDBOX_SKELETON_ONLY);
        }
        for typ in ["Skeleton", "Explorational", ""] {
            let error = require_skeleton(typ).unwrap_err();
            assert_eq!(error.status, axum::http::StatusCode::NOT_FOUND);
            assert_eq!(error.message, RESOURCE_NOT_FOUND);
        }
    }

    #[test]
    fn dummy_owner_yields_no_restrictions_even_for_admins() {
        let user = AuthUser {
            id: "5f0000000000000000000001".to_owned(),
            organization_id: "org".to_owned(),
            is_admin: true,
            is_dataset_manager: true,
            is_superuser: true,
        };
        let annotation = sandbox_metadata("5f0000000000000000000002", Utc::now());
        for user in [None, Some(&user)] {
            let r = annotation_access::restrictions(&annotation, user);
            assert!(!r.allow_access && !r.allow_update && !r.allow_finish && !r.allow_download);
        }
    }
}
