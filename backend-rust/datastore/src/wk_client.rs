//! RPC client from the datastore to the WEBKNOSSOS main application.
//!
//! Ports Scala `rpc.RPC`/`rpc.RPCRequest` (generic request builder, error/log semantics),
//! `util.cache.AlfuCache` (async loading cache that never keeps failures) and
//! `services.DSRemoteWebknossosClient` (every WK callback, its query parameters and caches,
//! plus the `IntervalScheduler` status ping).
//!
//! Every call carries `key=<datastore.key>`; calls that act for a user add `token=<user token>`
//! from the request's [`TokenContext`]. The HTTP client uses the Play WS timeouts configured in
//! `standalone-datastore.conf` (`play.ws.timeout.{request,idle,connection} = 2 hours`).

use std::{
    collections::HashMap,
    hash::Hash,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use axum::http::{Method, StatusCode, header};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::{sync::OnceCell, task::JoinHandle};
use url::Url;

use crate::{
    access::{TokenContext, UserAccessAnswer, UserAccessRequest},
    config::{DatastoreConfig, Secret},
    error::{DsError, DsResult},
};

/// Play WS `timeout.request` / `timeout.idle` / `timeout.connection` from the datastore config.
pub const PLAY_WS_TIMEOUT: Duration = Duration::from_secs(2 * 60 * 60);
/// Scala `RPCRequest.slowRequestLoggingThreshold` default.
pub const SLOW_REQUEST_THRESHOLD: Duration = Duration::from_secs(2 * 60);
/// Scala `IntervalScheduler.tickerInitialDelay` default.
pub const PING_INITIAL_DELAY: Duration = Duration::from_secs(10);
/// Scala `IntervalScheduler.innerTickerInterval`: shorter intervals are rejected at startup.
pub const PING_MIN_INTERVAL: Duration = Duration::from_millis(100);

// ---------------------------------------------------------------------------------------------
// AlfuCache
// ---------------------------------------------------------------------------------------------

/// Scala `AlfuCache`: an async loading cache. Concurrent loads of one key share a single load,
/// successful values are kept until `time_to_live` after the load or `time_to_idle` after the
/// last access (whichever comes first), and failed loads are removed so the next call retries.
///
/// Deviation: Caffeine evicts by W-TinyLFU once `max_capacity` is exceeded; this cache first drops
/// expired entries and then the least recently accessed one.
pub struct AlfuCache<K, V> {
    entries: Mutex<HashMap<K, CacheEntry<V>>>,
    max_capacity: usize,
    time_to_live: Duration,
    time_to_idle: Duration,
}

struct CacheEntry<V> {
    cell: Arc<OnceCell<DsResult<V>>>,
    /// Set once the load completed; in-flight loads never expire (Caffeine async semantics).
    loaded_at: Option<Instant>,
    accessed_at: Instant,
}

impl<V> CacheEntry<V> {
    fn is_expired(&self, now: Instant, ttl: Duration, tti: Duration) -> bool {
        self.loaded_at.is_some_and(|loaded| {
            now.duration_since(loaded) >= ttl || now.duration_since(self.accessed_at) >= tti
        })
    }
}

impl<K: Eq + Hash + Clone, V: Clone> AlfuCache<K, V> {
    /// Scala `AlfuCache.apply` defaults: capacity 1000, time to live 2 h, time to idle 1 h.
    pub fn with_defaults() -> Self {
        Self::new(
            1000,
            Duration::from_secs(2 * 60 * 60),
            Duration::from_secs(60 * 60),
        )
    }

    pub fn new(max_capacity: usize, time_to_live: Duration, time_to_idle: Duration) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            max_capacity: max_capacity.max(1),
            time_to_live,
            time_to_idle,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<K, CacheEntry<V>>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Scala `getOrLoad`.
    pub async fn get_or_load<F, Fut>(&self, key: K, load: F) -> DsResult<V>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = DsResult<V>>,
    {
        let cell = {
            let mut entries = self.lock();
            let now = Instant::now();
            let live = entries
                .get(&key)
                .is_some_and(|e| !e.is_expired(now, self.time_to_live, self.time_to_idle));
            if live {
                let entry = entries.get_mut(&key).expect("checked above");
                entry.accessed_at = now;
                entry.cell.clone()
            } else {
                entries.remove(&key);
                self.make_room(&mut entries, now);
                let cell = Arc::new(OnceCell::new());
                entries.insert(
                    key.clone(),
                    CacheEntry {
                        cell: cell.clone(),
                        loaded_at: None,
                        accessed_at: now,
                    },
                );
                cell
            }
        };
        let result = cell.get_or_init(load).await.clone();
        let mut entries = self.lock();
        if let Some(entry) = entries.get_mut(&key)
            && Arc::ptr_eq(&entry.cell, &cell)
        {
            if result.is_err() {
                // "Do not cache failures"
                entries.remove(&key);
            } else if entry.loaded_at.is_none() {
                let now = Instant::now();
                entry.loaded_at = Some(now);
                entry.accessed_at = now;
            }
        }
        result
    }

    fn make_room(&self, entries: &mut HashMap<K, CacheEntry<V>>, now: Instant) {
        if entries.len() < self.max_capacity {
            return;
        }
        entries.retain(|_, e| !e.is_expired(now, self.time_to_live, self.time_to_idle));
        while entries.len() >= self.max_capacity {
            let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, e)| e.accessed_at)
                .map(|(k, _)| k.clone())
            else {
                return;
            };
            entries.remove(&oldest);
        }
    }

    /// Scala `remove`.
    pub fn remove(&self, key: &K) {
        self.lock().remove(key);
    }

    /// Scala `clear(fn)`: removes all keys matching `predicate`, returns how many.
    pub fn clear_matching(&self, mut predicate: impl FnMut(&K) -> bool) -> usize {
        let mut entries = self.lock();
        let before = entries.len();
        entries.retain(|k, _| !predicate(k));
        before - entries.len()
    }

    /// Scala `clear()`.
    pub fn clear(&self) {
        self.lock().clear();
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

// ---------------------------------------------------------------------------------------------
// Generic RPC machinery (Scala `RPC` / `RPCRequest`)
// ---------------------------------------------------------------------------------------------

/// Scala `RPC`: shared HTTP client plus the process-wide request counter used in log lines.
#[derive(Clone)]
pub struct Rpc {
    http: reqwest::Client,
    counter: Arc<AtomicU64>,
}

impl Rpc {
    /// HTTP client with the Play WS timeouts of the datastore (2 h request/idle/connect).
    pub fn new() -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .timeout(PLAY_WS_TIMEOUT)
            .read_timeout(PLAY_WS_TIMEOUT)
            .connect_timeout(PLAY_WS_TIMEOUT)
            .build()?;
        Ok(Self {
            http,
            counter: Arc::new(AtomicU64::new(0)),
        })
    }

    /// Scala `rpc(url)`.
    pub fn request(&self, url: impl Into<String>) -> RpcRequest {
        RpcRequest {
            http: self.http.clone(),
            id: self.counter.fetch_add(1, Ordering::Relaxed),
            url: url.into(),
            query: Vec::new(),
            verbose: true,
            log_on_failure: true,
            slow_threshold: SLOW_REQUEST_THRESHOLD,
            timeout: None,
        }
    }
}

