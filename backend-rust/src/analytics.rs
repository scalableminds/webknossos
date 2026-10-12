//! Play's `AnalyticsController` and `AnalyticsService`.
//!
//! `POST /analytics/ingest` stores events relayed by other WEBKNOSSOS
//! instances (only with `WK_ANALYTICS_SAVE_TO_DATABASE_ENABLED`).
//! `POST /analytics/{eventType}` tracks a frontend event for the logged-in
//! user in the background: it is stored when database saving is enabled and
//! forwarded to `WK_ANALYTICS_URI` (Play's `backendAnalytics.uri`) when that
//! is non-empty. Like Play, the response never waits for or reports either.
//!
//! Server-side events of other controllers use [`track`] (requesting user),
//! [`track_for_user`] (another identity, e.g. a freshly created account) or
//! [`track_open_dataset`]. [`spawn_heartbeat`] runs Play's 24-hour
//! `webknossos_heartbeat` ticker (`AnalyticsService.tick`).
use std::{future::Future, time::Duration};

use axum::{
    Extension, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    response::Response,
    routing::post,
};
use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    application_info::{MiscConfig, MiscState, build_info_json, ok_empty},
    auth::{AuthUser, authenticate_request},
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    id::ObjectId,
    scheduler::{
        Job, JobError, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/analytics/ingest", post(ingest))
        .route("/analytics/{event_type}", post(track_frontend_event))
}

/// AnalyticsEventJsonUserProperties
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct UserProperties {
    pub organization_id: String,
    pub is_organization_admin: bool,
    pub is_super_user: bool,
    pub webknossos_uri: String,
}

/// AnalyticsEventJson
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AnalyticsEvent {
    pub event_type: String,
    /// The multi-user id.
    pub user_id: String,
    pub time: DateTime<Utc>,
    pub user_properties: UserProperties,
    pub event_properties: Map<String, Value>,
    pub session_id: i64,
}

impl AnalyticsEvent {
    /// `Json.writes[AnalyticsEventJson]` (camelCase, time in epoch millis).
    fn to_json(&self) -> Value {
        json!({
            "eventType": self.event_type,
            "userId": self.user_id,
            "time": self.time.timestamp_millis(),
            "userProperties": {
                "organizationId": self.user_properties.organization_id,
                "isOrganizationAdmin": self.user_properties.is_organization_admin,
                "isSuperUser": self.user_properties.is_super_user,
                "webknossosUri": self.user_properties.webknossos_uri,
            },
            "eventProperties": self.event_properties,
            "sessionId": self.session_id,
        })
    }
}

// ---------------------------------------------------------------------------
// Reads (snake_case first, camelCase fallback; a present but mistyped
// snake_case field fails like Play's `JsLookupResult.orElse`).

type ReadResult<T> = Result<T, String>;

fn lookup<'a>(value: &'a Value, snake: &str, camel: &str) -> ReadResult<&'a Value> {
    value
        .get(snake)
        .or_else(|| value.get(camel))
        .ok_or_else(|| camel.to_owned())
}

fn read_string(value: &Value, snake: &str, camel: &str) -> ReadResult<String> {
    lookup(value, snake, camel)?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| camel.to_owned())
}

fn read_bool(value: &Value, snake: &str, camel: &str) -> ReadResult<bool> {
    lookup(value, snake, camel)?
        .as_bool()
        .ok_or_else(|| camel.to_owned())
}

fn read_long(value: &Value, snake: &str, camel: &str) -> ReadResult<i64> {
    lookup(value, snake, camel)?
        .as_i64()
        .ok_or_else(|| camel.to_owned())
}

/// Instant reads: epoch millis as number, or an ISO-8601 / epoch-millis string.
fn read_instant(value: Option<&Value>) -> ReadResult<DateTime<Utc>> {
    let error = || "time".to_owned();
    let millis = match value.ok_or_else(error)? {
        Value::Number(number) => number.as_i64().ok_or_else(error)?,
        Value::String(text) => match DateTime::parse_from_rfc3339(text) {
            Ok(parsed) => return Ok(parsed.with_timezone(&Utc)),
            Err(_) => text.parse().map_err(|_| error())?,
        },
        _ => return Err(error()),
    };
    DateTime::from_timestamp_millis(millis).ok_or_else(error)
}

