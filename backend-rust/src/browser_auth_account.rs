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
    AppState, annotation_access,
    auth::{AuthCredential, AuthUser, authenticate_request},
    browser_auth::{
        BrowserAuthConfig, Form, FormBody, create_email_verification, hash_password, issue_cookie,
        messages, random_base64url, signer_secret, verify_password,
    },
    browser_auth_onboarding::join_organization_as,
    dataset_access,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    id::ObjectId,
    mail::{MailSender, templates},
    organizations,
};

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
        sqlx::query(
            "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE value = $1 AND _user = $2",
        )
        .bind(token)
        .bind(&secured.user.id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// userService.userFromMultiUserEmail
async fn identity_for_email(
    tx: &mut Transaction<'_, Postgres>,
    email: &str,
) -> ApiResult<Option<(String, String, String)>> {
    let row: Option<(Option<String>, String, String)> = sqlx::query_as(
        r#"SELECT COALESCE(
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._id = m._lastLoggedInIdentity AND u._multiUser = m._id AND NOT u.isDeactivated),
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._multiUser = m._id AND NOT u.isDeactivated ORDER BY u.created, u._id LIMIT 1)),
           m.email, m.firstName || ' ' || m.lastName
         FROM webknossos.multiUsers_ m WHERE m.email = $1"#,
    )
    .bind(email)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.and_then(|(user, email, name)| user.map(|user| (user, email, name))))
}

