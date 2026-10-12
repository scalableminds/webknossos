//! Account and organization onboarding from AuthenticationController and
//! OrganizationController.addUser: registration, organization creation,
//! superuser account administration, invitations and joining.
//!
//! Every multi-record mutation runs in one transaction (Play performs these
//! steps non-transactionally). Mails and analytics events are sent only
//! after commit. Mailchimp side effects are not ported; suspicious
//! registration names are reported to Slack.
use axum::{
    Extension, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::{Postgres, Transaction};

use crate::{
    AppState,
    analytics::{properties, track, track_for_user},
    application_info::MiscState,
    auth::{AuthUser, OptionalAuthUser},
    browser_auth::{
        BrowserAuthConfig, Form, FormBody, create_email_verification, hash_password, messages,
        random_base64url, random_hex,
    },
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    id::ObjectId,
    mail::{Mail, MailSender, templates},
    service_clients::ServiceClients,
    slack::SlackNotificationService,
};

pub(crate) mod organization_messages {
    pub const USER_LIMIT_REACHED: &str = "Cannot add new user to this organization because it would exceed the organization’s user limit. Please ask the organization owner to upgrade.";
    pub const ALREADY_JOINED: &str =
        "Your account is already associated with the selected organization.";
    pub const AMBIGUOUS: &str =
        "Registration without invite is not allowed for instances with multiple organizations.";
    pub const NOT_FOUND_BY_INVITE: &str =
        "Organization specified in the invite could not be found.";
    pub const ID_TAKEN: &str = "This id is already in use by a different organization and not available anymore. Please choose a different id.";
    pub const ID_INVALID: &str =
        "This organization id contains illegal characters. Please only use letters and numbers.";
    pub const CREATE_FORBIDDEN: &str = "You do not have permission to create a new organization.";
    pub const CREATE_FAILED: &str = "Could not create a new organization.";
    pub const NEEDS_INVITE: &str =
        "Registration without invite is not enabled for this WEBKNOSSOS instance.";
    pub const INVALID_INVITE_TOKEN: &str = "This invite token is invalid.";
    pub const TOS_NOT_ACCEPTED: &str = "Terms of service must be accepted.";
    pub fn not_found(id: &str) -> String {
        format!("Organization “{id}” could not be found or accessed.")
    }
    pub fn tos_version_mismatch(required: i32, version: i32) -> String {
        format!(
            "Terms of service version mismatch. Current version is {required}, received acceptance for {version}."
        )
    }
}
use organization_messages as org_msg;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route(
            "/auth/createOrganizationWithAdmin",
            post(create_organization_with_admin),
        )
        .route(
            "/auth/createOrganizationWithExistingUser",
            post(create_organization_with_existing_user),
        )
        .route(
            "/auth/createUserInOrganization/{organization_id}",
            post(create_user_in_organization),
        )
        .route(
            "/auth/joinOrganization/{invite_token}",
            post(join_organization),
        )
        .route("/auth/sendInvites", post(send_invites))
        .route("/organizations/{organization_id}/addUser", post(add_user))
}

// ---------------------------------------------------------------------------
// Shared helpers

fn ok_empty() -> Response {
    StatusCode::OK.into_response()
}

fn ok_text(text: String) -> Response {
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; charset=utf-8"),
        )],
        text,
    )
        .into_response()
}

fn messages_response(errors: &[String]) -> Response {
    let messages: Vec<_> = errors.iter().map(|error| json!({"error": error})).collect();
    (
        StatusCode::BAD_REQUEST,
        axum::Json(json!({ "messages": messages })),
    )
        .into_response()
}

/// TextUtils.normalizeStrong: transliterate, then keep `[A-Za-z0-9_\-\s]`.
pub(crate) fn normalize_strong(value: &str) -> Option<String> {
    let mut normalized = String::new();
    for c in value.chars() {
        let replacement = match c {
            'ü' => "ue",
            'Ü' => "Ue",
            'ö' => "oe",
            'Ö' => "Oe",
            'ä' => "ae",
            'Ä' => "Ae",
            'ß' => "ss",
            'é' | 'è' | 'ê' | 'ë' => "e",
            'È' | 'É' | 'Ê' | 'Ë' => "E",
            'Ç' => "C",
            'ç' => "c",
            'ñ' => "n",
            'Ñ' => "N",
            'ï' | 'í' | 'ì' => "i",
            'Ï' => "I",
            'å' => "a",
            'Å' => "A",
            'œ' | 'ø' => "oe",
            'Œ' | 'Ø' => "Oe",
            'æ' => "ae",
            'Æ' => "Ae",
            'þ' => "th",
            'Þ' => "Th",
            _ => {
                // Java's \s: space, \t, \n, \x0B, \f, \r.
                if c.is_ascii_alphanumeric()
                    || matches!(c, '_' | '-' | ' ' | '\t' | '\n' | '\x0B' | '\x0C' | '\r')
                {
                    normalized.push(c);
                }
                continue;
            }
        };
        normalized.push_str(replacement);
    }
    (!normalized.is_empty()).then_some(normalized)
}

