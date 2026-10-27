//! Password reset/change, identity switching and email verification
//! (AuthenticationController, EmailVerificationController).
use axum::{
    Extension, Router,
    extract::{FromRequestParts, State},
    http::{HeaderMap, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::{Postgres, Transaction};

use crate::{
    AppState,
    auth::browser::dao::update_last_logged_in_identity,
    auth::browser::onboarding::dao::find_one_organization_team,
    auth::browser::onboarding::join_organization_as,
    auth::browser::{
        BrowserAuthConfig, Form, FormBody, create_email_verification, hash_password, issue_cookie,
        messages, random_base64url, signer_secret, verify_password,
    },
    auth::{AuthCredential, AuthUser, authenticate_request},
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    mail::{MailSender, templates},
    util::id::ObjectId,
};

pub(crate) mod dao;

mod verification_messages {
    pub const KEY_INVALID: &str = "Verification key is invalid.";
    pub const KEY_USED: &str = "Verification key has already been used.";
    pub const LINK_EXPIRED: &str = "The email verification link is expired.";
    pub const EMAIL_DOES_NOT_MATCH: &str =
        "This verification key is associated with a different email address.";
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/startResetPassword", post(start_reset_password))
        .route("/auth/resetPassword", post(reset_password))
        .route("/auth/changePassword", post(change_password))
        .route("/auth/switch", get(switch_multi_user))
        .route(
            "/auth/switchOrganization/{organization_id}",
            post(switch_organization),
        )
        .route("/auth/accessibleBySwitching", get(accessible_by_switching))
        .route("/verifyEmail/{key}", post(verify_email))
        .route("/verifyEmail", post(request_verification_mail))
}

/// A secured request with the credential that authenticated it.
struct Secured {
    user: AuthUser,
    credential: AuthCredential,
}

impl FromRequestParts<AppState> for Secured {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        let (user, credential) = authenticate_request(parts, state)
            .await?
            .ok_or_else(ApiError::unauthorized)?;
        Ok(Self { user, credential })
    }
}

/// Silhouette `discard` of the current authenticator whose result Play
/// ignores: bearer tokens are soft-deleted, stateless cookies are unaffected.
async fn discard_bearer_token(
    tx: &mut Transaction<'_, Postgres>,
    secured: &Secured,
) -> ApiResult<()> {
    if let AuthCredential::Token(token) = &secured.credential {
        dao::delete_token_by_value_for_user(tx, token, &secured.user.id).await?;
    }
    Ok(())
}

/// userService.userFromMultiUserEmail
async fn identity_for_email(
    tx: &mut Transaction<'_, Postgres>,
    email: &str,
) -> ApiResult<Option<(ObjectId, String, String)>> {
    let row = dao::find_identity_by_email(tx, email).await?;
    Ok(row.and_then(|(user, email, name)| user.map(|user| (user, email, name))))
}

async fn start_reset_password(
    State(state): State<AppState>,
    State(config): State<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    FormBody(data): FormBody,
) -> ApiResult<StatusCode> {
    let mut form = Form::new(&data);
    let email = form.email("email");
    form.finish()?;
    let email = email.to_lowercase();
    let mut tx = state.pool.begin().await?;
    // Always 200: never reveal whether an account exists.
    if let Some((user_id, email, name)) = identity_for_email(&mut tx, &email).await? {
        dao::delete_reset_password_tokens_for_user(&mut tx, &user_id).await?;
        let token = random_base64url(16)?;
        let expiry_ms = i64::try_from(config.reset_password_expiry.as_millis())
            .map_err(|_| ApiError::internal())?;
        let idle_ms = i64::try_from(config.token_idle_timeout.as_millis())
            .map_err(|_| ApiError::internal())?;
        dao::insert_reset_password_token(&mut tx, &token, &user_id, expiry_ms, idle_ms).await?;
        tx.commit().await?;
        mailer.send(templates::reset_password(
            &name,
            &email,
            &config.public_uri,
            &token,
        ));
    }
    Ok(StatusCode::OK)
}

async fn reset_password(
    State(state): State<AppState>,
    FormBody(data): FormBody,
) -> ApiResult<StatusCode> {
    let mut form = Form::new(&data);
    let token = form.text("token");
    let password = form.new_password("password");
    form.finish()?;
    let token = token.trim();
    let mut tx = state.pool.begin().await?;
    // userForResetPasswordToken: not for deactivated users.
    let target = dao::find_user_for_reset_password_token(&mut tx, token).await?;
    let (_, multi_user_id, deactivated) =
        target.ok_or_else(|| ApiError::bad_request(crate::msg::user::token::INVALID))?;
    if deactivated {
        return Err(ApiError::bad_request(messages::IS_DEACTIVATED));
    }
    let hash = hash_password(password).await?;
    dao::update_password(&mut tx, &multi_user_id, &hash).await?;
    dao::delete_tokens_by_value(&mut tx, token).await?;
    tx.commit().await?;
    tracing::info!(multi_user = %multi_user_id, "Multiuser reset their password.");
    Ok(StatusCode::OK)
}

async fn change_password(
    State(state): State<AppState>,
    State(config): State<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    secured: Secured,
    FormBody(data): FormBody,
) -> ApiResult<StatusCode> {
    let mut form = Form::new(&data);
    let old_password = form.non_empty("oldPassword");
    let password = form.new_password("password");
    form.finish()?;
    let mut tx = state.pool.begin().await?;
    let (multi_user_id, hasher, current_hash, email, name) =
        dao::find_password_info_of_user_for_update(&mut tx, &secured.user.id)
            .await?
            .ok_or_else(ApiError::unauthorized)?;
    if !verify_password(old_password, &hasher, current_hash).await {
        return Err(ApiError::bad_request(crate::msg::user::INVALID_CREDENTIALS));
    }
    let hash = hash_password(password).await?;
    dao::update_password(&mut tx, &multi_user_id, &hash).await?;
    discard_bearer_token(&mut tx, &secured).await?;
    tx.commit().await?;
    tracing::info!(multi_user = %multi_user_id, "Multiuser changed their password.");
    mailer.send(templates::change_password(
        &name,
        &email,
        &config.public_uri,
    ));
    Ok(StatusCode::OK)
}

/// switchToUser: a fresh cookie for the target in a redirect to /dashboard.
fn switch_response(cookie: axum::http::HeaderValue) -> Response {
    let mut response = (StatusCode::SEE_OTHER, [(header::LOCATION, "/dashboard")]).into_response();
    response.headers_mut().append(header::SET_COOKIE, cookie);
    response
}

#[derive(Deserialize)]
struct SwitchQuery {
    to: String,
}

async fn switch_multi_user(
    State(state): State<AppState>,
    State(config): State<BrowserAuthConfig>,
    headers: HeaderMap,
    secured: Secured,
    Query(query): Query<SwitchQuery>,
) -> ApiResult<Response> {
    if !secured.user.is_superuser {
        return Err(ApiError::forbidden(crate::msg::user::NOT_AUTHENTICATED));
    }
    signer_secret(&config)?;
    let mut tx = state.pool.begin().await?;
    let (target, _, _) = identity_for_email(&mut tx, &query.to)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::user::NOT_FOUND_NO_ID))?;
    discard_bearer_token(&mut tx, &secured).await?;
    let cookie = issue_cookie(&config, &headers, &target)?;
    tx.commit().await?;
    tracing::info!(user = %secured.user.id, target = %target, "Superuser switched identity.");
    Ok(switch_response(cookie))
}

