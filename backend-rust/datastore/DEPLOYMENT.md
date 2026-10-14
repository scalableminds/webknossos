# Datastore deployment rehearsal and staged cutover

This is a runbook, not evidence of production cutover or full behavioral parity. The Scala tracingstore remains in use. Route registration alone is insufficient; retain a working Scala datastore until the acceptance gates below pass.

## Configuration contract

The binary reads process environment only: no automatic `.env`, HOCON, JVM `-D` or `application.conf` loading. `.env.example` lists every currently supported `WK_DS_*` key. Source a trusted shell file explicitly or inject variables with your service manager. Unknown environment keys are ignored. Durations accept `30 seconds`, `100ms` or bare milliseconds; parser sizes accept `250M` (MiB), `1GB` (decimal GB) or bare bytes. Cache byte limits and counts accept unsigned decimal integers, not size suffixes. Booleans accept `true/false/yes/no/on/off`; arrays are JSON.

| Environment | Scala key | Default / behavior |
|---|---|---|
| `WK_DS_HTTP_URI`, `_ADDRESS`, `_PORT` | `http.uri`, `http.address`, `http.port` | `http://localhost:9090`, `0.0.0.0`, `9090`; URI does not derive from port and must describe client-reachable public service |
| `WK_DS_REQUEST_TIMEOUT` | `play.server.pekko.requestTimeout` | `10000s`; timeout until response headers, not entire streamed response |
| `WK_DS_PARSER_MAX_MEMORY_BUFFER`, `_MAX_DISK_BUFFER` | `play.http.parser.maxMemoryBuffer`, `maxDiskBuffer` | `250M`, `1G`; extractor limits, not a Play disk-spooling implementation or universal streamed-body ceiling |
| `WK_DS_SHUTDOWN_TIMEOUT` | Rust only | `30 seconds`; drain after SIGTERM/ctrl-c, then abort remaining server task |
| `WK_DS_KEY`, `WK_DS_NAME` | `datastore.key`, `datastore.name` | `something-secur3`, `standalone-9090`; must match registered datastore identity/key |
| `WK_DS_WEBKNOSSOS_URI`, `_PING_INTERVAL` | `datastore.webKnossos.uri`, `pingInterval` | `http://localhost:9000`, `10 minutes`; interval at least 100ms |
| `WK_DS_BASE_DIRECTORIES` | `datastore.baseDirectories` | JSON example below; relative paths resolve against working directory; at least one, no nested paths, remote `doScan` forbidden |
| `WK_DS_LOCAL_DIRECTORY_WHITELIST` | `datastore.localDirectoryWhitelist` | `[]`; use JSON absolute local directory strings |
| `WK_DS_WRITE_VIRTUAL_DATASETS_MIRROR` | `datastore.writeVirtualDatasetsMirror` | `false` |
| `WK_DS_WATCH_FILE_SYSTEM_ENABLED`, `_INTERVAL`, `_INITIAL_DELAY` | `datastore.watchFileSystem.*` | `true`, `1 minute`, `5 seconds`; enabled interval at least 100ms; disabled interval still positive |
| `WK_DS_UPLOAD_DELETE_TEMPORARY_FILES_AFTER_UPLOAD` | `datastore.upload.deleteTemporaryFilesAfterUpload` | `false`; does not disable startup orphan cleanup |
| `WK_DS_CACHE_MAPPING_MAX_ENTRIES` | `datastore.cache.mapping.maxEntries` | `5` |
| `WK_DS_CACHE_IMAGE_ARRAY_CHUNKS_MAX_SIZE_BYTES` | `datastore.cache.imageArrayChunks.maxSizeBytes` | `2000000000` |
| `WK_DS_CACHE_AGGLOMERATE_FILE_MAX_FILE_HANDLE_ENTRIES`, `_MAX_SEGMENT_ID_ENTRIES`, `_BLOCK_SIZE`, `_CUMSUM_MAX_READER_RANGE` | `datastore.cache.agglomerateFile.*` | `15`, `625000`, `512`, `1310720`; final two positive |
| `WK_DS_AD_HOC_MESH_TIMEOUT`, `_ACTOR_POOL_SIZE` | `datastore.adHocMesh.*` | `30 seconds`, `8`; positive |
| `WK_DS_REDIS_ADDRESS`, `_PORT` | `datastore.redis.*` | `localhost`, `6379`; plaintext TCP, no Redis password/TLS/database-index settings |
| `WK_DS_AGGLOMERATE_TREE_MAX_EDGES`, `WK_DS_AGGLOMERATE_GRAPH_MAX_EDGES` | `datastore.agglomerateTree.maxEdges`, `agglomerateGraph.maxEdges` | `1000000`, `10000000` |
| `WK_DS_DATA_VAULTS_CREDENTIALS` | `datastore.dataVaults.credentials` | `[]`; JSON objects `{type,name,identifier,secret}`; URI-prefix matching |
| `WK_DS_SLACK_NOTIFICATIONS_URI`, `_VERBOSE_LOGGING_ENABLED` | `slackNotifications.*` | empty webhook, `false`; Slack internal-problem, slow-data and failed-upload notices; 30-message/minute limit |
| `RUST_LOG` | Rust tracing filter | `info` |

