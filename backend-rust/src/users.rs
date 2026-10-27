pub(crate) mod dao;
pub mod notification_emails;

use crate::auth::browser::onboarding::assert_users_can_be_added;
use crate::auth::browser::onboarding::dao::delete_team_memberships_for_user;
use std::collections::{BTreeMap, HashMap, HashSet};

use axum::{
    Extension, Json, Router,
    extract::State,
    routing::{get, put},
};
use serde::Deserialize;
use serde_json::{Map, Value};
use sqlx::{Postgres, Transaction};

use crate::AppState;
use crate::auth::AuthUser;
use crate::auth::browser::{BrowserAuthConfig, verify_password};
use crate::error::{ApiError, ApiResult};
use crate::extract::{Json as RequestJson, Path, Query};
use crate::mail::{MailSender, templates};
use crate::util::id::{ObjectId, PathObjectId};
pub(crate) use dao::push_read_access;
use dao::{OldMembership, Target};
use notification_emails::{NotificationEmailService, TeamMembership, UserAccess};

pub fn router(email_verification_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/user", get(current))
        .route("/users", get(list))
        .route("/users/{id}", get(read).patch(update))
        .route("/users/{id}/taskTypeId", put(update_task_type))
        .route(
            "/users/{id}/novelUserExperienceInfos",
            put(update_experience),
        )
        .route("/users/{id}/selectedTheme", put(update_theme))
        .layer(Extension(EmailVerification(email_verification_enabled)))
}

#[derive(Clone)]
struct EmailVerification(bool);

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Filters {
    is_editable: Option<bool>,
    is_team_manager_or_admin: Option<bool>,
    is_admin: Option<bool>,
}

async fn document(
    state: &AppState,
    requester: &AuthUser,
    id: &ObjectId,
    verification: &EmailVerification,
) -> ApiResult<Value> {
    let mut value: Value = dao::find_one_document(&state.pool, requester, id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::user::not_found(id)))?;
    if !verification.0 {
        value["isEmailVerified"] = Value::Bool(true);
    }
    Ok(value)
}

async fn current(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(verification): Extension<EmailVerification>,
) -> ApiResult<Json<Value>> {
    let result = document(&state, &user, &user.id, &verification).await?;
    dao::update_last_activity(&state.pool, &user.id).await?;
    Ok(Json(result))
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(filters): Query<Filters>,
) -> ApiResult<Json<Vec<Value>>> {
    Ok(Json(
        dao::find_all_documents(
            &state.pool,
            &user,
            filters.is_editable,
            filters.is_team_manager_or_admin,
            filters.is_admin,
        )
        .await?,
    ))
}

