//! Slack notifications: port of `SlackClient` (webknossos-datastore
//! `slacknotification/SlackClient.scala`) and the main application's
//! `telemetry.SlackNotificationService`.
//!
//! Messages are POSTed to the configured incoming-webhook URI as
//! `{"attachments":[{"title":"<title> reported from WEBKNOSSOS at <http.uri>","text":<msg>,"color":<color>}]}`.
//! Without a URI the service is disabled (verbose mode logs the message
//! instead). Sending never blocks or fails the caller: the rate limit (30
//! messages per fixed one-minute window, as in Scala) is checked
//! synchronously, the POST runs on a spawned task and errors are only logged.
//!
//! Handlers obtain the service as an extractor; a router without the
//! `Extension(SlackNotificationService)` layer gets a disabled service.
use std::{
    collections::HashMap,
    convert::Infallible,
    fmt,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{extract::FromRequestParts, http::request::Parts};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

/// `http.uri` default (`application.conf`), also the Rust `WK_PUBLIC_URL` default.
const DEFAULT_PUBLIC_URI: &str = "http://localhost:9000";
/// SlackClient.rateLimitInterval.
pub const RATE_LIMIT_INTERVAL: Duration = Duration::from_secs(60);
/// SlackClient.rateLimitMaxMessages.
pub const RATE_LIMIT_MAX_MESSAGES: u32 = 30;
/// Timeout of one webhook POST (Play WS default request timeout is 2 min;
/// a shorter bound keeps spawned tasks from piling up).
const SEND_TIMEOUT: Duration = Duration::from_secs(30);

pub const COLOR_WARN: &str = "#ff8a00";
pub const COLOR_INFO: &str = "#333ccc";
pub const COLOR_SUCCESS: &str = "#049b4a";
pub const COLOR_ERROR: &str = "#e10000";

/// `slackNotifications.*` plus `http.uri` (used in every message title).
#[derive(Clone)]
pub struct SlackConfig {
    /// `slackNotifications.uri`; `None` (empty) disables sending. The webhook
    /// URI is a credential and is never printed.
    pub uri: Option<String>,
    /// `slackNotifications.verboseLoggingEnabled`.
    pub verbose_logging_enabled: bool,
    /// `http.uri` without trailing slash (from `WK_PUBLIC_URL`).
    pub public_uri: String,
}

impl Default for SlackConfig {
    fn default() -> Self {
        Self {
            uri: None,
            verbose_logging_enabled: false,
            public_uri: DEFAULT_PUBLIC_URI.into(),
        }
    }
}

impl fmt::Debug for SlackConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SlackConfig")
            .field("uri_configured", &self.uri.is_some())
            .field("verbose_logging_enabled", &self.verbose_logging_enabled)
            .field("public_uri", &self.public_uri)
            .finish()
    }
}

/// Parses settings from environment values (called by config.rs):
/// `WK_SLACK_NOTIFICATIONS_URI` (default empty = disabled),
/// `WK_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED` (default false) and
/// `WK_PUBLIC_URL` (default `http://localhost:9000`, validated by config.rs).
pub fn config_from_values(values: &HashMap<String, String>) -> Result<SlackConfig, String> {
    let uri = match values
        .get("WK_SLACK_NOTIFICATIONS_URI")
        .map(|value| value.trim())
    {
        None | Some("") => None,
        Some(raw) => {
            let valid = url::Url::parse(raw)
                .ok()
                .is_some_and(|url| matches!(url.scheme(), "http" | "https") && url.has_host());
            if !valid {
                return Err("WK_SLACK_NOTIFICATIONS_URI must be an absolute HTTP(S) URL".into());
            }
            Some(raw.to_owned())
        }
    };
    let verbose_logging_enabled = match values.get("WK_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED")
    {
        None => false,
        Some(value) => value.parse().map_err(|_| {
            "WK_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED must be true or false".to_owned()
        })?,
    };
    let public_uri = values
        .get("WK_PUBLIC_URL")
        .map(|raw| match url::Url::parse(raw) {
            Ok(url) => url.as_str().trim_end_matches('/').to_owned(),
            Err(_) => raw.trim_end_matches('/').to_owned(),
        })
        .unwrap_or_else(|| DEFAULT_PUBLIC_URI.into());
    Ok(SlackConfig {
        uri,
        verbose_logging_enabled,
        public_uri,
    })
}