fn read_user_properties(value: &Value) -> ReadResult<UserProperties> {
    Ok(UserProperties {
        organization_id: read_string(value, "organization_id", "organizationId")?,
        is_organization_admin: read_bool(value, "is_organization_admin", "isOrganizationAdmin")?,
        is_super_user: read_bool(value, "is_superuser", "isSuperUser")?,
        webknossos_uri: read_string(value, "webknossos_uri", "webknossosUri")?,
    })
}

fn read_event(value: &Value) -> ReadResult<AnalyticsEvent> {
    let user_id = read_string(value, "user_id", "userId")?;
    let user_id = ObjectId::parse(&user_id)
        .map_err(|_| "userId".to_owned())?
        .to_string();
    Ok(AnalyticsEvent {
        event_type: read_string(value, "event_type", "eventType")?,
        user_id,
        time: read_instant(value.get("time"))?,
        user_properties: read_user_properties(lookup(value, "user_properties", "userProperties")?)?,
        event_properties: match lookup(value, "event_properties", "eventProperties")? {
            Value::Object(map) => map.clone(),
            _ => return Err("eventProperties".into()),
        },
        session_id: read_long(value, "session_id", "sessionId")?,
    })
}

/// AnalyticsEventsIngestJson: `(events, api_key|apiKey)`.
pub(crate) fn read_ingest(value: &Value) -> ReadResult<(Vec<AnalyticsEvent>, String)> {
    let events = match value.get("events") {
        Some(Value::Array(events)) => events.iter().map(read_event).collect::<Result<_, _>>()?,
        _ => return Err("events".into()),
    };
    Ok((events, read_string(value, "api_key", "apiKey")?))
}

