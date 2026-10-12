//! Rust implementation of the WEBKNOSSOS datastore (`webknossos-datastore`).
//! See ../checkpoints/datastore-plan.md for the migration plan and
//! ../checkpoints/datastore-ds0a.md for the foundation decisions.

pub mod access;
pub mod compression;
pub mod config;
pub mod controllers;
pub mod datareaders;
pub mod datavault;
pub mod error;
pub mod explore;
pub mod models;
pub mod proto;
pub mod redis;
pub mod redis_store;
pub mod services;
pub mod tracingstore_client;
pub mod versioning;
pub mod wk_client;

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use tower_http::{
    catch_panic::CatchPanicLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
};

use crate::{
    access::AccessTokenService,
    config::DatastoreConfig,
    error::{DsError, DsResult},
    versioning::RequestedApiVersion,
    wk_client::WkClient,
};

/// Shared state of the datastore service.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<DatastoreConfig>,
    pub health: HealthProblems,
    pub data_vaults: crate::datavault::DataVaultService,
    pub chunk_contents_cache: Arc<crate::datareaders::ChunkContentsCache>,
    pub binary_data: Arc<crate::services::BinaryDataService>,
    pub datasets: crate::services::DatasetCache,
    pub data_sources: crate::services::DataSourceService,
    pub base_dirs: crate::services::BaseDirService,
    pub source_scanner: crate::services::DataSourceScanner,
    /// RPC client to WEBKNOSSOS (Scala `DSRemoteWebknossosClient`).
    pub wk_client: WkClient,
    /// User access checks (Scala `DataStoreAccessTokenService`).
    pub access: AccessTokenService,
    /// RPC client to tracingstores (Scala `DSRemoteTracingstoreClient`).
    pub tracingstore: crate::tracingstore_client::TracingstoreClient,
    /// Resumable uploads (Scala `UploadService`, Redis metadata).
    pub uploads: crate::services::upload::UploadService,
    /// Agglomerate files (Scala `AgglomerateService`), also the data mapper of `binary_data`.
    pub agglomerates: Arc<crate::services::agglomerate::AgglomerateService>,
    /// Segment index files (Scala `SegmentIndexFileService`).
    pub segment_index: Arc<crate::services::segment_index::SegmentIndexService>,
    pub statistics_file: Arc<crate::services::segment_statistics_file::StatisticsFileService>,
    pub index_statistics: Arc<crate::services::index_statistics::IndexStatisticsService>,
    pub mesh_files: Arc<crate::services::mesh_file::MeshFileService>,
    pub mappings: Arc<crate::services::mapping::MappingService>,
    pub ad_hoc_mesh: Arc<crate::services::ad_hoc_mesh::AdHocMeshService>,
    pub full_mesh: Arc<crate::services::full_mesh::FullMeshService>,
    pub connectomes: Arc<crate::services::connectome::ConnectomeService>,
}

