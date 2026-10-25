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
use serde_json::{Value, json};

use crate::{
    AppState,
    annotation::metadata::PUBLIC_WRITES_FAILED,
    annotation::provider::AnnotationLayerType,
    annotation::provider::{
        AccessContext, AnnotationProvider, MERGE_FAILED_IN_TRACINGSTORE, ProvidedAnnotation,
        ProviderError,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Path,
    extract::extension,
    proto::AnnotationProto,
    stores::tracing_client::{MergeRequest, TracingStoreClient},
    util::id::ObjectId,
    util::instant::now_millis,
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
        .map_err(|_| ApiError::bad_request(crate::msg::request::INVALID_QUERY))?;
    let Some((_, value)) = pairs.into_iter().find(|(key, _)| key == KEY) else {
        return Ok(true);
    };
    match value.trim() {
        "true" => Ok(true),
        "false" => Ok(false),
        other => other
            .parse::<i32>()
            .map(|number| number != 0)
            .map_err(|_| ApiError::bad_request(crate::msg::request::invalid_boolean(KEY))),
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
        .wrap(crate::msg::annotation::NOT_FOUND)
        .into_api_error(StatusCode::NOT_FOUND)
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
        if !crate::dataset::access::can_read(&state.pool, Some(user), b.dataset_id(), None).await? {
            return Err(ProviderError::Empty);
        }
        let url = crate::stores::tracing_client::find_first_tracing_store_url(&state.pool)
            .await?
            .ok_or_else(|| ProviderError::failure(crate::msg::tracing_store::NOT_FOUND))?;
        let request = MergeRequest {
            annotation_ids: vec![ObjectId::parse(a.id())?, ObjectId::parse(b.id())?],
            owner_ids: vec![a.owner_id().clone(), b.owner_id().clone()],
            additional_bounding_boxes: Vec::new(),
            new_annotation_id: new_id.clone(),
            to_temporary_store: false,
            requesting_user_id: user.id.clone(),
            remap_segment_ids,
        };
        tracing_store
            .merge_annotations_by_ids(&url, &request)
            .await
            .map_err(ProviderError::from)
    };
    in_tracing_store
        .await
        .map_err(|error| error.wrap(MERGE_FAILED_IN_TRACINGSTORE))
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
        .bind(AnnotationLayerType::from(layer.typ()).as_str())
        .bind(&layer.name)
        .execute(&mut *transaction)
        .await?;
    }
    // restrictions = defaultsFor(merged); Fox.assertTrue(allowAccess(..))
    // ?~> noAccessOnMerged ~> FORBIDDEN. For an Internal annotation owned by
    // the requester allowAccess is always true. The check
    // runs on the inserted row inside the transaction (rolled back on denial).
    let metadata =
        crate::annotation::access::find(&mut *transaction, Some(user), new_id.as_str(), true)
            .await?;
    if !crate::annotation::access::restrictions(&metadata, Some(user)).allow_access {
        return Err(ApiError::forbidden(NO_ACCESS_ON_MERGED));
    }
    // publicWrites(merged, user, restrictions) ?~> publicWritesFailed. It runs
    // before commit so a serializer failure leaves no row behind.
    let mut json = crate::annotation::lists::full_json(
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
mod tests;