/// Scala `RPCRequest`. Non-2xx answers become `Failed RPC <id>: <METHOD> <url>. Response: <status>
/// '<first 2000 chars of the body>'` carrying the answer's status (Scala `Failure ~> status`);
/// transport errors become `Error sending RPC <id>: <METHOD> <url>: <cause>` (default status 400).
/// Log lines and messages use the URL without its query, so `key`/`token` never appear.
pub struct RpcRequest {
    http: reqwest::Client,
    id: u64,
    url: String,
    query: Vec<(String, String)>,
    verbose: bool,
    log_on_failure: bool,
    slow_threshold: Duration,
    timeout: Option<Duration>,
}

impl RpcRequest {
    /// Scala `addQueryParam`.
    pub fn query(mut self, name: &str, value: impl ToString) -> Self {
        self.query.push((name.to_owned(), value.to_string()));
        self
    }

    /// Scala `addQueryParam(key, Option)`: no parameter for `None`.
    pub fn query_opt(self, name: &str, value: Option<impl ToString>) -> Self {
        match value {
            Some(value) => self.query(name, value),
            None => self,
        }
    }

    /// Scala `withTokenFromContext`.
    pub fn with_token(self, tc: &TokenContext) -> Self {
        self.query_opt("token", tc.user_token.as_deref())
    }

