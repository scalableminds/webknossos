use axum::extract::{FromRequestParts, Query};
use axum::http::{header::AUTHORIZATION, request::Parts};
use sqlx::PgPool;

use crate::AppState;
use crate::error::{ApiError, ApiResult};

#[derive(Clone, sqlx::FromRow)]
pub struct AuthUser {
    pub id: String,
    pub organization_id: String,
    pub is_admin: bool,
    pub is_dataset_manager: bool,
    pub is_superuser: bool,
}

pub struct OptionalAuthUser(pub Option<AuthUser>);

/// The credential that authenticated a request.
#[derive(Clone)]
pub enum AuthCredential {
    Token(String),
    Cookie(Box<crate::browser_auth::CookieAuthenticator>),
}

fn has_token_transport(parts: &Parts) -> ApiResult<bool> {
    let Query(query) = Query::<Vec<(String, String)>>::try_from_uri(&parts.uri)
        .map_err(|_| ApiError::unauthorized())?;
    Ok(parts.headers.contains_key("x-auth-token")
        || parts.headers.contains_key(AUTHORIZATION)
        || query.iter().any(|(key, _)| key == "token"))
}

/// CombinedAuthenticatorService.retrieve: a valid signed browser cookie takes
/// priority over bearer credentials. A signed cookie that yields no identity
/// (expired, inactive user) suppresses bearer credentials, as in Play. Absent
/// any credential this returns `None`; an explicit invalid bearer credential
/// is an error.
pub async fn authenticate_request(
    parts: &Parts,
    state: &AppState,
) -> ApiResult<Option<(AuthUser, AuthCredential)>> {
    use crate::browser_auth::{CookieOutcome, authenticate_cookie};
    match authenticate_cookie(parts, &state.pool).await? {
        CookieOutcome::Authenticated(user, cookie) => {
            return Ok(Some((*user, AuthCredential::Cookie(cookie))));
        }
        CookieOutcome::Rejected => return Ok(None),
        CookieOutcome::Absent => {}
    }
    if !has_token_transport(parts)? {
        return Ok(None);
    }
    let token = extract_token(parts)?;
    let user = authenticate(&state.pool, &token).await?;
    Ok(Some((user, AuthCredential::Token(token))))
}

impl FromRequestParts<AppState> for OptionalAuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        Ok(Self(
            authenticate_request(parts, state)
                .await?
                .map(|(user, _)| user),
        ))
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        authenticate_request(parts, state)
            .await?
            .map(|(user, _)| user)
            .ok_or_else(ApiError::unauthorized)
    }
}

pub(crate) fn extract_token(parts: &Parts) -> ApiResult<String> {
    let mut candidates = Vec::new();
    for value in parts.headers.get_all("x-auth-token") {
        let token = value.to_str().map_err(|_| ApiError::unauthorized())?;
        candidates.push(token.to_owned());
    }
    for value in parts.headers.get_all(AUTHORIZATION) {
        let value = value.to_str().map_err(|_| ApiError::unauthorized())?;
        let (scheme, token) = value.split_once(' ').ok_or_else(ApiError::unauthorized)?;
        if !scheme.eq_ignore_ascii_case("Bearer") {
            return Err(ApiError::unauthorized());
        }
        candidates.push(token.to_owned());
    }
    let Query(query) = Query::<Vec<(String, String)>>::try_from_uri(&parts.uri)
        .map_err(|_| ApiError::unauthorized())?;
    candidates.extend(
        query
            .into_iter()
            .filter(|(key, _)| key == "token")
            .map(|(_, value)| value),
    );
    let token = candidates.first().ok_or_else(ApiError::unauthorized)?;
    if token.is_empty()
        || token.chars().any(char::is_whitespace)
        || candidates.iter().any(|candidate| candidate != token)
    {
        return Err(ApiError::unauthorized());
    }
    Ok(token.clone())
}

