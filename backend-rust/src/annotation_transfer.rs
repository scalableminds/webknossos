//! AnnotationController.transfer / AnnotationService.transferAnnotationToUser:
//! hand a saved annotation over to another user who can read its dataset.
use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::patch};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState, annotation_access, annotation_lists,
    annotation_metadata::{NO_UPDATE_ACCESS, NOT_ALLOWED},
    annotation_provider::{
        ANNOTATION_NOT_FOUND, AccessContext, AnnotationIdentifier, AnnotationProvider,
        RESTRICTIONS_NOT_FOUND,
    },
    auth::AuthUser,
    dataset_access,
    error::{ApiError, ApiResult},
    extract::{Json as JsonBody, Path},
    id::ObjectId,
    users,
};

/// Msg.Annotation.transfereeNoDatasetAccess.
pub const TRANSFEREE_NO_DATASET_ACCESS: &str =
    "Cannot transfer annotation to a user who has no access to the dataset.";

/// Msg.User.notFound(id).
pub fn user_not_found(id: &str) -> String {
    format!("User “{id}” could not be found or accessed.")
}

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/annotations/{typ}/{id}/transfer", patch(transfer))
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

/// TransferAnnotationParameters.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferParameters {
    user_id: ObjectId,
}

/// UserDAO.findOne under the requester's access context (self, team-managed
/// members, or users of an organization the requester administrates).
async fn readable_user<'e, E: sqlx::Executor<'e, Database = sqlx::Postgres>>(
    executor: E,
    requester: &AuthUser,
    target: &str,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT EXISTS(SELECT 1 FROM webknossos.users_ AS usr WHERE usr._id=$2 AND {})",
        users::READ_ACCESS_PREDICATE
    ))
    .bind(&requester.id)
    .bind(target)
    .fetch_one(executor)
    .await?)
}

async fn transfer(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    Extension(JobsEnabled(jobs)): Extension<JobsEnabled>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
    JsonBody(body): JsonBody<TransferParameters>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let target = body.user_id.as_str();
    let context = AccessContext::requester(Some(&user));
    // provider.restrictionsFor ?~> Restrictions.notFound ~> NOT_FOUND; an
    // unknown type fails inside restrictionsFor and is wrapped the same way.
    let restrictions = async {
        let identifier = AnnotationIdentifier::parse(&typ, &id)?;
        provider.restrictions_for(context, &identifier).await
    }
    .await
    .map_err(|error| {
        error
            .wrap(RESTRICTIONS_NOT_FOUND)
            .into_api_error(StatusCode::NOT_FOUND)
    })?;
    // Compound restrictions never allow finishing, so only saved
    // annotations get past this point.
    if !restrictions.allow_finish {
        return Err(ApiError::forbidden(NOT_ALLOWED));
    }
    if !readable_user(&state.pool, &user, target).await? {
        return Err(ApiError::bad_request(user_not_found(target)));
    }
    // transferAnnotationToUser: provideAnnotation ?~> Annotation.notFound.
    let provided = provider
        .provide(context, &typ, &id)
        .await
        .map_err(|error| ApiError::from(error.wrap(ANNOTATION_NOT_FOUND)))?;

    let mut transaction = state.pool.begin().await?;
    // Re-read and lock the live row, re-checking the finish restriction that
    // authorized the transfer so a concurrent finish/lock/owner change
    // cannot slip in between the check and the update.
    let annotation = annotation_access::lock_readable(&mut transaction, &user, provided.id())
        .await?
        .ok_or_else(|| ApiError::bad_request(ANNOTATION_NOT_FOUND))?;
    let restrictions = annotation_access::restrictions(&annotation, Some(&user));
    if !restrictions.allow_finish {
        return Err(ApiError::forbidden(NOT_ALLOWED));
    }
    if !readable_user(&mut *transaction, &user, target).await? {
        return Err(ApiError::bad_request(user_not_found(target)));
    }
    // datasetDAO.findOne under AuthorizedAccessContext(newUser): no sharing token.
    let transferee_can_read: bool = sqlx::query_scalar(&format!(
        "SELECT EXISTS(SELECT 1 FROM webknossos.datasets_ d WHERE d._id=$3 AND {})",
        dataset_access::READ_PREDICATE
    ))
    .bind(target)
    .bind(Option::<&str>::None)
    .bind(&annotation.dataset_id)
    .fetch_one(&mut *transaction)
    .await?;
    if !transferee_can_read {
        return Err(ApiError::bad_request(TRANSFEREE_NO_DATASET_ACCESS));
    }
    // AnnotationDAO.updateUser: assertUpdateAccess, then only `_user` changes.
    if !annotation_access::lock_update_access(&mut transaction, &user, &annotation.id).await? {
        return Err(ApiError::bad_request(NO_UPDATE_ACCESS));
    }
    sqlx::query("UPDATE webknossos.annotations SET _user=$2 WHERE _id=$1")
        .bind(&annotation.id)
        .bind(target)
        .execute(&mut *transaction)
        .await?;
    // Scala persists the owner change before reloading. The reload below runs
    // under the requester's read access and can fail afterwards (e.g. a
    // non-admin handing over a Private annotation); the transfer still stands.
    transaction.commit().await?;

    let reloaded = provider
        .provide(context, &typ, &id)
        .await
        .map_err(ApiError::from)?;
    let mut connection = state.pool.acquire().await?;
    let mut json = annotation_lists::full_json(&mut connection, &user, reloaded.id(), jobs).await?;
    // publicWrites(updated, user, Some(restrictions)): the restrictions were
    // resolved for the pre-transfer annotation, not recomputed for the new owner.
    json["restrictions"] = json!({
        "allowAccess": restrictions.allow_access,
        "allowUpdate": restrictions.allow_update,
        "allowFinish": restrictions.allow_finish,
        "allowDownload": restrictions.allow_download,
    });
    Ok(Json(json))
}
