//! Typed annotation metadata routes of AnnotationController: `edit`,
//! `editLockedState` and the shared-teams pair. Every route resolves the
//! annotation through the [`AnnotationProvider`] first (so compound types run
//! or hit the compound merge exactly like Scala, even when the route then
//! rejects them) and writes to the database only for saved annotations.
use crate::response::Messages;
use axum::{
    Json as ResponseJson, Router,
    extract::{RawQuery, State},
    http::StatusCode,
    routing::{get, patch},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    annotation::annotation_dao,
    annotation::provider::{
        AccessContext, AnnotationIdentifier, AnnotationProvider, AnnotationType, ProviderError,
        RESTRICTIONS_NOT_FOUND,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    state::JobsEnabled,
    users::notification_emails::{NotificationEmailService, SharedResource},
    util::id::ObjectId,
};

/// Msg.Annotation.Edit.notAllowed.
pub const EDIT_NOT_ALLOWED: &str = "You do not have permission to edit this annotation.";
/// Msg.Annotation.Edit.failed.
pub const EDIT_FAILED: &str = "Could not update the annotation.";
/// Msg.Annotation.Edit.success.
pub const EDIT_SUCCESS: &str = "Successfully updated the annotation.";
/// Msg.Annotation.Edit.accessingTeamFailed.
pub const ACCESSING_TEAM_FAILED: &str =
    "Could not access a team during annotation shared team update.";
/// Rust stand-in for Scala's `SQL Failure: <driver message>` when the
/// shared-teams transaction fails (e.g. duplicate team IDs hit the primary key).
pub const SHARED_TEAMS_UPDATE_FAILED: &str = "Could not update the shared teams of the annotation.";
/// Msg.Annotation.Lock.notAllowed.
pub const LOCK_NOT_ALLOWED: &str =
    "Only the owner of this annotation has permission to change the locked state of an annotation.";
/// Msg.Annotation.Lock.explorationalsOnly.
pub const LOCK_EXPLORATIONALS_ONLY: &str = "Only explorational annotations can be locked.";
/// Msg.Annotation.Lock.failed.
pub const LOCK_FAILED: &str = "Could not change the isLockedByOwner state of the annotation.";
/// Msg.Annotation.Lock.success.
pub const LOCK_SUCCESS: &str = "The locking state of the annotation was successfully updated.";
/// Msg.Annotation.publicWritesFailed.
pub const PUBLIC_WRITES_FAILED: &str = "Could not convert annotation to json.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/annotations/{typ}/{id}/edit", patch(edit))
        .route(
            "/annotations/{typ}/{id}/editLockedState",
            patch(edit_locked_state),
        )
        .route(
            "/annotations/{typ}/{id}/sharedTeams",
            get(shared_teams).patch(update_shared_teams),
        )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
enum Visibility {
    Private,
    Internal,
    Public,
}

impl Visibility {
    fn as_str(self) -> &'static str {
        match self {
            Self::Private => "Private",
            Self::Internal => "Internal",
            Self::Public => "Public",
        }
    }
}

/// EditAnnotationParameters: absent or null fields are no-ops, unknown
/// fields (e.g. description) are ignored.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditParameters {
    name: Option<String>,
    visibility: Option<Visibility>,
    tags: Option<Vec<String>>,
    view_configuration: Option<Map<String, Value>>,
}

fn path_id(id: &str) -> ApiResult<ObjectId> {
    ObjectId::parse_path(id)
}