    /// Scala `silent`: no debug logging of request/response bodies (failures are still logged).
    pub fn silent(mut self) -> Self {
        self.verbose = false;
        self
    }

    /// Scala `silentEvenOnFailure`.
    pub fn silent_even_on_failure(mut self) -> Self {
        self.verbose = false;
        self.log_on_failure = false;
        self
    }

    /// Scala `withSlowRequestLoggingThreshold`.
    pub fn with_slow_request_logging_threshold(mut self, threshold: Duration) -> Self {
        self.slow_threshold = threshold;
        self
    }

    /// Per-request timeout override (Scala `withRequestTimeout`, e.g. `withLongTimeout`).
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    pub async fn get(self) -> DsResult<Vec<u8>> {
        self.perform(Method::GET, None).await
    }

    pub async fn get_json<T: DeserializeOwned>(self) -> DsResult<T> {
        let rpc_info = self.debug_info(&Method::GET);
        let verbose = self.verbose;
        let body = self.perform(Method::GET, None).await?;
        parse_json(&rpc_info, verbose, &body)
    }

    pub async fn post_json<B: Serialize + ?Sized>(self, body: &B) -> DsResult<Vec<u8>> {
        let body = self.json_body(&Method::POST, body)?;
        self.perform(Method::POST, Some(body)).await
    }

    pub async fn post_json_with_json_response<B: Serialize + ?Sized, T: DeserializeOwned>(
        self,
        body: &B,
    ) -> DsResult<T> {
        let rpc_info = self.debug_info(&Method::POST);
        let verbose = self.verbose;
        let body = self.json_body(&Method::POST, body)?;
        let response = self.perform(Method::POST, Some(body)).await?;
        parse_json(&rpc_info, verbose, &response)
    }

    pub async fn put_json<B: Serialize + ?Sized>(self, body: &B) -> DsResult<Vec<u8>> {
        let body = self.json_body(&Method::PUT, body)?;
        self.perform(Method::PUT, Some(body)).await
    }

    pub async fn patch_json<B: Serialize + ?Sized>(self, body: &B) -> DsResult<Vec<u8>> {
        let body = self.json_body(&Method::PATCH, body)?;
        self.perform(Method::PATCH, Some(body)).await
    }

    pub async fn delete(self) -> DsResult<Vec<u8>> {
        self.perform(Method::DELETE, None).await
    }

    fn debug_info(&self, method: &Method) -> String {
        format!("RPC {}: {method} {}", self.id, self.url)
    }

    fn json_body<B: Serialize + ?Sized>(&self, method: &Method, body: &B) -> DsResult<Vec<u8>> {
        serde_json::to_vec(body).map_err(|e| {
            DsError::failure(format!(
                "Error sending {}: request body is not serializable: {e}",
                self.debug_info(method)
            ))
        })
    }

