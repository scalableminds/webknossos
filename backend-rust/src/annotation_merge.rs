//! AnnotationController.merge (`POST /annotations/:typ/:id/merge/:mergedTyp/:mergedId`)
//! and mergeWithoutType (`POST /annotations/:id/merge/:mergedTyp/:mergedId`):
//! AnnotationMerger.mergeTwo merges two provided (saved or compound)
//! annotations in the tracing store into a NEW persistent Explorational owned
//! by the requester (`mergedFromIds` with `toTemporaryStore=false`), which is
//! then inserted (AnnotationDAO.insertOne) and serialized.
use axum::{
    Extension, Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    routing::post,
};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use crate::{
    AppState, annotation_access, annotation_lists,
    annotation_metadata::PUBLIC_WRITES_FAILED,
    annotation_provider::{
        ANNOTATION_NOT_FOUND, AccessContext, AnnotationProvider, FoxFailure,
        MERGE_FAILED_IN_TRACINGSTORE, ProvidedAnnotation, ProviderError,
    },
    auth::AuthUser,
    dataset_access,
    error::{ApiError, ApiResult},
    extract::Path,
    id::ObjectId,
    proto::{AnnotationLayerTypeProto, AnnotationProto},
    service_clients::ServiceError,
    tracingstore_client::{
        self, MergeRequest, TRACING_STORE_NOT_FOUND, TracingStoreClient, TracingStoreError,
    },
};

/// Msg.Annotation.Merge.failed.
pub const MERGE_FAILED: &str = "Could not merge annotations.";
/// Msg.Annotation.Merge.success.
pub const MERGE_SUCCESS: &str = "Merging annotations was successful.";
/// Msg.Annotation.Merge.noAccessOnMerged.
pub const NO_ACCESS_ON_MERGED: &str = "Could not access merged annotation.";

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route(
            "/annotations/{typ}/{id}/merge/{merged_typ}/{merged_id}",
            post(merge),
        )
        .route(
            "/annotations/{id}/merge/{merged_typ}/{merged_id}",
            post(merge_without_type),
        )
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

/// Play's `remapSegmentIds: Option[Boolean]` binder (first value wins; the
/// Boolean binder trims, accepts true/false or any integer, non-zero = true).
/// Absent defaults to `true` (`remapSegmentIds.getOrElse(true)`).
pub fn parse_remap_segment_ids(query: Option<&str>) -> ApiResult<bool> {
    const KEY: &str = "remapSegmentIds";
    let pairs: Vec<(String, String)> = serde_urlencoded::from_str(query.unwrap_or(""))
        .map_err(|_| ApiError::bad_request("Invalid query parameters."))?;
    let Some((_, value)) = pairs.into_iter().find(|(key, _)| key == KEY) else {
        return Ok(true);
    };
    match value.trim() {
        "true" => Ok(true),
        "false" => Ok(false),
        other => other.parse::<i32>().map(|number| number != 0).map_err(|_| {
            ApiError::bad_request(format!(
                "Cannot parse parameter {KEY} as Boolean: should be true, false, 0 or 1"
            ))
        }),
    }
}

/// Bound during routing, before authentication.
pub struct RemapSegmentIds(pub bool);

impl<S: Send + Sync> FromRequestParts<S> for RemapSegmentIds {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parse_remap_segment_ids(parts.uri.query()).map(Self)
    }
}

struct Services {
    provider: AnnotationProvider,
    tracing_store: TracingStoreClient,
    jobs_enabled: bool,
}

fn extension<T: Clone + Send + Sync + 'static>(parts: &Parts) -> ApiResult<T> {
    parts
        .extensions
        .get::<T>()
        .cloned()
        .ok_or_else(ApiError::internal)
}

impl<S: Send + Sync> FromRequestParts<S> for Services {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: extension(parts)?,
            tracing_store: extension(parts)?,
            jobs_enabled: extension::<JobsEnabled>(parts)?.0,
        })
    }
}

/// POST /annotations/:typ/:id/merge/:mergedTyp/:mergedId?remapSegmentIds=
async fn merge(
    State(state): State<AppState>,
    services: Services,
    RemapSegmentIds(remap): RemapSegmentIds,
    Path((typ, id, merged_typ, merged_id)): Path<(String, String, String, String)>,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let merged_id = ObjectId::parse_path(&merged_id)?;
    merge_typed(
        &state,
        &services,
        &user,
        (&typ, &id),
        (&merged_typ, &merged_id),
        remap,
    )
    .await
    .map(Json)
}