impl AppState {
    pub fn new(config: DatastoreConfig) -> Self {
        // Building a rustls client only fails if the TLS backend cannot initialize.
        let wk_client = WkClient::new(&config).expect("cannot build the WEBKNOSSOS HTTP client");
        let health = HealthProblems::default();
        let data_vaults =
            crate::datavault::DataVaultService::from_config(&config, wk_client.clone());
        let chunk_contents_cache = Arc::new(crate::datareaders::ChunkContentsCache::new(
            config.cache.image_array_chunks_max_size_bytes,
        ));
        let agglomerates = Arc::new(crate::services::agglomerate::AgglomerateService::new(
            data_vaults.clone(),
            Arc::clone(&chunk_contents_cache),
            config.agglomerate_tree_max_edges,
            config.agglomerate_graph_max_edges,
            config.cache.agglomerate_file.clone(),
        ));
        let binary_data = Arc::new(crate::services::BinaryDataService::new(
            data_vaults.clone(),
            Arc::clone(&chunk_contents_cache),
            health.clone(),
            Some(Arc::new(
                crate::services::agglomerate::AgglomerateDataMapper(Arc::clone(&agglomerates)),
            )),
        ));
        let base_dirs = crate::services::BaseDirService::new(config.base_directories.clone());
        let data_sources = crate::services::DataSourceService::new(data_vaults.clone());
        let uploads = crate::services::upload::UploadService::new(
            base_dirs.clone(),
            crate::redis_store::RedisStore::new(&config.redis),
            config.upload_delete_temporary_files_after_upload,
        );
        let segment_index = Arc::new(crate::services::segment_index::SegmentIndexService::new(
            data_vaults.clone(),
            Arc::clone(&chunk_contents_cache),
        ));
        let mappings = Arc::new(crate::services::mapping::MappingService::new(
            base_dirs.clone(),
            config.cache.mapping_max_entries as usize,
        ));
        let ad_hoc_mesh = Arc::new(crate::services::ad_hoc_mesh::AdHocMeshService::new(
            Arc::clone(&binary_data),
            Arc::clone(&agglomerates),
            Arc::clone(&mappings),
            config.ad_hoc_mesh.timeout,
            config.ad_hoc_mesh.actor_pool_size as usize,
        ));
        Self {
            connectomes: Arc::new(crate::services::connectome::ConnectomeService::new(
                data_vaults.clone(),
                Arc::clone(&chunk_contents_cache),
            )),
            full_mesh: Arc::new(crate::services::full_mesh::FullMeshService::default()),
            mappings,
            ad_hoc_mesh,
            mesh_files: Arc::new(crate::services::mesh_file::MeshFileService::new(
                data_vaults.clone(),
                Arc::clone(&chunk_contents_cache),
            )),
            index_statistics: Arc::new(
                crate::services::index_statistics::IndexStatisticsService::new(
                    Arc::clone(&segment_index),
                    Arc::clone(&agglomerates),
                    Arc::clone(&binary_data),
                ),
            ),
            statistics_file: Arc::new(
                crate::services::segment_statistics_file::StatisticsFileService::new(
                    data_vaults.clone(),
                    Arc::clone(&chunk_contents_cache),
                ),
            ),
            uploads,
            agglomerates,
            segment_index,
            source_scanner: crate::services::DataSourceScanner::new(
                base_dirs.clone(),
                data_sources.clone(),
                wk_client.clone(),
            ),
            base_dirs,
            data_sources,
            datasets: crate::services::DatasetCache::new(wk_client.clone()),
            access: AccessTokenService::new(wk_client.clone()),
            tracingstore: crate::tracingstore_client::TracingstoreClient::new(
                wk_client.rpc().clone(),
            ),
            wk_client,
            config: Arc::new(config),
            health,
            data_vaults,
            chunk_contents_cache,
            binary_data,
        }
    }
}

/// Scala `ApplicationHealthService`: internal errors during data loading make the health check
/// fail for one minute. Scala records JVM `InternalError`s (typically native-code failures) from
/// `DatasetErrorLoggingService`; the Rust data-loading path (DS3) reports its equivalent here.
#[derive(Clone, Default)]
pub struct HealthProblems {
    latest: Arc<Mutex<Option<(Instant, String)>>>,
}

impl HealthProblems {
    /// Scala `getRecentProblem` default window.
    pub const RECENT_WINDOW: Duration = Duration::from_secs(60);

    pub fn push(&self, message: impl Into<String>) {
        let mut latest = self.latest.lock().unwrap_or_else(|e| e.into_inner());
        *latest = Some((Instant::now(), message.into()));
    }

    pub fn recent_problem(&self, window: Duration) -> Option<String> {
        let latest = self.latest.lock().unwrap_or_else(|e| e.into_inner());
        latest
            .as_ref()
            .filter(|(at, _)| at.elapsed() < window)
            .map(|(_, message)| message.clone())
    }
}

/// Scala `MissingBucketHeaders` names, exposed to browsers by the CORS preflight answer.
const EXPOSED_HEADERS: &str = "failure-bucket-indices, empty-bucket-indices, MISSING-BUCKETS";

