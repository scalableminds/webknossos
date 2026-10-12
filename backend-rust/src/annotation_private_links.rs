//! Owner-managed annotation private links and database-backed annotation sources.
use axum::{Json as ResponseJson, Router, extract::State, routing::get};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Executor, FromRow, Postgres};

use crate::{
    AppState, annotation_access,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/zarrPrivateLinks", get(list).post(create))
        .route(
            "/zarrPrivateLinks/byAnnotation/{annotationId}",
            get(by_annotation),
        )
        .route(
            "/zarrPrivateLinks/{id}",
            get(read).put(update).delete(delete),
        )
        .route("/annotations/source/{accessTokenOrId}", get(source))
}

#[derive(Deserialize)]
struct Parameters {
    annotation: ObjectId,
    #[serde(
        rename = "expirationDateTime",
        default,
        deserialize_with = "crate::instant::optional"
    )]
    expiration: Option<DateTime<Utc>>,
}

#[derive(FromRow)]
struct PrivateLink {
    id: String,
    annotation: String,
    access_token: String,
    expiration: Option<DateTime<Utc>>,
}
impl PrivateLink {
    fn public_json(self) -> Value {
        json!({"id":self.id,"annotation":self.annotation,"accessToken":self.access_token,"expirationDateTime":self.expiration.map(|date|date.timestamp_millis())})
    }
}
const SELECT: &str = "SELECT link._id AS id,link._annotation AS annotation,link.accessToken AS access_token,link.expirationDateTime AS expiration FROM webknossos.annotation_privateLinks link JOIN webknossos.annotations a ON a._id=link._annotation WHERE NOT link.isDeleted AND NOT a.isDeleted AND a._user=$1";
async fn owned_link<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
    user: &AuthUser,
    id: &str,
    lock: bool,
) -> ApiResult<PrivateLink> {
    ObjectId::parse(id)?;
    let suffix = if lock { " FOR UPDATE OF link" } else { "" };
    sqlx::query_as(&format!("{SELECT} AND link._id=$2{suffix}"))
        .bind(&user.id)
        .bind(id)
        .fetch_optional(executor)
        .await?
        .ok_or_else(|| ApiError::not_found("Annotation private link not found."))
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Vec<Value>>> {
    let links: Vec<PrivateLink> = sqlx::query_as(SELECT)
        .bind(&user.id)
        .fetch_all(&state.pool)
        .await?;
    Ok(ResponseJson(
        links.into_iter().map(PrivateLink::public_json).collect(),
    ))
}
async fn by_annotation(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Vec<Value>>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let links: Vec<PrivateLink> = sqlx::query_as(&format!("{SELECT} AND link._annotation=$2"))
        .bind(&user.id)
        .bind(id)
        .fetch_all(&state.pool)
        .await?;
    Ok(ResponseJson(
        links.into_iter().map(PrivateLink::public_json).collect(),
    ))
}
async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let link = owned_link(&state.pool, &user, &id, false).await?;
    if link
        .expiration
        .is_some_and(|expiration| expiration <= Utc::now())
    {
        return Err(ApiError::not_found(
            "Annotation private link token is expired.",
        ));
    }
    annotation_access::find(&state.pool, Some(&user), &link.annotation, false).await?;
    Ok(ResponseJson(link.public_json()))
}