/// validateNameAndEmail: Ok(normalized names, lowercased email) or the
/// error messages in Play's (prepended) order.
async fn validate_name_and_email(
    tx: &mut Transaction<'_, Postgres>,
    first_name: &str,
    last_name: &str,
    email: &str,
) -> ApiResult<Result<(String, String, String), Vec<String>>> {
    let mut errors = Vec::new();
    let first = normalize_strong(first_name);
    if first.is_none() {
        errors.insert(0, messages::INVALID_FIRST_NAME.to_owned());
    }
    let last = normalize_strong(last_name);
    if last.is_none() {
        errors.insert(0, messages::INVALID_LAST_NAME.to_owned());
    }
    let email = email.to_lowercase();
    // Deleted accounts still own their address (UNIQUE across all rows).
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.multiUsers WHERE email = $1)")
            .bind(&email)
            .fetch_one(&mut **tx)
            .await?;
    if taken {
        errors.insert(0, messages::EMAIL_TAKEN.to_owned());
    }
    Ok(match (first, last) {
        (Some(first), Some(last)) if errors.is_empty() => Ok((first, last, email)),
        _ => Err(errors),
    })
}

fn notify_on_suspicious_names(
    slack: &SlackNotificationService,
    organization_id: &str,
    first_name: &str,
    last_name: &str,
) {
    let case_switches = |name: &str| {
        let chars: Vec<char> = name.chars().collect();
        chars
            .windows(2)
            .filter(|pair| {
                (pair[0].is_lowercase() && pair[1].is_uppercase())
                    || (pair[0].is_uppercase() && pair[1].is_lowercase())
            })
            .count()
    };
    if case_switches(first_name) >= 4 || case_switches(last_name) >= 4 {
        tracing::warn!(
            organization = %organization_id,
            "Name with >=4 case switches detected during registration"
        );
        slack.warn(
            "Registration with suspicious name",
            &format!(
                "Name with >=4 case switches detected during registration: {first_name} {last_name} (organizationId {organization_id})"
            ),
        );
    }
}

#[derive(sqlx::FromRow)]
pub(crate) struct OrganizationRow {
    pub id: String,
    pub name: String,
    pub enable_auto_verify: bool,
    pub new_user_mailing_list: String,
}

pub(crate) const ORGANIZATION_COLUMNS: &str = "_id AS id, name, enableAutoVerify AS enable_auto_verify, newUserMailingList AS new_user_mailing_list";

async fn find_organization(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
) -> ApiResult<Option<OrganizationRow>> {
    Ok(sqlx::query_as(&format!(
        "SELECT {ORGANIZATION_COLUMNS} FROM webknossos.organizations_ WHERE _id = $1"
    ))
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?)
}

