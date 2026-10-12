//! Typed annotation metadata routes of AnnotationController: `edit`,
//! `editLockedState` and the shared-teams pair. Every route resolves the
//! annotation through the [`AnnotationProvider`] first (so compound types run
//! or hit the compound merge exactly like Scala, even when the route then
//! rejects them) and writes to the database only for saved annotations.
use axum::{
    Extension, Json as ResponseJson, Router,
    extract::{RawQuery, State},
    http::StatusCode,
    routing::{get, patch},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::{
    AppState, annotation_access, annotation_lists,
    annotation_provider::{
        AccessContext, AnnotationIdentifier, AnnotationProvider, AnnotationType, ProviderError,
        RESTRICTIONS_NOT_FOUND,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    id::ObjectId,
};

/// Msg.notAllowed.
pub const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
/// Msg.Annotation.Edit.notAllowed.
pub const EDIT_NOT_ALLOWED: &str = "You do not have permission to edit this annotation.";
/// Msg.Annotation.Edit.failed.
pub const EDIT_FAILED: &str = "Could not update the annotation.";
/// Msg.Annotation.Edit.success.
pub const EDIT_SUCCESS: &str = "Successfully updated the annotation.";
/// Msg.Annotation.Edit.accessingTeamFailed.
pub const ACCESSING_TEAM_FAILED: &str =
    "Could not access a team during annotation shared team update.";
/// SecuredSQLDAO.assertUpdateAccess (unwrapped by updateTeamsForSharedAnnotation).
pub const NO_UPDATE_ACCESS: &str = "No update access.";
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

/// Msg.ObjectId.invalid(literal).
pub fn invalid_object_id(literal: &str) -> String {
    format!("The supplied resource id “{literal}” is not a valid ObjectId.")
}

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
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
        .layer(Extension(JobsEnabled(jobs_enabled)))
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
    Extension(provider): Extension<AnnotationProvider>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
    Json(body): Json<EditParameters>,
) -> ApiResult<ResponseJson<Value>> {
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
    let annotation_id = saved.id.as_str();

    let mut transaction = state.pool.begin().await?;
    // Re-check the runtime gate on the locked live row (no TOCTOU between the
    // provider read and the writes); a concurrently deleted row is not found.
    let locked = annotation_access::lock_readable(&mut transaction, &user, annotation_id)
        .await?
        .ok_or_else(|| ProviderError::NotFound.into_api_error(StatusCode::NOT_FOUND))?;
    if !annotation_access::restrictions(&locked, Some(&user)).allow_update {
        return Err(ApiError::forbidden(EDIT_NOT_ALLOWED));
    }
    let clears_teams = body.visibility == Some(Visibility::Private);
    let dao_fields =
        clears_teams || body.name.is_some() || body.visibility.is_some() || body.tags.is_some();
    // AnnotationDAO update access only gates the DAO-protected fields; a
    // view-configuration-only (or empty) edit succeeds for collaborators.
    if dao_fields
        && !annotation_access::lock_update_access(&mut transaction, &user, annotation_id).await?
    {
        return Err(ApiError::bad_request(if clears_teams {
            NO_UPDATE_ACCESS
        } else {
            EDIT_FAILED
        }));
    }
    if clears_teams {
        sqlx::query("DELETE FROM webknossos.annotation_sharedTeams WHERE _annotation=$1")
            .bind(annotation_id)
            .execute(&mut *transaction)
            .await?;
    }
    if let Some(name) = &body.name {
        sqlx::query("UPDATE webknossos.annotations SET name=$1 WHERE _id=$2")
            .bind(name)
            .bind(annotation_id)
            .execute(&mut *transaction)
            .await?;
    }
    if let Some(visibility) = body.visibility {
        sqlx::query("UPDATE webknossos.annotations SET visibility=$1::webknossos.ANNOTATION_VISIBILITY WHERE _id=$2")
            .bind(visibility.as_str())
            .bind(annotation_id)
            .execute(&mut *transaction)
            .await?;
    }
    if let Some(tags) = &body.tags {
        sqlx::query("UPDATE webknossos.annotations SET tags=$1 WHERE _id=$2")
            .bind(tags)
            .bind(annotation_id)
            .execute(&mut *transaction)
            .await?;
    }
    if let Some(view_configuration) = body.view_configuration {
        sqlx::query(
            "INSERT INTO webknossos.user_annotationViewConfigurations(_annotation,_user,viewConfiguration) VALUES($1,$2,$3)
             ON CONFLICT (_user,_annotation) DO UPDATE SET viewConfiguration=EXCLUDED.viewConfiguration",
        )
        .bind(annotation_id)
        .bind(&user.id)
        .bind(sqlx::types::Json(Value::Object(view_configuration)))
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(ResponseJson(
        json!({"messages":[{"success": EDIT_SUCCESS}]}),
    ))
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
        .map_err(|_| ApiError::bad_request("Invalid query parameters."))?;
    let value = pairs
        .into_iter()
        .find(|(key, _)| key == KEY)
        .map(|(_, value)| value)
        .ok_or_else(|| ApiError::bad_request(format!("Missing parameter: {KEY}")))?;
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

/// PATCH /annotations/:typ/:id/editLockedState?isLockedByOwner=
/// (AnnotationController.editLockedState).
async fn edit_locked_state(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
    RawQuery(query): RawQuery,
) -> ApiResult<ResponseJson<Value>> {
    let is_locked = is_locked_by_owner(query.as_deref())?;
    let id = path_id(&id)?;
    let context = AccessContext::requester(Some(&user));
    let provided = provider.provide(context, &typ, &id).await?;
    if provided.owner_id() != user.id {
        return Err(ApiError::bad_request(LOCK_NOT_ALLOWED));
    }
    // The ACTUAL type: a `View` path may resolve an Explorational row, a
    // compound never qualifies.
    let saved = provided
        .saved()
        .filter(|_| provided.annotation_type() == Some(AnnotationType::Explorational))
        .ok_or_else(|| ApiError::bad_request(LOCK_EXPLORATIONALS_ONLY))?;
    let mut transaction = state.pool.begin().await?;
    if !annotation_access::lock_update_access(&mut transaction, &user, &saved.id).await? {
        return Err(ApiError::bad_request(LOCK_FAILED));
    }
    // No modified timestamp change, like AnnotationDAO.updateLockedState.
    sqlx::query("UPDATE webknossos.annotations SET isLockedByOwner=$1 WHERE _id=$2")
        .bind(is_locked)
        .bind(&saved.id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    tracing::info!(locked = is_locked, "Updated annotation locked state");

    let updated = provider
        .provide(context, &typ, &id)
        .await
        .map_err(|error| error.into_api_error(StatusCode::NOT_FOUND))?;
    let mut connection = state.pool.acquire().await?;
    let mut value = annotation_lists::full_json(&mut connection, &user, updated.id(), jobs_enabled)
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

/// TeamDAO read access (member, or admin of the team's organization),
/// scoped to live teams of the requester's organization like the rest of
/// the crate; TeamService.publicWrites also needs the live organization.
const READABLE_TEAM: &str = "team._organization=$2 AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles role WHERE role._team=team._id AND role._user=$1))
    AND EXISTS(SELECT 1 FROM webknossos.organizations_ organization WHERE organization._id=team._organization)";

/// GET /annotations/:typ/:id/sharedTeams (AnnotationController.getSharedTeams).
async fn shared_teams(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
) -> ApiResult<ResponseJson<Vec<Value>>> {
    let id = path_id(&id)?;
    let provided = provider
        .provide(AccessContext::requester(Some(&user)), &typ, &id)
        .await?;
    if provided.owner_id() != user.id {
        return Err(ApiError::forbidden(NOT_ALLOWED));
    }
    let teams: Vec<Value> = sqlx::query_scalar(&format!(
        "SELECT jsonb_build_object('id',team._id,'name',team.name,'organization',team._organization,'isOrganizationTeam',team.isOrganizationTeam)
         FROM webknossos.teams_ team
         WHERE team._id IN (SELECT shared._team FROM webknossos.annotation_sharedTeams shared WHERE shared._annotation=$4)
         AND {READABLE_TEAM} ORDER BY team._id"
    ))
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(provided.id())
    .fetch_all(&state.pool)
    .await?;
    Ok(ResponseJson(teams))
}

/// PATCH /annotations/:typ/:id/sharedTeams with a bare JSON array of team IDs
/// (AnnotationController.updateSharedTeams).
async fn update_shared_teams(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
    Json(body): Json<Vec<String>>,
) -> ApiResult<ResponseJson<Vec<String>>> {
    let id = path_id(&id)?;
    let provided = provider
        .provide(AccessContext::requester(Some(&user)), &typ, &id)
        .await?;
    if provided.owner_id() != user.id || provided.visibility() == "Private" {
        return Err(ApiError::forbidden(NOT_ALLOWED));
    }
    // ObjectId.fromString: exactly 24 hex characters, no path prefixes.
    let team_ids = body
        .iter()
        .map(|literal| {
            ObjectId::parse(literal)
                .map(String::from)
                .map_err(|_| ApiError::bad_request(invalid_object_id(literal)))
        })
        .collect::<ApiResult<Vec<String>>>()?;

    let mut transaction = state.pool.begin().await?;
    // teamDAO.findOne for every team before any mutation; FOR SHARE keeps the
    // validated teams live (soft deletion is an UPDATE) until commit.
    let mut unique: Vec<&String> = team_ids.iter().collect();
    unique.sort();
    unique.dedup();
    let readable: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM (SELECT team._id FROM webknossos.teams team
         WHERE NOT team.isDeleted AND team._id=ANY($4) AND {READABLE_TEAM} ORDER BY team._id FOR SHARE OF team) locked"
    ))
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&unique)
    .fetch_one(&mut *transaction)
    .await?;
    if usize::try_from(readable).ok() != Some(unique.len()) {
        return Err(ApiError::bad_request(ACCESSING_TEAM_FAILED));
    }
    // AnnotationDAO.updateTeamsForSharedAnnotation: update access on the live
    // persisted row. Compounds have none and fail here, like Scala.
    if !annotation_access::lock_update_access(&mut transaction, &user, provided.id()).await? {
        return Err(ApiError::bad_request(NO_UPDATE_ACCESS));
    }
    sqlx::query("DELETE FROM webknossos.annotation_sharedTeams WHERE _annotation=$1")
        .bind(provided.id())
        .execute(&mut *transaction)
        .await?;
    // Duplicates are not deduplicated: the primary key rejects them and the
    // whole replacement rolls back.
    sqlx::query(
        "INSERT INTO webknossos.annotation_sharedTeams(_annotation,_team) SELECT $1,team FROM unnest($2::text[]) team",
    )
    .bind(provided.id())
    .bind(&team_ids)
    .execute(&mut *transaction)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => {
            ApiError::bad_request(SHARED_TEAMS_UPDATE_FAILED)
        }
        _ => error.into(),
    })?;
    transaction.commit().await?;
    Ok(ResponseJson(team_ids))
}