fn token() -> ApiResult<String> {
    let mut bytes = [0; 12];
    getrandom::fill(&mut bytes).map_err(|_| ApiError::internal())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(parameters): Json<Parameters>,
) -> ApiResult<ResponseJson<Value>> {
    let mut tx = state.pool.begin().await?;
    let annotation =
        annotation_access::lock_for_mutation(&mut tx, &user, parameters.annotation.as_str())
            .await?;
    // The subsequent Scala link DAO lookup is owner-only. Keep insertion and
    // lookup atomic so a rejected request cannot leave an inaccessible link.
    if annotation.owner_id != user.id {
        return Err(ApiError::forbidden(
            "Only the annotation owner can manage its private links.",
        ));
    }
    let id = ObjectId::new().to_string();
    sqlx::query("INSERT INTO webknossos.annotation_privateLinks(_id,_annotation,accessToken,expirationDateTime) VALUES($1,$2,$3,$4)")
        .bind(&id).bind(parameters.annotation.as_str()).bind(token()?).bind(parameters.expiration).execute(&mut *tx).await?;
    let value = owned_link(&mut *tx, &user, &id, false).await?.public_json();
    tx.commit().await?;
    Ok(ResponseJson(value))
}
async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<Parameters>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut tx = state.pool.begin().await?;
    let link = owned_link(&mut *tx, &user, &id, true).await?;
    // Lock annotation references in id order to avoid rebind deadlocks.
    let mut annotation_ids = vec![link.annotation.as_str(), parameters.annotation.as_str()];
    annotation_ids.sort_unstable();
    annotation_ids.dedup();
    for annotation_id in annotation_ids {
        let annotation =
            annotation_access::lock_for_mutation(&mut tx, &user, annotation_id).await?;
        if annotation.owner_id != user.id {
            return Err(ApiError::forbidden(
                "Only the annotation owner can manage its private links.",
            ));
        }
    }
    sqlx::query("UPDATE webknossos.annotation_privateLinks SET _annotation=$2,expirationDateTime=$3 WHERE _id=$1 AND NOT isDeleted")
        .bind(&id).bind(parameters.annotation.as_str()).bind(parameters.expiration).execute(&mut *tx).await?;
    let value = owned_link(&mut *tx, &user, &id, false).await?.public_json();
    tx.commit().await?;
    Ok(ResponseJson(value))
}
async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut tx = state.pool.begin().await?;
    let link = owned_link(&mut *tx, &user, &id, true).await?;
    annotation_access::lock_for_mutation(&mut tx, &user, &link.annotation).await?;
    sqlx::query("UPDATE webknossos.annotation_privateLinks SET isDeleted=true WHERE _id=$1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(ResponseJson(
        json!({"messages":[{"success":"Annotation private link was successfully deleted."}]}),
    ))
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceQuery {
    user_token: Option<String>,
}
async fn source(
    State(state): State<AppState>,
    Path(token_or_id): Path<String>,
    Query(query): Query<SourceQuery>,
) -> ApiResult<ResponseJson<Value>> {
    let linked:Option<String>=sqlx::query_scalar("SELECT link._annotation FROM webknossos.annotation_privateLinks_ link JOIN webknossos.annotations_ a ON a._id=link._annotation WHERE link.accessToken=$1 AND (link.expirationDateTime IS NULL OR link.expirationDateTime>statement_timestamp())")
        .bind(&token_or_id).fetch_optional(&state.pool).await?;
    let via_private_link = linked.is_some();
    let annotation = if let Some(id) = linked {
        annotation_access::find(&state.pool, None, &id, true).await?
    } else {
        let token_or_id = ObjectId::parse(&token_or_id)?.to_string();
        // This raw Action uses only userToken, not normal authentication headers.
        // Invalid userToken falls back to anonymous annotation access.
        let user = match query.user_token {
            Some(token) => crate::auth::user_for_service_token(&state.pool, &token).await?,
            None => None,
        };
        annotation_access::find(&state.pool, user.as_ref(), &token_or_id, false).await?
    };
    let value:Value=sqlx::query_scalar(r#"SELECT jsonb_build_object('id',a._id,
        'annotationLayers',COALESCE((SELECT jsonb_agg(jsonb_build_object('tracingId',layer.tracingId,'typ',layer.typ,'name',layer.name,'stats',layer.statistics) ORDER BY layer.tracingId) FROM webknossos.annotation_layers layer WHERE layer._annotation=a._id),'[]'::jsonb),
        'datasetDirectoryName',d.directoryName,'datasetId',d._id,'organizationId',organization._id,
        'dataStoreUrl',store.publicUrl,'tracingStoreUrl',(SELECT publicUrl FROM webknossos.tracingStores_ LIMIT 1),
        'accessViaPrivateLink',$2)
        FROM webknossos.annotations_ a JOIN webknossos.datasets_ d ON d._id=a._dataset
        JOIN webknossos.organizations_ organization ON organization._id=d._organization
        JOIN webknossos.dataStores_ store ON store.name=trim(d._dataStore)
        WHERE a._id=$1"#).bind(&annotation.id).bind(via_private_link).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::not_found("Annotation source not found."))?;
    if value["tracingStoreUrl"].is_null() {
        return Err(ApiError::not_found("Tracing store not found."));
    }
    Ok(ResponseJson(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expiry_accepts_scala_instant_formats_and_rejects_invalid_values() {
        for value in [
            json!(1577836800000_i64),
            json!("1577836800000"),
            json!("2020-01-01T00:00:00.000Z"),
        ] {
            let p: Parameters = serde_json::from_value(
                json!({"annotation":"000000000000000000000001","expirationDateTime":value}),
            )
            .unwrap();
            assert_eq!(p.expiration.unwrap().timestamp_millis(), 1577836800000);
        }
        for value in [json!(true), json!("tomorrow"), json!([]), json!(1.5)] {
            assert!(
                serde_json::from_value::<Parameters>(
                    json!({"annotation":"000000000000000000000001","expirationDateTime":value})
                )
                .is_err()
            );
        }
    }
    #[test]
    fn tokens_are_unique_and_match_url_safe_twelve_byte_encoding() {
        let tokens: std::collections::HashSet<_> = (0..1000).map(|_| token().unwrap()).collect();
        assert_eq!(tokens.len(), 1000);
        assert!(tokens.iter().all(|token| {
            token.len() == 16
                && token
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        }));
    }
}
