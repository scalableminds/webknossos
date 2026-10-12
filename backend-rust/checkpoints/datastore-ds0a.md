# DS0a datastore foundation checkpoint

Owner: ds0a sub-agent. Files: backend-rust/datastore/{Cargo.toml (tokio `io-util` feature only; Cargo.lock unchanged), src/config.rs, src/error.rs, src/redis.rs, src/versioning.rs, src/lib.rs, src/main.rs, tests/common/mod.rs, tests/health.rs, tests/routing.rs}.

## Status

DONE (2026-10-11). DS0a complete; DS0b (WK RPC client + user-access validation) is next.

## Done

- `config.rs`: typed `DatastoreConfig::from_env()` / `from_values(map, cwd)` / `defaults(cwd)`; `Secret` newtype (Debug prints `[redacted]`) for `key`, credential secrets and the Slack webhook (Debug shows only `uri_configured`). Credential JSON parse errors never echo input. HOCON-style durations/sizes/booleans.
- `error.rs`: `DsError {status, message, exception, chain}` = Scala `Failure`/`ParamFailure[Int]`; `failure` (400 default), `from_exception` (Fox.fromFuture), `empty()` (404 `Msg.notFound`), `with_status` (`~>`), `wrap` (`?~>`/`?->`). Renders `{"messages":[{"error":m},{"chain":"[Server Time <ISO_INSTANT>] c1 <~ c2"}]}` (chain only if present), `application/json`.
- `redis.rs`: RESP `PING` over tokio TcpStream, 1 s connect + 1 s ping timeout, Scala failure messages (`Redis health check failed.` ← `Redis access exception on host:port: …` | `Redis access failure` ← cause).
- `versioning.rs`: Scala `ApiVersioning` (current 16, oldest 10) + versioned-routes aliasing.
- `lib.rs`: `AppState {config: Arc<DatastoreConfig>, health: HealthProblems}`; `router(state)`; `controller(router, allow_remote_origin)` helper that every future controller router must use; `/data/health`; `/` + `/index.html` frontpage (Twirl template port, HTML-escaped).
- `main.rs`: config load, warnings for default key / skipped credentials, bind `http.address:http.port` (0.0.0.0:9090), graceful shutdown on SIGTERM / ctrl-c with `WK_DS_SHUTDOWN_TIMEOUT` drain limit.

## Config mapping (env → Scala key, Scala default)

