use axum::{
    Json as ResponseJson, Router,
    extract::{FromRequestParts, State},
    http::{HeaderValue, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::{PgPool, Postgres};

use super::{
    credit_transactions::organization_credit_transactions_dao::hand_out_monthly_free_credits,
    organization_dao,
};

use crate::{
    AppState,
    auth::browser::onboarding::{insert_organization, join_organization_as},
    auth::{AuthCredential, AuthUser, OptionalAuthUser, authenticate_request},
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    system::application_info::MiscState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/organizations", get(list).post(create))
        .route("/organizations/default", get(default_organization))
        .route("/organizations/byInvite/{token}", get(by_invite))
        .route(
            "/organizations/{id}",
            get(read).patch(update).delete(delete),
        )
        .route("/organizationsIsEmpty", get(is_empty))
}

async fn credit_read_access(pool: &PgPool, user: &AuthUser) -> ApiResult<bool> {
    if user.is_admin || user.is_dataset_manager || user.is_superuser {
        return Ok(true);
    }
    user.is_team_manager_or_admin(pool).await
}

pub(crate) async fn public_json<'e, E: sqlx::Executor<'e, Database = Postgres>>(
    executor: E,
    id: &str,
    requesting_organization: Option<&str>,
    is_admin: bool,
    credit_access: bool,
) -> ApiResult<Value> {
    organization_dao::find_one_public_json(
        executor,
        id,
        requesting_organization,
        is_admin,
        credit_access,
    )
    .await?
    // OrganizationController.get has no explicit message: Fox falls back to Msg.notFound.
    .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))
}

async fn read(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let credit_access = if let Some(user) = &user {
        credit_read_access(&state.pool, user).await?
    } else {
        false
    };
    Ok(ResponseJson(
        public_json(
            &state.pool,
            &id,
            user.as_ref().map(|u| u.organization_id.as_str()),
            user.as_ref().is_some_and(|u| u.is_admin),
            credit_access,
        )
        .await?,
    ))
}

#[derive(Default, Deserialize)]
struct ListParameters {
    compact: Option<bool>,
}
async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(parameters): Query<ListParameters>,
) -> ApiResult<ResponseJson<Value>> {
    // Organization membership belongs to the account, not only the current
    // identity. Superusers can list every organization.
    let values: Vec<Value> = if parameters.compact.unwrap_or(false) {
        organization_dao::find_all_compact_for_user(&state.pool, &user.id, user.is_superuser)
            .await?
    } else {
        organization_dao::find_all_public_json_for_user(&state.pool, &user.id, user.is_superuser)
            .await?
    };
    Ok(ResponseJson(Value::Array(values)))
}

async fn default_organization(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let ids = organization_dao::find_up_to_two_ids(&state.pool).await?;
    match ids.as_slice() {
        [] => Err(ApiError::bad_request(crate::msg::organization::LIST_FAILED)),
        [id] => {
            let credit_access = if let Some(user) = &user {
                credit_read_access(&state.pool, user).await?
            } else {
                false
            };
            Ok(ResponseJson(
                public_json(
                    &state.pool,
                    id,
                    user.as_ref().map(|u| u.organization_id.as_str()),
                    user.as_ref().is_some_and(|u| u.is_admin),
                    credit_access,
                )
                .await?,
            ))
        }
        _ => Ok(ResponseJson(Value::Null)),
    }
}
async fn by_invite(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    // This route intentionally stays anonymous, matching the plain Action.
    let organization = organization_dao::find_organization_id_by_invite_token(&state.pool, token)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    Ok(ResponseJson(
        public_json(&state.pool, &organization, None, false, false).await?,
    ))
}
async fn is_empty(State(state): State<AppState>) -> ApiResult<ResponseJson<bool>> {
    Ok(ResponseJson(organization_dao::is_empty(&state.pool).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrganizationParameters {
    name: String,
    new_user_mailing_list: String,
}
async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<OrganizationParameters>,
) -> ApiResult<ResponseJson<Value>> {
    let mut tx = state.pool.begin().await?;
    let accessible =
        organization_dao::is_accessible(&mut tx, &id, &user.id, user.is_superuser).await?;
    if !accessible {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            &id,
        )));
    }
    if !user.is_admin || user.organization_id != id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let updated = organization_dao::update_name_and_new_user_mailing_list(
        &mut tx,
        &id,
        parameters.name,
        parameters.new_user_mailing_list,
    )
    .await?;
    if updated == 0 {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            &id,
        )));
    }
    let value = public_json(&mut *tx, &id, Some(&user.organization_id), true, true).await?;
    tx.commit().await?;
    Ok(ResponseJson(value))
}

// ---------------------------------------------------------------------------
// POST /organizations (superuser-only creation for an existing account)

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrganizationCreationParameters {
    organization: Option<String>,
    organization_name: String,
    owner_email: String,
}

async fn create(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    user: AuthUser,
    Json(parameters): Json<OrganizationCreationParameters>,
) -> ApiResult<Response> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    // Play runs these steps without a transaction; a late failure here
    // leaves no half-created organization behind.
    let mut tx = state.pool.begin().await?;
    let owner =
        organization_dao::find_multi_user_id_by_email_for_update(&mut tx, &parameters.owner_email)
            .await?
            .ok_or_else(|| ApiError::bad_request(crate::msg::user::NOT_FOUND_NO_ID))?;
    let (organization_id, team) = insert_organization(
        &mut tx,
        misc.config().is_wkorg_instance,
        parameters.organization.as_deref(),
        &parameters.organization_name,
    )
    .await?;
    let original = organization_dao::find_first_user_id_by_multi_user(&mut tx, &owner)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    join_organization_as(
        &mut tx,
        &original,
        &organization_id,
        true,
        true,
        false,
        false,
        true,
        &[(team, false)],
    )
    .await?;
    hand_out_monthly_free_credits(&mut tx, misc.config().monthly_free_milli_credits).await?;
    tx.commit().await?;
    tracing::info!(organization = %organization_id, "Created organization.");
    Ok((
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; charset=utf-8"),
        )],
        organization_id,
    )
        .into_response())
}

// ---------------------------------------------------------------------------
// DELETE /organizations/:id

/// The authenticated identity together with the credential, which deletion
/// discards like Silhouette's `discard`.
struct AuthWithCredential(AuthUser, AuthCredential);

impl FromRequestParts<AppState> for AuthWithCredential {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        let (user, credential) = authenticate_request(parts, state)
            .await?
            .ok_or_else(ApiError::unauthorized)?;
        Ok(Self(user, credential))
    }
}

async fn delete(
    State(state): State<AppState>,
    AuthWithCredential(user, credential): AuthWithCredential,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let mut tx = state.pool.begin().await?;
    let accessible =
        organization_dao::is_accessible_not_deleted(&mut tx, &id, &user.id, user.is_superuser)
            .await?;
    if !accessible {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            &id,
        )));
    }
    if !user.is_admin || user.organization_id != id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    tracing::info!(organization = %id, "Deleting organization");
    let deleted = organization_dao::mark_deleted(&mut tx, &id).await?;
    if deleted == 0 {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            &id,
        )));
    }
    organization_dao::mark_users_deleted(&mut tx, &id).await?;
    organization_dao::clear_last_logged_in_identities(&mut tx, &id).await?;
    // combinedAuthenticatorService.discard: a bearer token is revoked; Play
    // drops the discard result, so no cookie-clearing header is sent.
    if let AuthCredential::Token(token) = &credential {
        organization_dao::mark_token_deleted(&mut tx, token).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::OK.into_response())
}
