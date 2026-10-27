pub(crate) mod dao;

use crate::{
    AppState,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    util::id::ObjectId,
};
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    routing::{get, post},
};
use serde::Serialize;
use url::Url;

#[derive(Clone)]
pub struct PublicUrl(pub Url);

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShortLink {
    #[serde(rename = "_id")]
    _id: ObjectId,
    key: String,
    long_link: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/shortLinks", post(create))
        .route("/shortLinks/byKey/{key}", get(read))
}

fn validate_link(base: &Url, value: &str) -> ApiResult<()> {
    let link = Url::parse(value)
        .map_err(|_| ApiError::bad_request(crate::msg::short_link::INVALID_URL))?;
    // Like Play: the raw link must start with the configured URI plus exactly one trailing slash.
    let required_prefix = format!("{}/", base.as_str().trim_end_matches('/'));
    if !value.starts_with(&required_prefix) {
        return Err(ApiError::bad_request(crate::msg::short_link::URI_MISMATCH));
    }
    let base_path = base.path().trim_end_matches('/');
    // A string prefix check would accept https://webknossos.org.attacker.example.
    if link.origin() != base.origin()
        || !link.username().is_empty()
        || link.password().is_some()
        || !(link.path() == base_path || link.path().starts_with(&format!("{base_path}/")))
    {
        return Err(ApiError::bad_request(crate::msg::short_link::URI_MISMATCH));
    }
    Ok(())
}

async fn create(
    State(state): State<AppState>,
    State(PublicUrl(base)): State<PublicUrl>,
    Json(link): Json<String>,
) -> ApiResult<ResponseJson<ShortLink>> {
    validate_link(&base, &link)?;
    // UUID's random tail supplies 70 random bits; the other two are variant bits.
    let bytes = *uuid::Uuid::new_v4().as_bytes();
    let key: String = bytes[7..16].iter().map(|b| format!("{b:02x}")).collect();
    let result = dao::insert_one(&state.pool, ObjectId::new(), key, link).await?;
    Ok(ResponseJson(result))
}
async fn read(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<ResponseJson<ShortLink>> {
    let result = dao::find_one_by_key(&state.pool, key)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::SHORT_LINK_NOT_FOUND))?;
    Ok(ResponseJson(result))
}

#[cfg(test)]
mod tests;