async fn start_reset_password(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
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
        sqlx::query(
            "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE _user = $1 AND tokenType = 'ResetPassword' AND NOT isDeleted",
        )
        .bind(&user_id)
        .execute(&mut *tx)
        .await?;
        let token = random_base64url(16)?;
        let expiry_ms = i64::try_from(config.reset_password_expiry.as_millis())
            .map_err(|_| ApiError::internal())?;
        let idle_ms = i64::try_from(config.token_idle_timeout.as_millis())
            .map_err(|_| ApiError::internal())?;
        sqlx::query(
            r#"INSERT INTO webknossos.tokens
                 (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
               VALUES ($1, $2, $3, statement_timestamp(),
                 statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
                 'ResetPassword', statement_timestamp())"#,
        )
        .bind(ObjectId::new().as_str())
        .bind(&token)
        .bind(&user_id)
        .bind(expiry_ms)
        .bind(idle_ms)
        .execute(&mut *tx)
        .await?;
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
    // Deliberately stricter than Play's userForToken, which accepts any token
    // type: only reset-password tokens may set a password without the old one.
    let target: Option<(String, String)> = sqlx::query_as(
        r#"SELECT u._id, u._multiUser FROM webknossos.tokens t
           JOIN webknossos.users_ u ON u._id = t._user
           JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
           WHERE t.value = $1 AND t.tokenType = 'ResetPassword' AND NOT t.isDeleted
             AND t.expirationDateTime > statement_timestamp()
             AND (t.idleTimeout IS NULL OR (t.idleTimeout > 0 AND
               EXTRACT(EPOCH FROM (statement_timestamp() - t.lastUsedDateTime)) * 1000 < t.idleTimeout))
             AND (u.loggedOutEverywhereTime IS NULL OR t.created > u.loggedOutEverywhereTime)
             AND (SELECT COUNT(*) FROM webknossos.tokens d WHERE d.value = $1 AND NOT d.isDeleted) = 1
           FOR UPDATE OF t"#,
    )
    .bind(token)
    .fetch_optional(&mut *tx)
    .await?;
    let (_, multi_user_id) =
        target.ok_or_else(|| ApiError::bad_request(messages::TOKEN_INVALID))?;
    let hash = hash_password(password).await?;
    sqlx::query(
        "UPDATE webknossos.multiUsers SET passwordInfo_hasher = 'SCrypt', passwordInfo_password = $2 WHERE _id = $1",
    )
    .bind(&multi_user_id)
    .bind(&hash)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE webknossos.tokens SET isDeleted = TRUE WHERE value = $1")
        .bind(token)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tracing::info!(multi_user = %multi_user_id, "Multiuser reset their password.");
    Ok(StatusCode::OK)
}

async fn change_password(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    secured: Secured,
    FormBody(data): FormBody,
) -> ApiResult<StatusCode> {
    let mut form = Form::new(&data);
    let old_password = form.non_empty("oldPassword");
    let password = form.new_password("password");
    form.finish()?;
    let mut tx = state.pool.begin().await?;
    let (multi_user_id, hasher, current_hash, email, name): (
        String,
        String,
        String,
        String,
        String,
    ) = sqlx::query_as(
        r#"SELECT m._id, m.passwordInfo_hasher::text, m.passwordInfo_password, m.email,
                 m.firstName || ' ' || m.lastName
               FROM webknossos.multiUsers_ m JOIN webknossos.users_ u ON u._multiUser = m._id
               WHERE u._id = $1 FOR UPDATE OF m"#,
    )
    .bind(&secured.user.id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthorized)?;
    if !verify_password(old_password, &hasher, current_hash).await {
        return Err(ApiError::bad_request(messages::INVALID_CREDENTIALS));
    }
    let hash = hash_password(password).await?;
    sqlx::query(
        "UPDATE webknossos.multiUsers SET passwordInfo_hasher = 'SCrypt', passwordInfo_password = $2 WHERE _id = $1",
    )
    .bind(&multi_user_id)
    .bind(&hash)
    .execute(&mut *tx)
    .await?;
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
    Extension(config): Extension<BrowserAuthConfig>,
    headers: HeaderMap,
    secured: Secured,
    Query(query): Query<SwitchQuery>,
) -> ApiResult<Response> {
    if !secured.user.is_superuser {
        return Err(ApiError::forbidden(messages::NOT_AUTHENTICATED));
    }
    signer_secret(&config)?;
    let mut tx = state.pool.begin().await?;
    let (target, _, _) = identity_for_email(&mut tx, &query.to)
        .await?
        .ok_or_else(|| ApiError::not_found(messages::USER_NOT_FOUND))?;
    discard_bearer_token(&mut tx, &secured).await?;
    let cookie = issue_cookie(&config, &headers, &target)?;
    tx.commit().await?;
    tracing::info!(user = %secured.user.id, target = %target, "Superuser switched identity.");
    Ok(switch_response(cookie))
}

async fn switch_organization(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    headers: HeaderMap,
    secured: Secured,
    Path(organization_id): Path<String>,
) -> ApiResult<Response> {
    signer_secret(&config)?;
    let mut tx = state.pool.begin().await?;
    let multi_user_id: String = sqlx::query_scalar(
        "SELECT m._id FROM webknossos.multiUsers_ m JOIN webknossos.users_ u ON u._multiUser = m._id WHERE u._id = $1 FOR UPDATE OF m",
    )
    .bind(&secured.user.id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthorized)?;
    // OrganizationDAO read access: the account's organizations, or superuser.
    let accessible: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM webknossos.organizations_ o WHERE o._id = $1
             AND ($3 OR o._id IN (SELECT _organization FROM webknossos.users_ WHERE _multiUser = $2)))"#,
    )
    .bind(&organization_id)
    .bind(&multi_user_id)
    .bind(secured.user.is_superuser)
    .fetch_one(&mut *tx)
    .await?;
    if !accessible {
        return Err(ApiError::not_found(format!(
            "Organization “{organization_id}” could not be found or accessed."
        )));
    }
    let existing: Option<(String, bool)> = sqlx::query_as(
        "SELECT _id, isDeactivated FROM webknossos.users_ WHERE _multiUser = $1 AND _organization = $2",
    )
    .bind(&multi_user_id)
    .bind(&organization_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (target, deactivated) = match existing {
        Some(existing) => existing,
        None if secured.user.is_superuser => {
            // fillSuperUserIdentity: an unlisted admin identity.
            let team: Option<String> = sqlx::query_scalar(
                "SELECT _id FROM webknossos.organizationTeams WHERE _organization = $1 LIMIT 1",
            )
            .bind(&organization_id)
            .fetch_optional(&mut *tx)
            .await?;
            let teams: Vec<(String, bool)> = team.into_iter().map(|team| (team, false)).collect();
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
        None => return Err(ApiError::not_found(messages::USER_NOT_FOUND)),
    };
    if deactivated {
        return Err(ApiError::bad_request(messages::IS_DEACTIVATED));
    }
    discard_bearer_token(&mut tx, &secured).await?;
    let cookie = issue_cookie(&config, &headers, &target)?;
    sqlx::query("UPDATE webknossos.multiUsers SET _lastLoggedInIdentity = $2 WHERE _id = $1")
        .bind(&multi_user_id)
        .bind(&target)
        .execute(&mut *tx)
        .await?;
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
            dataset_access::can_read(pool, Some(identity), id.as_str(), None).await?
        }
        Target::Annotation(id) => {
            match annotation_access::find(pool, Some(identity), id.as_str(), true).await {
                Ok(annotation) => {
                    annotation.state != "Cancelled"
                        && annotation_access::restrictions(&annotation, Some(identity)).allow_access
                }
                Err(error) if error.status == StatusCode::NOT_FOUND => false,
                Err(error) => return Err(error),
            }
        }
        Target::Workflow(hash) => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM webknossos.voxelytics_workflows WHERE _organization = $1 AND hash = $2)",
        )
        .bind(&identity.organization_id)
        .bind(hash)
        .fetch_one(pool)
        .await?,
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
    let not_found = || ApiError::bad_request("Could not find or access the requested resource.");
    let organization: String = if user.is_superuser {
        let found: Option<String> = match &target {
            Target::Dataset(id) => sqlx::query_scalar(
                "SELECT o._id FROM webknossos.datasets_ d JOIN webknossos.organizations_ o ON o._id = d._organization WHERE d._id = $1",
            )
            .bind(id.as_str())
            .fetch_optional(&state.pool)
            .await?,
            Target::Annotation(id) => sqlx::query_scalar(
                r#"SELECT o._id FROM webknossos.annotations_ a JOIN webknossos.users_ u ON u._id = a._user
                   JOIN webknossos.organizations_ o ON o._id = u._organization WHERE a._id = $1"#,
            )
            .bind(id.as_str())
            .fetch_optional(&state.pool)
            .await?,
            Target::Workflow(hash) => sqlx::query_scalar(
                r#"SELECT o._id FROM webknossos.voxelytics_workflows w
                   JOIN webknossos.organizations_ o ON o._id = w._organization
                   WHERE w.hash = $1 ORDER BY w._organization LIMIT 1"#,
            )
            .bind(hash)
            .fetch_optional(&state.pool)
            .await?,
        };
        found.ok_or_else(not_found)?
    } else {
        let identities: Vec<AuthUser> = sqlx::query_as(
            r#"SELECT u._id AS id, u._organization AS organization_id, u.isAdmin AS is_admin,
                 u.isDatasetManager AS is_dataset_manager, FALSE AS is_superuser
               FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._multiUser = (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1)
               ORDER BY u.created, u._id"#,
        )
        .bind(&user.id)
        .fetch_all(&state.pool)
        .await?;
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
        organizations::public_json(&state.pool, &organization, None, false, false).await?,
    ))
}

