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
use crate::browser_auth::{BrowserAuthConfig, verify_password};
use crate::error::{ApiError, ApiResult};
use crate::extract::{Json as RequestJson, Path, Query};
use crate::id::{ObjectId, PathObjectId};
use crate::mail::{MailSender, templates};

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

// One statement assembles the public response without exposing account hashes,
// internal configuration, or tokens. Lateral aggregates avoid join fanout.
const USER_DOCUMENTS: &str = r#"
SELECT jsonb_build_object(
  'id', usr._id, 'email', multi.email, 'firstName', multi.firstName, 'lastName', multi.lastName,
  'isAdmin', usr.isAdmin, 'isOrganizationOwner', usr.isOrganizationOwner,
  'isDatasetManager', usr.isDatasetManager, 'isActive', NOT usr.isDeactivated,
  'teams', team_data.teams, 'experiences', experience_data.experiences,
  'lastActivity', FLOOR(EXTRACT(EPOCH FROM usr.lastActivity) * 1000)::BIGINT,
  'isAnonymous', FALSE, 'isEditable', permissions.manage OR jsonb_array_length(team_data.teams) = 0,
  'organization', usr._organization, 'novelUserExperienceInfos', multi.novelUserExperienceInfos,
  'selectedTheme', multi.selectedTheme, 'created', FLOOR(EXTRACT(EPOCH FROM usr.created) * 1000)::BIGINT,
  'lastTaskTypeId', usr.lastTaskTypeId, 'isSuperUser', multi.isSuperUser,
  'isEmailVerified', multi.isEmailVerified, 'isUnlisted', usr.isUnlisted,
  'isGuest', paying._organization IS NOT NULL AND paying._organization != usr._organization
)
FROM webknossos.users_ AS usr
JOIN webknossos.multiUsers_ AS multi ON multi._id = usr._multiUser
JOIN webknossos.organizations_ AS org ON org._id = usr._organization
CROSS JOIN LATERAL (
  SELECT ($3 AND usr._organization = $2) OR EXISTS (
    SELECT 1 FROM webknossos.user_team_roles AS target_role
    JOIN webknossos.teams_ AS team ON team._id = target_role._team AND team._organization = $2
    JOIN webknossos.user_team_roles AS requester_role ON requester_role._team = team._id
    WHERE target_role._user = usr._id AND requester_role._user = $1 AND requester_role.isTeamManager
  ) AS manage
) AS permissions
CROSS JOIN LATERAL (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', team._id, 'name', team.name,
    'isTeamManager', role.isTeamManager) ORDER BY team.name), '[]'::jsonb) AS teams,
    COALESCE(bool_or(role.isTeamManager), FALSE) AS is_manager
  FROM webknossos.user_team_roles AS role JOIN webknossos.teams_ AS team ON team._id = role._team AND team._organization = usr._organization
  WHERE role._user = usr._id
) AS team_data
CROSS JOIN LATERAL (
  SELECT COALESCE(jsonb_object_agg(domain, value), '{}'::jsonb) AS experiences
  FROM webknossos.user_experiences WHERE _user = usr._id
) AS experience_data
LEFT JOIN LATERAL (
  SELECT identity._organization FROM webknossos.users_ AS identity
  JOIN webknossos.organizations_ AS organization ON organization._id = identity._organization
  WHERE identity._multiUser = usr._multiUser AND NOT identity.isDeactivated
    AND organization.pricingPlan IN ('Team', 'Power', 'Custom', 'Team_Trial', 'Power_Trial')
  ORDER BY identity.created ASC LIMIT 1
) AS paying ON TRUE
WHERE usr._organization = $2 AND (permissions.manage OR usr._id = $1)
  AND ($5::TEXT IS NULL OR usr._id = $5)
  AND (NOT $9 OR NOT usr.isUnlisted OR $4)
  AND ($6::BOOLEAN IS NULL OR permissions.manage = $6)
  AND ($7::BOOLEAN IS NULL OR (usr.isAdmin OR team_data.is_manager) = $7)
  AND ($8::BOOLEAN IS NULL OR usr.isAdmin = $8)
