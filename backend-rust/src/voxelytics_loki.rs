//! LokiClient: voxelytics log storage in Grafana Loki.
//!
//! Disabled (Play: "Loki is not enabled.") unless `WK_VOXELYTICS_LOKI_URI` is
//! set. Credentials, URLs and upstream bodies never enter error output.
use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use axum::http::StatusCode;
use chrono::{DateTime, Local, NaiveDateTime, SecondsFormat, TimeZone, Utc};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::error::{ApiError, ApiResult};

const POLLING_INTERVAL: Duration = Duration::from_secs(1);
const LOG_TIME_BATCH_INTERVAL_MILLIS: i64 = 24 * 60 * 60 * 1000;
const LOG_ENTRY_QUERY_BATCH_SIZE: i64 = 5000;
const LOG_ENTRY_INSERT_BATCH_SIZE: usize = 1000;
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

/// VoxelyticsLogLevel in declaration (= severity) order.
pub(crate) const LOG_LEVELS: [&str; 7] = [
    "NOTSET", "DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL",
];

#[derive(Clone)]
pub struct LokiConfig {
    /// Base URL; empty disables Loki.
    pub uri: String,
    /// Sent as `X-Scope-OrgID` when nonempty.
    pub tenant: String,
    pub user: String,
    pub password: String,
    pub startup_timeout: Duration,
}

impl Default for LokiConfig {
    fn default() -> Self {
        Self {
            uri: String::new(),
            tenant: String::new(),
            user: String::new(),
            password: String::new(),
            startup_timeout: Duration::from_secs(60),
        }
    }
}

impl fmt::Debug for LokiConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LokiConfig")
            .field("uri", &self.uri)
            .field("tenant", &self.tenant)
            .field("user", &(!self.user.is_empty()))
            .field("password", &"[redacted]")
            .field("startup_timeout", &self.startup_timeout)
            .finish()
    }
}

#[derive(Clone)]
pub(crate) struct LokiClient {
    config: LokiConfig,
    http: reqwest::Client,
    ready: Arc<AtomicBool>,
}

fn loki_failed(status: StatusCode) -> ApiError {
    ApiError::new(status, "Loki request failed.")
}

fn map_transport(error: reqwest::Error) -> ApiError {
    if error.is_timeout() {
        ApiError::new(StatusCode::GATEWAY_TIMEOUT, "Loki request timed out.")
    } else {
        ApiError::service_unavailable("Loki is unavailable.")
    }
}