/// SlackClient.testAndSetRateLimit: a fixed window that restarts with the
/// first message more than one interval after the previous window start.
#[derive(Debug, Default)]
pub struct RateLimiter {
    last_reset: Option<Instant>,
    sent_since_reset: u32,
}

impl RateLimiter {
    /// Returns whether a message may be sent at `now` and counts it if so.
    pub fn test_and_set(&mut self, now: Instant) -> bool {
        let window_over = self
            .last_reset
            .is_none_or(|last| now.saturating_duration_since(last) > RATE_LIMIT_INTERVAL);
        if window_over {
            self.last_reset = Some(now);
            self.sent_since_reset = 1;
            true
        } else if self.sent_since_reset < RATE_LIMIT_MAX_MESSAGES {
            self.sent_since_reset += 1;
            true
        } else {
            false
        }
    }

    pub fn sent_since_reset(&self) -> u32 {
        self.sent_since_reset
    }
}

/// One attachment as built by SlackClient.sendMessage.
pub fn attachment(name: &str, title: &str, msg: &str, color: &str) -> Value {
    json!({
        "title": format!("{title} reported from {name}"),
        "text": msg,
        "color": color,
    })
}

/// The webhook request body: `{"attachments":[attachment]}`.
pub fn payload(attachment: Value) -> Value {
    json!({ "attachments": [attachment] })
}

struct Sender {
    uri: String,
    http: reqwest::Client,
    limiter: Mutex<RateLimiter>,
}

struct Inner {
    /// `WEBKNOSSOS at <http.uri>`.
    name: String,
    /// `http.uri`, for links in messages.
    public_uri: String,
    verbose: bool,
    sender: Option<Sender>,
}

/// telemetry.SlackNotificationService (cheap to clone; clones share the rate limit).
#[derive(Clone)]
pub struct SlackNotificationService {
    inner: Arc<Inner>,
}

impl Default for SlackNotificationService {
    /// A disabled service (no URI), as with the default configuration.
    fn default() -> Self {
        Self::new(&SlackConfig::default())
    }
}

impl fmt::Debug for SlackNotificationService {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SlackNotificationService")
            .field("name", &self.inner.name)
            .field("enabled", &self.is_enabled())
            .finish()
    }
}

