use axum::{
    Extension, Json as ResponseJson, Router,
    extract::{FromRequestParts, State},
    http::{HeaderValue, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::{PgPool, Postgres};

use crate::{
    AppState,
    auth::browser::onboarding::{insert_organization, join_organization_as},
    auth::{AuthCredential, AuthUser, OptionalAuthUser, authenticate_request},
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    sql::Sql,
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

/// OrganizationService.publicWrites for alias `o`; callers append the
/// `WHERE` clause. It includes milliCreditBalance for members of the
/// requesting identity's organization, and the credit DAO returns zero to
/// members lacking billing (credit-read) access. Administrator fields only
/// for administrators of the requesting organization.
fn select_public<'a>(
    requesting_organization: Option<&'a str>,
    is_admin: bool,
    credit_access: bool,
) -> Sql<'a> {
    let mut q = Sql::new(
        r#"SELECT jsonb_build_object(
 'id',o._id,'name',o.name,'additionalInformation',o.additionalinformation,'enableAutoVerify',o.enableautoverify,
 'pricingPlan',o.pricingplan,'aiPlan',o.aiplan,'paidUntil',floor(extract(epoch FROM o.paiduntil)*1000)::bigint,
 'includedUsers',o.includedusers,'includedStorageBytes',o.includedstorage,
 'usedStorageBytes',(SELECT COALESCE(sum(usedstoragebytes),0)::bigint FROM (
    SELECT usedstoragebytes FROM webknossos.organization_usedstorage_mags WHERE _organization=o._id
    UNION ALL SELECT usedstoragebytes FROM webknossos.organization_usedstorage_attachments WHERE _organization=o._id
 ) storage),
 'ownerName',(SELECT m.firstname || ' ' || m.lastname FROM webknossos.users_ u
    JOIN webknossos.multiusers_ m ON m._id=u._multiuser WHERE u._organization=o._id AND u.isorganizationowner AND NOT u.isdeactivated LIMIT 1),
 'milliCreditBalance',CASE WHEN o._id="#,
    );
    q.push_bind(requesting_organization)
        .push(
            r#" THEN (SELECT COALESCE(sum(milli_credit_delta),0)::bigint
    FROM webknossos.credit_transactions_ WHERE _organization=o._id AND "#,
        )
        .push_bind(credit_access)
        .push(") ELSE NULL END\n) || CASE WHEN o._id=")
        .push_bind(requesting_organization)
        .push(" AND ")
        .push_bind(is_admin)
        .push(
            r#" THEN jsonb_build_object(
 'newUserMailingList',o.newusermailinglist,
 'lastTermsOfServiceAcceptanceTime',floor(extract(epoch FROM o.lasttermsofserviceacceptancetime)*1000)::bigint,
 'lastTermsOfServiceAcceptanceVersion',o.lasttermsofserviceacceptanceversion
) ELSE '{}'::jsonb END FROM webknossos.organizations_ o "#,
        );
    q
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
    let mut q = select_public(requesting_organization, is_admin, credit_access);
    q.push("WHERE o._id=").push_bind(id);
    q.build_query_scalar()
        .fetch_optional(executor)
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
        sqlx::query_scalar("SELECT jsonb_build_object('id',o._id,'name',o.name) FROM webknossos.organizations_ o WHERE ($2 OR o._id IN (SELECT _organization FROM webknossos.users_ WHERE _multiuser=(SELECT _multiuser FROM webknossos.users_ WHERE _id=$1))) ORDER BY o._id")
            .bind(&user.id)
            .bind(user.is_superuser)
            .fetch_all(&state.pool)
            .await?
    } else {
        // Scala deliberately calls publicWrites without requestingUser here,
        // so list responses never include administrator fields or balances.
        let mut q = select_public(None, false, false);
        q.push(" WHERE (")
            .push_bind(user.is_superuser)
            .push(
                " OR o._id IN (SELECT _organization FROM webknossos.users_ WHERE _multiuser=\
                 (SELECT _multiuser FROM webknossos.users_ WHERE _id=",
            )
            .push_bind(&user.id)
            .push("))) ORDER BY o._id");
        q.build_query_scalar().fetch_all(&state.pool).await?
    };
    Ok(ResponseJson(Value::Array(values)))
}