ORDER BY LOWER(multi.lastName), usr._id
"#;

async fn documents(
    state: &AppState,
    requester: &AuthUser,
    id: Option<&str>,
    filters: &Filters,
    listing: bool,
) -> ApiResult<Vec<Value>> {
    Ok(sqlx::query_scalar(USER_DOCUMENTS)
        .bind(&requester.id)
        .bind(&requester.organization_id)
        .bind(requester.is_admin)
        .bind(requester.is_superuser)
        .bind(id)
        .bind(filters.is_editable)
        .bind(filters.is_team_manager_or_admin)
        .bind(filters.is_admin)
        .bind(listing)
        .fetch_all(&state.pool)
        .await?)
}

async fn document(
    state: &AppState,
    requester: &AuthUser,
    id: &str,
    verification: &EmailVerification,
) -> ApiResult<Value> {
    let mut value = documents(state, requester, Some(id), &Filters::default(), false)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::not_found("User not found."))?;
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
    sqlx::query("UPDATE webknossos.users SET lastActivity = GREATEST(lastActivity, statement_timestamp()) WHERE _id = $1 AND NOT isDeleted")
        .bind(&user.id).execute(&state.pool).await?;
    Ok(Json(result))
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(filters): Query<Filters>,
) -> ApiResult<Json<Vec<Value>>> {
    Ok(Json(documents(&state, &user, None, &filters, true).await?))
}