/// POST /annotations/:id/merge/:mergedTyp/:mergedId?remapSegmentIds=:
/// provideAnnotation(id, user) resolves the saved row (never compound) with
/// `?~> notFound ~> NOT_FOUND`, then `merge` runs with its STORED type and
/// re-provides it.
async fn merge_without_type(
    State(state): State<AppState>,
    services: Services,
    RemapSegmentIds(remap): RemapSegmentIds,
    Path((id, merged_typ, merged_id)): Path<(String, String, String)>,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let merged_id = ObjectId::parse_path(&merged_id)?;
    let saved = services
        .provider
        .provide_saved(AccessContext::requester(Some(&user)), &id)
        .await
        .map_err(not_found)?;
    merge_typed(
        &state,
        &services,
        &user,
        (&saved.annotation_type, &id),
        (&merged_typ, &merged_id),
        remap,
    )
    .await
    .map(Json)
}

/// `provideAnnotation(..) ?~> Msg.Annotation.notFound ~> NOT_FOUND`.
fn not_found(error: ProviderError) -> ApiError {
    error
        .wrap(ANNOTATION_NOT_FOUND)
        .into_api_error(StatusCode::NOT_FOUND)
}

fn failure(message: &str, status: Option<StatusCode>) -> ProviderError {
    ProviderError::Failure(FoxFailure {
        message: message.to_owned(),
        chain: Vec::new(),
        status,
    })
}

/// RPC failures are Fox failures; only an unsuccessful upstream HTTP status
/// is kept as ParamFailure status (RPCRequest `~> result.status`).
fn tracing_store_failure(error: TracingStoreError) -> ProviderError {
    let status = match &error {
        TracingStoreError::Service(ServiceError::UpstreamStatus(code)) => {
            StatusCode::from_u16(*code).ok()
        }
        _ => None,
    };
    failure(&error.to_string(), status)
}

/// AnnotationMerger.mergeTwo → mergeN(newId, toTemporaryStore = false,
/// requester, annotationB's dataset, Explorational, [A, B], no boxes, remap)
/// → mergeAnnotationsInTracingstore (`?~> "Failed to merge annotations in
/// tracingstore."`): dataset read under the requester's access context
/// (unreadable = Fox.empty), first live tracing store, `mergedFromIds`.
async fn merge_two(
    state: &AppState,
    tracing_store: &TracingStoreClient,
    user: &AuthUser,
    new_id: &ObjectId,
    a: &ProvidedAnnotation,
    b: &ProvidedAnnotation,
    remap_segment_ids: bool,
) -> Result<AnnotationProto, ProviderError> {
    let in_tracing_store = async {
        if !dataset_access::can_read(&state.pool, Some(user), b.dataset_id(), None).await? {
            return Err(ProviderError::Empty);
        }
        let url = tracingstore_client::find_first_tracing_store_url(&state.pool)
            .await?
            .ok_or_else(|| failure(TRACING_STORE_NOT_FOUND, None))?;
        let request = MergeRequest {
            annotation_ids: vec![ObjectId::parse(a.id())?, ObjectId::parse(b.id())?],
            owner_ids: vec![
                ObjectId::parse(a.owner_id())?,
                ObjectId::parse(b.owner_id())?,
            ],
            additional_bounding_boxes: Vec::new(),
            new_annotation_id: new_id.clone(),
            to_temporary_store: false,
            requesting_user_id: ObjectId::parse(&user.id)?,
            remap_segment_ids,
        };
        tracing_store
            .merge_annotations_by_ids(&url, &request)
            .await
            .map_err(tracing_store_failure)
    };
    in_tracing_store
        .await
        .map_err(|error| error.wrap(MERGE_FAILED_IN_TRACINGSTORE))
}

fn layer_type(typ: AnnotationLayerTypeProto) -> &'static str {
    match typ {
        AnnotationLayerTypeProto::Skeleton => "Skeleton",
        AnnotationLayerTypeProto::Volume => "Volume",
    }
}

/// Instant.now (millisecond precision).
fn now_millis() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap_or_else(Utc::now)
}