async fn default_organization(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT _id FROM webknossos.organizations_ LIMIT 2")
        .fetch_all(&state.pool)
        .await?;
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
    let organization: String = sqlx::query_scalar(
        "SELECT _organization FROM webknossos.invites_ WHERE tokenvalue=$1 AND \
            expirationdatetime>statement_timestamp() LIMIT 1",
    )
    .bind(token)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    Ok(ResponseJson(
        public_json(&state.pool, &organization, None, false, false).await?,
    ))
}
async fn is_empty(State(state): State<AppState>) -> ApiResult<ResponseJson<bool>> {
    Ok(ResponseJson(
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM webknossos.organizations_)")
            .fetch_one(&state.pool)
            .await?,
    ))
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
    let accessible: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.organizations_ o WHERE o._id=$1 AND ($3 \
            OR o._id IN(SELECT _organization FROM webknossos.users_ WHERE _multiuser=(SELECT \
            _multiuser FROM webknossos.users_ WHERE _id=$2))))",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(user.is_superuser)
    .fetch_one(&mut *tx)
    .await?;
    if !accessible {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            &id,
        )));
    }
    if !user.is_admin || user.organization_id != id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let updated = sqlx::query(
        "UPDATE webknossos.organizations SET name=$2,newusermailinglist=$3 WHERE _id=$1 \
            AND NOT isdeleted",
    )
    .bind(&id)
    .bind(parameters.name)
    .bind(parameters.new_user_mailing_list)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
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
    Extension(misc): Extension<MiscState>,
    user: AuthUser,
    Json(parameters): Json<OrganizationCreationParameters>,
) -> ApiResult<Response> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    // Play runs these steps without a transaction; a late failure here
    // leaves no half-created organization behind.
    let mut tx = state.pool.begin().await?;
    let owner: String =
        sqlx::query_scalar("SELECT _id FROM webknossos.multiUsers_ WHERE email = $1 FOR UPDATE")
            .bind(&parameters.owner_email)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| ApiError::bad_request(crate::msg::user::NOT_FOUND_NO_ID))?;
    let (organization_id, team) = insert_organization(
        &mut tx,
        misc.config().is_wkorg_instance,
        parameters.organization.as_deref(),
        &parameters.organization_name,
    )
    .await?;
    // userDAO.findFirstByMultiUser
    let original: String = sqlx::query_scalar(
        "SELECT _id FROM webknossos.users_ WHERE _multiUser = $1 AND NOT isDeactivated ORDER BY created, _id LIMIT 1",
    )
    .bind(&owner)
    .fetch_optional(&mut *tx)
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

/// CreditTransactionDAO.handOutMonthlyFreeCredits (`jobs.monthlyFreeMilliCredits`), shared by
/// organization creation and the credit ticker. The SQL function grants every organization
/// without a grant expiring next month, so repeated calls within one month are no-ops.
pub(crate) async fn hand_out_monthly_free_credits(
    connection: &mut sqlx::PgConnection,
    free_milli_credits: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT webknossos.hand_out_monthly_free_credits($1::INT)")
        .bind(free_milli_credits)
        .execute(connection)
        .await?;
    Ok(())
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
    let accessible: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.organizations o WHERE o._id=$1 AND NOT o.isDeleted AND ($3 OR o._id IN(SELECT _organization FROM webknossos.users_ WHERE _multiuser=(SELECT _multiuser FROM webknossos.users_ WHERE _id=$2))))",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(user.is_superuser)
    .fetch_one(&mut *tx)
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
    let deleted = sqlx::query(
        "UPDATE webknossos.organizations SET isDeleted = TRUE WHERE _id = $1 AND NOT isDeleted",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    if deleted.rows_affected() == 0 {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            &id,
        )));
    }
    sqlx::query("UPDATE webknossos.users SET isDeleted = TRUE WHERE _organization = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE webknossos.multiUsers SET _lastLoggedInIdentity = NULL WHERE _lastLoggedInIdentity IN (SELECT _id FROM webknossos.users WHERE _organization = $1)",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    // combinedAuthenticatorService.discard: a bearer token is revoked; Play
    // drops the discard result, so no cookie-clearing header is sent.
    if let AuthCredential::Token(token) = &credential {
        sqlx::query("UPDATE webknossos.tokens SET isDeleted = TRUE WHERE value = $1")
            .bind(token)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::OK.into_response())
}