/// `wellKnownUris.map(_.split("\\|")).map(parts => (parts(0), parts(1))).toMap`;
/// Java's split drops trailing empty strings, so `"uri|"` is malformed too.
pub(crate) fn parse_well_known_uris(
    entries: &[String],
) -> Option<std::collections::HashMap<String, String>> {
    entries
        .iter()
        .map(|entry| {
            let mut parts: Vec<&str> = entry.split('|').collect();
            while parts.last().is_some_and(|part| part.is_empty()) {
                parts.pop();
            }
            (parts.len() >= 2).then(|| (parts[0].to_owned(), parts[1].to_owned()))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Persistence and forwarding

/// AnalyticsDAO.insertMany (one statement, like Play's multi-row VALUES).
async fn insert_many(pool: &sqlx::PgPool, events: &[AnalyticsEvent]) -> ApiResult<()> {
    let mut builder = sqlx::QueryBuilder::new(
        "INSERT INTO webknossos.analyticsEvents(_id, created, sessionId, eventType, eventProperties, _user, _organization, isOrganizationAdmin, isSuperUser, webknossosUri) ",
    );
    builder.push_values(events, |mut row, event| {
        row.push_bind(ObjectId::new().as_str().to_owned())
            .push_bind(event.time)
            .push_bind(event.session_id)
            .push_bind(&event.event_type)
            .push_bind(Value::Object(event.event_properties.clone()))
            .push_bind(&event.user_id)
            .push_bind(&event.user_properties.organization_id)
            .push_bind(event.user_properties.is_organization_admin)
            .push_bind(event.user_properties.is_super_user)
            .push_bind(&event.user_properties.webknossos_uri);
    });
    builder.build().execute(pool).await?;
    Ok(())
}

/// AnalyticsSessionService.refreshAndGetSessionId
pub(crate) fn refresh_session_id(misc: &MiscState, multi_user_id: &str, now: DateTime<Utc>) -> i64 {
    let pause = chrono::Duration::from_std(misc.config().analytics.session_pause)
        .unwrap_or(chrono::Duration::MAX);
    let mut sessions = match misc.0.analytics_sessions.lock() {
        Ok(sessions) => sessions,
        Err(poisoned) => poisoned.into_inner(),
    };
    let previous = sessions.get(multi_user_id).copied();
    let session_id = match previous {
        Some((last, id)) if last.checked_add_signed(pause).is_none_or(|end| end >= now) => id,
        _ => now.timestamp_millis(),
    };
    sessions.insert(multi_user_id.to_owned(), (now, session_id));
    session_id
}

/// Identity fields of an event's user (Play's `AnalyticsEvent.user` plus
/// `AnalyticsLookUpService.isSuperUser`).
struct Actor {
    multi_user_id: String,
    organization_id: String,
    is_admin: bool,
    is_super_user: bool,
}

/// Runs one event's lookups and delivery in the background; like Play's
/// `track`, the caller never waits for or sees the result.
fn spawn_tracking(task: impl Future<Output = ApiResult<()>> + Send + 'static) {
    tokio::spawn(async move {
        if let Err(error) = task.await {
            tracing::debug!(%error, "Analytics event could not be tracked");
        }
    });
}

/// AnalyticsService.track: fire-and-forget storage and forwarding of an
/// event for an authenticated user. Never fails the caller.
pub(crate) fn track(
    state: &AppState,
    misc: &MiscState,
    user: &AuthUser,
    event_type: String,
    event_properties: Map<String, Value>,
) {
    let (state, misc, user) = (state.clone(), misc.clone(), user.clone());
    spawn_tracking(async move {
        let actor = actor_for_auth_user(&state.pool, &user).await?;
        emit(&state.pool, &misc, actor, event_type, event_properties).await
    });
}

/// Identity fields of the requesting user: organization and admin flag of the
/// request identity, superuser flag of its account.
async fn actor_for_auth_user(pool: &sqlx::PgPool, user: &AuthUser) -> ApiResult<Actor> {
    let (multi_user_id, is_super_user): (String, bool) = sqlx::query_as(
        "SELECT m._id, m.isSuperUser FROM webknossos.users u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1",
    )
    .bind(&user.id)
    .fetch_one(pool)
    .await?;
    Ok(Actor {
        multi_user_id,
        organization_id: user.organization_id.clone(),
        is_admin: user.is_admin,
        is_super_user,
    })
}

/// Loads the event user's identity fields by user id.
async fn actor_for(pool: &sqlx::PgPool, user_id: &str) -> ApiResult<Actor> {
    let (multi_user_id, organization_id, is_admin, is_super_user): (String, String, bool, bool) =
        sqlx::query_as(
            "SELECT m._id, u._organization, u.isAdmin, m.isSuperUser FROM webknossos.users u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?;
    Ok(Actor {
        multi_user_id,
        organization_id,
        is_admin,
        is_super_user,
    })
}

/// [`track`] for an identity other than the requesting [`AuthUser`]: a
/// freshly created account (`SignupEvent`) or the joining identity of
/// `JoinOrganizationEvent`. Its organization and admin flag are read from the
/// database, so call it after the creating transaction committed.
pub(crate) fn track_for_user(
    state: &AppState,
    misc: &MiscState,
    user_id: &str,
    event_type: &str,
    event_properties: Map<String, Value>,
) {
    let (pool, misc) = (state.pool.clone(), misc.clone());
    let (user_id, event_type) = (user_id.to_owned(), event_type.to_owned());
    spawn_tracking(async move {
        let actor = actor_for(&pool, &user_id).await?;
        emit(&pool, &misc, actor, event_type, event_properties).await
    });
}

/// `OpenDatasetEvent` properties. Like `AnalyticsLookUpService.multiUserIdFor`
/// (`userDAO.findOne`), an uploader that no longer exists fails the event.
async fn open_dataset_properties(
    pool: &sqlx::PgPool,
    dataset_id: &str,
) -> ApiResult<Map<String, Value>> {
    let (name, organization, uploader): (String, String, Option<String>) = sqlx::query_as(
        "SELECT name, _organization, _uploader FROM webknossos.datasets WHERE _id = $1",
    )
    .bind(dataset_id)
    .fetch_one(pool)
    .await?;
    let uploader_multi_user_id = match uploader {
        Some(uploader) => Some(
            sqlx::query_scalar::<_, String>(
                "SELECT _multiUser FROM webknossos.users_ WHERE _id = $1",
            )
            .bind(uploader)
            .fetch_one(pool)
            .await?,
        ),
        None => None,
    };
    let Value::Object(properties) = json!({
        "dataset_id": dataset_id,
        "dataset_name": name,
        "dataset_organization_id": organization,
        "dataset_uploader_multiuser_id": uploader_multi_user_id,
    }) else {
        unreachable!("json! object literal");
    };
    Ok(properties)
}

/// `OpenDatasetEvent(user, dataset)`.
pub(crate) fn track_open_dataset(
    state: &AppState,
    misc: &MiscState,
    user: &AuthUser,
    dataset_id: &str,
) {
    let (state, misc, user) = (state.clone(), misc.clone(), user.clone());
    let dataset_id = dataset_id.to_owned();
    spawn_tracking(async move {
        let properties = open_dataset_properties(&state.pool, &dataset_id).await?;
        let actor = actor_for_auth_user(&state.pool, &user).await?;
        emit(&state.pool, &misc, actor, "open_dataset".into(), properties).await
    });
}

/// Single-entry JSON object for event properties.
pub(crate) fn properties(key: &str, value: impl Into<Value>) -> Map<String, Value> {
    let mut properties = Map::new();
    properties.insert(key.to_owned(), value.into());
    properties
}

/// saveInDatabaseIfEnabled + sendIfEnabled for one event.
async fn emit(
    pool: &sqlx::PgPool,
    misc: &MiscState,
    actor: Actor,
    event_type: String,
    event_properties: Map<String, Value>,
) -> ApiResult<()> {
    let Actor {
        multi_user_id,
        organization_id,
        is_admin,
        is_super_user,
    } = actor;
    let now = Utc::now();
    let session_id = refresh_session_id(misc, &multi_user_id, now);
    let config = &misc.config();
    let event = AnalyticsEvent {
        event_type,
        user_id: multi_user_id,
        time: now,
        user_properties: UserProperties {
            organization_id,
            is_organization_admin: is_admin,
            is_super_user,
            webknossos_uri: config.public_uri.clone(),
        },
        event_properties,
        session_id,
    };
    let analytics = &config.analytics;
    if analytics.save_to_database_enabled {
        if analytics.verbose_logging_enabled {
            tracing::info!(event_type = %event.event_type, session_id, "Storing analytics event");
        }
        if let Err(error) = insert_many(pool, std::slice::from_ref(&event)).await {
            tracing::warn!(%error, "Storing analytics event failed");
        }
    } else if analytics.verbose_logging_enabled {
        tracing::info!(event_type = %event.event_type, session_id, "Not storing analytics event");
    }
    if analytics.uri.is_empty() {
        if analytics.verbose_logging_enabled {
            tracing::info!(
                event_type = %event.event_type,
                "Not sending analytics event, since uri is not configured"
            );
        }
        return Ok(());
    }
    if analytics.verbose_logging_enabled {
        tracing::info!(event_type = %event.event_type, session_id, "Sending analytics event");
    }
    // rpc(uri).silent.postJson: failures are not reported.
    let body = json!({"api_key": analytics.key, "events": [event.to_json()]});
    let result = misc
        .0
        .http
        .post(&analytics.uri)
        .timeout(Duration::from_secs(30))
        .json(&body)
        .send()
        .await;
    if let Err(error) = result {
        tracing::debug!(error = %error.without_url(), "Sending analytics event failed");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Heartbeat ticker

/// Job name: log field and advisory lock identity.
pub const HEARTBEAT_JOB_NAME: &str = "analytics-heartbeat";
/// Scala `AnalyticsService.tickerInterval`.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
/// Scala `IntervalScheduler.tickerInitialDelay` default.
pub const HEARTBEAT_INITIAL_DELAY: Duration = Duration::from_secs(10);

/// Schedule of the heartbeat. Play's ticker always runs, but its event is a
/// no-op unless forwarding (`WK_ANALYTICS_URI`) or database saving
/// (`WK_ANALYTICS_SAVE_TO_DATABASE_ENABLED`) is configured; the Rust job is
/// only enabled in that case, so no new setting is needed.
pub fn heartbeat_schedule(config: &MiscConfig) -> JobSchedule {
    JobSchedule {
        enabled: !config.analytics.uri.is_empty() || config.analytics.save_to_database_enabled,
        interval: HEARTBEAT_INTERVAL,
        initial_delay: HEARTBEAT_INITIAL_DELAY,
    }
}

/// One `AnalyticsService.tick`: a `webknossos_heartbeat` event for the oldest
/// active user (`UserDAO.findOldestActive`) with the `/buildinfo` JSON. Holds
/// a transaction-scoped advisory lock so concurrent instances do not send
/// twice at once (Play takes no lock). Waits for storage and forwarding.
pub async fn run_heartbeat(pool: &sqlx::PgPool, misc: &MiscState) -> Result<JobOutcome, JobError> {
    let mut lock = pool.begin().await?;
    if !try_advisory_xact_lock(&mut lock, advisory_lock_key(HEARTBEAT_JOB_NAME)).await? {
        lock.rollback().await?;
        return Ok(JobOutcome::SkippedLocked);
    }
    let oldest: Option<String> = sqlx::query_scalar(
        "SELECT _id FROM webknossos.users_ WHERE NOT isDeactivated ORDER BY created LIMIT 1",
    )
    .fetch_optional(&mut *lock)
    .await?;
    let Some(user_id) = oldest else {
        lock.rollback().await?;
        // Play's parseFirst fails the tick; nothing is sent.
        return Ok(JobOutcome::Completed(
            "No active user, heartbeat not sent.".into(),
        ));
    };
    let state = AppState { pool: pool.clone() };
    let build_info = build_info_json(&state, misc.config()).await;
    let actor = actor_for(pool, &user_id).await?;
    emit(
        pool,
        misc,
        actor,
        "webknossos_heartbeat".into(),
        properties("build_info", build_info),
    )
    .await?;
    lock.commit().await?;
    Ok(JobOutcome::Completed("Sent webknossos_heartbeat.".into()))
}

/// Scheduler with the heartbeat job registered (also when disabled, so that is logged).
pub fn heartbeat_scheduler(
    pool: sqlx::PgPool,
    misc: MiscState,
    schedule: JobSchedule,
) -> Scheduler {
    let mut scheduler = Scheduler::new();
    scheduler.add(Job::new(HEARTBEAT_JOB_NAME, schedule, move || {
        let (pool, misc) = (pool.clone(), misc.clone());
        async move { run_heartbeat(&pool, &misc).await }
    }));
    scheduler
}

/// Starts the 24 h heartbeat on the current runtime with
/// [`heartbeat_schedule`]`(misc.config())`. Call [`SchedulerHandle::shutdown`]
/// before closing the pool.
pub fn spawn_heartbeat(pool: sqlx::PgPool, misc: MiscState) -> SchedulerHandle {
    let schedule = heartbeat_schedule(misc.config());
    heartbeat_scheduler(pool, misc, schedule).spawn()
}

// ---------------------------------------------------------------------------
// Handlers

/// Silhouette's UserAwareAction: invalid credentials yield no identity
/// instead of a rejection.
struct UserAware(Option<AuthUser>);

impl FromRequestParts<AppState> for UserAware {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        match authenticate_request(parts, state).await {
            Ok(user) => Ok(Self(user.map(|(user, _)| user))),
            Err(error) if error.status == StatusCode::UNAUTHORIZED => Ok(Self(None)),
            Err(error) => Err(error),
        }
    }
}

async fn ingest(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let (events, api_key) =
        read_ingest(&body).map_err(|_| ApiError::bad_request("Invalid JSON request body."))?;
    let analytics = &misc.config().analytics;
    if !analytics.save_to_database_enabled {
        return Err(ApiError::bad_request(
            "Database logging of events is not enabled",
        ));
    }
    let well_known = parse_well_known_uris(&analytics.well_known_uris)
        .ok_or_else(|| ApiError::bad_request("wellKnownUris configuration is incorrect"))?;
    let authorized = events.iter().all(|event| {
        well_known
            .get(&event.user_properties.webknossos_uri)
            .is_none_or(|key| *key == api_key)
    });
    if !authorized {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Provided API key is not correct for provided webknossosUri",
        ));
    }
    if events.is_empty() {
        // Play renders an empty multi-row INSERT, which PostgreSQL rejects.
        return Err(ApiError::bad_request("No analytics events provided."));
    }
    insert_many(&state.pool, &events).await?;
    Ok(ok_empty())
}

async fn track_frontend_event(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    UserAware(user): UserAware,
    Path(event_type): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let Value::Object(mut properties) = body else {
        return Err(ApiError::bad_request("Invalid JSON request body."));
    };
    if let Some(user) = user {
        // FrontendAnalyticsEvent: eventProperties ++ {"is_frontend_event": true}
        properties.insert("is_frontend_event".into(), Value::Bool(true));
        track(&state, &misc, &user, event_type, properties);
    }
    Ok(ok_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn well_known_uris_follow_java_split() {
        let parse = |entries: &[&str]| {
            parse_well_known_uris(&entries.iter().map(|e| e.to_string()).collect::<Vec<_>>())
        };
        let parsed = parse(&["https://a|k1", "https://b|k2|extra", "|k3"]).unwrap();
        assert_eq!(parsed["https://a"], "k1");
        assert_eq!(parsed["https://b"], "k2");
        assert_eq!(parsed[""], "k3");
        assert!(parse(&["https://a"]).is_none());
        assert!(parse(&["https://a|"]).is_none());
        assert!(parse(&[]).unwrap().is_empty());
    }

    #[test]
    fn ingest_reads_both_casings() {
        let snake = json!({"events": [{
            "event_type": "x", "user_id": "5c766bec6c01006c018c7459", "time": "1970-01-01T00:00:01Z",
            "user_properties": {"organization_id": "o", "is_organization_admin": true,
                "is_superuser": false, "webknossos_uri": "u"},
            "event_properties": {"a": 1}, "session_id": 5}], "api_key": "k"});
        let (events, key) = read_ingest(&snake).unwrap();
        assert_eq!(key, "k");
        assert_eq!(events[0].time.timestamp_millis(), 1000);
        let camel = json!({"events": [{
            "eventType": "x", "userId": "5c766bec6c01006c018c7459", "time": "1000",
            "userProperties": {"organizationId": "o", "isOrganizationAdmin": true,
                "isSuperUser": false, "webknossosUri": "u"},
            "eventProperties": {"a": 1}, "sessionId": 5}], "apiKey": "k"});
        assert_eq!(read_ingest(&camel).unwrap().0, events);
        let mistyped = json!({"events": [], "api_key": 1, "apiKey": "k"});
        assert!(read_ingest(&mistyped).is_err());
        let bad_id = json!({"events": [{"eventType": "x", "userId": "nope"}], "apiKey": "k"});
        assert!(read_ingest(&bad_id).is_err());
    }

    #[test]
    fn heartbeat_schedule_follows_scala_and_analytics_config() {
        let mut config = MiscConfig::default();
        let schedule = heartbeat_schedule(&config);
        assert!(schedule.enabled, "default forwarding URI enables it");
        assert_eq!(schedule.interval, Duration::from_secs(86_400));
        assert_eq!(schedule.initial_delay, Duration::from_secs(10));
        config.analytics.uri = String::new();
        assert!(!heartbeat_schedule(&config).enabled);
        config.analytics.save_to_database_enabled = true;
        assert!(heartbeat_schedule(&config).enabled);
    }

    #[test]
    fn heartbeat_lock_key_is_pinned_and_unique() {
        let key = advisory_lock_key(HEARTBEAT_JOB_NAME);
        assert_eq!(key, -3_148_850_142_407_920_231);
        let mut others: Vec<i64> = crate::housekeeping::HousekeepingJob::ALL
            .iter()
            .map(|job| job.advisory_lock_key())
            .collect();
        others.push(advisory_lock_key(crate::credit_ticker::JOB_NAME));
        others.push(advisory_lock_key(crate::dataset_storage::JOB_NAME));
        others.push(advisory_lock_key("worker-liveness"));
        assert!(!others.contains(&key));
    }

    #[tokio::test]
    async fn disabled_heartbeat_spawns_no_job() {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://unused@127.0.0.1:1/unused")
            .unwrap();
        let mut config = MiscConfig::default();
        config.analytics.uri = String::new();
        let handle = spawn_heartbeat(pool, MiscState::new(config));
        assert!(handle.job_names().is_empty());
        handle.shutdown().await;
    }

    #[test]
    fn sessions_expire_after_pause() {
        let misc = MiscState::default();
        let start = DateTime::from_timestamp_millis(10_000_000).unwrap();
        let first = refresh_session_id(&misc, "m", start);
        assert_eq!(first, start.timestamp_millis());
        let later = start + chrono::Duration::minutes(29);
        assert_eq!(refresh_session_id(&misc, "m", later), first);
        let much_later = later + chrono::Duration::minutes(31);
        assert_eq!(
            refresh_session_id(&misc, "m", much_later),
            much_later.timestamp_millis()
        );
    }
}