/// PATCH /annotations/:typ/:id/edit (AnnotationController.editAnnotation).
async fn edit(
    State(state): State<AppState>,
    State(provider): State<AnnotationProvider>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
    Json(body): Json<EditParameters>,
) -> ApiResult<ResponseJson<Messages>> {
    let id = path_id(&id)?;
    let context = AccessContext::requester(Some(&user));
    let provided = provider
        .provide(context, &typ, &id)
        .await
        .map_err(|error| error.into_api_error(StatusCode::NOT_FOUND))?;
    let identifier = AnnotationIdentifier::parse(&typ, &id)
        .map_err(|error| error.into_api_error(StatusCode::NOT_FOUND))?;
    let restrictions = provider
        .restrictions_for(context, &identifier)
        .await
        .map_err(restrictions_error)?;
    // Compound restrictions never allow updates, so only saved rows remain.
    let Some(saved) = provided.saved().filter(|_| restrictions.allow_update) else {
        return Err(ApiError::forbidden(EDIT_NOT_ALLOWED));
    };
    let annotation_id = &saved.id;

    let mut transaction = state.pool.begin().await?;
    // Re-check the runtime gate on the locked live row (no TOCTOU between the
    // provider read and the writes); a concurrently deleted row is not found.
    let locked =
        crate::annotation::annotation_dao::lock_readable(&mut transaction, &user, annotation_id)
            .await?
            .ok_or_else(|| ProviderError::NotFound.into_api_error(StatusCode::NOT_FOUND))?;
    if !crate::annotation::access::restrictions(&locked, Some(&user)).allow_update {
        return Err(ApiError::forbidden(EDIT_NOT_ALLOWED));
    }
    let clears_teams = body.visibility == Some(Visibility::Private);
    let dao_fields =
        clears_teams || body.name.is_some() || body.visibility.is_some() || body.tags.is_some();
    // AnnotationDAO update access only gates the DAO-protected fields; a
    // view-configuration-only (or empty) edit succeeds for collaborators.
    if dao_fields
        && !crate::annotation::annotation_dao::lock_update_access(
            &mut transaction,
            &user,
            annotation_id,
        )
        .await?
    {
        return Err(ApiError::bad_request(if clears_teams {
            crate::msg::annotation::NO_UPDATE_ACCESS
        } else {
            EDIT_FAILED
        }));
    }
    if clears_teams {
        annotation_dao::delete_shared_teams(&mut transaction, annotation_id).await?;
    }
    if let Some(name) = &body.name {
        annotation_dao::update_name(&mut transaction, annotation_id, name).await?;
    }
    if let Some(visibility) = body.visibility {
        annotation_dao::update_visibility(&mut transaction, annotation_id, visibility.as_str())
            .await?;
    }
    if let Some(tags) = &body.tags {
        annotation_dao::update_tags(&mut transaction, annotation_id, tags).await?;
    }
    if let Some(view_configuration) = body.view_configuration {
        annotation_dao::upsert_view_configuration(
            &mut transaction,
            annotation_id,
            &user.id,
            Value::Object(view_configuration),
        )
        .await?;
    }
    transaction.commit().await?;
    Ok(Messages::success(EDIT_SUCCESS))
}

/// `restrictionsFor(..) ?~> Msg.Annotation.Restrictions.notFound ~> NOT_FOUND`.
fn restrictions_error(error: ProviderError) -> ApiError {
    error
        .wrap(RESTRICTIONS_NOT_FOUND)
        .into_api_error(StatusCode::NOT_FOUND)
}

/// Play's QueryStringBindable for the required `isLockedByOwner: Boolean`.
fn is_locked_by_owner(query: Option<&str>) -> ApiResult<bool> {
    const KEY: &str = "isLockedByOwner";
    let pairs: Vec<(String, String)> = serde_urlencoded::from_str(query.unwrap_or(""))
        .map_err(|_| ApiError::bad_request(crate::msg::request::INVALID_QUERY))?;
    let value = pairs
        .into_iter()
        .find(|(key, _)| key == KEY)
        .map(|(_, value)| value)
        .ok_or_else(|| ApiError::bad_request(crate::msg::request::missing_parameter(KEY)))?;
    match value.trim() {
        "true" => Ok(true),
        "false" => Ok(false),
        other => other
            .parse::<i32>()
            .map(|number| number != 0)
            .map_err(|_| ApiError::bad_request(crate::msg::request::invalid_boolean(KEY))),
    }
}

/// PATCH /annotations/:typ/:id/editLockedState?isLockedByOwner=
/// (AnnotationController.editLockedState).
async fn edit_locked_state(
    State(state): State<AppState>,
    State(provider): State<AnnotationProvider>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
    RawQuery(query): RawQuery,
) -> ApiResult<ResponseJson<Value>> {
    let is_locked = is_locked_by_owner(query.as_deref())?;
    let id = path_id(&id)?;
    let context = AccessContext::requester(Some(&user));
    let provided = provider.provide(context, &typ, &id).await?;
    if *provided.owner_id() != user.id {
        return Err(ApiError::bad_request(LOCK_NOT_ALLOWED));
    }
    // The ACTUAL type: a `View` path may resolve an Explorational row, a
    // compound never qualifies.
    let saved = provided
        .saved()
        .filter(|_| provided.annotation_type() == Some(AnnotationType::Explorational))
        .ok_or_else(|| ApiError::bad_request(LOCK_EXPLORATIONALS_ONLY))?;
    let mut transaction = state.pool.begin().await?;
    if !crate::annotation::annotation_dao::lock_update_access(&mut transaction, &user, &saved.id)
        .await?
    {
        return Err(ApiError::bad_request(LOCK_FAILED));
    }
    annotation_dao::update_locked_state(&mut transaction, &saved.id, is_locked).await?;
    transaction.commit().await?;
    tracing::info!(locked = is_locked, "Updated annotation locked state");

    let updated = provider
        .provide(context, &typ, &id)
        .await
        .map_err(|error| error.into_api_error(StatusCode::NOT_FOUND))?;
    let mut connection = state.pool.acquire().await?;
    let mut value =
        crate::annotation::lists::full_json(&mut connection, &user, updated.id(), jobs_enabled)
            .await
            .map_err(public_writes_error)?;
    let Some(object) = value.as_object_mut() else {
        return Err(ApiError::bad_request(PUBLIC_WRITES_FAILED));
    };
    object.insert("messages".into(), json!([{"success": LOCK_SUCCESS}]));
    Ok(ResponseJson(value))
}

