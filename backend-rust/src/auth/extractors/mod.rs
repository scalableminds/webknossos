use axum::extract::{FromRequestParts, Query};
use axum::http::{header::AUTHORIZATION, request::Parts};
use sqlx::PgPool;

use crate::AppState;
use crate::auth::dao;
use crate::error::{ApiError, ApiResult};
use crate::util::id::ObjectId;

#[derive(Clone, sqlx::FromRow)]
pub struct AuthUser {
    pub id: ObjectId,
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
    Cookie(Box<crate::auth::browser::CookieAuthenticator>),
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
    use crate::auth::browser::{CookieOutcome, authenticate_cookie};
    match authenticate_cookie(parts, &state.pool, &state.browser_auth).await? {
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

pub async fn authenticate(pool: &PgPool, token: &str) -> ApiResult<AuthUser> {
    dao::find_one_and_touch_for_authentication(pool, token)
        .await?
        .ok_or_else(ApiError::unauthorized)
}

pub async fn user_for_service_token(
    pool: &sqlx::PgPool,
    token: &str,
) -> ApiResult<Option<AuthUser>> {
    Ok(dao::find_user_for_service_token(pool, token).await?)
}

impl AuthUser {
    pub async fn is_team_manager_or_admin(&self, pool: &PgPool) -> ApiResult<bool> {
        if self.is_admin {
            return Ok(true);
        }
        Ok(dao::is_team_manager_in_organization(pool, &self.id, &self.organization_id).await?)
    }

    pub async fn can_manage_team(&self, pool: &PgPool, team_id: &ObjectId) -> ApiResult<bool> {
        Ok(dao::can_manage_team(
            pool,
            team_id,
            &self.organization_id,
            self.is_admin,
            &self.id,
        )
        .await?)
    }
}

#[cfg(test)]
mod tests;
