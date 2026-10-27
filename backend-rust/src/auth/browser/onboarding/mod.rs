//! Account and organization onboarding from AuthenticationController and
//! OrganizationController.addUser: registration, organization creation,
//! superuser account administration, invitations and joining.
//!
//! Every multi-record mutation runs in one transaction (Play performs these
//! steps non-transactionally). Mails and analytics events are sent only
//! after commit. Mailchimp side effects are not ported; suspicious
//! registration names are reported to Slack.
use axum::{
    Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::{Postgres, Transaction};

pub(crate) mod dao;
use dao::{InviteRow, OrganizationRow};

use crate::{
    AppState,
    auth::browser::{
        BrowserAuthConfig, Form, FormBody, create_email_verification, hash_password, messages,
        random_base64url, random_hex,
    },
    auth::{AuthUser, OptionalAuthUser},
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    mail::{Mail, MailSender, templates},
    slack::SlackNotificationService,
    stores::client::ServiceClients,
    system::analytics::{properties, track, track_for_user},
    system::application_info::MiscState,
    system::application_info::ok_empty,
    util::id::ObjectId,
    util::text::normalize_strong,
};

pub(crate) mod organization_messages {
    pub const USER_LIMIT_REACHED: &str = "Cannot add new user to this organization because it would exceed the organization’s user limit. Please ask the organization owner to upgrade.";
    pub const ALREADY_JOINED: &str =
        "Your account is already associated with the selected organization.";
    pub const AMBIGUOUS: &str =
        "Registration without invite is not allowed for instances with multiple organizations.";
    pub const ID_TAKEN: &str = "This id is already in use by a different organization and not available anymore. Please choose a different id.";
    pub const ID_INVALID: &str =
        "This organization id contains illegal characters. Please only use letters and numbers.";
    pub const CREATE_FORBIDDEN: &str = "You do not have permission to create a new organization.";
    pub const CREATE_FAILED: &str = "Could not create a new organization.";
    pub const NEEDS_INVITE: &str =
        "Registration without invite is not enabled for this WEBKNOSSOS instance.";
    pub const INVALID_INVITE_TOKEN: &str = "This invite token is invalid.";
    pub const TOS_NOT_ACCEPTED: &str = "Terms of service must be accepted.";
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
    let taken = dao::multi_user_email_exists(tx, &email).await?;
    if taken {
        errors.insert(0, crate::msg::user::email::TAKEN.to_owned());
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

async fn find_organization(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
) -> ApiResult<Option<OrganizationRow>> {
    dao::find_one_organization(tx, id).await
}

/// organizationService.assertUsersCanBeAdded. Locks the organization row so
/// concurrent additions cannot exceed the limit.
pub(crate) async fn assert_users_can_be_added(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: &str,
) -> ApiResult<()> {
    let included = dao::find_included_users_for_update(tx, organization_id).await?;
    let Some(Some(included)) = included else {
        return Ok(());
    };
    let count = dao::count_users_towards_limit(tx, organization_id).await?;
    if count + 1 > i64::from(included) {
        return Err(ApiError::bad_request(org_msg::USER_LIMIT_REACHED));
    }
    Ok(())
}

/// userService.initialTeamMemberships
pub(crate) async fn initial_team_memberships(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: &str,
    invite_id: Option<&ObjectId>,
) -> ApiResult<Vec<(ObjectId, bool)>> {
    if let Some(invite_id) = invite_id {
        return dao::find_all_invite_team_roles(tx, invite_id).await;
    }
    let team = dao::find_one_organization_team(tx, organization_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::organization::TEAM_MISSING))?;
    Ok(vec![(team, false)])
}

async fn insert_team_memberships(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &ObjectId,
    memberships: &[(ObjectId, bool)],
) -> ApiResult<()> {
    dao::delete_team_memberships_for_user(tx, user_id).await?;
    for (team, is_manager) in memberships {
        dao::insert_team_membership(tx, user_id, team, *is_manager).await?;
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
    pub team_memberships: Vec<(ObjectId, bool)>,
}

pub(crate) struct CreatedAccount {
    pub user_id: ObjectId,
    pub mails: Vec<Mail>,
}

/// userService.insert
pub(crate) async fn insert_account(
    tx: &mut Transaction<'_, Postgres>,
    config: &BrowserAuthConfig,
    account: NewAccount<'_>,
) -> ApiResult<CreatedAccount> {
    let taken = dao::multi_user_email_exists(tx, account.email).await?;
    if taken {
        return Err(ApiError::bad_request(crate::msg::user::email::TAKEN));
    }
    let (hasher, hash) = match account.password {
        Some(password) => ("SCrypt", hash_password(password).await?),
        None => ("Empty", String::new()),
    };
    let multi_user_id = ObjectId::new();
    dao::insert_multi_user(
        tx,
        &multi_user_id,
        account.email,
        hasher,
        &hash,
        account.first_name,
        account.last_name,
        account.is_email_verified,
    )
    .await?;
    let mut mails = Vec::new();
    if !account.is_email_verified {
        mails.push(create_email_verification(tx, config, &multi_user_id).await?);
    }
    let user_id = ObjectId::new();
    dao::insert_user(
        tx,
        &user_id,
        &multi_user_id,
        account.organization_id,
        !account.is_active,
        account.is_admin,
        account.is_organization_owner,
        account.is_dataset_manager,
    )
    .await?;
    insert_team_memberships(tx, &user_id, &account.team_memberships).await?;
    Ok(CreatedAccount { user_id, mails })
}

/// userService.joinOrganization: a new identity copying the original's
/// account-level fields (configuration, logout cutoff).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn join_organization_as(
    tx: &mut Transaction<'_, Postgres>,
    original_user_id: &ObjectId,
    organization_id: &str,
    auto_activate: bool,
    is_admin: bool,
    is_dataset_manager: bool,
    is_unlisted: bool,
    is_organization_owner: bool,
    team_memberships: &[(ObjectId, bool)],
) -> ApiResult<ObjectId> {
    let new_user_id = ObjectId::new();
    let inserted = dao::insert_user_copying_original(
        tx,
        &new_user_id,
        original_user_id,
        organization_id,
        !auto_activate,
        is_admin,
        is_organization_owner,
        is_dataset_manager,
        is_unlisted,
    )
    .await?;
    if inserted == 0 {
        return Err(ApiError::bad_request(crate::msg::user::NOT_FOUND_NO_ID));
    }
    insert_team_memberships(tx, &new_user_id, team_memberships).await?;
    tracing::info!(
        organization = %organization_id,
        user = %new_user_id,
        "Multiuser joined organization with new user id."
    );
    Ok(new_user_id)
}

/// organizationService.newUserMailRecipient: mailing list, else the owner.
async fn new_user_mail_recipient(
    tx: &mut Transaction<'_, Postgres>,
    organization: &OrganizationRow,
) -> ApiResult<Option<String>> {
    if !organization.new_user_mailing_list.is_empty() {
        return Ok(Some(organization.new_user_mailing_list.clone()));
    }
    dao::find_organization_owner_email(tx, &organization.id).await
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

/// inviteDAO.findOneByTokenValue, locked for single use.
async fn find_invite(
    tx: &mut Transaction<'_, Postgres>,
    token: &str,
) -> ApiResult<Option<InviteRow>> {
    dao::find_one_invite_by_token_for_update(tx, token).await
}

async fn deactivate_invite(
    tx: &mut Transaction<'_, Postgres>,
    invite_id: &ObjectId,
) -> ApiResult<()> {
    dao::delete_invite(tx, invite_id).await
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
        initial_team_memberships(tx, &organization.id, invite.map(|i| &i.id)).await?;
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

/// organizationService.createOrganization: organization, root folder and
/// organization team. Returns the organization and organization team IDs.
pub(crate) async fn insert_organization(
    tx: &mut Transaction<'_, Postgres>,
    is_wkorg_instance: bool,
    requested_id: Option<&str>,
    name: &str,
) -> ApiResult<(String, ObjectId)> {
    let normalized_name =
        normalize_strong(name).ok_or_else(|| ApiError::bad_request(org_msg::ID_INVALID))?;
    let id = match requested_id {
        Some(requested) => {
            normalize_strong(requested).ok_or_else(|| ApiError::bad_request(org_msg::ID_INVALID))?
        }
        None => normalized_name,
    }
    .replace(' ', "_");
    // Ids of deleted organizations stay reserved (primary key).
    let exists = dao::organization_id_exists(tx, &id).await?;
    if exists {
        return Err(ApiError::bad_request(org_msg::ID_TAKEN));
    }
    let (plan, included_users, included_storage): (&str, Option<i32>, Option<i64>) =
        if is_wkorg_instance {
            ("Personal", Some(1), Some(50_000_000_000))
        } else {
            ("Custom", None, None)
        };
    let root_folder = ObjectId::new();
    dao::insert_root_folder(tx, &root_folder).await?;
    dao::insert_root_folder_path(tx, &root_folder).await?;
    dao::insert_organization(
        tx,
        &id,
        name,
        &root_folder,
        plan,
        included_users,
        included_storage,
    )
    .await?;
    let team = ObjectId::new();
    dao::insert_organization_team(tx, &team, &id).await?;
    Ok((id, team))
}

/// organizationService.createOrganization
async fn create_organization(
    tx: &mut Transaction<'_, Postgres>,
    config: &BrowserAuthConfig,
    requested_id: Option<&str>,
    name: &str,
) -> ApiResult<OrganizationRow> {
    let (id, _) = insert_organization(tx, config.is_wkorg_instance, requested_id, name).await?;
    Ok(OrganizationRow {
        id,
        name: name.to_owned(),
        enable_auto_verify: false,
        new_user_mailing_list: String::new(),
    })
}

/// organizationService.createOrganizationDirectory: notify every datastore.
/// Like Play, individual RPC failures are ignored.
pub(crate) async fn create_organization_directory(
    pool: &sqlx::PgPool,
    clients: Option<&ServiceClients>,
    organization_id: &str,
) {
    let Some(clients) = clients else {
        return;
    };
    let urls: Vec<String> = match dao::find_all_data_store_urls(pool).await {
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
    State(config): State<BrowserAuthConfig>,
    State(mailer): State<MailSender>,
    State(misc): State<MiscState>,
    State(slack): State<SlackNotificationService>,
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
            .ok_or_else(|| ApiError::bad_request(crate::msg::organization::NOT_FOUND_BY_INVITE))?,
        None => {
            let organizations = dao::find_first_two_organizations(&mut tx).await?;
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
    State(config): State<BrowserAuthConfig>,
    State(mailer): State<MailSender>,
    State(misc): State<MiscState>,
    State(clients): State<ServiceClients>,
    State(slack): State<SlackNotificationService>,
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
    let no_organizations = dao::has_no_organizations(&mut tx).await?;
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
            return Err(ApiError::bad_request(
                crate::msg::organization::terms_of_service::version_mismatch(
                    config.terms_of_service_version,
                    version,
                ),
            ));
        }
        dao::update_terms_of_service_acceptance(&mut tx, &organization.id, version).await?;
    }
    tx.commit().await?;
    track_for_user(
        &state,
        &misc,
        &created.user_id,
        "signup",
        properties("had_invite", false),
    );
    create_organization_directory(&state.pool, Some(&clients), &organization.id).await;
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
    State(config): State<BrowserAuthConfig>,
    State(misc): State<MiscState>,
    State(clients): State<ServiceClients>,
    requester: AuthUser,
    Json(body): Json<ExistingUserOrganization>,
) -> ApiResult<axum::Json<String>> {
    if !requester.is_superuser {
        return Err(ApiError::bad_request(crate::msg::user::SUPER_USER_ONLY));
    }
    let mut tx = state.pool.begin().await?;
    let exists = dao::user_exists(&mut tx, &body.user_id).await?;
    if !exists {
        // Play: `userDAO.findOne(userId)` without a message, an empty Fox: the generic 404.
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
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
        &body.user_id,
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
        &body.user_id,
        "join_organization",
        properties("joined_organization_id", organization.id.as_str()),
    );
    create_organization_directory(&state.pool, Some(&clients), &organization.id).await;
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
    State(config): State<BrowserAuthConfig>,
    State(mailer): State<MailSender>,
    State(misc): State<MiscState>,
    requester: AuthUser,
    Path(organization_id): Path<String>,
    Json(body): Json<CreateUserInOrganization>,
) -> ApiResult<Response> {
    if !requester.is_superuser {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let mut tx = state.pool.begin().await?;
    let organization = find_organization(&mut tx, &organization_id)
        .await?
        .ok_or_else(|| {
            ApiError::bad_request(crate::msg::organization::not_found(&organization_id))
        })?;
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
    Ok(ok_text(created.user_id.into()))
}

/// Serialize joins of one account (assertNotInOrgaYet + insert).
async fn lock_multi_user(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &ObjectId,
) -> ApiResult<(ObjectId, String, String, String, bool)> {
    dao::find_multi_user_of_user_for_update(tx, user_id)
        .await?
        .ok_or_else(ApiError::unauthorized)
}

async fn join_organization(
    State(state): State<AppState>,
    State(config): State<BrowserAuthConfig>,
    State(mailer): State<MailSender>,
    State(misc): State<MiscState>,
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
    let already =
        dao::multi_user_has_user_in_organization(&mut tx, &multi_user_id, &organization.id).await?;
    if already {
        return Err(ApiError::bad_request(org_msg::ALREADY_JOINED));
    }
    let paying = dao::find_paying_organization_of_multi_user(&mut tx, &multi_user_id).await?;
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
    State(config): State<BrowserAuthConfig>,
    State(mailer): State<MailSender>,
    State(misc): State<MiscState>,
    user: AuthUser,
    Json(body): Json<InviteParameters>,
) -> ApiResult<Response> {
    // Deviation from Scala: plain members may not invite at all.
    if !user.is_team_manager_or_admin(&state.pool).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    for membership in &body.team_memberships {
        if !user.can_manage_team(&state.pool, &membership.id).await? {
            return Err(ApiError::bad_request(
                crate::msg::user::invite::TEAMS_NOT_MANAGED,
            ));
        }
    }
    if (body.is_admin || body.is_dataset_manager) && !user.is_admin {
        return Err(ApiError::bad_request(
            crate::msg::user::invite::PROMOTION_ADMIN_ONLY,
        ));
    }
    let mut tx = state.pool.begin().await?;
    let (organization_name, sender_name) =
        dao::find_organization_name_and_sender_name(&mut tx, &user.id).await?;
    let expiry_ms =
        i64::try_from(config.invite_expiry.as_millis()).map_err(|_| ApiError::internal())?;
    let mut mails = Vec::new();
    for recipient in &body.recipients {
        let invite_id = ObjectId::new();
        let token = random_base64url(16)?;
        dao::insert_invite(
            &mut tx,
            &invite_id,
            &token,
            &user.organization_id,
            body.auto_activate,
            body.is_admin,
            body.is_dataset_manager,
            expiry_ms,
        )
        .await?;
        for membership in &body.team_memberships {
            dao::insert_invite_team_role(
                &mut tx,
                &invite_id,
                &membership.id,
                membership.is_team_manager,
            )
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
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let mut tx = state.pool.begin().await?;
    let multi_user_id = dao::find_multi_user_id_by_email_for_update(&mut tx, &email)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let organization = find_organization(&mut tx, &organization_id)
        .await?
        .ok_or_else(|| {
            ApiError::not_found(crate::msg::organization::not_found(&organization_id))
        })?;
    let already =
        dao::multi_user_has_user_in_organization(&mut tx, &multi_user_id, &organization.id).await?;
    if already {
        return Err(ApiError::bad_request(org_msg::ALREADY_JOINED));
    }
    let original = dao::find_first_active_user_of_multi_user(&mut tx, &multi_user_id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
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
    Ok(ok_text(user_id.into()))
}
