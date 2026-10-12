# DS0b datastore WK RPC client + user access checkpoint

Owner: ds0b sub-agent. Files: backend-rust/datastore/{src/wk_client.rs, src/access.rs, AppState/main wiring in src/lib.rs + src/main.rs, tests/wk_client.rs, tests/access.rs, tests/mock_wk/mod.rs (new shared mock-WK test helper)}. No Cargo changes (reqwest/url/tokio sync were already present).

## Status

DONE (2026-10-11, finalized by coordinator after the agent hit a usage limit): full datastore suite green (lib 47, access 7, health 7, routing 6, wk_client 12); DS0b files rustfmt-clean; clippy findings remaining in the crate are only in unfinished DS1a/DS1b files. Model-typed RPC methods and CredentialLookup impl are follow-ups once DS1a/DS1b land.

## API for controllers

```rust
use crate::access::{AccessResult, TokenContext, UserAccessRequest};

async fn handler(State(state): State<AppState>, tc: TokenContext, Path(id): Path<String>)
    -> AccessResult<Json<Value>> {
    state.access.validate_access(UserAccessRequest::read_dataset(&id), &tc).await?;
    let value = do_work().await?;            // DsError -> AccessError::Failed via From
    Ok(Json(value))
}
```

- `TokenContext` (axum extractor, infallible): first `token` query parameter (form-decoded), else `X-Auth-Token` header (Scala `RequestTokenHelper`). `TokenContext::new(Option<String>)` for internal calls.
- `AppState.access: AccessTokenService` — `validate_access(req, &tc)` (cached), `validate_access_uncached(req, &tc)` (`useCaching = false`), `has_user_access(req, &tc, use_caching) -> DsResult<UserAccessAnswer>` (raw answer).
- `AccessError { Forbidden(String), Failed(DsError) }`, `AccessResult<T>`; `IntoResponse`. Forbidden = `403 text/plain; charset=utf-8` body `Token may be expired, consider reloading. Access forbidden: <msg>` or `… Token authentication failed.` (msg absent). Failed = Scala JSON error `Failed to check data access, token may be expired, consider reloading.` with the RPC failure in `chain`, keeping WK's HTTP status (e.g. 401/403/404 from WK; 400 for transport/JSON errors).
- `UserAccessRequest` constructors: `administrate_datasets()`, `administrate_datasets_of(org)`, `read_dataset/write_dataset/delete_dataset(id)`, `read_tracing/write_tracing(id)`, `read_annotation/write_annotation(id)`, `download_job_export(id)`, `webknossos()`. JSON `{"resourceId"?, "resourceType": dataset|tracing|annotation|webknossos|jobExport, "mode": administrate|list|read|write|delete}`.
- `AppState.wk_client: WkClient` (Scala `DSRemoteWebknossosClient`), all calls add `key`; user calls add `token`:
  - `report_status()` PATCH `/api/datastores/:name/status` `{"ok":true,"url":<WK_DS_HTTP_URI>}`; `spawn_status_ping()` (main.rs; 10 s initial delay, then `pingInterval` after each completed tick; <100 ms rejected like Scala; aborted at shutdown); `status_ping_loop(initial, interval)`.
  - `request_user_access`, `get_job_export_properties -> JobExportProperties` (query order jobId,key), `get_tracingstore_uri` (cached 2 h/1 h idle), `get_annotation_source(access_token, tc) -> Value` (cached 5 s per (token, userToken), `userToken` query), `get_credential(id) -> Value` (silent, cached 5 s), `get_dataset_id(org, dir) -> String` (cached 5 min, validates 24-hex ObjectId), `get_local_root_path_or_empty -> Option<PathBuf>` (`""` → None = Scala `Fox.empty`), `delete_dataset` (JSON string body).
  - Model-dependent calls are generic over `B: Serialize` / `T: DeserializeOwned` until the models exist (TODOs in code): `report_data_source`, `report_data_sources(body, org?)` (silent), `report_real_paths` (silent), `update_data_source`, `get_data_source<T>` (wrapped `Failed to get data source from remote webknossos`), `get_unfinished_uploads_for_user<T>`, `report_dataset_upload`, `report_mag_upload`, `report_attachment_upload`, `reserve_{dataset,mag,attachment}_upload<B,T>`.
- Generic machinery: `wk_client::Rpc` (shared reqwest client, 2 h request/read/connect timeouts = Play WS conf, request counter) → `RpcRequest` builder: `query`, `query_opt`, `with_token`, `silent`, `silent_even_on_failure`, `with_slow_request_logging_threshold`, `with_timeout`; `get`, `get_json`, `post_json`, `post_json_with_json_response`, `put_json`, `patch_json`, `delete`. `wk_client::AlfuCache<K,V>` (Scala AlfuCache) is reusable by other services.

## Semantics kept from Scala

- Non-2xx: `Failed RPC <n>: <METHOD> <url>. Response: <status> '<body ≤2000 chars>'` with that status; transport: `Error sending RPC <n>: <METHOD> <url>: <cause>` (400); invalid JSON: `RPC <n>: <METHOD> <url> returned invalid JSON: <serde error>` (400). URL in messages/logs excludes the query (no key/token leak); reqwest errors are stripped of their URL. Debug logs of request (100-byte preview) and response (100 chars) unless silent; error log on failure unless silent_even_on_failure; info log for slow (>2 min) requests.
- Access cache: key (request, user token), TTL = TTI = 2 min, capacity 1000; granted AND denied answers cached; failed RPCs removed; concurrent loads of one key share one RPC.

## Deviations

- AlfuCache eviction at capacity: expired entries first, then least-recently-accessed (Caffeine uses W-TinyLFU).
- Error text for transport/JSON failures has no Java stack trace / Play JsError formatting.
- `get_annotation_source` and `get_credential` return `serde_json::Value` (models not yet ported: AnnotationSource/AnnotationLayer, DataVaultCredential sealed trait). Typing them is a DS1b/DS4 TODO; credentials JSON contains secrets — never log it.
- Scala itself never yields 401 from access checks; 401 appears only when WK answers 401 (status preserved). Tested as such.
- Query-string encoding uses `application/x-www-form-urlencoded` (space → `+`; AHC uses `%20`); WK decodes both.

## Next

- Run full `cargo test` + clippy once the concurrent `datavault` module compiles; then mark DONE.
- DS1a: switch generic `B`/`T` signatures to typed `DataSource`/upload models. DS1b: type `get_credential`.

## Evidence

- tests/wk_client.rs: 12 passed (ping payload/path/query/content-type and repetition, <100 ms rejection, failure status + no key leak, transport 400 without secrets, invalid JSON, job export query order, dataset-id cache + failure not cached, empty root path, tracingstore cache, annotation-source cache + credential query, every report/reserve/update method path+method+query+body, WK URI path prefix).