async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(verification): Extension<EmailVerification>,
) -> ApiResult<Json<Value>> {
    let result = document(&state, &user, &id, &verification).await?;
    if result["isEditable"] != true {
        return Err(ApiError::forbidden(crate::msg::user::NOT_EDITABLE));
    }
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LastTaskType {
    last_task_type_id: Option<ObjectId>,
}

async fn update_task_type(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(verification): Extension<EmailVerification>,
    RequestJson(body): RequestJson<LastTaskType>,
) -> ApiResult<Json<Value>> {
    let original = document(&state, &user, &id, &verification).await?;
    if original["isEditable"] != true && user.id != *id {
        return Err(ApiError::forbidden(crate::msg::user::NOT_EDITABLE));
    }
    let rows_affected =
        dao::update_last_task_type_if_editable(&state.pool, &id, &body.last_task_type_id, &user)
            .await?;
    if rows_affected != 1 {
        return Err(ApiError::forbidden(crate::msg::user::NO_LONGER_EDITABLE));
    }
    Ok(Json(document(&state, &user, &id, &verification).await?))
}

async fn update_experience(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(verification): Extension<EmailVerification>,
    RequestJson(body): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Value>> {
    if user.id != *id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    dao::update_novel_user_experience_infos(&state.pool, &user.id, Value::Object(body)).await?;
    Ok(Json(document(&state, &user, &id, &verification).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Theme {
    Light,
    Dark,
    Auto,
}

impl Theme {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
            Self::Auto => "auto",
        }
    }
}

async fn update_theme(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(verification): Extension<EmailVerification>,
    RequestJson(theme): RequestJson<Theme>,
) -> ApiResult<Json<Value>> {
    if user.id != *id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    dao::update_selected_theme(&state.pool, &user.id, theme.as_str()).await?;
    Ok(Json(document(&state, &user, &id, &verification).await?))
}

// ---------------------------------------------------------------------------
// PATCH /users/:id (UserController.update)

/// Message texts from util/.../Msg.scala and UserController.
pub(crate) mod msg {
    pub const NO_SELF_DEACTIVATE: &str =
        "You cannot deactivate yourself. Please contact an admin to do it for you.";
    pub const LAST_ADMIN: &str = "This user is the last remaining admin in your organization. Cannot remove admin privileges from this account.";
    pub const LAST_OWNER: &str = "Cannot deactivate the organization owner. Please talk to the WEBKNOSSOS team to transfer organization ownership.";
    pub const NAME_ONLY_OWN: &str =
        "On this webknossos instance, users may only change their own names.";
    pub const NAME_ONLY_ADMINS: &str = "Only admins can change the names of other users.";

    pub fn team_admin_not_possible_by(team_name: &str, user_name: &str) -> String {
        format!(
            "User “{user_name}” cannot be assigned administrative rights in team “{team_name}” because they are not in the same organization."
        )
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserUpdate {
    first_name: Option<String>,
    last_name: Option<String>,
    email: Option<String>,
    password: Option<String>,
    is_active: Option<bool>,
    is_admin: Option<bool>,
    is_dataset_manager: Option<bool>,
    teams: Option<Vec<Membership>>,
    experiences: Option<BTreeMap<String, i32>>,
    last_task_type_id: Option<ObjectId>,
}

/// TeamMembership reads: `id` and `isTeamManager`; other fields are ignored.
#[derive(Clone, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
struct Membership {
    id: ObjectId,
    is_team_manager: bool,
}

#[allow(clippy::too_many_arguments)]
async fn update(
    State(state): State<AppState>,
    requester: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(verification): Extension<EmailVerification>,
    State(mailer): State<MailSender>,
    Extension(notification_emails): Extension<NotificationEmailService>,
    State(auth_config): State<BrowserAuthConfig>,
    RequestJson(body): RequestJson<UserUpdate>,
) -> ApiResult<Json<Value>> {
    let id: &ObjectId = &id;
    let not_found = || ApiError::not_found(crate::msg::user::not_found(id));
    let mut tx = state.pool.begin().await?;
    let organization = dao::find_organization_id_if_readable(&mut tx, id, &requester)
        .await?
        .ok_or_else(not_found)?;
    // Admin/owner counts and the user limit are organization-wide invariants.
    // Lock the organization first, like onboarding does before adding users.
    dao::lock_organization(&mut tx, &organization).await?;
    let target = dao::find_one_target_for_update(&mut tx, id)
        .await?
        .ok_or_else(not_found)?;
    let old_memberships = dao::find_all_memberships_for_user(&mut tx, &requester, id).await?;
    let old_experiences = dao::find_all_experiences_for_user(&mut tx, id).await?;

    let is_self = requester.id == *id;
    let admin_of_target = requester.is_admin && requester.organization_id == target.organization;
    // UserService.isEditableBy: team manager of a shared team, organization
    // admin, or the user has no team memberships.
    let shares_managed_team = dao::shares_managed_team(&mut tx, id, &requester.id).await?;
    let team_manager_or_admin_of_target = shares_managed_team || admin_of_target;
    let is_editable = team_manager_or_admin_of_target || old_memberships.is_empty();

    let first_name = body.first_name.unwrap_or_else(|| target.first_name.clone());
    let last_name = body.last_name.unwrap_or_else(|| target.last_name.clone());
    let email = body.email.unwrap_or_else(|| target.email.clone());
    let is_active = body.is_active.unwrap_or(!target.is_deactivated);
    let is_admin = body.is_admin.unwrap_or(target.is_admin);
    let is_dataset_manager = body.is_dataset_manager.unwrap_or(target.is_dataset_manager);
    let requested_teams = body.teams;
    let experiences = body.experiences.unwrap_or_else(|| old_experiences.clone());
    let last_task_type_id = body
        .last_task_type_id
        .or_else(|| target.last_task_type_id.clone());

    if !is_self && !is_editable {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    // checkTeamManagerOnlyUpdates: team lists are compared as sets. Changes need
    // a team manager (of a shared team) or admin of the user; users without
    // teams may be edited by any team manager or admin of their organization,
    // e.g. to add them to a team. This also applies to the user's own changes.
    let teams_changed = requested_teams.as_ref().is_some_and(|teams| {
        let requested: HashSet<(&ObjectId, bool)> =
            teams.iter().map(|m| (&m.id, m.is_team_manager)).collect();
        let old: HashSet<(&ObjectId, bool)> = old_memberships
            .iter()
            .map(|m| (&m.team, m.is_team_manager))
            .collect();
        requested != old
    });
    if experiences != old_experiences || teams_changed {
        let team_manager_or_admin_of_org = requester.organization_id == target.organization
            && (requester.is_admin
                || dao::is_team_manager_in_organization(
                    &mut tx,
                    &requester.id,
                    &requester.organization_id,
                )
                .await?);
        if !(team_manager_or_admin_of_target
            || (old_memberships.is_empty() && team_manager_or_admin_of_org))
        {
            return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
        }
    }
    // checkAdminOnlyUpdates
    if !(is_active
        && is_admin == target.is_admin
        && is_dataset_manager == target.is_dataset_manager)
        && !admin_of_target
    {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    // checkPasswordIfEmailChanged, checkEmailDoesNotExistIfChanged
    if email != target.email {
        if !is_self {
            return Err(ApiError::bad_request(crate::msg::NOT_ALLOWED));
        }
        let Some(password) = body.password else {
            return Err(ApiError::bad_request(crate::msg::user::INVALID_CREDENTIALS));
        };
        let (hasher, hash) = dao::find_password_info(&mut tx, &target.multi_user).await?;
        if !verify_password(password, &hasher, hash).await {
            return Err(ApiError::bad_request(crate::msg::user::INVALID_CREDENTIALS));
        }
        let taken = dao::multi_user_email_exists(&mut tx, &email).await?;
        if taken {
            return Err(ApiError::bad_request(crate::msg::user::email::TAKEN));
        }
    }
    if is_self && !is_active && !target.is_deactivated {
        return Err(ApiError::forbidden(msg::NO_SELF_DEACTIVATE));
    }
    if !is_active && !target.is_deactivated {
        let tasks = dao::find_active_task_ids_for_user(&mut tx, id).await?;
        if !tasks.is_empty() {
            return Err(ApiError::bad_request(format!(
                "Cannot deactivate user with active tasks. Task ids are: {}",
                tasks.join(";")
            )));
        }
    }
    if target.is_deactivated && is_active {
        assert_users_can_be_added(&mut tx, &target.organization).await?;
    }
    if target.is_admin && !is_admin {
        let admins = dao::count_admins(&mut tx, &target.organization).await?;
        if admins <= 1 {
            return Err(ApiError::bad_request(msg::LAST_ADMIN));
        }
    }
    if target.is_organization_owner && !target.is_deactivated && !is_active {
        let owners = dao::count_owners(&mut tx, &target.organization).await?;
        if owners <= 1 {
            return Err(ApiError::bad_request(msg::LAST_OWNER));
        }
    }
    // checkNameUpdatePermissions
    let (first_name, last_name) = (first_name.trim(), last_name.trim());
    let name_changed = first_name != target.first_name || last_name != target.last_name;
    if name_changed && !is_self {
        if auth_config.is_wkorg_instance {
            return Err(ApiError::bad_request(msg::NAME_ONLY_OWN));
        }
        if !admin_of_target {
            return Err(ApiError::bad_request(msg::NAME_ONLY_ADMINS));
        }
    }

    let updated_teams = match &requested_teams {
        Some(requested) => {
            membership_updates(&mut tx, &requester, &target, requested, &old_memberships).await?
        }
        None => old_memberships
            .iter()
            .map(|m| (m.team.clone(), m.is_team_manager))
            .collect(),
    };

    if email != target.email {
        dao::update_email(&mut tx, &target.multi_user, &email).await?;
        tracing::info!(multi_user = %target.multi_user, "Email of multi user changed");
    }
    dao::update_user_flags(
        &mut tx,
        id,
        is_admin,
        is_dataset_manager,
        !is_active,
        &last_task_type_id,
    )
    .await?;
    if name_changed {
        dao::update_names(&mut tx, &target.multi_user, first_name, last_name).await?;
    }
    delete_team_memberships_for_user(&mut tx, id).await?;
    for (team, is_team_manager) in &updated_teams {
        dao::insert_team_membership_if_team_exists(&mut tx, id, team, is_team_manager).await?;
    }
    // Play's experience update re-checks update access after the membership
    // change, so a team manager cannot remove the user from their last shared team.
    let still_accessible = dao::is_readable(&mut tx, id, &requester).await?;
    if !still_accessible {
        return Err(ApiError::bad_request(
            crate::msg::annotation::NO_UPDATE_ACCESS,
        ));
    }
    dao::delete_experiences_for_user(&mut tx, id).await?;
    let trimmed: BTreeMap<&str, i32> = experiences
        .iter()
        .map(|(domain, value)| (domain.trim(), *value))
        .collect();
    for (domain, value) in &trimmed {
        dao::insert_experience(&mut tx, id, domain, value).await?;
        dao::insert_experience_domain(&mut tx, domain, &target.organization).await?;
    }
    tx.commit().await?;

    if target.is_deactivated && is_active {
        // DefaultMails.activatedMail, addressed with the previous full name.
        mailer.send(templates::activated(
            &format!("{} {}", target.first_name, target.last_name),
            &email,
            &auth_config.public_uri,
        ));
    }
    notification_emails.send_access_changed_email(
        &state.pool,
        id,
        UserAccess {
            is_admin: target.is_admin,
            is_dataset_manager: target.is_dataset_manager,
            is_deactivated: target.is_deactivated,
        },
        old_memberships
            .iter()
            .map(|m| TeamMembership::new(m.team.clone(), m.is_team_manager))
            .collect(),
        UserAccess {
            is_admin,
            is_dataset_manager,
            is_deactivated: !is_active,
        },
        updated_teams
            .into_iter()
            .map(|(team, is_team_manager)| TeamMembership::new(team, is_team_manager))
            .collect(),
        &requester.id,
    );
    Ok(Json(document(&state, &requester, id, &verification).await?))
}

/// Requested memberships of teams the requester manages, plus existing ones
/// of teams the requester cannot manage (which are kept unchanged).
async fn membership_updates(
    tx: &mut Transaction<'_, Postgres>,
    requester: &AuthUser,
    target: &Target,
    requested: &[Membership],
    old: &[OldMembership],
) -> ApiResult<Vec<(ObjectId, bool)>> {
    let mut teams: HashMap<&ObjectId, (String, String, bool)> = HashMap::new();
    for membership in requested {
        let team = dao::find_one_team_for_share(tx, requester, &membership.id)
            .await?
            .ok_or_else(|| ApiError::not_found(crate::msg::team::not_found(&membership.id)))?;
        teams.insert(&membership.id, team);
    }
    if old.iter().any(|m| !m.team_exists) {
        return Err(ApiError::bad_request(crate::msg::team::ADMIN_NOT_ALLOWED));
    }
    let mut updated = Vec::new();
    for membership in requested {
        let (name, organization, manageable) = &teams[&membership.id];
        if !manageable {
            continue;
        }
        if membership.is_team_manager && *organization != target.organization {
            return Err(ApiError::forbidden(msg::team_admin_not_possible_by(
                name,
                &format!("{} {}", target.first_name, target.last_name),
            )));
        }
        updated.push((membership.id.clone(), membership.is_team_manager));
    }
    updated.extend(
        old.iter()
            .filter(|m| !m.manageable)
            .map(|m| (m.team.clone(), m.is_team_manager)),
    );
    Ok(updated)
}