impl LokiClient {
    pub fn new(config: LokiConfig) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(5))
            // Never forward basic-auth credentials to another location.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default();
        Self {
            config,
            http,
            ready: Arc::new(AtomicBool::new(false)),
        }
    }

    fn enabled(&self) -> bool {
        !self.config.uri.is_empty()
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.config.uri.trim_end_matches('/'))
    }

    fn with_auth(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let request = if self.config.tenant.is_empty() {
            request
        } else {
            request.header("X-Scope-OrgID", &self.config.tenant)
        };
        if self.config.user.is_empty() && self.config.password.is_empty() {
            request
        } else {
            request.basic_auth(&self.config.user, Some(&self.config.password))
        }
    }

    /// serverStartupFox: poll `/ready` until Loki answers successfully. Unlike
    /// Play's memoized lazy value, a failed wait is retried by later requests.
    async fn ensure_ready(&self) -> ApiResult<()> {
        if !self.enabled() {
            return Err(ApiError::bad_request("Loki is not enabled."));
        }
        if self.ready.load(Ordering::Acquire) {
            return Ok(());
        }
        tracing::info!("Waiting for Loki to become available.");
        let deadline = tokio::time::Instant::now() + self.config.startup_timeout;
        loop {
            let response = self
                .with_auth(self.http.get(self.url("/ready")))
                .send()
                .await;
            let available = match response {
                Ok(response) if response.status().is_success() => true,
                Ok(response) if response.status().is_server_error() => {
                    tracing::info!(status = response.status().as_u16(), "Loki status");
                    false
                }
                Err(error) if error.is_connect() => {
                    tracing::info!("Loki connection exception");
                    false
                }
                _ => {
                    return Err(ApiError::new(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unexpected error while trying to connect to Loki.",
                    ));
                }
            };
            if available {
                tracing::info!("Loki is available.");
                self.ready.store(true, Ordering::Release);
                return Ok(());
            }
            tokio::time::sleep(POLLING_INTERVAL).await;
            if tokio::time::Instant::now() >= deadline {
                return Err(ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!(
                        "Loki did not become ready within {} seconds.",
                        self.config.startup_timeout.as_secs()
                    ),
                ));
            }
        }
    }

    async fn read_body(response: reqwest::Response) -> ApiResult<Vec<u8>> {
        if !response.status().is_success() {
            return Err(loki_failed(
                StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(loki_failed(StatusCode::BAD_GATEWAY));
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(map_transport)?;
            if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(bytes.len()) {
                return Err(loki_failed(StatusCode::BAD_GATEWAY));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    /// queryLogsBatched: newest entries first, in day-sized windows walking
    /// backwards from `end_millis`, until `limit` entries (if any) or the
    /// start is reached. The result is ordered by ascending timestamp.
    #[allow(clippy::too_many_arguments)]
    pub async fn query_logs_batched(
        &self,
        public_uri: &str,
        run_name: &str,
        organization_id: &str,
        task_name: Option<&str>,
        min_level: &str,
        start_millis: i64,
        end_millis: i64,
        limit: Option<i64>,
    ) -> ApiResult<Vec<Value>> {
        let mut segments: Vec<Vec<Value>> = Vec::new();
        let mut end = end_millis;
        let mut limit = limit;
        loop {
            let current_start =
                start_millis.max(end.saturating_sub(LOG_TIME_BATCH_INTERVAL_MILLIS));
            let current_limit = limit
                .unwrap_or(LOG_ENTRY_QUERY_BATCH_SIZE)
                .min(LOG_ENTRY_QUERY_BATCH_SIZE);
            if current_limit <= 0 {
                break;
            }
            let head = self
                .query_logs(
                    public_uri,
                    run_name,
                    organization_id,
                    task_name,
                    min_level,
                    current_start,
                    end,
                    current_limit,
                )
                .await?;
            let new_limit = limit.map(|l| (l - head.len() as i64).max(0));
            if head.is_empty() {
                if current_start == start_millis || new_limit == Some(0) {
                    break;
                }
                end = current_start;
            } else {
                let head_time = head[0]["timestamp"].as_i64().ok_or_else(|| {
                    ApiError::bad_request("Could not parse the Loki log entries.")
                })?;
                segments.push(head);
                // Defensive: Loki must answer strictly before `end`.
                if head_time >= end {
                    break;
                }
                end = head_time;
            }
            limit = new_limit;
        }
        Ok(segments.into_iter().rev().flatten().collect())
    }

    #[allow(clippy::too_many_arguments)]
    async fn query_logs(
        &self,
        public_uri: &str,
        run_name: &str,
        organization_id: &str,
        task_name: Option<&str>,
        min_level: &str,
        start_millis: i64,
        end_millis: i64,
        limit: i64,
    ) -> ApiResult<Vec<Value>> {
        if limit <= 0 {
            return Ok(Vec::new());
        }
        let query = log_ql(public_uri, run_name, organization_id, task_name, min_level);
        self.ensure_ready().await?;
        let request = self.http.get(self.url("/loki/api/v1/query_range")).query(&[
            ("query", query),
            ("start", iso_instant(start_millis)),
            ("end", iso_instant(end_millis)),
            ("limit", limit.to_string()),
            ("direction", "backward".to_owned()),
        ]);
        let response = self
            .with_auth(request)
            .send()
            .await
            .map_err(map_transport)?;
        let body = Self::read_body(response).await?;
        parse_query_response(&body)
            .ok_or_else(|| ApiError::bad_request("Could not parse the Loki log entries."))
    }

    /// bulkInsertBatched: push entries in batches of 1000.
    pub async fn bulk_insert_batched(
        &self,
        public_uri: &str,
        entries: &[Map<String, Value>],
        organization_id: &str,
    ) -> ApiResult<()> {
        for batch in entries.chunks(LOG_ENTRY_INSERT_BATCH_SIZE) {
            self.bulk_insert(public_uri, batch, organization_id).await?;
        }
        Ok(())
    }

    async fn bulk_insert(
        &self,
        public_uri: &str,
        entries: &[Map<String, Value>],
        organization_id: &str,
    ) -> ApiResult<()> {
        if entries.is_empty() {
            return Ok(());
        }
        self.ensure_ready().await?;
        let streams = push_streams(public_uri, entries, organization_id)
            .ok_or_else(|| ApiError::bad_request("Invalid voxelytics log entries."))?;
        let request = self
            .http
            .post(self.url("/loki/api/v1/push"))
            .json(&json!({ "streams": streams }));
        let response = self
            .with_auth(request)
            .send()
            .await
            .map_err(map_transport)?;
        Self::read_body(response).await?;
        Ok(())
    }
}

/// LogQL string literal (Go syntax) for an interpolated value. Play
/// interpolated raw values; escaping keeps run/task names from altering the query.
fn quote(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    for c in value.chars() {
        match c {
            '\\' => quoted.push_str("\\\\"),
            '"' => quoted.push_str("\\\""),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            c => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

/// Escape regular-expression metacharacters for a `=~` matcher.
fn regex_literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for c in value.chars() {
        if "\\.+*?()|[]{}^$".contains(c) {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

pub(crate) fn log_ql(
    public_uri: &str,
    run_name: &str,
    organization_id: &str,
    task_name: Option<&str>,
    min_level: &str,
) -> String {
    let index = LOG_LEVELS
        .iter()
        .position(|level| *level == min_level)
        .unwrap_or(2);
    let levels = LOG_LEVELS[index..].join("|");
    let mut filters = Vec::new();
    if let Some(task_name) = task_name {
        filters.push(format!("vx_task_name={}", quote(task_name)));
    }
    filters.push(format!("level=~{}", quote(&format!("({levels})"))));
    format!(
        "{{vx_run_name={},wk_org=~{},wk_url={}}} | json vx_task_name,level | {}",
        quote(run_name),
        quote(&regex_literal(organization_id)),
        quote(public_uri),
        filters.join(" | ")
    )
}

/// Instant.toString: ISO-8601 UTC with millisecond precision only when needed.
pub(crate) fn iso_instant(millis: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(|t| t.to_rfc3339_opts(SecondsFormat::AutoSi, true))
        .unwrap_or_else(|| millis.to_string())
}

/// `data.result[*]`: each value line (a JSON object) merged with its stream
/// labels and `timestamp` (milliseconds), sorted by timestamp.
fn parse_query_response(body: &[u8]) -> Option<Vec<Value>> {
    let response: Value = serde_json::from_slice(body).ok()?;
    let mut entries = Vec::new();
    for stream in response.get("data")?.get("result")?.as_array()? {
        let labels = stream.get("stream")?.as_object()?;
        for value in stream.get("values")?.as_array()? {
            let [nanos, line] = value.as_array()?.as_slice() else {
                return None;
            };
            let nanos = nanos.as_str()?;
            let millis: i64 = nanos.get(..nanos.len().checked_sub(6)?)?.parse().ok()?;
            let Value::Object(mut entry) = serde_json::from_str::<Value>(line.as_str()?).ok()?
            else {
                return None;
            };
            for (key, label) in labels {
                entry.insert(key.clone(), label.clone());
            }
            entry.insert("timestamp".into(), json!(millis));
            entries.push(Value::Object(entry));
        }
    }
    entries.sort_by_key(|entry| entry["timestamp"].as_i64());
    Some(entries)
}

/// The log line Play stores (field order as in LokiClient.bulkInsert).
#[derive(Serialize)]
struct LogLine<'a> {
    level: &'a str,
    pid: String,
    logger_name: &'a str,
    vx_workflow_hash: &'a str,
    vx_run_name: &'a str,
    vx_task_name: &'a str,
    message: &'a str,
    host: &'a str,
    program: &'a str,
    func_name: &'a str,
    line: String,
    path: &'a str,
    process_name: &'a str,
    thread_name: &'a str,
    vx_version: &'a str,
    user: &'a str,
    pgid: String,
    log_path: &'a str,
}

fn text<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    object.get(key)?.as_str()
}

/// Play's `as[Long]`: integral JSON numbers only.
fn long(object: &Map<String, Value>, key: &str) -> Option<i64> {
    let number = object.get(key)?.as_number()?;
    number.as_i64().or_else(|| {
        number
            .as_f64()
            .filter(|f| f.fract() == 0.0 && f.abs() < 9.2e18)
            .map(|f| f as i64)
    })
}

/// `@timestamp`: ISO (or epoch milliseconds) when it ends with `Z`, otherwise
/// `yyyy-MM-ddTHH:mm:ss.SSS` in the server's local time zone.
fn log_timestamp(value: &str) -> Option<i64> {
    if value.ends_with('Z') {
        return DateTime::parse_from_rfc3339(value)
            .ok()
            .map(|t| t.timestamp_millis())
            .or_else(|| value.parse().ok());
    }
    let naive = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f").ok()?;
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|t| t.timestamp_millis())
}

fn log_value(entry: &Map<String, Value>) -> Option<Value> {
    let vx = entry.get("vx")?.as_object()?;
    let millis = log_timestamp(text(entry, "@timestamp")?)?;
    let line = LogLine {
        level: text(entry, "level")?,
        pid: long(entry, "pid")?.to_string(),
        logger_name: text(vx, "logger_name")?,
        vx_workflow_hash: text(vx, "workflow_hash")?,
        vx_run_name: text(vx, "run_name")?,
        vx_task_name: text(vx, "task_name")?,
        message: text(entry, "message")?,
        host: text(entry, "host")?,
        program: text(entry, "program")?,
        func_name: text(vx, "func_name")?,
        line: long(vx, "line")?.to_string(),
        path: text(vx, "path")?,
        process_name: text(vx, "process_name")?,
        thread_name: text(vx, "thread_name")?,
        vx_version: text(vx, "version")?,
        user: text(vx, "user")?,
        pgid: long(vx, "process_group_id")?.to_string(),
        log_path: text(vx, "log_path")?,
    };
    Some(json!([
        format!("{millis}000000"),
        serde_json::to_string(&line).ok()?
    ]))
}

/// Loki push streams, one per (workflow hash, run name, pid) in first-seen order.
fn push_streams(
    public_uri: &str,
    entries: &[Map<String, Value>],
    organization_id: &str,
) -> Option<Vec<Value>> {
    let mut groups: Vec<((String, String, String), Vec<Value>)> = Vec::new();
    for entry in entries {
        let vx = entry.get("vx")?.as_object()?;
        let key = (
            text(vx, "workflow_hash")?.to_owned(),
            text(vx, "run_name")?.to_owned(),
            long(entry, "pid")?.to_string(),
        );
        let value = log_value(entry)?;
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, values)) => values.push(value),
            None => groups.push((key, vec![value])),
        }
    }
    Some(
        groups
            .into_iter()
            .map(|((hash, run_name, pid), values)| {
                json!({
                    "stream": {
                        "vx_workflow_hash": hash,
                        "vx_run_name": run_name,
                        "pid": pid,
                        "wk_url": public_uri,
                        "wk_org": organization_id,
                    },
                    "values": values,
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_ql_escapes_values_and_lists_levels_from_the_minimum() {
        assert_eq!(
            log_ql("http://wk", "run", "org", None, "WARNING"),
            r#"{vx_run_name="run",wk_org=~"org",wk_url="http://wk"} | json vx_task_name,level | level=~"(WARNING|ERROR|CRITICAL)""#
        );
        assert_eq!(
            log_ql("http://wk", "r\"}", "a.b", Some("t"), "unknown"),
            r#"{vx_run_name="r\"}",wk_org=~"a\\.b",wk_url="http://wk"} | json vx_task_name,level | vx_task_name="t" | level=~"(INFO|NOTICE|WARNING|ERROR|CRITICAL)""#
        );
    }

    #[test]
    fn instants_and_timestamps_follow_scala() {
        assert_eq!(iso_instant(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_instant(1_500), "1970-01-01T00:00:01.500Z");
        assert_eq!(log_timestamp("1970-01-01T00:00:01.5Z"), Some(1_500));
        assert_eq!(log_timestamp("1234Z"), None);
        assert!(log_timestamp("2024-01-01T10:00:00.123").is_some());
        assert_eq!(log_timestamp("garbage"), None);
    }

    #[test]
    fn query_responses_merge_labels_and_sort() {
        let body = json!({"data": {"result": [
            {"stream": {"vx_run_name": "r"}, "values": [
                ["3000000000", "{\"message\":\"b\"}"],
                ["1000000000", "{\"message\":\"a\"}"]
            ]}
        ]}});
        let entries = parse_query_response(body.to_string().as_bytes()).unwrap();
        assert_eq!(entries[0]["message"], "a");
        assert_eq!(entries[0]["timestamp"], 1000);
        assert_eq!(entries[1]["vx_run_name"], "r");
        assert!(parse_query_response(b"{\"data\":{}}").is_none());
    }
}