/// Body of the Pekko HTTP request-timeout response (`play.server.pekko.requestTimeout`).
const REQUEST_TIMEOUT_BODY: &str = "The server was not able to produce a timely response to your request.\r\nPlease try again in a short while!";

/// The datastore HTTP API.
pub fn router(state: AppState) -> Router {
    let body_limit = usize::try_from(state.config.http.max_disk_buffer).unwrap_or(usize::MAX);
    let json_body_limit =
        usize::try_from(state.config.http.max_memory_buffer).unwrap_or(usize::MAX);
    let request_timeout = state.config.http.request_timeout;

    // Scala `controllers.Application` (allowRemoteOrigin = true).
    let application = controller(Router::new().route("/data/health", get(health)), true);

    let routes = Router::new()
        .route("/", get(frontpage))
        .route("/index.html", get(frontpage))
        .merge(application)
        .merge(controllers::binary_data::router().layer(DefaultBodyLimit::max(json_body_limit)))
        .merge(controllers::data_source::router().layer(DefaultBodyLimit::max(json_body_limit)))
        .merge(controllers::data_proxy::router())
        .merge(
            controllers::segment_statistics::router().layer(DefaultBodyLimit::max(json_body_limit)),
        )
        .merge(controllers::agglomerates::router().layer(DefaultBodyLimit::max(json_body_limit)))
        .merge(controllers::meshes::router().layer(DefaultBodyLimit::max(json_body_limit)))
        .merge(controllers::ad_hoc_mesh::router().layer(DefaultBodyLimit::max(json_body_limit)))
        .merge(controllers::connectomes::router().layer(DefaultBodyLimit::max(json_body_limit)))
        .merge(controllers::upload::router())
        .merge(controllers::thumbnails::router().layer(DefaultBodyLimit::max(json_body_limit)))
        .merge(controllers::zarr_streaming::router())
        .merge(controllers::exports::router().layer(DefaultBodyLimit::max(json_body_limit)))
        .fallback(|| async { DsError::route_not_found() })
        .method_not_allowed_fallback(|| async {
            DsError::failure("Method not allowed.").with_status(StatusCode::METHOD_NOT_ALLOWED)
        })
        .layer(DefaultBodyLimit::max(body_limit))
        .with_state(state);

    // Middleware on this outer router runs before `routes` does its own routing, so the
    // version rewrite below changes which route matches.
    Router::new()
        .fallback_service(routes)
        .layer(middleware::from_fn(request_handler))
        .layer(middleware::from_fn_with_state(request_timeout, timeout))
        .layer(CatchPanicLayer::custom(|_| {
            DsError::internal().into_response()
        }))
        .layer(middleware::from_fn(security_headers))
        .layer(middleware::from_fn(log_failures))
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
}

/// What every Scala `Action.fox` result gets from `boxToResult`: `Cache-Control: no-cache` unless
/// the handler set one, plus the remote-origin headers for controllers with `allowRemoteOrigin`.
pub fn controller<S: Clone + Send + Sync + 'static>(
    router: Router<S>,
    allow_remote_origin: bool,
) -> Router<S> {
    router.route_layer(middleware::from_fn(
        move |request: Request, next: Next| async move {
            let mut response = next.run(request).await;
            let headers = response.headers_mut();
            headers
                .entry(header::CACHE_CONTROL)
                .or_insert(HeaderValue::from_static("no-cache"));
            if allow_remote_origin {
                headers.insert(
                    header::ACCESS_CONTROL_ALLOW_ORIGIN,
                    HeaderValue::from_static("*"),
                );
                headers.insert(
                    header::ACCESS_CONTROL_MAX_AGE,
                    HeaderValue::from_static("600"),
                );
            }
            response
        },
    ))
}