    async fn perform(self, method: Method, body: Option<Vec<u8>>) -> DsResult<Vec<u8>> {
        let rpc_info = self.debug_info(&method);
        let send_error = |cause: String| {
            let message = format!("Error sending {rpc_info}: {cause}");
            if self.log_on_failure {
                tracing::error!("{message}");
            }
            DsError::failure(message)
        };
        let mut url = Url::parse(&self.url).map_err(|e| send_error(e.to_string()))?;
        if !self.query.is_empty() {
            url.query_pairs_mut().extend_pairs(&self.query);
        }
        let body_preview = body.as_deref().map(preview_body).unwrap_or_default();
        if self.verbose {
            tracing::debug!("Sending {rpc_info}, RequestBody: '{body_preview}'");
        }
        let mut request = self.http.request(method, url);
        if let Some(body) = body {
            request = request
                .header(header::CONTENT_TYPE, "application/json")
                .body(body);
        }
        if let Some(timeout) = self.timeout {
            request = request.timeout(timeout);
        }
        let before = Instant::now();
        let response = request
            .send()
            .await
            .map_err(|e| send_error(error_text(e)))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|e| send_error(error_text(e)))?;
        let duration = before.elapsed();
        let log_slow = self.verbose && duration > self.slow_threshold;
        if status.is_success() {
            if log_slow {
                tracing::info!("Slow {rpc_info} took {duration:?}");
            }
            return Ok(bytes.to_vec());
        }
        let response_preview: String = String::from_utf8_lossy(&bytes).chars().take(2000).collect();
        if self.log_on_failure {
            let duration_label = if log_slow {
                format!(" Duration: {duration:?}.")
            } else {
                String::new()
            };
            tracing::error!(
                "Failed {rpc_info}, Status: {}.{duration_label} RequestBody: '{body_preview}' ResponseBody: '{response_preview}'",
                status.as_u16()
            );
        }
        Err(DsError::failure(format!(
            "Failed {rpc_info}. Response: {} '{response_preview}'",
            status.as_u16()
        ))
        .with_status(StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_REQUEST)))
    }
}

/// reqwest error text including its causes, without the URL (which carries `key`/`token`).
fn error_text(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut text = error.to_string();
    let mut source = std::error::Error::source(&error);
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

/// Scala `requestBodyPreview` for in-memory JSON bodies.
fn preview_body(body: &[u8]) -> String {
    let shown = String::from_utf8_lossy(&body[..body.len().min(100)]).into_owned();
    if body.len() > 100 {
        format!("{shown}... <omitted {} bytes>", body.len() - 100)
    } else {
        shown
    }
}

/// Scala `parseJsonResponse`.
fn parse_json<T: DeserializeOwned>(rpc_info: &str, verbose: bool, body: &[u8]) -> DsResult<T> {
    if verbose {
        let preview: String = String::from_utf8_lossy(body).chars().take(100).collect();
        tracing::debug!("Successful {rpc_info}. ResponseBody: '{preview}'");
    }
    serde_json::from_slice(body).map_err(|e| {
        let message = format!("{rpc_info} returned invalid JSON: {e}");
        tracing::error!("{message}");
        DsError::failure(message)
    })
}

// ---------------------------------------------------------------------------------------------
// DSRemoteWebknossosClient
// ---------------------------------------------------------------------------------------------

/// Scala `DataStoreStatus`, the status ping payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataStoreStatus {
    pub ok: bool,
    pub url: String,
}

/// Scala `TracingStoreInfo` (`GET /api/tracingstore`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TracingStoreInfo {
    pub name: String,
    pub url: String,
}

/// Scala `controllers.JobExportProperties`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobExportProperties {
    pub job_id: String,
    pub run_id: String,
    pub organization_id: String,
    pub export_file_name: String,
}

impl JobExportProperties {
    /// Scala `fullPathIn(orgaDir)`.
    pub fn full_path_in(&self, orga_dir: &std::path::Path) -> PathBuf {
        orga_dir
            .join(".export")
            .join(&self.run_id)
            .join(&self.export_file_name)
    }
}

/// Scala `ObjectId` JSON (24 hex digits) as answered by `findDatasetId`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ObjectIdString(String);

impl<'de> Deserialize<'de> for ObjectIdString {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        if value.len() == 24 && value.bytes().all(|b| b.is_ascii_hexdigit()) {
            Ok(Self(value))
        } else {
            Err(serde::de::Error::custom(format!(
                "Expected a valid ObjectId, got {value:?}"
            )))
        }
    }
}

/// Scala `DSRemoteWebknossosClient`. Cheap to clone (shared caches).
#[derive(Clone)]
pub struct WkClient {
    inner: Arc<WkClientInner>,
}

struct WkClientInner {
    rpc: Rpc,
    webknossos_uri: String,
    name: String,
    key: Secret,
    datastore_uri: String,
    ping_interval: Duration,
    tracingstore_uri_cache: AlfuCache<(), String>,
    /// TODO(DS4/annotation models): typed `AnnotationSource` once `AnnotationLayer` exists.
    annotation_source_cache: AlfuCache<(String, Option<String>), Value>,
    /// TODO(DS1b): typed `DataVaultCredential` (sealed-trait JSON) once vault credentials exist.
    credential_cache: AlfuCache<String, Value>,
    dataset_id_cache: AlfuCache<(String, String), String>,
}