impl SlackNotificationService {
    pub fn new(config: &SlackConfig) -> Self {
        let sender = config.uri.as_ref().and_then(|uri| {
            match reqwest::Client::builder().timeout(SEND_TIMEOUT).build() {
                Ok(http) => Some(Sender {
                    uri: uri.clone(),
                    http,
                    limiter: Mutex::new(RateLimiter::default()),
                }),
                Err(error) => {
                    tracing::error!(%error, "Could not build the Slack HTTP client; Slack notifications are disabled");
                    None
                }
            }
        });
        Self {
            inner: Arc::new(Inner {
                name: format!("WEBKNOSSOS at {}", config.public_uri),
                public_uri: config.public_uri.clone(),
                verbose: config.verbose_logging_enabled,
                sender,
            }),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.inner.sender.is_some()
    }

    pub fn warn(&self, title: &str, msg: &str) {
        self.send_message(title, msg, COLOR_WARN);
    }

    pub fn info(&self, title: &str, msg: &str) {
        self.send_message(title, msg, COLOR_INFO);
    }

    pub fn success(&self, title: &str, msg: &str) {
        self.send_message(title, msg, COLOR_SUCCESS);
    }

    pub fn error(&self, title: &str, msg: &str) {
        self.send_message(title, msg, COLOR_ERROR);
    }

    /// noticeFailedJobRequest.
    pub fn notice_failed_job_request(&self, msg: &str) {
        self.warn("Failed job request", msg);
    }

    /// noticeBaseAnnotationTaskCreation.
    pub fn notice_base_annotation_task_creation(&self, task_type_id: &str, number_of_tasks: usize) {
        self.info(
            "Task creation with base",
            &format!(
                "{number_of_tasks} tasks with BaseAnnotation for TaskType {task_type_id} have been created"
            ),
        );
    }

    /// noticeSlowRequest.
    pub fn notice_slow_request(&self, msg: &str) {
        self.info("Slow request", msg);
    }

    /// DatasetService.logDatasetUploadToSlack (the caller checks
    /// `!needsConversion`): looks up the organization name, then sends
    /// `Dataset added (<label>)[ (for superuser)]` on a spawned task. As in
    /// Scala (`_ = trackNewDataset(...)`) failures never reach the route.
    pub fn notice_dataset_added(
        &self,
        pool: &sqlx::PgPool,
        organization_id: &str,
        is_superuser: bool,
        dataset_id: &str,
        add_variant_label: &str,
    ) {
        if !self.is_enabled() && !self.inner.verbose {
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let (service, pool, organization_id) =
            (self.clone(), pool.clone(), organization_id.to_owned());
        let title = format!(
            "Dataset added ({add_variant_label}){}",
            if is_superuser { " (for superuser)" } else { "" }
        );
        let result_link = format!("{}/datasets/{dataset_id}", self.inner.public_uri);
        runtime.spawn(async move {
            let name: Option<String> = match sqlx::query_scalar(
                "SELECT name FROM webknossos.organizations_ WHERE _id = $1",
            )
            .bind(&organization_id)
            .fetch_optional(&pool)
            .await
            {
                Ok(name) => name,
                Err(error) => {
                    tracing::warn!(%error, "Dataset added Slack notice: organization lookup failed");
                    None
                }
            };
            if let Some(name) = name {
                service.info(
                    &title,
                    &format!("For organization: {name}. <{result_link}|Result>"),
                );
            }
        });
    }

    /// noticeStartup (Startup.scala).
    pub fn notice_startup(&self, version: &str) {
        self.info(
            "Startup",
            &format!("WEBKNOSSOS version `{version}` started"),
        );
    }

    /// Worker.reportAsDead (WorkerLivenessService), for the liveness monitor.
    pub fn notice_worker_missing(
        &self,
        name: &str,
        id: &str,
        last_heartbeat: DateTime<Utc>,
        now: DateTime<Utc>,
    ) {
        let msg = format!(
            "Worker {name} ({id}) is not reporting. {}",
            format_heartbeat(last_heartbeat, now)
        );
        tracing::warn!("{msg}");
        self.warn("Worker missing", &msg);
    }

    /// Worker.reportAsResurrected (WorkerLivenessService).
    pub fn notice_worker_return(
        &self,
        name: &str,
        id: &str,
        last_heartbeat: DateTime<Utc>,
        now: DateTime<Utc>,
    ) {
        let msg = format!(
            "Worker {name} ({id}) is reporting again. {}",
            format_heartbeat(last_heartbeat, now)
        );
        tracing::info!("{msg}");
        self.success("Worker return", &msg);
    }

    /// Startup.checkPostgresSchema's `warn("SQL schema mismatch", ...)`. The
    /// backend exits right after a mismatch, so this waits (bounded by the
    /// send timeout) until the webhook POST finished.
    pub async fn notice_schema_mismatch(&self, msg: &str) {
        if let Some(task) = self.send_message("SQL schema mismatch", msg, COLOR_WARN) {
            let _ = task.await;
        }
    }

    /// SlackClient.sendMessage. Returns the spawned send task, if any (tests).
    fn send_message(
        &self,
        title: &str,
        msg: &str,
        color: &str,
    ) -> Option<tokio::task::JoinHandle<()>> {
        let message = attachment(&self.inner.name, title, msg, color);
        let Some(sender) = &self.inner.sender else {
            if self.inner.verbose {
                tracing::info!(message = %message, "Not sending slack notification as it was not configured");
            }
            return None;
        };
        let (allowed, sent) = {
            let mut limiter = sender
                .limiter
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let allowed = limiter.test_and_set(Instant::now());
            (allowed, limiter.sent_since_reset())
        };
        if !allowed {
            // Scala logs the whole message; only the title is logged here
            // because texts may contain user names.
            tracing::warn!(
                title = %title,
                limit = sent,
                "Not sending slack notification as rate limit was reached"
            );
            return None;
        }
        if self.inner.verbose {
            tracing::info!(message = %message, sent_since_reset = sent, "Sending slack notification");
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            tracing::warn!(title = %title, "Not sending slack notification outside of a Tokio runtime");
            return None;
        };
        let request = sender.http.post(&sender.uri).json(&payload(message));
        let title = title.to_owned();
        Some(runtime.spawn(async move {
            match request.send().await {
                Ok(response) if response.status().is_success() => {}
                Ok(response) => {
                    tracing::warn!(title = %title, status = %response.status(), "Slack notification was rejected");
                }
                Err(error) => {
                    // The webhook URI is a credential: never log it.
                    tracing::warn!(title = %title, error = %error.without_url(), "Sending slack notification failed");
                }
            }
        }))
    }
}

/// The process-wide service for code without request context (startup,
/// schema check, background tickers). Installed once by `main.rs`.
static GLOBAL: OnceLock<SlackNotificationService> = OnceLock::new();

/// Installs the process-wide service (first call wins) and returns it.
pub fn install_global(config: &SlackConfig) -> SlackNotificationService {
    GLOBAL
        .get_or_init(|| SlackNotificationService::new(config))
        .clone()
}

/// The installed process-wide service, or a disabled one (tests, tools).
pub fn global() -> SlackNotificationService {
    GLOBAL.get().cloned().unwrap_or_default()
}

/// Startup.scala: `slackNotificationService.noticeStartup(BuildInfo.version)`
/// with the process-wide service. `main.rs` calls this once the database
/// connection and schema check succeeded.
pub fn notice_startup(version: &str) {
    global().notice_startup(version);
}

/// Router-wide extension lookup; without the layer Slack is disabled.
impl<S: Send + Sync> FromRequestParts<S> for SlackNotificationService {
    type Rejection = Infallible;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(parts.extensions.get::<Self>().cloned().unwrap_or_default())
    }
}

/// Formatter.formatDuration (util/mvc/Formatter.scala), for milliseconds.
pub fn format_duration(millis: i64) -> String {
    const MILLIS_THRESHOLD: i64 = 59995;
    const SECONDS_THRESHOLD: i64 = 59499;
    let sign = if millis < 0 { "-" } else { "" };
    let mut abs = millis.saturating_abs();
    if abs < 1000 {
        return format!("{sign}{abs}ms");
    }
    if abs < MILLIS_THRESHOLD {
        let whole_seconds = abs / 1000;
        // Math.round(abs / 10.0) % 100 (round half up, non-negative here).
        let centis = ((abs as f64 / 10.0 + 0.5).floor() as i64) % 100;
        return if centis == 0 {
            format!("{sign}{whole_seconds}s")
        } else if centis % 10 == 0 {
            format!("{sign}{whole_seconds}.{}s", centis / 10)
        } else {
            format!("{sign}{whole_seconds}.{centis:02}s")
        };
    }
    const HOUR: i64 = 3600 * 1000;
    const DAY: i64 = 24 * HOUR;
    let mut labels = Vec::new();
    let mut days = abs / DAY;
    if abs - days * DAY > 23 * HOUR + 59 * 60 * 1000 + SECONDS_THRESHOLD {
        days += 1;
    }
    let include_seconds = days == 0;
    if days > 0 {
        labels.push(if days == 1 {
            "1 day".to_owned()
        } else {
            format!("{days} days")
        });
        abs -= days * DAY;
    }
    // Math.floor on a possibly negative remainder (after rounding up a day).
    let mut hours = abs.div_euclid(HOUR);
    if abs - hours * HOUR > 59 * 60 * 1000 + SECONDS_THRESHOLD {
        hours += 1;
    }
    if hours > 0 {
        labels.push(format!("{hours}h"));
        abs -= hours * HOUR;
    }
    let mut minutes = abs.div_euclid(60 * 1000);
    if abs - minutes * 60 * 1000 > SECONDS_THRESHOLD {
        minutes += 1;
    }
    if minutes > 0 {
        abs -= minutes * 60 * 1000;
        labels.push(format!("{minutes}m"));
    }
    // Math.round(abs / 1000.0): round half up.
    let seconds = (abs as f64 / 1000.0 + 0.5).floor() as i64;
    if include_seconds && seconds > 0 {
        labels.push(format!("{seconds}s"));
    }
    format!("{sign}{}", labels.join(" "))
}

/// Worker.formatHeartbeat: `Instant.toString` is ISO_INSTANT (UTC, `Z`,
/// fraction only when non-zero).
pub fn format_heartbeat(last_heartbeat: DateTime<Utc>, now: DateTime<Utc>) -> String {
    // Scala's Instant has millisecond precision.
    let millis = last_heartbeat.timestamp_millis();
    let last_heartbeat = DateTime::from_timestamp_millis(millis).unwrap_or(last_heartbeat);
    format!(
        "Last heartbeat was at {} ({} ago)",
        last_heartbeat.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true),
        format_duration(now.timestamp_millis() - millis)
    )
}