`WK_DS_BASE_DIRECTORIES='[{"path":"/srv/webknossos/binaryData","organizationId":null,"allowsUpload":true,"doScan":true}]'`. Organization-specific entries place datasets directly under that path; organization-agnostic entries add organization directories. Preserve order and organization assignments from Scala. Remote upload targets require matching global credentials; do not substitute local paths for remote targets.

Credential types: `S3AccessKey` and `HttpBasicAuth` require identifier and secret; `HttpToken` requires secret; `GoogleServiceAccount` requires a JSON document encoded as the secret string. Unknown/incomplete entries are skipped with a count warning; malformed top-level JSON fails startup. Verify that the accepted count matches expectation. Global credentials apply to data loading; exploration uses explicit request credentials.

Defaults follow **standalone-datastore.conf**, not integrated `conf/application.conf`: the latter uses key `something-secure`, name `localhost`, WEBKNOSSOS URI `${http.uri}`, and 2-hour inbound request timeout. Explicitly translate deployed overrides. No equivalent settings for Play sessions/cookies, pidfile, Pekko dispatcher sizing or server idle timeout. Outbound WK RPC request/read/connect timeouts are fixed at 2 hours; changing the inbound timeout does not change them. The process starts without checking WK registration or Redis readiness. Default key is warned about, not rejected. `/data/health` checks Redis and recent internal problems; independently verify authenticated WK calls.

Keep secrets in dedicated key/credential/webhook fields. Do not embed credentials in URI userinfo, path or query: path/config errors and remote-path diagnostics are not universally redacted. `Secret` Debug is redacted and ordinary incoming `key`/`token` query parameters plus reqwest error URLs are hidden, but this does not sanitize arbitrary upstream error bodies. Prefer `X-Auth-Token` for user access checks; query token takes precedence if both are supplied. Keep reverse-proxy query logging off/redacted too. Do not log the environment or enable shell tracing when loading secrets.

## Build and isolated rehearsal

Run from `backend-rust` with Rust 1.91 or newer. Redis and reachable WEBKNOSSOS are required; no PostgreSQL schema bootstrap is part of datastore deployment.

```sh
cargo fmt --manifest-path datastore/Cargo.toml --check
cargo clippy --manifest-path datastore/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path datastore/Cargo.toml --locked
python3 tools/datastore_route_inventory.py --check
cargo build --manifest-path datastore/Cargo.toml --locked --release
cp datastore/.env.example datastore/.env
chmod 600 datastore/.env
```