/// AnnotationController.merge, in Scala order.
async fn merge_typed(
    state: &AppState,
    services: &Services,
    user: &AuthUser,
    (typ, id): (&str, &ObjectId),
    (merged_typ, merged_id): (&str, &ObjectId),
    remap_segment_ids: bool,
) -> ApiResult<Value> {
    let access = AccessContext::requester(Some(user));
    let annotation_a = services
        .provider
        .provide(access, typ, id)
        .await
        .map_err(not_found)?;
    let annotation_b = services
        .provider
        .provide(access, merged_typ, merged_id)
        .await
        .map_err(not_found)?;
    let new_id = ObjectId::new();
    // mergeTwo(..) ?~> Msg.Annotation.Merge.failed (default 400, or the
    // upstream status of an unsuccessful RPC).
    let merged = merge_two(
        state,
        &services.tracing_store,
        user,
        &new_id,
        &annotation_a,
        &annotation_b,
        remap_segment_ids,
    )
    .await
    .map_err(|error| ApiError::from(error.wrap(MERGE_FAILED)))?;

    // AnnotationDAO.insertOne: annotation row + layers (statistics unknown =
    // `{}`) in one transaction. Annotation defaults: no task, empty name and
    // description, Internal, Active, no tags, no tracing time, OwnerOnly.
    let now = now_millis();
    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,description,visibility,name,state,tags,tracingTime,typ,collaborationMode,created,modified,isDeleted)
         VALUES($1,$2,NULL,$3,'','Internal','','Active','{}',NULL,'Explorational','OwnerOnly',$4,$4,false)",
    )
    .bind(new_id.as_str())
    .bind(annotation_b.dataset_id())
    .bind(&user.id)
    .bind(now)
    .execute(&mut *transaction)
    .await?;
    for layer in &merged.annotation_layers {
        sqlx::query(
            "INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics)
             VALUES($1,$2,$3::webknossos.ANNOTATION_LAYER_TYPE,$4,'{}'::jsonb)",
        )
        .bind(new_id.as_str())
        .bind(&layer.tracing_id)
        .bind(layer_type(layer.typ()))
        .bind(&layer.name)
        .execute(&mut *transaction)
        .await?;
    }
    // restrictions = defaultsFor(merged). Deliberately fail closed: in Scala
    // `_ <- allowAccess(..) ?~> noAccessOnMerged ~> FORBIDDEN` binds a
    // Fox[Boolean], so `false` would not short-circuit. For an Internal
    // annotation owned by the requester allowAccess is always true. The check
    // runs on the inserted row inside the transaction (rolled back on denial).
    let metadata =
        annotation_access::find(&mut *transaction, Some(user), new_id.as_str(), true).await?;
    if !annotation_access::restrictions(&metadata, Some(user)).allow_access {
        return Err(ApiError::forbidden(NO_ACCESS_ON_MERGED));
    }
    // publicWrites(merged, user, restrictions) ?~> publicWritesFailed. It runs
    // before commit so a serializer failure leaves no row behind.
    let mut json = annotation_lists::full_json(
        &mut transaction,
        user,
        new_id.as_str(),
        services.jobs_enabled,
    )
    .await
    .map_err(|error| {
        if error.status.is_server_error() {
            error
        } else {
            ApiError::bad_request(PUBLIC_WRITES_FAILED)
        }
    })?;
    transaction.commit().await?;
    json["messages"] = json!([{ "success": MERGE_SUCCESS }]);
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::parse_remap_segment_ids;

    #[test]
    fn remap_segment_ids_follows_play_option_boolean_binder() {
        assert!(parse_remap_segment_ids(None).unwrap());
        assert!(parse_remap_segment_ids(Some("other=false")).unwrap());
        assert!(!parse_remap_segment_ids(Some("remapSegmentIds=false")).unwrap());
        assert!(!parse_remap_segment_ids(Some("remapSegmentIds=%200%20")).unwrap());
        assert!(parse_remap_segment_ids(Some("remapSegmentIds=2&remapSegmentIds=0")).unwrap());
        assert_eq!(
            parse_remap_segment_ids(Some("remapSegmentIds=yes"))
                .unwrap_err()
                .message,
            "Cannot parse parameter remapSegmentIds as Boolean: should be true, false, 0 or 1"
        );
    }
}
