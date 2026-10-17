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
./target/release/webknossos-datastore > /tmp/wk-datastore-rehearsal.log 2>&1 &
DS_PID=$!
curl --fail --silent --show-error "http://${WK_DS_HTTP_ADDRESS}:${WK_DS_HTTP_PORT}/data/health"
kill -TERM "$DS_PID"
wait "$DS_PID"
```

The binary path assumes no `CARGO_TARGET_DIR` override. Probe a concrete loopback/host address when binding `0.0.0.0` or IPv6. An HTTP health success is only a dependency smoke test. Rehearse SIGTERM during a long read/upload and confirm completion or bounded cancellation; align service-manager termination grace with `WK_DS_SHUTDOWN_TIMEOUT` plus process overhead. TLS termination, request limits, streaming/idle timeouts and query redaction belong in the reverse proxy.

## Shared state and ownership during coexistence

The datastore has no SQL schema. During a staged cutover Scala and Rust run side by side on the **same** registered identity, base directories and Redis, so these formats are shared contracts and must not change on one side only:

| State | Owner during coexistence | Guard |
|---|---|---|
| Redis upload metadata: `upload___<domain>___<uploadId>___<suffix>`, per-file `…___file___<name>___chunkCount/chunkSet`, reverse lookup `…___<DataSourceId JSON>___datasourceId`, 14-day idle expiry | Scala `UploadMetadataStore.scala` is authoritative; Rust mirrors it byte for byte | `python3 tools/datastore_replay/check_shared_formats.py` (also checks the special directories); run it in CI and before every deploy |
| Special directories under each base directory: `.uploading`, `.unpacked`, `.forConversion`, `.converting`, `.trash`, `.mirror` | Scala | same script |
| `datasource-properties.json` written by disk PUT, upload finish and mirrors | Scala JSON shape; Rust uses Play key order and number rendering (`play_f64`, `play_f32`) | differential corpus (`run_live_replay.py --breadth`) compares served datasources |
| WK ↔ datastore RPC (`/api/datastores/<name>/…` on WK, `/data/…` WK-initiated calls) | the main application (Scala WK or the Rust main app); changes go into both datastores in the same release | main-app and datastore route inventories, `fixture_server.py` contract |
| Datastore HTTP API versions v10–v16 (frontend, libraries) | Scala routes files | `tools/datastore_route_inventory.py --check`, contract corpus aliases |
| Registration row in WK's `datastores` table (name, key, URL) | WK; both datastores report the same name, key and public URI | status ping uses `WK_DS_HTTP_URI`, must equal Scala's `http.uri` |

Process for a change to any of these: change Scala and Rust in the same PR, rerun the guard and the differential, and only deploy when both are rolled out together (or the change is backwards compatible for the rollback window: new keys tolerated by the old reader, old keys still written).

In-memory state is per process: dataset/datasource cache (24 h TTL, 1 h idle), chunk contents, providers, agglomerate/mesh/connectome caches, Zarr private-link resolutions. WEBKNOSSOS invalidates them through the registered URL, so the proxy must fan invalidations out (see below).

## Route classes for staged traffic

- **R — read-only data and metadata** (safe to split by percentage): `GET /data/health`; binary data `POST …/data`, `POST|GET …/readData|data`, knossos `bucket.raw`, thumbnails, `findData`, `histogram`, `mappings`, all Zarr2/Zarr3 streaming incl. `/data/annotations/zarr*` private links, `proxy/…`, agglomerate/mesh/connectome/segment-index/statistics reads (POST bodies select data only), `adHocMesh`, `exploreRemote`, `validatePaths`, `measureUsedStorage`, `getOneBaseDirForOrgaAbsolute`, `getOrganizationBaseDirectory`, `aiModels/effectiveVoxelSize`, exports download.
- **I — cache invalidation and reload** (must reach both backends while both serve R): `DELETE /data/datasets/:id`, `POST /data/triggers/reload/:org/:id`, `PUT /data/datasets/:id` (writes the file, then invalidates; send the write to the writer and a `DELETE /data/datasets/:id` to the other).
- **W — writes** (exactly one owner at a time): uploads (`/data/datasets/upload/…` reserve, chunks, finish, cancel, clean-up), `deleteOnDisk`, `deletePaths`, `writeMirrors`, `triggers/checkInboxBlocking`, `createOrganizationDirectory`, `scanRealPathsForVirtual`.
- **B — background work** per process: status ping (always on), startup orphan clean-up of staging directories (always on, after 10 s), inbox watcher (`WK_DS_WATCH_FILE_SYSTEM_ENABLED`), Slack. Run the watcher on one backend only; the ping is idempotent when both report the same URI; the orphan clean-up reads the shared Redis, so both see the same uploads.

## Acceptance gates and staged traffic

Stage 0 — rehearsal (done for the fixture corpus, repeat with production-like data):
1. Record the Scala version, Rust revision and binary checksum, all translated non-secret settings, dataset snapshot and Redis backup. Verify name/key, public URL, organization boundaries, whitelist and vault credential prefixes against the deployed configuration.
2. Differential on isolated copies: `run_live_replay.py --breadth --rounds 3` must pass (declared divergences only; review `declared_cases` and the breadth `status_counts`). Add representative real datasets (all deployed formats, HDF5/Zarr attachments, remote stores) as extra corpora. `check_shared_formats.py` passes.
3. Load: `run_live_replay.py --bench` on hardware like production; no non-200 answers, Rust throughput ≥ Scala per scenario (2026-10-17 laptop run: all scenarios ≥ Scala except readData 128³ at ~0.9×), RSS/CPU recorded. Repeat with remote-store latency and failures.

Stage 1 — shadow: put a reverse proxy in front of the registered datastore URL. Keep all traffic on Scala; mirror R to Rust (responses discarded), Rust with watcher off. Gate: Rust error rate and latency over a few days of real traffic; no Rust process restarts; log review (`RUST_LOG=info`, request ids).

Stage 2 — read canary: route a percentage of R to Rust (sticky per dataset is preferable so caches stay warm), I fanned out to both, W and B-watcher on Scala. Gate per step (5 % → 25 % → 100 %): error rate and p99 at or below Scala, no authorization differences in logs, no increase in frontend bucket failures (`failure-bucket-indices`). Note the declared behavior differences users can see: findData/histogram clip to the layer bounding box (pending decision), thumbnails of uint64 data, compressed-segmentation uint32 and remote ZIP bugs fixed on the Rust side.

Stage 3 — writes: in a maintenance window stop admitting new uploads on Scala, wait until no upload is in progress, then route W to Rust and move the watcher to Rust. Check progress via Redis (`upload___dataset___*___datasetId` keys) and the `.uploading` staging directories. `unfinishedUploads` is reliable only once both sides carry the reverse-lookup fix (datastore-cutover.md DC1e); older Scala builds always answer `[]`. Shared Redis and staging layout mean in-progress uploads continue on either side, but never run two writers concurrently. Gate: `run_live_replay.py --uploads` passes on the release binary (answers, Redis state, files and WK calls identical for reserve/chunk/finish/cancel and the failure paths); rehearse S3 targets, failure and retry on disposable storage.

Stage 4 — Scala off: keep its launch configuration and binaries for the rollback window; I no longer needs fan-out.

## Rollback

Stop admitting Rust writes first; drain or terminate the candidate with SIGTERM and the configured grace. Determine whether any Rust upload/finish or dataset mutation occurred. Preserve the matching Redis snapshot, data/staging files and logs; do not independently rewind Redis while retaining newer files. Restore the prior Scala upstream/config, registered datastore URL and identity if changed, then start Scala as the sole writer. Validate health and authenticated reads, pending uploads and datasource reports before resuming writes. Binary rollback does not reverse persisted mutations; reconcile affected datasets/uploads or restore a consistent tested backup when needed. Route failure alone does not authorize deletion or schema changes.