async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(verification): Extension<EmailVerification>,
) -> ApiResult<Json<Value>> {
    let result = document(&state, &user, id.as_str(), &verification).await?;
    if result["isEditable"] != true {
        return Err(ApiError::forbidden(
            "User is not editable by the requesting user.",
        ));
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
    let original = document(&state, &user, id.as_str(), &verification).await?;
    if original["isEditable"] != true && user.id != id.as_str() {
        return Err(ApiError::forbidden(
            "User is not editable by the requesting user.",
        ));
    }
    let result = sqlx::query(r#"
        UPDATE webknossos.users AS target SET lastTaskTypeId = $2
        WHERE target._id = $1 AND NOT target.isDeleted AND target._organization = $4
          AND (target._id = $3 OR $5 OR NOT EXISTS (
            SELECT 1 FROM webknossos.user_team_roles AS role
            JOIN webknossos.teams_ AS team ON team._id = role._team AND team._organization = $4
            WHERE role._user = target._id
          ) OR EXISTS (
            SELECT 1 FROM webknossos.user_team_roles AS target_role
            JOIN webknossos.teams_ AS team ON team._id = target_role._team AND team._organization = $4
            JOIN webknossos.user_team_roles AS requester_role ON requester_role._team = team._id
            WHERE target_role._user = target._id AND requester_role._user = $3 AND requester_role.isTeamManager
          ))
        "#)
        .bind(id.as_str()).bind(body.last_task_type_id.as_ref().map(ObjectId::as_str))
        .bind(&user.id).bind(&user.organization_id).bind(user.is_admin).execute(&state.pool).await?;
    if result.rows_affected() != 1 {
        return Err(ApiError::forbidden(
            "User is no longer editable by the requesting user.",
        ));
    }
    Ok(Json(
        document(&state, &user, id.as_str(), &verification).await?,
    ))
}

async fn update_experience(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(verification): Extension<EmailVerification>,
    RequestJson(body): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Value>> {
    if user.id != id.as_str() {
        return Err(ApiError::forbidden(
            "Users can only update their own experience information.",
        ));
    }
    sqlx::query("UPDATE webknossos.multiUsers AS multi SET novelUserExperienceInfos = $2 FROM webknossos.users_ AS usr WHERE usr._id = $1 AND usr._multiUser = multi._id AND NOT multi.isDeleted")
        .bind(&user.id).bind(Value::Object(body)).execute(&state.pool).await?;
    Ok(Json(
        document(&state, &user, id.as_str(), &verification).await?,
    ))
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
    if user.id != id.as_str() {
        return Err(ApiError::forbidden(
            "Users can only update their own theme.",
        ));
    }
    sqlx::query("UPDATE webknossos.multiUsers AS multi SET selectedTheme = $2::webknossos.THEME FROM webknossos.users_ AS usr WHERE usr._id = $1 AND usr._multiUser = multi._id AND NOT multi.isDeleted")
        .bind(&user.id).bind(theme.as_str()).execute(&state.pool).await?;
    Ok(Json(
        document(&state, &user, id.as_str(), &verification).await?,
    ))
}

// ---------------------------------------------------------------------------
// PATCH /users/:id (UserController.update)

/// Message texts from util/.../Msg.scala and UserController.
pub(crate) mod msg {
    pub const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
    pub const NO_SELF_DEACTIVATE: &str =
        "You cannot deactivate yourself. Please contact an admin to do it for you.";
    pub const INVALID_CREDENTIALS: &str = "Incorrect email or password. Please try again.";
    pub const EMAIL_TAKEN: &str = "An account with this email address already exists. Please log in instead or use a different email.";
    pub const LAST_ADMIN: &str = "This user is the last remaining admin in your organization. Cannot remove admin privileges from this account.";
    pub const LAST_OWNER: &str = "Cannot deactivate the organization owner. Please talk to the WEBKNOSSOS team to transfer organization ownership.";
    pub const USER_LIMIT_REACHED: &str = "Cannot add new user to this organization because it would exceed the organization’s user limit. Please ask the organization owner to upgrade.";
    pub const TEAM_ADMIN_NOT_ALLOWED: &str =
        "You do not have permission to administrate this team.";
    pub const NAME_ONLY_OWN: &str =
        "On this webknossos instance, users may only change their own names.";
    pub const NAME_ONLY_ADMINS: &str = "Only admins can change the names of other users.";
    pub const NO_UPDATE_ACCESS: &str = "No update access.";

    pub fn user_not_found(id: &str) -> String {
        format!("User “{id}” could not be found or accessed.")
    }
    pub fn team_not_found(id: &str) -> String {
        format!("Team “{id}” could not be found or accessed.")
    }
    pub fn team_admin_not_possible_by(team_name: &str, user_name: &str) -> String {
        format!(
            "User “{user_name}” cannot be assigned administrative rights in team “{team_name}” because they are not in the same organization."
        )
    }
}

/// UserDAO.readAccessQ (also its update access) for a `users_` row aliased
/// `usr`; bind $1 to the requesting user id.
pub(crate) const READ_ACCESS_PREDICATE: &str = r#"(
  usr._id IN (SELECT _user FROM webknossos.user_team_roles WHERE _team IN (
    SELECT _team FROM webknossos.user_team_roles WHERE _user = $1 AND isTeamManager))
  OR usr._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $1 AND isAdmin)
  OR usr._id = $1
)"#;

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

#[derive(sqlx::FromRow)]
struct Target {
    organization: String,
    multi_user: String,
    is_admin: bool,
    is_dataset_manager: bool,
    is_deactivated: bool,
    is_organization_owner: bool,
    last_task_type_id: Option<String>,
    email: String,
    first_name: String,
    last_name: String,
}

#[derive(sqlx::FromRow)]
struct OldMembership {
    team: String,
    is_team_manager: bool,
    team_exists: bool,
    manageable: bool,
}

/// Whether the requester manages the team: team manager of it, or admin of its
/// organization (UserService.isTeamManagerOrAdminOf(user, team)).
const TEAM_MANAGEABLE: &str = "(EXISTS (SELECT 1 FROM webknossos.user_team_roles AS r WHERE r._team = team._id AND r._user = $2 AND r.isTeamManager) OR ($3 AND team._organization = $4))";

async fn update(
    State(state): State<AppState>,
    requester: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(verification): Extension<EmailVerification>,
    Extension(mailer): Extension<MailSender>,
    Extension(auth_config): Extension<BrowserAuthConfig>,
    RequestJson(body): RequestJson<UserUpdate>,
) -> ApiResult<Json<Value>> {
    let id = id.as_str();
    let not_found = || ApiError::not_found(msg::user_not_found(id));
    let mut tx = state.pool.begin().await?;
    let organization: String = sqlx::query_scalar(&format!(
        "SELECT usr._organization FROM webknossos.users_ AS usr WHERE usr._id = $2 AND {READ_ACCESS_PREDICATE}"
    ))
    .bind(&requester.id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    // Admin/owner counts and the user limit are organization-wide invariants.
    // Lock the organization first, like onboarding does before adding users.
    sqlx::query("SELECT _id FROM webknossos.organizations WHERE _id = $1 FOR UPDATE")
        .bind(&organization)
        .execute(&mut *tx)
        .await?;
    let target: Target = sqlx::query_as(
        r#"SELECT u._organization AS organization, u._multiUser AS multi_user,
             u.isAdmin AS is_admin, u.isDatasetManager AS is_dataset_manager,
             u.isDeactivated AS is_deactivated, u.isOrganizationOwner AS is_organization_owner,
             u.lastTaskTypeId AS last_task_type_id, m.email, m.firstName AS first_name,
             m.lastName AS last_name
           FROM webknossos.users AS u JOIN webknossos.multiUsers AS m ON m._id = u._multiUser
           WHERE u._id = $1 AND NOT u.isDeleted AND NOT m.isDeleted
           FOR UPDATE OF u, m"#,
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    let old_memberships: Vec<OldMembership> = sqlx::query_as(&format!(
        r#"SELECT role._team AS team, role.isTeamManager AS is_team_manager,
             team._id IS NOT NULL AS team_exists, COALESCE({TEAM_MANAGEABLE}, FALSE) AS manageable
           FROM webknossos.user_team_roles AS role
           LEFT JOIN webknossos.teams_ AS team ON team._id = role._team
           WHERE role._user = $1 ORDER BY role._team"#
    ))
    .bind(id)
    .bind(&requester.id)
    .bind(requester.is_admin)
    .bind(&requester.organization_id)
    .fetch_all(&mut *tx)
    .await?;
    let old_experiences: BTreeMap<String, i32> = sqlx::query_as::<_, (String, i32)>(
        "SELECT domain, value FROM webknossos.user_experiences WHERE _user = $1",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();

    let is_self = requester.id == id;
    let admin_of_target = requester.is_admin && requester.organization_id == target.organization;
    // UserService.isEditableBy: team manager of a shared team, organization
    // admin, or the user has no team memberships.
    let shares_managed_team: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (SELECT 1 FROM webknossos.user_team_roles AS target_role
             JOIN webknossos.user_team_roles AS requester_role ON requester_role._team = target_role._team
             WHERE target_role._user = $1 AND requester_role._user = $2 AND requester_role.isTeamManager)"#,
    )
    .bind(id)
    .bind(&requester.id)
    .fetch_one(&mut *tx)
    .await?;
    let is_editable = shares_managed_team || admin_of_target || old_memberships.is_empty();

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
        .map(|id| id.as_str().to_owned())
        .or_else(|| target.last_task_type_id.clone());

    if !is_self && !is_editable {
        return Err(ApiError::forbidden(msg::NOT_ALLOWED));
    }
    // checkTeamManagerOnlyUpdates. Play discards this check's Boolean result
    // (only a failed Fox would abort), so it never rejects there. Enforced here
    // as intended; team lists are compared as sets because Play's comparison
    // depended on unordered database results.
    let teams_changed = requested_teams.as_ref().is_some_and(|teams| {
        let requested: HashSet<(&str, bool)> = teams
            .iter()
            .map(|m| (m.id.as_str(), m.is_team_manager))
            .collect();
        let old: HashSet<(&str, bool)> = old_memberships
            .iter()
            .map(|m| (m.team.as_str(), m.is_team_manager))
            .collect();
        requested != old
    });
    if (experiences != old_experiences || teams_changed) && !is_editable {
        return Err(ApiError::forbidden(msg::NOT_ALLOWED));
    }
    // checkAdminOnlyUpdates
    if !(is_active
        && is_admin == target.is_admin
        && is_dataset_manager == target.is_dataset_manager)
        && !admin_of_target
    {
        return Err(ApiError::forbidden(msg::NOT_ALLOWED));
    }
    // checkPasswordIfEmailChanged, checkEmailDoesNotExistIfChanged
    if email != target.email {
        if !is_self {
            return Err(ApiError::bad_request(msg::NOT_ALLOWED));
        }
        let Some(password) = body.password else {
            return Err(ApiError::bad_request(msg::INVALID_CREDENTIALS));
        };
        let (hasher, hash): (String, String) = sqlx::query_as(
            "SELECT passwordInfo_hasher::text, passwordInfo_password FROM webknossos.multiUsers WHERE _id = $1",
        )
        .bind(&target.multi_user)
        .fetch_one(&mut *tx)
        .await?;
        if !verify_password(password, &hasher, hash).await {
            return Err(ApiError::bad_request(msg::INVALID_CREDENTIALS));
        }
        let taken: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM webknossos.multiUsers_ WHERE email = $1)",
        )
        .bind(&email)
        .fetch_one(&mut *tx)
        .await?;
        if taken {
            return Err(ApiError::bad_request(msg::EMAIL_TAKEN));
        }
    }
    if is_self && !is_active && !target.is_deactivated {
        return Err(ApiError::forbidden(msg::NO_SELF_DEACTIVATE));
    }
    if !is_active && !target.is_deactivated {
        let tasks: Vec<String> = sqlx::query_scalar(
            "SELECT _task FROM webknossos.annotations_ WHERE _user = $1 AND typ = 'Task' AND state = 'Active' AND _task IS NOT NULL ORDER BY created, _id",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
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
        let admins: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM webknossos.users_ WHERE _organization = $1 AND isAdmin AND NOT isUnlisted",
        )
        .bind(&target.organization)
        .fetch_one(&mut *tx)
        .await?;
        if admins <= 1 {
            return Err(ApiError::bad_request(msg::LAST_ADMIN));
        }
    }
    if target.is_organization_owner && !target.is_deactivated && !is_active {
        let owners: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM webknossos.users_ WHERE _organization = $1 AND isOrganizationOwner AND NOT isUnlisted",
        )
        .bind(&target.organization)
        .fetch_one(&mut *tx)
        .await?;
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
        sqlx::query("UPDATE webknossos.multiUsers SET email = $2, isEmailVerified = FALSE, emailChangeDate = NOW() WHERE _id = $1")
            .bind(&target.multi_user).bind(&email).execute(&mut *tx).await?;
        tracing::info!(multi_user = %target.multi_user, "Email of multi user changed");
    }
    sqlx::query("UPDATE webknossos.users SET isAdmin = $2, isDatasetManager = $3, isDeactivated = $4, lastTaskTypeId = $5 WHERE _id = $1")
        .bind(id).bind(is_admin).bind(is_dataset_manager).bind(!is_active).bind(&last_task_type_id)
        .execute(&mut *tx).await?;
    if name_changed {
        sqlx::query(
            "UPDATE webknossos.multiUsers SET firstName = $2, lastName = $3 WHERE _id = $1",
        )
        .bind(&target.multi_user)
        .bind(first_name)
        .bind(last_name)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("DELETE FROM webknossos.user_team_roles WHERE _user = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for (team, is_team_manager) in &updated_teams {
        // Re-select from teams_ so deleted teams are never (re)assigned.
        sqlx::query("INSERT INTO webknossos.user_team_roles (_user, _team, isTeamManager) SELECT $1, t._id, $3 FROM webknossos.teams_ AS t WHERE t._id = $2")
            .bind(id).bind(team).bind(is_team_manager).execute(&mut *tx).await?;
    }
    // Play's experience update re-checks update access after the membership
    // change, so a team manager cannot remove the user from their last shared team.
    let still_accessible: bool = sqlx::query_scalar(&format!(
        "SELECT EXISTS (SELECT 1 FROM webknossos.users_ AS usr WHERE usr._id = $2 AND {READ_ACCESS_PREDICATE})"
    ))
    .bind(&requester.id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if !still_accessible {
        return Err(ApiError::bad_request(msg::NO_UPDATE_ACCESS));
    }
    sqlx::query("DELETE FROM webknossos.user_experiences WHERE _user = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let trimmed: BTreeMap<&str, i32> = experiences
        .iter()
        .map(|(domain, value)| (domain.trim(), *value))
        .collect();
    for (domain, value) in &trimmed {
        sqlx::query(
            "INSERT INTO webknossos.user_experiences (_user, domain, value) VALUES ($1, $2, $3)",
        )
        .bind(id)
        .bind(domain)
        .bind(value)
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO webknossos.experienceDomains (domain, _organization) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(domain).bind(&target.organization).execute(&mut *tx).await?;
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
) -> ApiResult<Vec<(String, bool)>> {
    let mut teams: HashMap<&str, (String, String, bool)> = HashMap::new();
    for membership in requested {
        let team: (String, String, bool) = sqlx::query_as(&format!(
            "SELECT team.name, team._organization, {TEAM_MANAGEABLE} FROM webknossos.teams_ AS team WHERE team._id = $1 FOR SHARE OF team"
        ))
        .bind(membership.id.as_str())
        .bind(&requester.id)
        .bind(requester.is_admin)
        .bind(&requester.organization_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| ApiError::not_found(msg::team_not_found(membership.id.as_str())))?;
        teams.insert(membership.id.as_str(), team);
    }
    if old.iter().any(|m| !m.team_exists) {
        return Err(ApiError::bad_request(msg::TEAM_ADMIN_NOT_ALLOWED));
    }
    let mut updated = Vec::new();
    for membership in requested {
        let (name, organization, manageable) = &teams[membership.id.as_str()];
        if !manageable {
            continue;
        }
        if membership.is_team_manager && *organization != target.organization {
            return Err(ApiError::forbidden(msg::team_admin_not_possible_by(
                name,
                &format!("{} {}", target.first_name, target.last_name),
            )));
        }
        updated.push((
            membership.id.as_str().to_owned(),
            membership.is_team_manager,
        ));
    }
    updated.extend(
        old.iter()
            .filter(|m| !m.manageable)
            .map(|m| (m.team.clone(), m.is_team_manager)),
    );
    Ok(updated)
}

/// OrganizationService.assertUsersCanBeAdded (the organization row is locked).
async fn assert_users_can_be_added(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: &str,
) -> ApiResult<()> {
    let included: Option<i32> =
        sqlx::query_scalar("SELECT includedUsers FROM webknossos.organizations_ WHERE _id = $1")
            .bind(organization_id)
            .fetch_optional(&mut **tx)
            .await?
            .flatten();
    let Some(included) = included else {
        return Ok(());
    };
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM webknossos.users_ AS u
           LEFT JOIN (
             SELECT DISTINCT ON (_multiUser) _multiUser, _organization FROM webknossos.users
             WHERE NOT isDeactivated AND _organization IN (
               SELECT _id FROM webknossos.organizations
               WHERE pricingPlan IN ('Team', 'Power', 'Custom', 'Team_Trial', 'Power_Trial'))
             ORDER BY _multiUser, created ASC
           ) AS paying ON paying._multiUser = u._multiUser
           WHERE u._organization = $1 AND NOT u.isDeactivated AND NOT u.isUnlisted
             AND (paying._organization IS NULL OR paying._organization = $1)"#,
    )
    .bind(organization_id)
    .fetch_one(&mut **tx)
    .await?;
    if count + 1 > i64::from(included) {
        return Err(ApiError::bad_request(msg::USER_LIMIT_REACHED));
    }
    Ok(())
}