/// Authenticate and touch the token in one statement. Invalid or revoked tokens are
/// never touched, and overlapping requests cannot move lastUsedDateTime backwards.
pub async fn authenticate(pool: &PgPool, token: &str) -> ApiResult<AuthUser> {
    let user = sqlx::query_as::<_, AuthUser>(
        r#"
        UPDATE webknossos.tokens AS token
        SET lastUsedDateTime = GREATEST(token.lastUsedDateTime, statement_timestamp())
        FROM webknossos.users AS usr
        JOIN webknossos.multiUsers AS multi ON multi._id = usr._multiUser
        JOIN webknossos.organizations AS org ON org._id = usr._organization
        WHERE token.value = $1
          AND token._user = usr._id
          AND NOT token.isDeleted
          AND token.tokenType IN ('Authentication', 'DataStore', 'Job')
          AND token.expirationDateTime > statement_timestamp()
          AND (token.idleTimeout IS NULL OR (
            token.idleTimeout > 0 AND
            EXTRACT(EPOCH FROM (statement_timestamp() - token.lastUsedDateTime)) * 1000
              < token.idleTimeout
          ))
          AND NOT usr.isDeleted AND NOT usr.isDeactivated
          AND NOT multi.isDeleted AND NOT org.isDeleted
          AND (usr.loggedOutEverywhereTime IS NULL
            OR token.created > usr.loggedOutEverywhereTime)
          AND (SELECT COUNT(*) FROM webknossos.tokens AS matching
            WHERE matching.value = $1 AND NOT matching.isDeleted) = 1
        RETURNING usr._id AS id, usr._organization AS organization_id,
          usr.isAdmin AS is_admin, usr.isDatasetManager AS is_dataset_manager,
          multi.isSuperUser AS is_superuser
        "#,
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;
    user.ok_or_else(ApiError::unauthorized)
}

pub async fn user_for_service_token(
    pool: &sqlx::PgPool,
    token: &str,
) -> ApiResult<Option<AuthUser>> {
    // WebknossosBearerTokenAuthenticatorService.userForToken is a read-only
    // lookup accepting any valid token type, including ResetPassword and Job.
    // This is an explicit query-userToken-only exception to AuthUser extraction,
    // which admits Authentication/DataStore/Job. It does not touch lastUsedDateTime.
    // Account-revocation checks match the Rust authentication boundary.
    let user=sqlx::query_as(r#"SELECT u._id AS id,u._organization AS organization_id,u.isAdmin AS is_admin,u.isDatasetManager AS is_dataset_manager,m.isSuperUser AS is_superuser
        FROM webknossos.tokens_ token JOIN webknossos.users_ u ON u._id=token._user
        JOIN webknossos.multiUsers_ m ON m._id=u._multiUser JOIN webknossos.organizations_ organization ON organization._id=u._organization
        WHERE token.value=$1 AND token.expirationDateTime>statement_timestamp() AND NOT u.isDeactivated
        AND (token.idleTimeout IS NULL OR (token.idleTimeout>0 AND extract(epoch FROM (statement_timestamp()-token.lastUsedDateTime))*1000<token.idleTimeout))
        AND (u.loggedOutEverywhereTime IS NULL OR token.created>u.loggedOutEverywhereTime)
        AND (SELECT count(*) FROM webknossos.tokens_ duplicate WHERE duplicate.value=$1)=1"#)
        .bind(token).fetch_optional(pool).await?;
    Ok(user)
}

impl AuthUser {
    pub async fn is_team_manager_or_admin(&self, pool: &PgPool) -> ApiResult<bool> {
        if self.is_admin {
            return Ok(true);
        }
        Ok(sqlx::query_scalar(
            r#"SELECT EXISTS (
              SELECT 1 FROM webknossos.user_team_roles AS role
              JOIN webknossos.teams_ AS team ON team._id = role._team
              WHERE role._user = $1 AND role.isTeamManager AND team._organization = $2
            )"#,
        )
        .bind(&self.id)
        .bind(&self.organization_id)
        .fetch_one(pool)
        .await?)
    }

    pub async fn can_manage_team(&self, pool: &PgPool, team_id: &str) -> ApiResult<bool> {
        Ok(sqlx::query_scalar(
            r#"SELECT EXISTS (
              SELECT 1 FROM webknossos.teams_ AS team
              WHERE team._id = $1 AND team._organization = $2
                AND ($3 OR EXISTS (
                  SELECT 1 FROM webknossos.user_team_roles AS role
                  WHERE role._team = team._id AND role._user = $4 AND role.isTeamManager
                ))
            )"#,
        )
        .bind(team_id)
        .bind(&self.organization_id)
        .bind(self.is_admin)
        .bind(&self.id)
        .fetch_one(pool)
        .await?)
    }
}

#[cfg(test)]
mod tests {
    use super::extract_token;
    use axum::http::Request;

    #[test]
    fn supports_each_transport_and_percent_decodes_legacy_tokens() {
        for request in [
            Request::builder().header("x-auth-token", "abc").body(()),
            Request::builder()
                .header("Authorization", "Bearer abc")
                .body(()),
            Request::builder().uri("/api?token=a%2Bb").body(()),
        ] {
            let (parts, _) = request.unwrap().into_parts();
            assert!(matches!(
                extract_token(&parts).as_deref(),
                Ok("abc" | "a+b")
            ));
        }
    }

    #[test]
    fn rejects_missing_malformed_or_ambiguous_credentials() {
        for request in [
            Request::builder().body(()),
            Request::builder().header("x-auth-token", "").body(()),
            Request::builder()
                .header("Authorization", "Basic abc")
                .body(()),
            Request::builder()
                .header("Authorization", "Bearer ")
                .body(()),
            Request::builder().header("x-auth-token", "a b").body(()),
            Request::builder()
                .header("x-auth-token", "abc")
                .uri("/api?token=other")
                .body(()),
            Request::builder()
                .uri("/api?token=abc&token=other")
                .body(()),
        ] {
            let (parts, _) = request.unwrap().into_parts();
            assert!(extract_token(&parts).is_err());
        }
    }
}