impl WkClient {
    pub fn new(config: &DatastoreConfig) -> Result<Self, reqwest::Error> {
        Ok(Self::with_rpc(config, Rpc::new()?))
    }

    pub fn with_rpc(config: &DatastoreConfig, rpc: Rpc) -> Self {
        let five_seconds = Duration::from_secs(5);
        let five_minutes = Duration::from_secs(5 * 60);
        Self {
            inner: Arc::new(WkClientInner {
                rpc,
                webknossos_uri: config.webknossos.uri.clone(),
                name: config.name.clone(),
                key: config.key.clone(),
                datastore_uri: config.http.uri.clone(),
                ping_interval: config.webknossos.ping_interval,
                tracingstore_uri_cache: AlfuCache::with_defaults(),
                annotation_source_cache: AlfuCache::new(1000, five_seconds, five_seconds),
                credential_cache: AlfuCache::new(1000, five_seconds, five_seconds),
                dataset_id_cache: AlfuCache::new(1000, five_minutes, five_minutes),
            }),
        }
    }

    /// The shared RPC builder (for other WK-adjacent calls, e.g. the tracingstore later).
    pub fn rpc(&self) -> &Rpc {
        &self.inner.rpc
    }

    /// `rpc("$webknossosUri/api/datastores/$dataStoreName/<path>").addQueryParam("key", key)`.
    fn datastore_rpc(&self, path: &str) -> RpcRequest {
        self.inner
            .rpc
            .request(format!(
                "{}/api/datastores/{}/{path}",
                self.inner.webknossos_uri, self.inner.name
            ))
            .query("key", self.inner.key.expose())
    }

    /// Scala `reportStatus` (the `IntervalScheduler.tick`):
    /// `PATCH /api/datastores/:name/status?key=` with `{"ok":true,"url":<http.uri>}`.
    pub async fn report_status(&self) -> DsResult<()> {
        let status = DataStoreStatus {
            ok: true,
            url: self.inner.datastore_uri.clone(),
        };
        self.datastore_rpc("status").patch_json(&status).await?;
        Ok(())
    }

    /// Starts the periodic status ping (Scala `IntervalScheduler`: first tick after 10 s, then
    /// `pingInterval` after the previous tick completed). Fails like Scala's constructor for
    /// intervals below 100 ms. Abort the handle on shutdown (Scala stop hook).
    pub fn spawn_status_ping(&self) -> DsResult<JoinHandle<()>> {
        let interval = self.inner.ping_interval;
        if interval < PING_MIN_INTERVAL {
            return Err(DsError::failure(format!(
                "IntervalScheduler was initialized with interval {interval:?}. Only intervals larger than the inner ticker interval {PING_MIN_INTERVAL:?} are supported."
            )));
        }
        Ok(tokio::spawn(
            self.clone().status_ping_loop(PING_INITIAL_DELAY, interval),
        ))
    }

    /// The ping loop itself (public so tests can use short delays). Failures are logged by the
    /// RPC layer and do not stop the loop.
    pub async fn status_ping_loop(self, initial_delay: Duration, interval: Duration) {
        tokio::time::sleep(initial_delay).await;
        loop {
            let _ = self.report_status().await;
            tokio::time::sleep(interval).await;
        }
    }

    /// Scala `reportDataSource` (legacy refresh): `PUT /api/datastores/:name/datasource`.
    /// TODO(DS1a): take `&DataSource` once the model exists.
    pub async fn report_data_source<B: Serialize + ?Sized>(&self, data_source: &B) -> DsResult<()> {
        self.datastore_rpc("datasource")
            .put_json(data_source)
            .await?;
        Ok(())
    }

    /// Scala `getUnfinishedUploadsForUser`: `GET …/getUnfinishedDatasetUploadsForUser`.
    /// TODO(DS4 upload): `T = Vec<UnfinishedUpload>` once the model exists.
    pub async fn get_unfinished_uploads_for_user<T: DeserializeOwned>(
        &self,
        organization_name: &str,
        tc: &TokenContext,
    ) -> DsResult<T> {
        self.datastore_rpc("getUnfinishedDatasetUploadsForUser")
            .query("organizationName", organization_name)
            .with_token(tc)
            .get_json()
            .await
    }