| Env var | Scala key | Default / format |
|---|---|---|
| WK_DS_HTTP_URI | http.uri | `http://localhost:9090` (http(s) URL, trailing `/` trimmed) |
| WK_DS_HTTP_ADDRESS | http.address (Play) | `0.0.0.0` |
| WK_DS_HTTP_PORT | http.port | `9090` (1-65535) |
| WK_DS_REQUEST_TIMEOUT | play.server.pekko.requestTimeout | `10000s` |
| WK_DS_PARSER_MAX_MEMORY_BUFFER | play.http.parser.maxMemoryBuffer | `250M` (kept for JSON extractors, not yet enforced) |
| WK_DS_PARSER_MAX_DISK_BUFFER | play.http.parser.maxDiskBuffer | `1G` → axum `DefaultBodyLimit` |
| WK_DS_SHUTDOWN_TIMEOUT | (new) | `30 seconds` |
| WK_DS_KEY | datastore.key | `something-secur3` (secret, non-empty; startup warns on default) |
| WK_DS_NAME | datastore.name | `standalone-9090` |
| WK_DS_WEBKNOSSOS_URI | datastore.webKnossos.uri | `http://localhost:9000` |
| WK_DS_WEBKNOSSOS_PING_INTERVAL | datastore.webKnossos.pingInterval | `10 minutes` (>0) |
| WK_DS_BASE_DIRECTORIES | datastore.baseDirectories | JSON `[{"path":"binaryData","organizationId":null,"allowsUpload":true,"doScan":true}]` |
| WK_DS_LOCAL_DIRECTORY_WHITELIST | datastore.localDirectoryWhitelist | JSON string array `[]` |
| WK_DS_WRITE_VIRTUAL_DATASETS_MIRROR | datastore.writeVirtualDatasetsMirror | `false` |
| WK_DS_WATCH_FILE_SYSTEM_ENABLED / _INTERVAL / _INITIAL_DELAY | datastore.watchFileSystem.* | `true` / `1 minute` / `5 seconds` |
| WK_DS_UPLOAD_DELETE_TEMPORARY_FILES_AFTER_UPLOAD | datastore.upload.deleteTemporaryFilesAfterUpload | `false` |
| WK_DS_CACHE_MAPPING_MAX_ENTRIES | datastore.cache.mapping.maxEntries | `5` |
| WK_DS_CACHE_IMAGE_ARRAY_CHUNKS_MAX_SIZE_BYTES | datastore.cache.imageArrayChunks.maxSizeBytes | `2000000000` |
| WK_DS_CACHE_AGGLOMERATE_FILE_MAX_FILE_HANDLE_ENTRIES / _MAX_SEGMENT_ID_ENTRIES / _BLOCK_SIZE / _CUMSUM_MAX_READER_RANGE | datastore.cache.agglomerateFile.* | `15` / `625000` / `512` (>0) / `1310720` (>0) |
| WK_DS_AD_HOC_MESH_TIMEOUT / _ACTOR_POOL_SIZE | datastore.adHocMesh.* | `30 seconds` / `8` (>0) |
| WK_DS_REDIS_ADDRESS / WK_DS_REDIS_PORT | datastore.redis.* | `localhost` / `6379` |
| WK_DS_AGGLOMERATE_TREE_MAX_EDGES | datastore.agglomerateTree.maxEdges | `1000000` |
| WK_DS_AGGLOMERATE_GRAPH_MAX_EDGES | datastore.agglomerateGraph.maxEdges | `10000000` |
| WK_DS_DATA_VAULTS_CREDENTIALS | datastore.dataVaults.credentials | JSON `[{type,name,identifier,secret}]`, `[]`; types S3AccessKey, HttpBasicAuth, GoogleServiceAccount (secret must be JSON), HttpToken |
| WK_DS_SLACK_NOTIFICATIONS_URI / _VERBOSE_LOGGING_ENABLED | slackNotifications.* | `""` (secret, http(s) if set) / `false` |

Formats: durations HOCON (`10 minutes`, `30s`, bare number = ms); sizes HOCON (`250M`=MiB, `1GB`=10^9, bare = bytes); booleans true/false/yes/no/on/off. Counts are unsigned (negative values rejected). Not mirrored: `play.http.secret.key` (no Play sessions/cookies in the datastore), `pidfile.path`, pekko dispatcher sizing, `play.ws.*` (applies to the DS0b RPC client: use 2 h timeouts there). The keys `reportUsedStorage`, `segmentIndex`, `agglomerateSkeleton` do not exist in Scala `DataStoreConfig` and were not added.

Validation (Scala `BaseDirConfigReader`): at least one entry; `doScan` forbidden on remote paths; no nested paths (path-component prefix); `path`, `allowsUpload`, `doScan` required, `organizationId` optional/null; local paths absolutized against cwd and lexically normalized, `file://` paths must be absolute, remote URIs segment-normalized (full UPath incl. zip entries → DS1b). Credentials: incomplete/unknown entries are dropped like Scala's `flatMap` and counted (`skipped_data_vault_credentials`, warned at startup).

## Decisions and deviations

