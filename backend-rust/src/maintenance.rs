use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    id::{ObjectId, PathObjectId},
};
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Parameters {
    #[serde(deserialize_with = "read_timestamp")]
    start_time: DateTime<Utc>,
    #[serde(deserialize_with = "read_timestamp")]
    end_time: DateTime<Utc>,
    message: String,
}

// Scala Instant accepts milliseconds, a milliseconds string, or an ISO timestamp.
fn read_timestamp<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<DateTime<Utc>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    let date = match value {
        serde_json::Value::Number(number) => {
            number.as_i64().and_then(DateTime::from_timestamp_millis)
        }
        serde_json::Value::String(text) => text
            .parse::<i64>()
            .ok()
            .and_then(DateTime::from_timestamp_millis)
            .or_else(|| {
                DateTime::parse_from_rfc3339(&text)
                    .ok()
                    .map(|v| v.with_timezone(&Utc))
            }),
        _ => None,
    };
    date.ok_or_else(|| serde::de::Error::custom("Invalid timestamp"))
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct Maintenance {
    id: String,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    start_time: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    end_time: DateTime<Utc>,
    message: String,
}
const COLUMNS: &str = "_id AS id, startTime AS start_time, endTime AS end_time, message";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/maintenances/listCurrentAndUpcoming", get(upcoming))
        .route("/maintenances/listAll", get(list))
        .route("/maintenances", post(create))
        .route("/maintenances/adHoc", post(ad_hoc))
        .route("/maintenances/{id}", get(read).put(update).delete(delete))
}

fn require_superuser(user: &AuthUser) -> ApiResult<()> {
    if user.is_superuser {
        Ok(())
    } else {
        Err(ApiError::forbidden("Superuser access required."))
    }
}
async fn upcoming(State(state): State<AppState>) -> ApiResult<ResponseJson<Vec<Maintenance>>> {
    let query = format!(
        "SELECT {COLUMNS} FROM webknossos.maintenances_ WHERE endTime >= NOW() ORDER BY startTime, _id"
    );
    Ok(ResponseJson(
        sqlx::query_as(&query).fetch_all(&state.pool).await?,
    ))
}
async fn list(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Vec<Maintenance>>> {
    require_superuser(&user)?;
    let query = format!("SELECT {COLUMNS} FROM webknossos.maintenances_ ORDER BY startTime, _id");
    Ok(ResponseJson(
        sqlx::query_as(&query).fetch_all(&state.pool).await?,
    ))
}
async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<ResponseJson<Maintenance>> {
    require_superuser(&user)?;
    let query = format!("SELECT {COLUMNS} FROM webknossos.maintenances_ WHERE _id=$1");
    Ok(ResponseJson(
        sqlx::query_as(&query)
            .bind(id.as_str())
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| ApiError::not_found("Maintenance not found."))?,
    ))
}
async fn insert(pool: &sqlx::PgPool, user: &AuthUser, body: Parameters) -> ApiResult<Maintenance> {
    require_superuser(user)?;
    let query = format!(
        "INSERT INTO webknossos.maintenances (_id, _user, startTime, endTime, message) VALUES ($1,$2,$3,$4,$5) RETURNING {COLUMNS}"
    );
    Ok(sqlx::query_as(&query)
        .bind(ObjectId::new().as_str())
        .bind(&user.id)
        .bind(body.start_time)
        .bind(body.end_time)
        .bind(body.message)
        .fetch_one(pool)
        .await?)
}
async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<Parameters>,
) -> ApiResult<ResponseJson<Maintenance>> {
    Ok(ResponseJson(insert(&state.pool, &user, body).await?))
}
async fn ad_hoc(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Maintenance>> {
    let start_time = Utc::now();
    let body = Parameters {
        start_time,
        end_time: start_time + chrono::Duration::minutes(5),
        message: "WEBKNOSSOS is temporarily under maintenance.".into(),
    };
    Ok(ResponseJson(insert(&state.pool, &user, body).await?))
}
async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Json(body): Json<Parameters>,
) -> ApiResult<ResponseJson<Maintenance>> {
    require_superuser(&user)?;
    let query = format!(
        "UPDATE webknossos.maintenances SET startTime=$2, endTime=$3, message=$4 WHERE _id=$1 AND NOT isDeleted RETURNING {COLUMNS}"
    );
    Ok(ResponseJson(
        sqlx::query_as(&query)
            .bind(id.as_str())
            .bind(body.start_time)
            .bind(body.end_time)
            .bind(body.message)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| ApiError::not_found("Maintenance not found."))?,
    ))
}
async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<StatusCode> {
    require_superuser(&user)?;
    if sqlx::query(
        "UPDATE webknossos.maintenances SET isDeleted=TRUE WHERE _id=$1 AND NOT isDeleted",
    )
    .bind(id.as_str())
    .execute(&state.pool)
    .await?
    .rows_affected()
        == 0
    {
        return Err(ApiError::not_found("Maintenance not found."));
    }
    Ok(StatusCode::OK)
}