/// `publicWrites ?~> Msg.Annotation.publicWritesFailed`: failures become 400
/// with the Scala message; infrastructure errors keep their status.
fn public_writes_error(error: ApiError) -> ApiError {
    if error.status.is_server_error() {
        error
    } else {
        ApiError::bad_request(PUBLIC_WRITES_FAILED)
    }
}

/// GET /annotations/:typ/:id/sharedTeams (AnnotationController.getSharedTeams).
async fn shared_teams(
    State(state): State<AppState>,
    State(provider): State<AnnotationProvider>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
) -> ApiResult<ResponseJson<Vec<Value>>> {
    let id = path_id(&id)?;
    let provided = provider
        .provide(AccessContext::requester(Some(&user)), &typ, &id)
        .await?;
    if *provided.owner_id() != user.id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let teams = annotation_dao::find_shared_teams_json(&state.pool, &user, provided.id()).await?;
    Ok(ResponseJson(teams))
}

/// PATCH /annotations/:typ/:id/sharedTeams with a bare JSON array of team IDs
/// (AnnotationController.updateSharedTeams).
async fn update_shared_teams(
    State(state): State<AppState>,
    State(provider): State<AnnotationProvider>,
    State(notification_emails): State<NotificationEmailService>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
    Json(body): Json<Vec<String>>,
) -> ApiResult<ResponseJson<Vec<ObjectId>>> {
    let id = path_id(&id)?;
    let provided = provider
        .provide(AccessContext::requester(Some(&user)), &typ, &id)
        .await?;
    if *provided.owner_id() != user.id || provided.visibility() == "Private" {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    // ObjectId.fromString: exactly 24 hex characters, no path prefixes.
    let team_ids = body
        .iter()
        .map(|literal| {
            ObjectId::parse(literal)
                .map_err(|_| ApiError::bad_request(crate::msg::object_id::invalid(literal)))
        })
        .collect::<ApiResult<Vec<ObjectId>>>()?;

    let mut transaction = state.pool.begin().await?;
    // teamDAO.findOne for every team before any mutation.
    let mut unique: Vec<&ObjectId> = team_ids.iter().collect();
    unique.sort();
    unique.dedup();
    let readable =
        annotation_dao::count_readable_teams_for_share(&mut transaction, &user, &unique).await?;
    if usize::try_from(readable).ok() != Some(unique.len()) {
        return Err(ApiError::bad_request(ACCESSING_TEAM_FAILED));
    }
    // AnnotationDAO.updateTeamsForSharedAnnotation: update access on the live
    // persisted row. Compounds have none and fail here, like Scala.
    if !crate::annotation::annotation_dao::lock_update_access(
        &mut transaction,
        &user,
        provided.id(),
    )
    .await?
    {
        return Err(ApiError::bad_request(
            crate::msg::annotation::NO_UPDATE_ACCESS,
        ));
    }
    let old_team_ids =
        annotation_dao::find_shared_team_ids(&mut transaction, &user, provided.id()).await?;
    let pending_emails = notification_emails
        .prepare_share_emails(
            &mut transaction,
            SharedResource::Annotation {
                id: provided.id().clone(),
            },
            &old_team_ids,
            &team_ids,
            &[&user.id, provided.owner_id()],
        )
        .await;
    annotation_dao::delete_shared_teams(&mut transaction, provided.id()).await?;
    // Duplicates are not deduplicated: the primary key rejects them and the
    // whole replacement rolls back.
    annotation_dao::insert_shared_teams(&mut transaction, provided.id(), &team_ids)
        .await
        .map_err(|error| match &error {
            sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => {
                ApiError::bad_request(SHARED_TEAMS_UPDATE_FAILED)
            }
            _ => error.into(),
        })?;
    transaction.commit().await?;
    notification_emails.send_share_emails(&state.pool, pending_emails, &user.id);
    Ok(ResponseJson(team_ids))
}
