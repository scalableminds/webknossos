//! OrganizationController.updatePartner: assigns an organization to a partner, which
//! co-brands WEBKNOSSOS for it (navbar logo, partner-only pretrained AI models).
pub(crate) mod organization_partner_dao;

use axum::{Json as ResponseJson, Router, extract::State, routing::put};
use serde::Deserialize;
use serde_json::Value;

use super::{organization_dao, routes::public_json};
use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    util::id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/organizations/{id}/partner", put(update_partner))
}

/// OrganizationPartnerParameters: a missing or null `partnerId` removes the assignment.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrganizationPartnerParameters {
    #[serde(default)]
    partner_id: Option<ObjectId>,
}

async fn update_partner(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<OrganizationPartnerParameters>,
) -> ApiResult<ResponseJson<Value>> {
    if !user.is_superuser {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let mut tx = state.pool.begin().await?;
    // Super users can read every live organization.
    if !organization_dao::exists(&mut *tx, &id).await? {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            &id,
        )));
    }
    if let Some(partner_id) = &parameters.partner_id
        && !organization_partner_dao::exists(&mut *tx, partner_id).await?
    {
        return Err(ApiError::not_found(crate::msg::partner::NOT_FOUND));
    }
    organization_dao::update_partner(&mut tx, &id, parameters.partner_id.as_ref()).await?;
    tracing::info!(
        "Super user {} set the partner of organization {} to {}",
        user.id,
        id,
        parameters
            .partner_id
            .as_ref()
            .map_or("none", ObjectId::as_str)
    );
    // Super users have credit-read access; administrator fields only for admins of `id`.
    let value = public_json(
        &mut *tx,
        &id,
        Some(&user.organization_id),
        user.is_admin,
        true,
    )
    .await?;
    tx.commit().await?;
    Ok(ResponseJson(value))
}

#[cfg(test)]
mod organization_partner_tests;
