use crate::{
    AppState,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    util::id::ObjectId,
};
use axum::{
    Extension, Json as ResponseJson, Router,
    extract::State,
    routing::{get, post},
};
use serde::Serialize;
use url::Url;

#[derive(Clone)]
pub struct PublicUrl(pub Url);

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ShortLink {
    #[serde(rename = "_id")]
    _id: String,
    key: String,
    long_link: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/shortLinks", post(create))
        .route("/shortLinks/byKey/{key}", get(read))
}

fn validate_link(base: &Url, value: &str) -> ApiResult<()> {
    let link = Url::parse(value).map_err(|_| ApiError::bad_request("Invalid short link URL."))?;
    let base_path = base.path().trim_end_matches('/');
    // A string prefix check would accept https://webknossos.org.attacker.example.
    if link.origin() != base.origin()
        || !link.username().is_empty()
        || link.password().is_some()
        || !(link.path() == base_path || link.path().starts_with(&format!("{base_path}/")))
    {
        return Err(ApiError::bad_request(
            "Could not generate short link: URI does not match.",
        ));
    }
    Ok(())
}

async fn create(
    State(state): State<AppState>,
    Extension(PublicUrl(base)): Extension<PublicUrl>,
    Json(link): Json<String>,
) -> ApiResult<ResponseJson<ShortLink>> {
    validate_link(&base, &link)?;
    // UUID's random tail supplies 70 random bits; the other two are variant bits.
    let bytes = *uuid::Uuid::new_v4().as_bytes();
    let key: String = bytes[7..16].iter().map(|b| format!("{b:02x}")).collect();
    let result = sqlx::query_as("INSERT INTO webknossos.shortLinks (_id,key,longLink) VALUES ($1,$2,$3) RETURNING _id,key,longLink AS long_link")
        .bind(ObjectId::new().as_str()).bind(key).bind(link).fetch_one(&state.pool).await?;
    Ok(ResponseJson(result))
}
async fn read(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<ResponseJson<ShortLink>> {
    let result = sqlx::query_as(
        "SELECT _id,key,longLink AS long_link FROM webknossos.shortLinks WHERE key=$1",
    )
    .bind(key)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Short link not found."))?;
    Ok(ResponseJson(result))
}

#[cfg(test)]
#[path = "short_links_tests.rs"]
mod tests;