- Health (`GET /data/health`, also `/data/v10..v16/health`): Redis PING must answer PONG (1 s), then no internal problem may be recorded in the last minute (`HealthProblems::push`, message `Java Internal Errors detected` kept verbatim), then `200 text/plain "Ok"` with `Cache-Control: no-cache`, `Access-Control-Allow-Origin: *`, `Access-Control-Max-Age: 600`. Failures are `400` JSON with the Scala chain. Redis is mandatory in Scala too (no disable option). The Scala `NativeBucketScanner` JNI self-test is omitted: no native library exists in Rust; add the equivalent self-test when the Rust segment-id scanner lands (DS3/DS5). Nothing pushes `HealthProblems` yet: the DS3 data-loading error path must push where Scala catches `InternalError`.
- Redis: fresh connection per health check instead of a persistent Lettuce connection; Java exception class names are approximated (`java.util.concurrent.TimeoutException: …`, `io.lettuce.core.RedisCommandExecutionException: …`); connection errors carry the OS error text instead of Netty's.
- CORS: every `OPTIONS` request (any path, before routing, Scala `DsRequestHandler`) answers `200 ":D"` with Allow-Origin `*`, Max-Age 600, Allow-Methods `POST, GET, DELETE, PUT, HEAD, PATCH, OPTIONS`, Allow-Headers echoing `Access-Control-Request-Headers` (or empty), Expose-Headers `failure-bucket-indices, empty-bucket-indices, MISSING-BUCKETS`. Non-preflight responses get Allow-Origin/Max-Age only from controller routers built with `controller(.., true)` (all Scala datastore controllers except DataProxyController, DSAiModelController and StandaloneDatastore).
- `controller()` also adds `Cache-Control: no-cache` unless set (Scala `addNoCacheHeaderFallback` on every Fox result). Router-level fallbacks (unknown route, 405, invalid version, timeout, panic) do not get CORS/no-cache, like Scala's non-Fox results.
- Security headers (Play `SecurityHeadersFilter` with CSP and nosniff disabled by the conf): `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `X-Permitted-Cross-Domain-Policies: master-only`, `Referrer-Policy: origin-when-cross-origin, strict-origin-when-cross-origin`, set if absent, on every response.
- Versioning: `^/(api|data|tracings)/v(\d+)` outside [10,16] → `404 {"messages":[{"error":"This WEBKNOSSOS instance does not support the requested HTTP API version. Client requested N but must be at least 10 and at most 16."}]}` (u64 overflow → same 404; Scala would 500). `/data/v{10..16}/rest` is rewritten to `/data/rest` before routing, with `RequestedApiVersion(n)` as a request extension (unversioned = 16). Paths Scala sends to `DSLegacyApiController` (v10-v14 datasource-properties.json x7, v10-v13 upload x5, v10 reserveManualUpload) are NOT rewritten, so they cannot reach latest handlers; DS4-legacy registers them at `/data/v{n}/…` (and unversioned `GET/POST /data/datasets`). Until then they 404.
- Unknown routes: JSON `404 {"messages":[{"error":"Route not implemented by the Rust datastore."}]}`; wrong method JSON 405 (Play would render its HTML error pages). Panics: JSON 500 `Internal server error.` (Play: HTML error page).
- Request timeout: `503` with the Pekko text body `The server was not able to produce a timely response to your request.\r\nPlease try again in a short while!`.
- Logging: non-2xx answers are logged as `Answering <status> at <uri>` with `key`/`token` query values redacted (Scala `logRequestFormatted`; the response body is not logged). `X-Request-Id` is set/propagated (additive). `RUST_LOG` controls the filter (default `info`).
- Not implemented here: `GET /api/buildinfo` (StandaloneDatastore.buildInfo) — belongs to a later DS4 batch.

## Next (DS0b)

- `DSRemoteWebknossosClient` with `play.ws` 2 h timeouts: `key` + `name` on every RPC; status ping every `webknossos.pingInterval`; `validateUserAccess` (`/api/datastores/:name/validateUserAccess`), data source reporting.
- `UserAccessRequest` model + token extraction (Scala `RequestTokenHelper`: `token` query param, else `X-Auth-Token` header) + access-check extractor with Scala's cache semantics; reuse `DsError` (403/401 statuses via `with_status`).
- Every new controller router must be wrapped with `controller(router, allow_remote_origin)` and merged into `lib::router`.

## Evidence

- `CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-ds-verify cargo test --locked --offline`: lib unit 19 passed, tests/health.rs 7 passed, tests/routing.rs 6 passed, 0 failed.
- `cargo clippy --locked --offline --all-targets -- -D warnings`: clean. `cargo fmt --check`: clean.
- Smoke: binary on 127.0.0.1:19391 against the local Redis answered `200 Ok` with the expected headers; SIGTERM → graceful exit 0.