/// organizationService.assertUsersCanBeAdded. Locks the organization row so
/// concurrent additions cannot exceed the limit.
async fn assert_users_can_be_added(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: &str,
) -> ApiResult<()> {
    let included: Option<Option<i32>> = sqlx::query_scalar(
        "SELECT includedUsers FROM webknossos.organizations_ WHERE _id = $1 FOR UPDATE",
    )
    .bind(organization_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(Some(included)) = included else {
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
        return Err(ApiError::bad_request(org_msg::USER_LIMIT_REACHED));
    }
    Ok(())
}

/// userService.initialTeamMemberships
pub(crate) async fn initial_team_memberships(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: &str,
    invite_id: Option<&str>,
) -> ApiResult<Vec<(String, bool)>> {
    if let Some(invite_id) = invite_id {
        return Ok(sqlx::query_as(
            "SELECT _team, isTeamManager FROM webknossos.invite_team_roles WHERE _invite = $1 ORDER BY _team",
        )
        .bind(invite_id)
        .fetch_all(&mut **tx)
        .await?);
    }
    let team: String = sqlx::query_scalar(
        "SELECT _id FROM webknossos.organizationTeams WHERE _organization = $1 LIMIT 1",
    )
    .bind(organization_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| ApiError::bad_request("Could not find the organization team."))?;
    Ok(vec![(team, false)])
}

async fn insert_team_memberships(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &str,
    memberships: &[(String, bool)],
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.user_team_roles WHERE _user = $1")
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    for (team, is_manager) in memberships {
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles(_user, _team, isTeamManager) VALUES($1, $2, $3)",
        )
        .bind(user_id)
        .bind(team)
        .bind(is_manager)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

pub(crate) struct NewAccount<'a> {
    pub organization_id: &'a str,
    pub email: &'a str,
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub is_active: bool,
    /// `None` stores PasswordInfo("Empty", "") (SSO-only account).
    pub password: Option<String>,
    pub is_admin: bool,
    pub is_dataset_manager: bool,
    pub is_organization_owner: bool,
    pub is_email_verified: bool,
    pub team_memberships: Vec<(String, bool)>,
}

pub(crate) struct CreatedAccount {
    pub user_id: String,
    pub mails: Vec<Mail>,
}

/// userService.insert
pub(crate) async fn insert_account(
    tx: &mut Transaction<'_, Postgres>,
    config: &BrowserAuthConfig,
    account: NewAccount<'_>,
) -> ApiResult<CreatedAccount> {
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.multiUsers WHERE email = $1)")
            .bind(account.email)
            .fetch_one(&mut **tx)
            .await?;
    if taken {
        return Err(ApiError::bad_request(messages::EMAIL_TAKEN));
    }
    let (hasher, hash) = match account.password {
        Some(password) => ("SCrypt", hash_password(password).await?),
        None => ("Empty", String::new()),
    };
    let multi_user_id = ObjectId::new();
    sqlx::query(
        r#"INSERT INTO webknossos.multiUsers(_id, email, passwordInfo_hasher, passwordInfo_password,
             firstName, lastName, isSuperUser, isEmailVerified)
           VALUES($1, $2, $3::webknossos.USER_PASSWORDINFO_HASHERS, $4, $5, $6, FALSE, $7)"#,
    )
    .bind(multi_user_id.as_str())
    .bind(account.email)
    .bind(hasher)
    .bind(&hash)
    .bind(account.first_name)
    .bind(account.last_name)
    .bind(account.is_email_verified)
    .execute(&mut **tx)
    .await?;
    let mut mails = Vec::new();
    if !account.is_email_verified {
        mails.push(create_email_verification(tx, config, multi_user_id.as_str()).await?);
    }
    let user_id = ObjectId::new();
    sqlx::query(
        r#"INSERT INTO webknossos.users(_id, _multiUser, _organization, lastActivity, userConfiguration,
             isDeactivated, isAdmin, isOrganizationOwner, isDatasetManager, isUnlisted, created)
           VALUES($1, $2, $3, statement_timestamp(), '{}'::jsonb, $4, $5, $6, $7, FALSE, statement_timestamp())"#,
    )
    .bind(user_id.as_str())
    .bind(multi_user_id.as_str())
    .bind(account.organization_id)
    .bind(!account.is_active)
    .bind(account.is_admin)
    .bind(account.is_organization_owner)
    .bind(account.is_dataset_manager)
    .execute(&mut **tx)
    .await?;
    insert_team_memberships(tx, user_id.as_str(), &account.team_memberships).await?;
    Ok(CreatedAccount {
        user_id: user_id.into(),
        mails,
    })
}

/// userService.joinOrganization: a new identity copying the original's
/// account-level fields (configuration, logout cutoff).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn join_organization_as(
    tx: &mut Transaction<'_, Postgres>,
    original_user_id: &str,
    organization_id: &str,
    auto_activate: bool,
    is_admin: bool,
    is_dataset_manager: bool,
    is_unlisted: bool,
    is_organization_owner: bool,
    team_memberships: &[(String, bool)],
) -> ApiResult<String> {
    let new_user_id = ObjectId::new();
    let inserted = sqlx::query(
        r#"INSERT INTO webknossos.users(_id, _multiUser, _organization, lastActivity, userConfiguration,
             isDeactivated, isAdmin, isOrganizationOwner, isDatasetManager, isUnlisted,
             loggedOutEverywhereTime, created, lastTaskTypeId, isDeleted)
           SELECT $1, _multiUser, $3, statement_timestamp(), userConfiguration, $4, $5, $6, $7, $8,
             loggedOutEverywhereTime, statement_timestamp(), NULL, FALSE
           FROM webknossos.users_ WHERE _id = $2"#,
    )
    .bind(new_user_id.as_str())
    .bind(original_user_id)
    .bind(organization_id)
    .bind(!auto_activate)
    .bind(is_admin)
    .bind(is_organization_owner)
    .bind(is_dataset_manager)
    .bind(is_unlisted)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(ApiError::bad_request(messages::USER_NOT_FOUND));
    }
    insert_team_memberships(tx, new_user_id.as_str(), team_memberships).await?;
    tracing::info!(
        organization = %organization_id,
        user = %new_user_id,
        "Multiuser joined organization with new user id."
    );
    Ok(new_user_id.into())
}

/// organizationService.newUserMailRecipient: mailing list, else the owner.
async fn new_user_mail_recipient(
    tx: &mut Transaction<'_, Postgres>,
    organization: &OrganizationRow,
) -> ApiResult<Option<String>> {
    if !organization.new_user_mailing_list.is_empty() {
        return Ok(Some(organization.new_user_mailing_list.clone()));
    }
    Ok(sqlx::query_scalar(
        r#"SELECT m.email FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON u._multiUser = m._id
           WHERE u.isOrganizationOwner AND NOT u.isDeactivated AND u._organization = $1 LIMIT 1"#,
    )
    .bind(&organization.id)
    .fetch_optional(&mut **tx)
    .await?)
}