async fn verify_email(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<StatusCode> {
    use verification_messages as msg;
    let mut tx = state.pool.begin().await?;
    let key_row: Option<(String, String, String, bool, bool)> = sqlx::query_as(
        r#"SELECT _id, email, _multiUser, isUsed,
             validUntil IS NOT NULL AND validUntil <= statement_timestamp()
           FROM webknossos.emailVerificationKeys WHERE key = $1 ORDER BY _id LIMIT 1 FOR UPDATE"#,
    )
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?;
    let (key_id, key_email, multi_user_id, is_used, expired) =
        key_row.ok_or_else(|| ApiError::bad_request(msg::KEY_INVALID))?;
    let (email, verified): (String, bool) = sqlx::query_as(
        "SELECT email, isEmailVerified FROM webknossos.multiUsers_ WHERE _id = $1 FOR UPDATE",
    )
    .bind(&multi_user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::bad_request(messages::USER_NOT_FOUND))?;
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
    sqlx::query("UPDATE webknossos.multiUsers SET isEmailVerified = TRUE WHERE _id = $1")
        .bind(&multi_user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE webknossos.emailVerificationKeys SET isUsed = TRUE WHERE _id = $1")
        .bind(&key_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::OK)
}

async fn request_verification_mail(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    user: AuthUser,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let multi_user_id: String =
        sqlx::query_scalar("SELECT _multiUser FROM webknossos.users_ WHERE _id = $1")
            .bind(&user.id)
            .fetch_one(&mut *tx)
            .await?;
    let mail = create_email_verification(&mut tx, &config, &multi_user_id).await?;
    tx.commit().await?;
    mailer.send(mail);
    Ok(StatusCode::OK)
}