/// JobService.durationLabel: ` after [waiting <wait> and running ]<duration>`
/// when the job has started and ended, else empty.
pub fn job_duration_label(
    created: DateTime<Utc>,
    started: Option<DateTime<Utc>>,
    ended: Option<DateTime<Utc>>,
    last_retry: Option<DateTime<Utc>>,
) -> String {
    let wait_label = started
        .map(|s| {
            let wait = (s - last_retry.unwrap_or(created)).num_milliseconds();
            format!("waiting {} and running ", format_duration(wait))
        })
        .unwrap_or_default();
    match (started, ended) {
        (Some(s), Some(e)) => format!(
            " after {wait_label}{}",
            format_duration((e - s).num_milliseconds())
        ),
        _ => String::new(),
    }
}

/// Job.resultLinkSlackFormatted (given resultLinkPublic).
pub fn result_link_slack_formatted(result_link_public: Option<&str>) -> String {
    result_link_public
        .map(|link| format!(" <{link}|Result>"))
        .unwrap_or_default()
}

/// Job.workflowLinkSlackFormatted.
pub fn workflow_link_slack_formatted(public_uri: &str, workflow_hash: Option<&str>) -> String {
    workflow_hash
        .map(|hash| format!(" <{public_uri}/workflows/{hash}|Workflow Report>"))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn config_defaults_disable_sending() {
        let config = config_from_values(&HashMap::new()).unwrap();
        assert!(config.uri.is_none());
        assert!(!config.verbose_logging_enabled);
        assert_eq!(config.public_uri, "http://localhost:9000");
        assert!(!SlackNotificationService::new(&config).is_enabled());
        let empty = HashMap::from([("WK_SLACK_NOTIFICATIONS_URI".into(), " ".into())]);
        assert!(config_from_values(&empty).unwrap().uri.is_none());
    }

    #[test]
    fn config_parses_values_and_redacts_uri() {
        let values = HashMap::from([
            (
                "WK_SLACK_NOTIFICATIONS_URI".to_owned(),
                "https://hooks.slack.com/services/T0/B0/hooktoken".to_owned(),
            ),
            (
                "WK_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED".to_owned(),
                "true".to_owned(),
            ),
            (
                "WK_PUBLIC_URL".to_owned(),
                "https://wk.example.org/".to_owned(),
            ),
        ]);
        let config = config_from_values(&values).unwrap();
        assert!(config.uri.is_some());
        assert!(config.verbose_logging_enabled);
        assert_eq!(config.public_uri, "https://wk.example.org");
        assert!(!format!("{config:?}").contains("hooktoken"));
        let service = SlackNotificationService::new(&config);
        assert!(service.is_enabled());
        assert!(!format!("{service:?}").contains("hooktoken"));

        for (key, value) in [
            ("WK_SLACK_NOTIFICATIONS_URI", "not a url"),
            ("WK_SLACK_NOTIFICATIONS_URI", "ftp://example.org/hook"),
            ("WK_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED", "yes"),
        ] {
            let values = HashMap::from([(key.to_owned(), value.to_owned())]);
            assert!(config_from_values(&values).is_err(), "{key}={value}");
        }
    }

    #[test]
    fn messages_match_scala_format() {
        let body = payload(attachment(
            "WEBKNOSSOS at http://localhost:9000",
            "Startup",
            "WEBKNOSSOS version `1.0` started",
            COLOR_INFO,
        ));
        // Key order is irrelevant to Slack (the main crate has no serde_json preserve_order).
        let expected: Value = serde_json::from_str(
            r##"{"attachments":[{"title":"Startup reported from WEBKNOSSOS at http://localhost:9000","text":"WEBKNOSSOS version `1.0` started","color":"#333ccc"}]}"##,
        )
        .unwrap();
        assert_eq!(body, expected);
        assert_eq!(
            [COLOR_WARN, COLOR_INFO, COLOR_SUCCESS, COLOR_ERROR],
            ["#ff8a00", "#333ccc", "#049b4a", "#e10000"]
        );
    }

    #[test]
    fn rate_limit_is_a_fixed_window_of_thirty_per_minute() {
        let start = Instant::now();
        let mut limiter = RateLimiter::default();
        for _ in 0..30 {
            assert!(limiter.test_and_set(start));
        }
        assert!(!limiter.test_and_set(start));
        // Exactly one interval later the window is still running (strict `>`).
        assert!(!limiter.test_and_set(start + RATE_LIMIT_INTERVAL));
        assert_eq!(limiter.sent_since_reset(), 30);
        let later = start + RATE_LIMIT_INTERVAL + Duration::from_millis(1);
        assert!(limiter.test_and_set(later));
        assert_eq!(limiter.sent_since_reset(), 1);
        // The new window starts at `later`, not at the old window's end.
        for _ in 0..29 {
            assert!(limiter.test_and_set(later + Duration::from_secs(59)));
        }
        assert!(!limiter.test_and_set(later + Duration::from_secs(60)));
        assert!(limiter.test_and_set(later + Duration::from_secs(61)));
    }

    #[test]
    fn format_duration_matches_scala_formatter() {
        for (millis, expected) in [
            (0, "0ms"),
            (999, "999ms"),
            (-500, "-500ms"),
            (1000, "1s"),
            (1500, "1.5s"),
            (1234, "1.23s"),
            (1999, "1s"), // Scala quirk: centis rounds to 100 % 100 = 0
            (59994, "59.99s"),
            (59995, "1m"),
            (61_000, "1m 1s"),
            (3_599_600, "1h"),
            (3_661_000, "1h 1m 1s"),
            (86_400_000, "1 day"),
            (
                2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000,
                "2 days 3h 4m",
            ),
            (86_399_600, "1 day"),
        ] {
            assert_eq!(format_duration(millis), expected, "{millis}");
        }
    }

    #[test]
    fn job_labels_match_job_service() {
        let at = |s: i64| Utc.timestamp_millis_opt(s * 1000).unwrap();
        assert_eq!(job_duration_label(at(0), None, None, None), "");
        assert_eq!(job_duration_label(at(0), Some(at(5)), None, None), "");
        assert_eq!(
            job_duration_label(at(0), Some(at(5)), Some(at(70)), None),
            " after waiting 5s and running 1m 5s"
        );
        assert_eq!(
            job_duration_label(at(0), Some(at(5)), Some(at(7)), Some(at(3))),
            " after waiting 2s and running 2s"
        );
        assert_eq!(result_link_slack_formatted(None), "");
        assert_eq!(
            result_link_slack_formatted(Some("http://wk/datasets/1")),
            " <http://wk/datasets/1|Result>"
        );
        assert_eq!(workflow_link_slack_formatted("http://wk", None), "");
        assert_eq!(
            workflow_link_slack_formatted("http://wk", Some("abc")),
            " <http://wk/workflows/abc|Workflow Report>"
        );
    }

    #[test]
    fn heartbeat_label_matches_worker_service() {
        let at = |millis: i64| Utc.timestamp_millis_opt(millis).unwrap();
        assert_eq!(
            format_heartbeat(at(1_700_000_000_000), at(1_700_000_125_000)),
            "Last heartbeat was at 2023-11-14T22:13:20Z (2m 5s ago)"
        );
        // ISO_INSTANT prints milliseconds only when non-zero; micros are cut.
        let micros = Utc.timestamp_micros(1_700_000_000_123_456).unwrap();
        assert_eq!(
            format_heartbeat(micros, at(1_700_000_000_623)),
            "Last heartbeat was at 2023-11-14T22:13:20.123Z (500ms ago)"
        );
    }

    #[test]
    fn disabled_service_never_spawns() {
        assert!(!global().is_enabled());
        let service = SlackNotificationService::default();
        assert!(service.send_message("t", "m", COLOR_INFO).is_none());
    }
}