async fn switch_organization(
    State(state): State<AppState>,
    State(config): State<BrowserAuthConfig>,
    headers: HeaderMap,
    secured: Secured,
    Path(organization_id): Path<String>,
) -> ApiResult<Response> {
    signer_secret(&config)?;
    let mut tx = state.pool.begin().await?;
    let multi_user_id = dao::find_multi_user_id_of_user_for_update(&mut tx, &secured.user.id)
        .await?
        .ok_or_else(ApiError::unauthorized)?;
    let accessible = dao::is_organization_accessible(
        &mut tx,
        &organization_id,
        &multi_user_id,
        secured.user.is_superuser,
    )
    .await?;
    if !accessible {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            &organization_id,
        )));
    }
    let existing =
        dao::find_one_user_of_multi_user_in_organization(&mut tx, &multi_user_id, &organization_id)
            .await?;
    let (target, deactivated) = match existing {
        Some(existing) => existing,
        None if secured.user.is_superuser => {
            // fillSuperUserIdentity: an unlisted admin identity.
            let team = find_one_organization_team(&mut tx, &organization_id).await?;
            let teams: Vec<(ObjectId, bool)> = team.into_iter().map(|team| (team, false)).collect();
            let id = join_organization_as(
                &mut tx,
                &secured.user.id,
                &organization_id,
                true,
                true,
                false,
                true,
                false,
                &teams,
            )
            .await?;
            (id, false)
        }
        None => return Err(ApiError::not_found(crate::msg::user::NOT_FOUND_NO_ID)),
    };
    if deactivated {
        return Err(ApiError::bad_request(messages::IS_DEACTIVATED));
    }
    discard_bearer_token(&mut tx, &secured).await?;
    let cookie = issue_cookie(&config, &headers, &target)?;
    update_last_logged_in_identity(&mut tx, &multi_user_id, &target).await?;
    tx.commit().await?;
    Ok(switch_response(cookie))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessibleQuery {
    dataset_id: Option<ObjectId>,
    annotation_id: Option<ObjectId>,
    workflow_hash: Option<String>,
}

