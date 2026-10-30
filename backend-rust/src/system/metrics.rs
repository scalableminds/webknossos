//! Prometheus text-format metrics for canary and cutover monitoring.
//!
//! Recorded for every request by [`record`] (method, matched route template, status): a counter and
//! a latency histogram. Raw URIs are never used as labels (unbounded cardinality, tokens in legacy
//! query strings). [`router`] serves `GET /metrics`; `main` binds it only when `WK_METRICS_BIND`
//! is set, on its own listener, so metrics are never exposed on the public application port.
use std::{
    collections::HashMap,
    fmt::Write as _,
    sync::{
        Arc, OnceLock, RwLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use axum::{
    Router,
    extract::{MatchedPath, Request, State},
    http::header,
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
};
use sqlx::PgPool;

/// Upper bounds in seconds; the last bucket is `+Inf`.
const BUCKETS: [f64; 13] = [
    0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 10.0, 60.0,
];

#[derive(Default)]
struct Series {
    count: AtomicU64,
    sum_micros: AtomicU64,
    buckets: [AtomicU64; BUCKETS.len()],
}

type Key = (String, String, u16);

#[derive(Default)]
pub struct Metrics {
    series: RwLock<HashMap<Key, Arc<Series>>>,
}

fn started() -> &'static (Instant, SystemTime) {
    static STARTED: OnceLock<(Instant, SystemTime)> = OnceLock::new();
    STARTED.get_or_init(|| (Instant::now(), SystemTime::now()))
}

pub fn global() -> &'static Metrics {
    static METRICS: OnceLock<Metrics> = OnceLock::new();
    started();
    METRICS.get_or_init(Metrics::default)
}

impl Metrics {
    pub fn observe(&self, method: &str, route: &str, status: u16, seconds: f64) {
        let key = (method.to_owned(), route.to_owned(), status);
        let existing = self
            .series
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&key)
            .cloned();
        let series = existing.unwrap_or_else(|| {
            Arc::clone(
                self.series
                    .write()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .entry(key)
                    .or_default(),
            )
        });
        series.count.fetch_add(1, Ordering::Relaxed);
        series
            .sum_micros
            .fetch_add((seconds * 1_000_000.0) as u64, Ordering::Relaxed);
        for (bound, bucket) in BUCKETS.iter().zip(&series.buckets) {
            if seconds <= *bound {
                bucket.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub fn render(&self, pool: Option<&PgPool>, version: &str, commit: &str) -> String {
        let mut out = String::new();
        let label = |text: &str| text.replace('\\', "\\\\").replace('"', "\\\"");
        out.push_str(
            "# HELP wk_http_requests_total HTTP requests by method, route template and status.\n",
        );
        out.push_str("# TYPE wk_http_requests_total counter\n");
        let series = self
            .series
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut keys: Vec<&Key> = series.keys().collect();
        keys.sort();
        for key @ (method, route, status) in &keys {
            let count = series[*key].count.load(Ordering::Relaxed);
            let _ = writeln!(
                out,
                "wk_http_requests_total{{method=\"{}\",route=\"{}\",status=\"{status}\"}} {count}",
                label(method),
                label(route)
            );
        }
        out.push_str(
            "# HELP wk_http_request_duration_seconds Request latency by method, route template and status.\n",
        );
        out.push_str("# TYPE wk_http_request_duration_seconds histogram\n");
        for key @ (method, route, status) in &keys {
            let entry = &series[*key];
            let labels = format!(
                "method=\"{}\",route=\"{}\",status=\"{status}\"",
                label(method),
                label(route)
            );
            for (bound, bucket) in BUCKETS.iter().zip(&entry.buckets) {
                let _ = writeln!(
                    out,
                    "wk_http_request_duration_seconds_bucket{{{labels},le=\"{bound}\"}} {}",
                    bucket.load(Ordering::Relaxed)
                );
            }
            let count = entry.count.load(Ordering::Relaxed);
            let _ = writeln!(
                out,
                "wk_http_request_duration_seconds_bucket{{{labels},le=\"+Inf\"}} {count}"
            );
            let _ = writeln!(
                out,
                "wk_http_request_duration_seconds_sum{{{labels}}} {}",
                entry.sum_micros.load(Ordering::Relaxed) as f64 / 1_000_000.0
            );
            let _ = writeln!(
                out,
                "wk_http_request_duration_seconds_count{{{labels}}} {count}"
            );
        }
        drop(series);
        if let Some(pool) = pool {
            out.push_str("# HELP wk_db_pool_connections Database pool connections by state.\n");
            out.push_str("# TYPE wk_db_pool_connections gauge\n");
            let idle = pool.num_idle() as u64;
            let size = u64::from(pool.size());
            let _ = writeln!(out, "wk_db_pool_connections{{state=\"idle\"}} {idle}");
            let _ = writeln!(
                out,
                "wk_db_pool_connections{{state=\"in_use\"}} {}",
                size.saturating_sub(idle)
            );
            let _ = writeln!(
                out,
                "wk_db_pool_connections_max {}",
                pool.options().get_max_connections()
            );
        }
        let (_, wall) = started();
        let _ = writeln!(
            out,
            "# TYPE wk_process_start_time_seconds gauge\nwk_process_start_time_seconds {}",
            wall.duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        );
        let _ = writeln!(
            out,
            "# TYPE wk_build_info gauge\nwk_build_info{{version=\"{}\",commit=\"{}\"}} 1",
            label(version),
            label(commit)
        );
        out
    }
}

/// Middleware recording one observation per request under its matched route template.
pub async fn record(request: Request, next: Next) -> Response {
    let method = request.method().as_str().to_owned();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".to_owned());
    let start = Instant::now();
    let response = next.run(request).await;
    global().observe(
        &method,
        &route,
        response.status().as_u16(),
        start.elapsed().as_secs_f64(),
    );
    response
}

#[derive(Clone)]
struct MetricsState {
    pool: PgPool,
    version: String,
    commit: String,
}

/// The `/metrics` router for the separate metrics listener.
pub fn router(pool: PgPool, version: String, commit: String) -> Router {
    Router::new()
        .route("/metrics", get(render))
        .with_state(MetricsState {
            pool,
            version,
            commit,
        })
}

async fn render(State(state): State<MetricsState>) -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        global().render(Some(&state.pool), &state.version, &state.commit),
    )
}

#[cfg(test)]
mod system_metrics_tests;