pub(crate) async fn admin_notifier_mail(
    tx: &mut Transaction<'_, Postgres>,
    config: &BrowserAuthConfig,
    organization: &OrganizationRow,
    full_name: &str,
    email: &str,
    auto_activate: bool,
) -> ApiResult<Option<Mail>> {
    let recipient = new_user_mail_recipient(tx, organization).await?;
    if recipient.is_none() {
        // Play fails the (already persisted) registration here; the Rust
        // backend keeps the atomic registration and skips the notification.
        tracing::warn!(organization = %organization.id, "No recipient for new-user notification");
    }
    Ok(recipient.map(|recipient| {
        templates::register_admin_notifier(
            full_name,
            email,
            &config.public_uri,
            &organization.name,
            &organization.id,
            auto_activate,
            &recipient,
        )
    }))
}

#[derive(sqlx::FromRow)]
struct InviteRow {
    id: String,
    organization_id: String,
    auto_activate: bool,
    is_admin: bool,
    is_dataset_manager: bool,
}

/// inviteDAO.findOneByTokenValue, locked for single use. Expired invites are
/// excluded (Play soft-deletes them with a periodic job that is not ported).
async fn find_invite(
    tx: &mut Transaction<'_, Postgres>,
    token: &str,
) -> ApiResult<Option<InviteRow>> {
    Ok(sqlx::query_as(
        r#"SELECT _id AS id, _organization AS organization_id, autoActivate AS auto_activate,
             isAdmin AS is_admin, isDatasetManager AS is_dataset_manager
           FROM webknossos.invites_ WHERE tokenValue = $1 AND expirationDateTime > statement_timestamp()
           ORDER BY created LIMIT 1 FOR UPDATE"#,
    )
    .bind(token)
    .fetch_optional(&mut **tx)
    .await?)
}

async fn deactivate_invite(tx: &mut Transaction<'_, Postgres>, invite_id: &str) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.invites SET isDeleted = TRUE WHERE _id = $1")
        .bind(invite_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// AuthenticationController.createUser
#[allow(clippy::too_many_arguments)]
async fn create_user(
    tx: &mut Transaction<'_, Postgres>,
    config: &BrowserAuthConfig,
    organization: &OrganizationRow,
    email: &str,
    first_name: &str,
    last_name: &str,
    auto_activate: bool,
    password: Option<String>,
    invite: Option<&InviteRow>,
) -> ApiResult<CreatedAccount> {
    let team_memberships =
        initial_team_memberships(tx, &organization.id, invite.map(|i| i.id.as_str())).await?;
    let mut created = insert_account(
        tx,
        config,
        NewAccount {
            organization_id: &organization.id,
            email,
            first_name,
            last_name,
            is_active: auto_activate,
            password,
            is_admin: invite.is_some_and(|i| i.is_admin),
            is_dataset_manager: invite.is_some_and(|i| i.is_dataset_manager),
            is_organization_owner: false,
            is_email_verified: false,
            team_memberships,
        },
    )
    .await
    .map_err(|error| {
        if error.status == StatusCode::BAD_REQUEST {
            error
        } else {
            ApiError::new(error.status, messages::CREATE_FAILED)
        }
    })?;
    if let Some(invite) = invite {
        deactivate_invite(tx, &invite.id).await?;
    }
    let full_name = format!("{first_name} {last_name}");
    if !config.is_wkorg_instance {
        // On wkorg instances Play registers the user with Mailchimp instead.
        created
            .mails
            .push(templates::new_user(&full_name, email, auto_activate));
    }
    if let Some(mail) =
        admin_notifier_mail(tx, config, organization, &full_name, email, auto_activate).await?
    {
        created.mails.push(mail);
    }
    Ok(created)
}

/// organizationService.createOrganization
async fn create_organization(
    tx: &mut Transaction<'_, Postgres>,
    config: &BrowserAuthConfig,
    requested_id: Option<&str>,
    name: &str,
) -> ApiResult<OrganizationRow> {
    let normalized_name =
        normalize_strong(name).ok_or_else(|| ApiError::bad_request(org_msg::ID_INVALID))?;
    let id = requested_id
        .and_then(normalize_strong)
        .unwrap_or(normalized_name)
        .replace(' ', "_");
    // Ids of deleted organizations stay reserved (primary key).
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.organizations WHERE _id = $1)")
            .bind(&id)
            .fetch_one(&mut **tx)
            .await?;
    if exists {
        return Err(ApiError::bad_request(org_msg::ID_TAKEN));
    }
    let (plan, included_users, included_storage): (&str, Option<i32>, Option<i64>) =
        if config.is_wkorg_instance {
            ("Personal", Some(1), Some(50_000_000_000))
        } else {
            ("Custom", None, None)
        };
    let root_folder = ObjectId::new();
    sqlx::query(
        "INSERT INTO webknossos.folders(_id, name, metadata) VALUES($1, 'Datasets', '[]'::jsonb)",
    )
    .bind(root_folder.as_str())
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth) VALUES($1, $1, 0)",
    )
    .bind(root_folder.as_str())
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO webknossos.organizations(_id, additionalInformation, logoUrl, name, _rootFolder,
             newUserMailingList, enableAutoVerify, pricingPlan, aiPlan, paidUntil, includedUsers,
             includedStorage, lastTermsOfServiceAcceptanceTime, lastTermsOfServiceAcceptanceVersion,
             created, isDeleted)
           VALUES($1, '', '', $2, $3, '', FALSE, $4::webknossos.PRICING_PLANS, NULL, NULL, $5, $6,
             NULL, 0, statement_timestamp(), FALSE)"#,
    )
    .bind(&id)
    .bind(name)
    .bind(root_folder.as_str())
    .bind(plan)
    .bind(included_users)
    .bind(included_storage)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO webknossos.teams(_id, _organization, name, created, isOrganizationTeam, isDeleted) VALUES($1, $2, 'Default', statement_timestamp(), TRUE, FALSE)",
    )
    .bind(ObjectId::new().as_str())
    .bind(&id)
    .execute(&mut **tx)
    .await?;
    Ok(OrganizationRow {
        id,
        name: name.to_owned(),
        enable_auto_verify: false,
        new_user_mailing_list: String::new(),
    })
}