enum Target {
    Dataset(ObjectId),
    Annotation(ObjectId),
    Workflow(String),
}

const COMBINATION_ERROR: &str =
    "Can either test access for dataset or annotation or workflow, not a combination";

async fn identity_can_access(
    pool: &sqlx::PgPool,
    identity: &AuthUser,
    target: &Target,
) -> ApiResult<bool> {
    Ok(match target {
        Target::Dataset(id) => {
            crate::dataset::access::can_read(pool, Some(identity), id, None).await?
        }
        Target::Annotation(id) => {
            match crate::annotation::access::find(pool, Some(identity), id, true).await {
                Ok(annotation) => {
                    annotation.state != "Cancelled"
                        && crate::annotation::access::restrictions(&annotation, Some(identity))
                            .allow_access
                }
                Err(error) if error.status == StatusCode::NOT_FOUND => false,
                Err(error) => return Err(error),
            }
        }
        Target::Workflow(hash) => {
            dao::workflow_exists_in_organization(pool, &identity.organization_id, hash).await?
        }
    })
}

async fn accessible_by_switching(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<AccessibleQuery>,
) -> ApiResult<axum::Json<Value>> {
    let target = match (query.dataset_id, query.annotation_id, query.workflow_hash) {
        (Some(id), None, None) => Target::Dataset(id),
        (None, Some(id), None) => Target::Annotation(id),
        (None, None, Some(hash)) => Target::Workflow(hash),
        _ => return Err(ApiError::bad_request(COMBINATION_ERROR)),
    };
    // Play's lookups end in empty Foxes (no message): the generic 404.
    let not_found = || ApiError::not_found(crate::msg::NOT_FOUND);
    let organization: String = if user.is_superuser {
        let found: Option<String> = match &target {
            Target::Dataset(id) => dao::find_organization_id_of_dataset(&state.pool, id).await?,
            Target::Annotation(id) => {
                dao::find_organization_id_of_annotation(&state.pool, id).await?
            }
            Target::Workflow(hash) => {
                dao::find_organization_id_of_workflow(&state.pool, hash).await?
            }
        };
        found.ok_or_else(not_found)?
    } else {
        let identities = dao::find_all_identities_of_account(&state.pool, &user.id).await?;
        let mut selected = None;
        for identity in identities {
            if identity_can_access(&state.pool, &identity, &target).await? {
                selected = Some(identity.organization_id);
                break;
            }
        }
        selected.ok_or_else(not_found)?
    };
    // Already in the right organization but still no access: assume a reason.
    if organization == user.organization_id {
        return Err(not_found());
    }
    Ok(axum::Json(
        crate::organization::routes::public_json(&state.pool, &organization, None, false, false)
            .await?,
    ))
}

async fn verify_email(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<StatusCode> {
    use verification_messages as msg;
    let mut tx = state.pool.begin().await?;
    let key_row = dao::find_email_verification_key_for_update(&mut tx, &key).await?;
    let (key_id, key_email, multi_user_id, is_used, expired) =
        key_row.ok_or_else(|| ApiError::bad_request(msg::KEY_INVALID))?;
    let (email, verified) = dao::find_email_and_verified_for_update(&mut tx, &multi_user_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::user::NOT_FOUND_NO_ID))?;
    if verified {
        return Ok(StatusCode::OK);
    }
    if is_used {
        return Err(ApiError::bad_request(msg::KEY_USED));
    }
    if expired {
        return Err(ApiError::bad_request(msg::LINK_EXPIRED));
    }
    if key_email != email {
        return Err(ApiError::bad_request(msg::EMAIL_DOES_NOT_MATCH));
    }
    dao::update_email_verified(&mut tx, &multi_user_id).await?;
    dao::update_email_verification_key_used(&mut tx, &key_id).await?;
    tx.commit().await?;
    Ok(StatusCode::OK)
}

async fn request_verification_mail(
    State(state): State<AppState>,
    State(config): State<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    user: AuthUser,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let multi_user_id = dao::find_multi_user_id_of_user(&mut tx, &user.id).await?;
    let mail = create_email_verification(&mut tx, &config, &multi_user_id).await?;
    tx.commit().await?;
    mailer.send(mail);
    Ok(StatusCode::OK)
}
