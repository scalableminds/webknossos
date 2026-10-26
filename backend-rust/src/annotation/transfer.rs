//! AnnotationController.transfer / AnnotationService.transferAnnotationToUser:
//! hand a saved annotation over to another user who can read its dataset.
use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::patch};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    AppState,
    annotation::dao,
    annotation::provider::{
        AccessContext, AnnotationIdentifier, AnnotationProvider, RESTRICTIONS_NOT_FOUND,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as JsonBody, Path},
    users::notification_emails::NotificationEmailService,
    util::id::ObjectId,
};

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

async fn transfer(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    Extension(JobsEnabled(jobs)): Extension<JobsEnabled>,
    Extension(notification_emails): Extension<NotificationEmailService>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
    JsonBody(body): JsonBody<TransferParameters>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let target = &body.user_id;
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
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    if !dao::is_user_readable(&state.pool, &user, target).await? {
        return Err(ApiError::bad_request(crate::msg::user::not_found(target)));
    }
    // transferAnnotationToUser: provideAnnotation ?~> Annotation.notFound.
    let provided = provider
        .provide(context, &typ, &id)
        .await
        .map_err(|error| ApiError::from(error.wrap(crate::msg::annotation::NOT_FOUND)))?;

    let mut transaction = state.pool.begin().await?;
    // Re-read and lock the live row, re-checking the finish restriction that
    // authorized the transfer so a concurrent finish/lock/owner change
    // cannot slip in between the check and the update.
    let annotation = crate::annotation::dao::lock_readable(&mut transaction, &user, provided.id())
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::annotation::NOT_FOUND))?;
    let restrictions = crate::annotation::access::restrictions(&annotation, Some(&user));
    if !restrictions.allow_finish {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    if !dao::is_user_readable(&mut *transaction, &user, target).await? {
        return Err(ApiError::bad_request(crate::msg::user::not_found(target)));
    }
    let transferee_can_read =
        dao::is_dataset_readable_by(&mut transaction, &annotation.dataset_id, target).await?;
    if !transferee_can_read {
        return Err(ApiError::bad_request(
            crate::msg::annotation::TRANSFEREE_NO_DATASET_ACCESS,
        ));
    }
    // AnnotationDAO.updateUser: assertUpdateAccess, then only `_user` changes.
    if !crate::annotation::dao::lock_update_access(&mut transaction, &user, &annotation.id).await? {
        return Err(ApiError::bad_request(
            crate::msg::annotation::NO_UPDATE_ACCESS,
        ));
    }
    dao::update_user(&mut transaction, &annotation.id, target).await?;
    // Scala persists the owner change before reloading. The reload below runs
    // under the requester's read access and can fail afterwards (e.g. a
    // non-admin handing over a Private annotation); the transfer still stands.
    transaction.commit().await?;
    notification_emails.send_annotation_transferred_email(
        &state.pool,
        &annotation.id,
        &annotation.name,
        &annotation.dataset_id,
        target,
        &user.id,
    );

    let reloaded = provider
        .provide(context, &typ, &id)
        .await
        .map_err(ApiError::from)?;
    let mut connection = state.pool.acquire().await?;
    let mut json =
        crate::annotation::lists::full_json(&mut connection, &user, reloaded.id(), jobs).await?;
    // publicWrites(updated, user, Some(restrictions)): the restrictions were
    // resolved for the pre-transfer annotation, not recomputed for the new owner.
    json["restrictions"] = restrictions.public_json();
    Ok(Json(json))
}