/// organizationService.createOrganizationDirectory: notify every datastore.
/// Like Play, individual RPC failures are ignored.
async fn create_organization_directory(
    pool: &sqlx::PgPool,
    clients: Option<&ServiceClients>,
    organization_id: &str,
) {
    let Some(clients) = clients else {
        return;
    };
    let urls: Vec<String> =
        match sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ ORDER BY name")
            .fetch_all(pool)
            .await
        {
            Ok(urls) => urls,
            Err(_) => {
                tracing::warn!("Could not list datastores for organization directory creation");
                return;
            }
        };
    let query = [("organizationId", organization_id.to_owned())];
    let requests = urls.iter().map(|url| {
        clients.request(
            axum::http::Method::POST,
            url,
            &["data", "triggers", "createOrganizationDirectory"],
            &query,
            None,
        )
    });
    for result in futures_util::future::join_all(requests).await {
        if let Err(error) = result {
            tracing::warn!(%error, "Datastore organization directory creation failed");
        }
    }
}

// ---------------------------------------------------------------------------
// Sign-up form

struct SignUp {
    organization: String,
    organization_name: String,
    email: String,
    first_name: String,
    last_name: String,
    password: String,
    invite_token: Option<String>,
    accepted_terms_of_service: Option<i32>,
    honeypot: Option<String>,
}

fn bind_sign_up(data: &std::collections::HashMap<String, String>) -> ApiResult<SignUp> {
    let mut form = Form::new(data);
    let sign_up = SignUp {
        organization: form.text("organization"),
        organization_name: form.text("organizationName"),
        email: form.email("email"),
        password: form.new_password("password"),
        first_name: form.non_empty("firstName"),
        last_name: form.non_empty("lastName"),
        invite_token: form.optional_non_empty("inviteToken"),
        accepted_terms_of_service: form.optional_number("acceptedTermsOfService"),
        honeypot: form.optional_text("referral"),
    };
    form.finish()?;
    Ok(sign_up)
}

async fn register(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    Extension(misc): Extension<MiscState>,
    slack: SlackNotificationService,
    FormBody(data): FormBody,
) -> ApiResult<Response> {
    let sign_up = bind_sign_up(&data)?;
    if sign_up.honeypot.is_some() {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }
    let mut tx = state.pool.begin().await?;
    let (first_name, last_name, email) = match validate_name_and_email(
        &mut tx,
        &sign_up.first_name,
        &sign_up.last_name,
        &sign_up.email,
    )
    .await?
    {
        Ok(values) => values,
        Err(errors) => return Ok(messages_response(&errors)),
    };
    // An unknown or expired invite token behaves like no invite.
    let invite = match &sign_up.invite_token {
        Some(token) => find_invite(&mut tx, token).await?,
        None => None,
    };
    if invite.is_none() && !config.register_to_default_orga_enabled {
        return Err(ApiError::bad_request(org_msg::NEEDS_INVITE));
    }
    let organization = match &invite {
        Some(invite) => find_organization(&mut tx, &invite.organization_id)
            .await?
            .ok_or_else(|| ApiError::bad_request(org_msg::NOT_FOUND_BY_INVITE))?,
        None => {
            let organizations: Vec<OrganizationRow> = sqlx::query_as(&format!(
                "SELECT {ORGANIZATION_COLUMNS} FROM webknossos.organizations_ ORDER BY _id LIMIT 2"
            ))
            .fetch_all(&mut *tx)
            .await?;
            let mut organizations = organizations.into_iter();
            match (organizations.next(), organizations.next()) {
                (Some(organization), None) => organization,
                _ => return Err(ApiError::bad_request(org_msg::AMBIGUOUS)),
            }
        }
    };
    assert_users_can_be_added(&mut tx, &organization.id).await?;
    let auto_activate = invite
        .as_ref()
        .map_or(organization.enable_auto_verify, |invite| {
            invite.auto_activate
        });
    notify_on_suspicious_names(&slack, &organization.id, &first_name, &last_name);
    let created = create_user(
        &mut tx,
        &config,
        &organization,
        &email,
        &first_name,
        &last_name,
        auto_activate,
        Some(sign_up.password),
        invite.as_ref(),
    )
    .await?;
    tx.commit().await?;
    // SignupEvent(user, inviteBox.isDefined)
    track_for_user(
        &state,
        &misc,
        &created.user_id,
        "signup",
        properties("had_invite", invite.is_some()),
    );
    for mail in created.mails {
        mailer.send(mail);
    }
    Ok(ok_empty())
}