    /// Scala `reportDatasetUpload`: `POST …/reportDatasetUpload?datasetId=`.
    /// TODO(DS4 upload): typed `ReportDatasetUploadParameters`.
    pub async fn report_dataset_upload<B: Serialize + ?Sized>(
        &self,
        dataset_id: &str,
        parameters: &B,
        tc: &TokenContext,
    ) -> DsResult<()> {
        self.datastore_rpc("reportDatasetUpload")
            .query("datasetId", dataset_id)
            .with_token(tc)
            .post_json(parameters)
            .await?;
        Ok(())
    }

    /// Scala `reportMagUpload`. TODO(DS4 upload): typed `ReportMagUploadParameters`.
    pub async fn report_mag_upload<B: Serialize + ?Sized>(&self, parameters: &B) -> DsResult<()> {
        self.datastore_rpc("reportMagUpload")
            .post_json(parameters)
            .await?;
        Ok(())
    }

    /// Scala `reportAttachmentUpload`. TODO(DS4 upload): typed `ReportAttachmentUploadParameters`.
    pub async fn report_attachment_upload<B: Serialize + ?Sized>(
        &self,
        parameters: &B,
    ) -> DsResult<()> {
        self.datastore_rpc("reportAttachmentUpload")
            .post_json(parameters)
            .await?;
        Ok(())
    }

    /// Scala `reportDataSources` (silent): `PUT …/datasources?organizationId=`.
    /// TODO(DS1a/DS4 inbox): typed `Seq[DataSourceWithRootPathInfo]`.
    pub async fn report_data_sources<B: Serialize + ?Sized>(
        &self,
        data_sources_with_path_info: &B,
        organization_id: Option<&str>,
    ) -> DsResult<()> {
        self.datastore_rpc("datasources")
            .query_opt("organizationId", organization_id)
            .silent()
            .put_json(data_sources_with_path_info)
            .await?;
        Ok(())
    }

    /// Scala `reportRealPaths` (silent): `PUT …/datasources/realpaths`.
    /// TODO(DS1a/DS4 inbox): typed `Seq[DataSourcePathInfo]`.
    pub async fn report_real_paths<B: Serialize + ?Sized>(&self, paths: &B) -> DsResult<()> {
        self.datastore_rpc("datasources/realpaths")
            .silent()
            .put_json(paths)
            .await?;
        Ok(())
    }