/// Scala `DsRequestHandler.routeRequest` + `ApiVersioning`.
async fn request_handler(mut request: Request, next: Next) -> Response {
    if request.method() == Method::OPTIONS {
        return options_response(request.headers());
    }
    let path = request.uri().path().to_owned();
    if let Some(message) = versioning::invalid_version_message(&path) {
        return DsError::failure(message)
            .with_status(StatusCode::NOT_FOUND)
            .into_response();
    }
    let version = match versioning::latest_alias(request.method().as_str(), &path) {
        Some((version, rewritten)) => {
            let path_and_query = match request.uri().query() {
                Some(query) => format!("{rewritten}?{query}"),
                None => rewritten,
            };
            let mut parts = request.uri().clone().into_parts();
            parts.path_and_query = path_and_query.parse().ok();
            if let Ok(uri) = Uri::from_parts(parts) {
                *request.uri_mut() = uri;
            }
            version
        }
        None => versioning::requested_version_digits(&path)
            .and_then(|digits| digits.parse().ok())
            .unwrap_or(versioning::CURRENT_API_VERSION),
    };
    request
        .extensions_mut()
        .insert(RequestedApiVersion(version));
    next.run(request).await
}

/// Scala `AdditionalHeaders.options`: every OPTIONS request is a successful CORS preflight.
fn options_response(request_headers: &HeaderMap) -> Response {
    let requested_headers = request_headers
        .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static(""));
    (
        [
            (
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            ),
            (
                header::ACCESS_CONTROL_MAX_AGE,
                HeaderValue::from_static("600"),
            ),
            (
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static("POST, GET, DELETE, PUT, HEAD, PATCH, OPTIONS"),
            ),
            (header::ACCESS_CONTROL_ALLOW_HEADERS, requested_headers),
            (
                header::ACCESS_CONTROL_EXPOSE_HEADERS,
                HeaderValue::from_static(EXPOSED_HEADERS),
            ),
        ],
        ":D",
    )
        .into_response()
}

async fn timeout(State(duration): State<Duration>, request: Request, next: Next) -> Response {
    match tokio::time::timeout(duration, next.run(request)).await {
        Ok(response) => response,
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, REQUEST_TIMEOUT_BODY).into_response(),
    }
}

/// Play `SecurityHeadersFilter` defaults, minus `contentSecurityPolicy` and `contentTypeOptions`
/// which `standalone-datastore.conf` unsets.
async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    for (name, value) in [
        ("x-frame-options", "DENY"),
        ("x-xss-protection", "1; mode=block"),
        ("x-permitted-cross-domain-policies", "master-only"),
        (
            "referrer-policy",
            "origin-when-cross-origin, strict-origin-when-cross-origin",
        ),
    ] {
        headers
            .entry(HeaderName::from_static(name))
            .or_insert(HeaderValue::from_static(value));
    }
    response
}

/// Scala `RequestLogging.logRequestFormatted`: non-2xx answers are logged with `key`/`token`
/// query parameters redacted. (The response body is not logged.)
async fn log_failures(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let uri = redact_uri(&request.uri().to_string());
    let started = Instant::now();
    let response = next.run(request).await;
    let status = response.status();
    if !status.is_success() && method != Method::OPTIONS {
        tracing::warn!("Answering {} at {uri}", status.as_u16());
    } else {
        tracing::debug!(%method, %uri, status = status.as_u16(), elapsed_ms = started.elapsed().as_millis() as u64, "request");
    }
    response
}

/// Scala `AbstractRequestLogging.redactUri`.
pub fn redact_uri(uri: &str) -> String {
    let Some((path, query)) = uri.split_once('?') else {
        return uri.to_owned();
    };
    let redacted: Vec<String> = query
        .split('&')
        .map(|pair| match pair.split_once('=') {
            Some((name, _)) if name == "key" || name == "token" => format!("{name}=xxx"),
            _ => pair.to_owned(),
        })
        .collect();
    format!("{path}?{}", redacted.join("&"))
}