Edit `.env` before launching: bind to loopback on a separate port; set the public URI accordingly; use a separate datastore name/key registered in a test WK or a WK fixture server, **copied disposable data** and a separate Redis instance. Disable watcher and set `allowsUpload=false` for a read-only rehearsal; this alone is insufficient isolation. Status reporting starts after 10s and changes the registered datastore URL. Startup orphan cleanup also runs after 10s and can delete temporary directories absent from Redis, even when the watcher is disabled. Never point the candidate at production data with an empty/new Redis. Do not run simultaneous writers against shared upload state.

```sh
set -a
. ./datastore/.env
set +a
./datastore/target/release/webknossos-datastore > /tmp/wk-datastore-rehearsal.log 2>&1 &
DS_PID=$!
curl --fail --silent --show-error "http://${WK_DS_HTTP_ADDRESS}:${WK_DS_HTTP_PORT}/data/health"
kill -TERM "$DS_PID"
wait "$DS_PID"
```

The binary path assumes no `CARGO_TARGET_DIR` override. Probe a concrete loopback/host address when binding `0.0.0.0` or IPv6. An HTTP health success is only a dependency smoke test. Rehearse SIGTERM during a long read/upload and confirm completion or bounded cancellation; align service-manager termination grace with `WK_DS_SHUTDOWN_TIMEOUT` plus process overhead. TLS termination, request limits, streaming/idle timeouts and query redaction belong in the reverse proxy.

## Acceptance gates and staged traffic

1. Record the exact Scala version, Rust revision/binary checksum, all translated nonsecret settings, dataset snapshot and Redis backup. Preserve the previous Scala launch/config and proxy target. Verify name/key, public URL, organization boundaries, whitelist and vault credential prefixes against deployed configuration.
2. Replay representative authenticated read requests against isolated Scala/Rust instances on the same immutable data. Compare status/headers/JSON/binary payloads, current-token behavior on warm caches, reload invalidation and denial side effects. Include WKW/Zarr2/Zarr3/N5/precomputed, HDF5 attachments, mesh/connectome/segment statistics, mapping and all deployed API versions. Consult checkpointed JPEG tolerance and deliberate Scala bug fixes; approve divergences explicitly.
3. Measure cold/warm p50/p95/p99 latency, throughput, RSS, file descriptors and CPU under representative concurrency and remote-store failures. Check missing buckets, malformed input, authorization rejection and large streaming requests. Retain logs and metric baselines; no performance threshold is implied by route coverage.
4. In a maintenance window, stop admitting new writes/uploads to the Scala datastore and drain active work. Verify no active writers or resumable requests before switching upload ownership. Preserve Redis metadata and staging directories together; restore testing must not discard ongoing uploads. Rehearse dataset/mag/attachment reserve, chunk, finish/cancel, S3 transfer failure and retry on disposable storage first.
5. Deploy Rust behind an internal candidate upstream. Keep one writable owner for each storage/Redis namespace. Start with read-only canary routing, then increase traffic only when error rate, authorization, payload comparisons and resource limits match agreed gates. Status callbacks and the registered public URI must remain consistent with the intended proxy address; a separate candidate identity avoids status-report races during shadow operation.
6. Enable writes only after the isolated upload/recovery gates pass and ownership is transferred. Keep Scala available for rollback; perform post-switch health, authenticated reads, upload/download, reload, discovery and tracingstore integration checks. Capture a concrete rollback trigger and responsible operator before proceeding.

## Rollback

Stop admitting Rust writes first; drain or terminate the candidate with SIGTERM and the configured grace. Determine whether any Rust upload/finish or dataset mutation occurred. Preserve the matching Redis snapshot, data/staging files and logs; do not independently rewind Redis while retaining newer files. Restore the prior Scala upstream/config, registered datastore URL and identity if changed, then start Scala as the sole writer. Validate health and authenticated reads, pending uploads and datasource reports before resuming writes. Binary rollback does not reverse persisted mutations; reconcile affected datasets/uploads or restore a consistent tested backup when needed. Route failure alone does not authorize deletion or schema changes.