    /// Scala `reserveDatasetUpload`. TODO(DS4 upload): typed `DatasetUploadInfo` →
    /// `DatasetUploadAdditionalInfo`.
    pub async fn reserve_dataset_upload<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        info: &B,
        tc: &TokenContext,
    ) -> DsResult<T> {
        self.datastore_rpc("reserveDatasetUpload")
            .with_token(tc)
            .post_json_with_json_response(info)
            .await
    }

    /// Scala `reserveMagUpload`. TODO(DS4 upload): typed `MagUploadInfo` → `MagUploadAdditionalInfo`.
    pub async fn reserve_mag_upload<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        info: &B,
        tc: &TokenContext,
    ) -> DsResult<T> {
        self.datastore_rpc("reserveMagUpload")
            .with_token(tc)
            .post_json_with_json_response(info)
            .await
    }

    /// Scala `reserveAttachmentUpload`. TODO(DS4 upload): typed `AttachmentUploadInfo` →
    /// `AttachmentUploadAdditionalInfo`.
    pub async fn reserve_attachment_upload<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        info: &B,
        tc: &TokenContext,
    ) -> DsResult<T> {
        self.datastore_rpc("reserveAttachmentUpload")
            .with_token(tc)
            .post_json_with_json_response(info)
            .await
    }

    /// Scala `updateDataSource`: `PUT …/datasources/:datasetId`. TODO(DS1a): `&DataSource`.
    pub async fn update_data_source<B: Serialize + ?Sized>(
        &self,
        data_source: &B,
        dataset_id: &str,
        tc: &TokenContext,
    ) -> DsResult<()> {
        self.datastore_rpc(&format!("datasources/{dataset_id}"))
            .with_token(tc)
            .put_json(data_source)
            .await?;
        Ok(())
    }

    /// Scala `deleteDataset`: `POST …/deleteDataset` with the id as JSON string body.
    pub async fn delete_dataset(&self, dataset_id: &str) -> DsResult<()> {
        self.datastore_rpc("deleteDataset")
            .post_json(dataset_id)
            .await?;
        Ok(())
    }

    /// Scala `getJobExportProperties`: `GET …/jobExportProperties?jobId=&key=`.
    pub async fn get_job_export_properties(&self, job_id: &str) -> DsResult<JobExportProperties> {
        self.inner
            .rpc
            .request(format!(
                "{}/api/datastores/{}/jobExportProperties",
                self.inner.webknossos_uri, self.inner.name
            ))
            .query("jobId", job_id)
            .query("key", self.inner.key.expose())
            .get_json()
            .await
    }

    /// Scala `requestUserAccess`: `POST …/validateUserAccess?key=&token=`.
    pub async fn request_user_access(
        &self,
        access_request: &UserAccessRequest,
        tc: &TokenContext,
    ) -> DsResult<UserAccessAnswer> {
        self.datastore_rpc("validateUserAccess")
            .with_token(tc)
            .post_json_with_json_response(access_request)
            .await
    }

    /// Scala `getTracingstoreUri`: `GET /api/tracingstore?key=`, cached (2 h / 1 h idle).
    pub async fn get_tracingstore_uri(&self) -> DsResult<String> {
        self.inner
            .tracingstore_uri_cache
            .get_or_load((), || async {
                let info: TracingStoreInfo = self
                    .inner
                    .rpc
                    .request(format!("{}/api/tracingstore", self.inner.webknossos_uri))
                    .query("key", self.inner.key.expose())
                    .get_json()
                    .await?;
                Ok(info.url)
            })
            .await
    }

    /// Scala `getAnnotationSource`: `GET /api/annotations/source/:accessToken?key=&userToken=`,
    /// cached 5 s per (access token, user token). Returns the raw JSON until the
    /// `AnnotationSource` model exists (TODO DS4).
    pub async fn get_annotation_source(
        &self,
        access_token: &str,
        tc: &TokenContext,
    ) -> DsResult<Value> {
        self.inner
            .annotation_source_cache
            .get_or_load((access_token.to_owned(), tc.user_token.clone()), || {
                self.inner
                    .rpc
                    .request(format!(
                        "{}/api/annotations/source/{access_token}",
                        self.inner.webknossos_uri
                    ))
                    .query("key", self.inner.key.expose())
                    .query_opt("userToken", tc.user_token.as_deref())
                    .get_json()
            })
            .await
    }

    /// Scala `getCredential` (silent): `GET …/findCredential?credentialId=&key=`, cached 5 s.
    /// Returns the raw credential JSON until DS1b types `DataVaultCredential` (secrets: never log).
    pub async fn get_credential(&self, credential_id: &str) -> DsResult<Value> {
        self.inner
            .credential_cache
            .get_or_load(credential_id.to_owned(), || {
                self.inner
                    .rpc
                    .request(format!(
                        "{}/api/datastores/{}/findCredential",
                        self.inner.webknossos_uri, self.inner.name
                    ))
                    .query("credentialId", credential_id)
                    .query("key", self.inner.key.expose())
                    .silent()
                    .get_json()
            })
            .await
    }

    /// Scala `getDataSource`: `GET …/datasources/:datasetId`. TODO(DS1a): `T = DataSource`.
    pub async fn get_data_source<T: DeserializeOwned>(&self, dataset_id: &str) -> DsResult<T> {
        self.datastore_rpc(&format!("datasources/{dataset_id}"))
            .get_json()
            .await
            .map_err(|e| e.wrap("Failed to get data source from remote webknossos"))
    }

    /// Scala `getDatasetId`: `GET …/findDatasetId?key=&organizationId=&datasetDirectoryName=`,
    /// cached 5 min per (organization, directory name).
    pub async fn get_dataset_id(
        &self,
        organization_id: &str,
        dataset_directory_name: &str,
    ) -> DsResult<String> {
        self.inner
            .dataset_id_cache
            .get_or_load(
                (
                    organization_id.to_owned(),
                    dataset_directory_name.to_owned(),
                ),
                || async {
                    let id: ObjectIdString = self
                        .datastore_rpc("findDatasetId")
                        .query("organizationId", organization_id)
                        .query("datasetDirectoryName", dataset_directory_name)
                        .get_json()
                        .await
                        .map_err(|e| e.wrap("Failed to get dataset id from remote webknossos"))?;
                    Ok(id.0)
                },
            )
            .await
    }

    /// Scala `getLocalRootPathOrEmpty`: `GET …/findDatasetLocalRootPath?key=&datasetId=`.
    /// An empty answer is Scala `Fox.empty` → `Ok(None)`.
    pub async fn get_local_root_path_or_empty(
        &self,
        dataset_id: &str,
    ) -> DsResult<Option<PathBuf>> {
        let root: String = self
            .datastore_rpc("findDatasetLocalRootPath")
            .query("datasetId", dataset_id)
            .get_json()
            .await
            .map_err(|e| e.wrap("Failed to get data source root path remote webknossos"))?;
        Ok((!root.is_empty()).then(|| PathBuf::from(root)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn body_preview_truncates_like_scala() {
        assert_eq!(preview_body(b"{}"), "{}");
        let long = vec![b'a'; 130];
        assert_eq!(
            preview_body(&long),
            format!("{}... <omitted 30 bytes>", "a".repeat(100))
        );
    }

    #[test]
    fn object_id_answers_are_validated() {
        let ok: ObjectIdString = serde_json::from_str("\"5f0c4e8a2b00002b00b4a1c3\"").unwrap();
        assert_eq!(ok.0, "5f0c4e8a2b00002b00b4a1c3");
        assert!(serde_json::from_str::<ObjectIdString>("\"nope\"").is_err());
    }

    #[tokio::test]
    async fn cache_keeps_values_and_drops_failures() {
        let cache: AlfuCache<&str, u32> = AlfuCache::with_defaults();
        let calls = AtomicUsize::new(0);
        let load = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(7)
        };
        assert_eq!(cache.get_or_load("a", load).await.unwrap(), 7);
        assert_eq!(cache.get_or_load("a", load).await.unwrap(), 7);
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let fail = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(DsError::failure("boom"))
        };
        assert!(cache.get_or_load("b", fail).await.is_err());
        assert!(cache.get_or_load("b", fail).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert_eq!(cache.len(), 1);
    }

    #[tokio::test]
    async fn cache_entries_expire() {
        let cache: AlfuCache<u8, u8> =
            AlfuCache::new(10, Duration::from_millis(30), Duration::from_secs(60));
        let calls = AtomicUsize::new(0);
        let load = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(1)
        };
        cache.get_or_load(1, load).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        cache.get_or_load(1, load).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn cache_shares_concurrent_loads() {
        let cache: AlfuCache<u8, u8> = AlfuCache::with_defaults();
        let calls = AtomicUsize::new(0);
        let load = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(30)).await;
            Ok(5)
        };
        let (a, b) = tokio::join!(cache.get_or_load(1, load), cache.get_or_load(1, load));
        assert_eq!((a.unwrap(), b.unwrap()), (5, 5));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cache_evicts_least_recently_used_at_capacity() {
        let cache: AlfuCache<u8, u8> =
            AlfuCache::new(2, Duration::from_secs(60), Duration::from_secs(60));
        for key in [1, 2] {
            cache
                .get_or_load(key, || async move { Ok(key) })
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        cache.get_or_load(1, || async { Ok(99) }).await.unwrap();
        tokio::time::sleep(Duration::from_millis(2)).await;
        cache.get_or_load(3, || async { Ok(3) }).await.unwrap();
        assert_eq!(cache.len(), 2);
        // 2 was least recently used and is reloaded.
        assert_eq!(cache.get_or_load(2, || async { Ok(42) }).await.unwrap(), 42);
    }
}