/// Scala `Application.health`.
async fn health(State(state): State<AppState>) -> DsResult<&'static str> {
    let before = Instant::now();
    redis::check_health(&state.config.redis).await?;
    let redis_duration = before.elapsed();
    if state
        .health
        .recent_problem(HealthProblems::RECENT_WINDOW)
        .is_some()
    {
        return Err(DsError::failure("Java Internal Errors detected"));
    }
    // Scala also constructs and self-tests the JNI `NativeBucketScanner` here. The Rust datastore
    // has no native library; the self-test returns with the Rust segment-id scanner (DS3/DS5).
    tracing::info!(
        "Answering ok for Datastore health check, took {:?} (Redis at {} {:?})",
        before.elapsed(),
        state.config.redis.authority(),
        redis_duration
    );
    Ok("Ok")
}

/// Scala `views.html.datastoreFrontpage` served by `DsRequestHandler` for `/` and `/index.html`.
async fn frontpage(State(state): State<AppState>) -> Html<String> {
    Html(render_frontpage(
        "Datastore",
        &state.config.name,
        &state.config.webknossos.uri,
        "/data/health",
    ))
}

fn render_frontpage(kind: &str, name: &str, wk_uri: &str, health_path: &str) -> String {
    let (kind, name, wk_uri, health_path) = (
        escape_html(kind),
        escape_html(name),
        escape_html(wk_uri),
        escape_html(health_path),
    );
    format!(
        r#"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
  <title>WEBKNOSSOS {kind}</title>
  <meta name="robot" content="noindex" />
  <link rel="shortcut icon" type="image/png" href="https://static.webknossos.org/images/icon-only.svg" />
  <style>
    * {{font-family: "Monospaced Number", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial,
    sans-serif;
    text-align: center}}
    img {{display: block; margin: auto; padding: 3em 2em 0.5em 2em}}
    a {{color:inherit; text-decoration: none}}
    a#wkLink {{color: black; font-size: 2em}}
    p#hint {{color: #777; margin-top: 4em}}
</style>
<script>
function fetchHealth() {{
  fetch("{health_path}")
    .then((r) => {{if(r.status != 200) {{throw r.status}} else {{return r.text()}}}})
    .then((status) => {{
      document.getElementById("healthcheck").innerHTML = status;
    }})
    .catch((err) => {{
      document.getElementById("healthcheck").innerHTML = "<a href=\"{health_path}\">Error</a>";
    }});
}}
</script>
</head>
<body onload="fetchHealth()">
<a href="{wk_uri}" id="wkLink">
  <img src="https://static.webknossos.org/images/icon-only.svg" alt="" />
  <span>Go to WEBKNOSSOS</span>
</a>
<p id="hint">This is the WEBKNOSSOS {kind} “{name}”. Health check: <span id="healthcheck">Loading...</span></p>
</body>
</html>
"#
    )
}

/// Twirl `HtmlFormat.escape`.
fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            '&' => out.push_str("&amp;"),
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_key_and_token_parameters() {
        assert_eq!(
            redact_uri("/data/health?token=abc&x=1&key=secret"),
            "/data/health?token=xxx&x=1&key=xxx"
        );
        assert_eq!(redact_uri("/data/x?tokenish=1"), "/data/x?tokenish=1");
        assert_eq!(redact_uri("/data/x"), "/data/x");
    }

    #[test]
    fn health_problems_expire() {
        let problems = HealthProblems::default();
        assert_eq!(problems.recent_problem(Duration::from_secs(60)), None);
        problems.push("native failure");
        assert_eq!(
            problems.recent_problem(Duration::from_secs(60)).as_deref(),
            Some("native failure")
        );
        assert_eq!(problems.recent_problem(Duration::ZERO), None);
    }

    #[test]
    fn frontpage_escapes_like_twirl() {
        let page = render_frontpage("Datastore", "<ds&\"'>", "http://wk", "/data/health");
        assert!(page.contains("“&lt;ds&amp;&quot;&#x27;&gt;”"));
        assert!(page.contains(r#"<a href="http://wk" id="wkLink">"#));
    }
}