#[allow(clippy::too_many_arguments)]
async fn create_organization_with_admin(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    Extension(misc): Extension<MiscState>,
    clients: Option<Extension<ServiceClients>>,
    slack: SlackNotificationService,
    headers: HeaderMap,
    OptionalAuthUser(user): OptionalAuthUser,
    FormBody(data): FormBody,
) -> ApiResult<Response> {
    let sign_up = bind_sign_up(&data)?;
    if sign_up.honeypot.is_some() {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }
    let mut tx = state.pool.begin().await?;
    // assertMayCreateOrganization: no organization yet, a wkorg instance, or
    // a superuser.
    let no_organizations: bool =
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM webknossos.organizations_)")
            .fetch_one(&mut *tx)
            .await?;
    if !(no_organizations
        || config.is_wkorg_instance
        || user.as_ref().is_some_and(|u| u.is_superuser))
    {
        return Err(ApiError::bad_request(org_msg::CREATE_FORBIDDEN));
    }
    let (first_name, last_name, email) = match validate_name_and_email(
        &mut tx,
        &sign_up.first_name,
        &sign_up.last_name,
        &sign_up.email,
    )
    .await?
    {
        Ok(values) => values,
        Err(errors) => return Ok(messages_response(&errors)),
    };
    let requested_id = Some(sign_up.organization.as_str()).filter(|id| !id.trim().is_empty());
    let organization =
        create_organization(&mut tx, &config, requested_id, &sign_up.organization_name)
            .await
            .map_err(|error| {
                if error.status == StatusCode::BAD_REQUEST {
                    ApiError::bad_request(org_msg::CREATE_FAILED)
                } else {
                    error
                }
            })?;
    let team_memberships = initial_team_memberships(&mut tx, &organization.id, None).await?;
    notify_on_suspicious_names(&slack, &organization.id, &first_name, &last_name);
    let created = insert_account(
        &mut tx,
        &config,
        NewAccount {
            organization_id: &organization.id,
            email: &email,
            first_name: &first_name,
            last_name: &last_name,
            is_active: true,
            password: Some(sign_up.password),
            is_admin: true,
            is_dataset_manager: false,
            is_organization_owner: true,
            is_email_verified: false,
            team_memberships,
        },
    )
    .await?;
    if config.terms_of_service_enabled {
        let version = sign_up
            .accepted_terms_of_service
            .ok_or_else(|| ApiError::bad_request(org_msg::TOS_NOT_ACCEPTED))?;
        if version != config.terms_of_service_version {
            return Err(ApiError::bad_request(org_msg::tos_version_mismatch(
                config.terms_of_service_version,
                version,
            )));
        }
        sqlx::query(
            "UPDATE webknossos.organizations SET lastTermsOfServiceAcceptanceTime = statement_timestamp(), lastTermsOfServiceAcceptanceVersion = $2 WHERE _id = $1",
        )
        .bind(&organization.id)
        .bind(version)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    track_for_user(
        &state,
        &misc,
        &created.user_id,
        "signup",
        properties("had_invite", false),
    );
    create_organization_directory(&state.pool, clients.as_deref(), &organization.id).await;
    for mail in created.mails {
        mailer.send(mail);
    }
    let host = headers
        .get(header::HOST)
        .and_then(|host| host.to_str().ok())
        .unwrap_or("");
    mailer.send(templates::new_organization(
        &organization.name,
        &email,
        host,
        &config.new_organization_mailing_list,
    ));
    Ok(ok_empty())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExistingUserOrganization {
    user_id: ObjectId,
    new_organization_name: String,
}

async fn create_organization_with_existing_user(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    Extension(misc): Extension<MiscState>,
    clients: Option<Extension<ServiceClients>>,
    requester: AuthUser,
    Json(body): Json<ExistingUserOrganization>,
) -> ApiResult<axum::Json<String>> {
    if !requester.is_superuser {
        return Err(ApiError::bad_request(messages::SUPER_USER_ONLY));
    }
    let mut tx = state.pool.begin().await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.users_ WHERE _id = $1)")
            .bind(body.user_id.as_str())
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        return Err(ApiError::bad_request(messages::USER_NOT_FOUND));
    }
    let organization = create_organization(
        &mut tx,
        &config,
        Some(&random_hex(8)?),
        &body.new_organization_name,
    )
    .await?;
    let team_memberships = initial_team_memberships(&mut tx, &organization.id, None).await?;
    join_organization_as(
        &mut tx,
        body.user_id.as_str(),
        &organization.id,
        true,
        true,
        false,
        false,
        true,
        &team_memberships,
    )
    .await?;
    tx.commit().await?;
    // JoinOrganizationEvent(user, organization): the existing (original) identity.
    track_for_user(
        &state,
        &misc,
        body.user_id.as_str(),
        "join_organization",
        properties("joined_organization_id", organization.id.as_str()),
    );
    create_organization_directory(&state.pool, clients.as_deref(), &organization.id).await;
    Ok(axum::Json(organization.id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateUserInOrganization {
    first_name: String,
    last_name: String,
    email: String,
    password: Option<String>,
    auto_activate: Option<bool>,
}

async fn create_user_in_organization(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    Extension(misc): Extension<MiscState>,
    requester: AuthUser,
    Path(organization_id): Path<String>,
    Json(body): Json<CreateUserInOrganization>,
) -> ApiResult<Response> {
    if !requester.is_superuser {
        return Err(ApiError::forbidden(messages::NOT_ALLOWED));
    }
    let mut tx = state.pool.begin().await?;
    let organization = find_organization(&mut tx, &organization_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(org_msg::not_found(&organization_id)))?;
    let (first_name, last_name, email) =
        match validate_name_and_email(&mut tx, &body.first_name, &body.last_name, &body.email)
            .await?
        {
            Ok(values) => values,
            Err(errors) => return Ok(messages_response(&errors)),
        };
    let created = create_user(
        &mut tx,
        &config,
        &organization,
        &email,
        &first_name,
        &last_name,
        body.auto_activate.unwrap_or(false),
        body.password,
        None,
    )
    .await?;
    tx.commit().await?;
    track_for_user(
        &state,
        &misc,
        &created.user_id,
        "signup",
        properties("had_invite", false),
    );
    for mail in created.mails {
        mailer.send(mail);
    }
    Ok(ok_text(created.user_id))
}

/// Serialize joins of one account (assertNotInOrgaYet + insert).
async fn lock_multi_user(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &str,
) -> ApiResult<(String, String, String, String, bool)> {
    sqlx::query_as(
        r#"SELECT m._id, m.email, m.firstName, m.lastName, m.isSuperUser
           FROM webknossos.multiUsers_ m JOIN webknossos.users_ u ON u._multiUser = m._id
           WHERE u._id = $1 FOR UPDATE OF m"#,
    )
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(ApiError::unauthorized)
}

async fn join_organization(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    Extension(misc): Extension<MiscState>,
    user: AuthUser,
    Path(invite_token): Path<String>,
) -> ApiResult<Response> {
    let mut tx = state.pool.begin().await?;
    let (multi_user_id, email, first_name, last_name, is_superuser) =
        lock_multi_user(&mut tx, &user.id).await?;
    let invite = find_invite(&mut tx, &invite_token)
        .await?
        .ok_or_else(|| ApiError::bad_request(org_msg::INVALID_INVITE_TOKEN))?;
    let organization = find_organization(&mut tx, &invite.organization_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(org_msg::INVALID_INVITE_TOKEN))?;
    let already: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.users_ WHERE _multiUser = $1 AND _organization = $2)",
    )
    .bind(&multi_user_id)
    .bind(&organization.id)
    .fetch_one(&mut *tx)
    .await?;
    if already {
        return Err(ApiError::bad_request(org_msg::ALREADY_JOINED));
    }
    let paying: Option<String> = sqlx::query_scalar(
        r#"SELECT _organization FROM webknossos.users_ WHERE _multiUser = $1 AND NOT isDeactivated
           AND _organization IN (SELECT _id FROM webknossos.organizations
             WHERE pricingPlan IN ('Team', 'Power', 'Custom', 'Team_Trial', 'Power_Trial'))
           ORDER BY created ASC LIMIT 1"#,
    )
    .bind(&multi_user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if !is_superuser && paying.is_none() {
        assert_users_can_be_added(&mut tx, &organization.id).await?;
    }
    let team_memberships =
        initial_team_memberships(&mut tx, &organization.id, Some(&invite.id)).await?;
    join_organization_as(
        &mut tx,
        &user.id,
        &organization.id,
        invite.auto_activate,
        invite.is_admin,
        invite.is_dataset_manager,
        false,
        false,
        &team_memberships,
    )
    .await?;
    let mail = admin_notifier_mail(
        &mut tx,
        &config,
        &organization,
        &format!("{first_name} {last_name}"),
        &email,
        invite.auto_activate,
    )
    .await?;
    deactivate_invite(&mut tx, &invite.id).await?;
    tx.commit().await?;
    // JoinOrganizationEvent(request.identity, organization): the requesting identity.
    track(
        &state,
        &misc,
        &user,
        "join_organization".into(),
        properties("joined_organization_id", organization.id.as_str()),
    );
    if let Some(mail) = mail {
        mailer.send(mail);
    }
    Ok(ok_empty())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InviteTeamMembership {
    id: ObjectId,
    is_team_manager: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InviteParameters {
    recipients: Vec<String>,
    auto_activate: bool,
    is_admin: bool,
    is_dataset_manager: bool,
    team_memberships: Vec<InviteTeamMembership>,
}

async fn send_invites(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    Extension(misc): Extension<MiscState>,
    user: AuthUser,
    Json(body): Json<InviteParameters>,
) -> ApiResult<Response> {
    for membership in &body.team_memberships {
        if !user
            .can_manage_team(&state.pool, membership.id.as_str())
            .await?
        {
            return Err(ApiError::bad_request(
                "Can only send invites with team roles for teams you manage.",
            ));
        }
    }
    if (body.is_admin || body.is_dataset_manager) && !user.is_admin {
        return Err(ApiError::bad_request(
            "Only admins can send invites that promote new users to admin or dataset manager.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let (organization_name, sender_name): (String, String) = sqlx::query_as(
        r#"SELECT o.name, m.firstName || ' ' || m.lastName FROM webknossos.users_ u
           JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
           JOIN webknossos.organizations_ o ON o._id = u._organization WHERE u._id = $1"#,
    )
    .bind(&user.id)
    .fetch_one(&mut *tx)
    .await?;
    let expiry_ms =
        i64::try_from(config.invite_expiry.as_millis()).map_err(|_| ApiError::internal())?;
    let mut mails = Vec::new();
    for recipient in &body.recipients {
        let invite_id = ObjectId::new();
        let token = random_base64url(16)?;
        sqlx::query(
            r#"INSERT INTO webknossos.invites(_id, tokenValue, _organization, autoActivate, isAdmin,
                 isDatasetManager, expirationDateTime, created, isDeleted)
               VALUES($1, $2, $3, $4, $5, $6,
                 statement_timestamp() + $7::bigint * INTERVAL '1 millisecond', statement_timestamp(), FALSE)"#,
        )
        .bind(invite_id.as_str())
        .bind(&token)
        .bind(&user.organization_id)
        .bind(body.auto_activate)
        .bind(body.is_admin)
        .bind(body.is_dataset_manager)
        .bind(expiry_ms)
        .execute(&mut *tx)
        .await?;
        for membership in &body.team_memberships {
            sqlx::query(
                "INSERT INTO webknossos.invite_team_roles(_invite, _team, isTeamManager) VALUES($1, $2, $3)",
            )
            .bind(invite_id.as_str())
            .bind(membership.id.as_str())
            .bind(membership.is_team_manager)
            .execute(&mut *tx)
            .await?;
        }
        tracing::info!("sending invite mail");
        mails.push(templates::invite(
            recipient,
            &token,
            body.auto_activate,
            &organization_name,
            &sender_name,
            &config.public_uri,
        ));
    }
    tx.commit().await?;
    track(
        &state,
        &misc,
        &user,
        "send_invites".into(),
        properties("recipient_count", body.recipients.len()),
    );
    for mail in mails {
        mailer.send(mail);
    }
    Ok(ok_empty())
}

async fn add_user(
    State(state): State<AppState>,
    requester: AuthUser,
    Path(organization_id): Path<String>,
    Json(email): Json<String>,
) -> ApiResult<Response> {
    if !requester.is_superuser {
        return Err(ApiError::forbidden(messages::NOT_ALLOWED));
    }
    let mut tx = state.pool.begin().await?;
    let multi_user_id: String =
        sqlx::query_scalar("SELECT _id FROM webknossos.multiUsers_ WHERE email = $1 FOR UPDATE")
            .bind(&email)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| ApiError::bad_request(messages::USER_NOT_FOUND))?;
    let organization = find_organization(&mut tx, &organization_id)
        .await?
        .ok_or_else(|| ApiError::not_found(org_msg::not_found(&organization_id)))?;
    let original: String = sqlx::query_scalar(
        "SELECT _id FROM webknossos.users_ WHERE _multiUser = $1 AND NOT isDeactivated ORDER BY created, _id LIMIT 1",
    )
    .bind(&multi_user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::bad_request(messages::USER_NOT_FOUND))?;
    let team_memberships = initial_team_memberships(&mut tx, &organization.id, None).await?;
    let user_id = join_organization_as(
        &mut tx,
        &original,
        &organization.id,
        true,
        false,
        false,
        false,
        false,
        &team_memberships,
    )
    .await?;
    tx.commit().await?;
    Ok(ok_text(user_id))
}

#[cfg(test)]
mod tests {
    use super::normalize_strong;

    #[test]
    fn normalize_strong_matches_text_utils() {
        assert_eq!(normalize_strong("Jürgen").as_deref(), Some("Juergen"));
        assert_eq!(normalize_strong("Ærø Øst").as_deref(), Some("Aeroe Oest"));
        assert_eq!(normalize_strong("a.b@c!").as_deref(), Some("abc"));
        assert_eq!(
            normalize_strong("my org-1_x").as_deref(),
            Some("my org-1_x")
        );
        assert_eq!(normalize_strong("日本"), None);
        assert_eq!(normalize_strong(""), None);
    }
}
