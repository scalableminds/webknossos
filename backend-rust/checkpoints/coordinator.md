# Rust migration coordinator checkpoint

## Open work items — verified against code, inventories and checkpoints, 2026-10-12

Route registration is complete for both services (main app 287/287, datastore 132/132; both inventory `--check`s clean). Registration is not behavioral parity. Test counts elsewhere in this file were not re-run for this review. Older entries below that list these items as "next", "queued" or "PARENT TODO" are superseded by this section.

### Main application
- G6 analytics: call sites (signup, join_organization, send_invites, open_dataset, change_dataset_settings) and tests are in the code, but the checkpoint still says IN PROGRESS and the final suite/clippy/fmt run is not recorded. `analytics::spawn_heartbeat` exists but is NOT called from `main.rs`, so the 24 h `webknossos_heartbeat` does not run.
- G8 pricing-plan expiry reminder: not started (no code).
- G9 Mailchimp: not started (client, hourly ticker and 6 call sites; only comments and a debug log exist).
- G10 virtual-dataset real-path bulk scan: only the per-dataset call exists (`dataset_lifecycle.rs`); no hourly job in `housekeeping.rs`.
- G11 startup tasks: no `WK_INITIAL_DATA_ON_STARTUP`; initial data only via `POST /triggers/initialData`.
- G12 pool health logging and G13 `.env.example`/README hygiene: not started.
- D1 product decision: mail bodies are plain text (no HTML templates, branding, Reply-To).
- Known bug: compound merge returns 500 when a dataset layer has no mags (`datasets::data_source_for_rpc`).
- Cutover work: differential tests against Play, observability/performance, schema ownership, staged traffic cutover.
- DONE and wired in `main.rs`: G1 SMTP, G2 housekeeping, G3 credit ticker, G4 Slack, G5 worker liveness, G7 used-storage scan.

### Datastore
- Zip vaults: `datastore/src/datavault/zip.rs` exists (434 lines, untracked) and is wired in `datavault/service.rs`, but it has no tests and no checkpoint, and datastore-ds1b.md still says "not supported (TODO DS1c)". Treat as started, unverified.
- DS6: differential tests against Scala, performance, config, cutover. Known divergences needing differential coverage: JPEG off by up to 1 (gray) / 2 (color) levels, deliberate fixes of Scala quirks (see datastore/README.md), and Scala oddities worth fixing on both sides (unfinishedUploads never enriches, upload clean-up leaves `voxelSize`, attachment upload dirs named `Some(<name>)__<id>`).
- Uncommitted datastore changes remain in the working tree.
- DONE: Compresso, managed-S3 uploads, legacy API versions, regional short-S3 rewrite.

### Tracingstore engine
- Postponed for later; the Scala tracingstore stays in use.

## Active datastore ownership — Codex, 2026-10-12

LATEST short-S3 exploration rewrite DONE: regional or global endpoint insertion, explicit credential lookup, raw-path preservation, archive outer paths and denied-request no-effect tests.16 actual Scala URI helper goldens; whole datastore **416 passed, zero failures/ignored**, fmt/clippy/inventories clean; `/tmp/webknossos-rust-ds-s3-uri-final-tests.log`; details datastore-ds1-s3-rewrite.md. Next zip vaults and DS6.

LATEST legacy API milestone DONE: versions10–14 safe-ID metadata, versions10–13 old uploads, authorized old linked-layer lookup, v10 manual reserve and unversioned chunks. Compiled Scala DTO/default/error goldens and actual HTTP/token/denial/version tests pass. Whole datastore **414 passed, zero failures/ignored**, fmt/clippy/inventories clean; `/tmp/webknossos-rust-ds-legacy-tests.log`; restart datastore-ds4-legacy.md. Latest registrations132/132 unchanged;56 versioned legacy +2 unversioned chunk registrations added. Next regional short-S3 rewrite (since done), zip vaults (started, unverified) and DS6.

LATEST managed-S3 milestone DONE: streamed signed PUT/multipart transfers, native AWS SDK signing goldens, dataset/mag/attachment finish receipts, failure retention, aborts and denial. Whole datastore **406 passed, zero failures/ignored**, fmt/all-target clippy/inventories clean; log `/tmp/webknossos-rust-ds-managed-s3-tests.log`. Registrations remain 132/132; restart datastore-ds4-managed-s3.md. Next legacy/version overrides, regional short-S3 rewrite, zip vaults and DS6.

User reconfirmed that Claude is stopped and Codex should continue owning the datastore. This supersedes the 02:10 Claude entry below. Compresso is now integrated and independently/native verified: 1,848 oracle cases, 324 checked-in cases, 18 actual JNI error/literal cases and 12 plain/raw-shard/gzip-shard end-to-end datasets. Complete datastore **393 passed, zero failures/ignored**, fmt/all-target clippy/inventories clean; log `/tmp/webknossos-rust-ds-compresso-tests.log`. Registrations remain132/132; see datastore-ds5-compresso.md. Next managed-S3 upload targets, legacy/version overrides, regional short-S3 rewrite and DS6 differential/performance/config/cutover. No migration-completion or production-cutover claim.

## Historical datastore ownership — Claude Code, 2026-10-12 02:10 local

User re-issued the resume goal to this Claude Code session after Codex's 127/132 milestone (Codex's last datastore edit 2026-10-11 22:46, no build running). Claude owns `backend-rust/datastore/**` and the datastore checkpoints again, building on all Codex code unchanged. Current task: the 5 connectome routes. If you are Codex resuming, coordinate with the user before editing datastore files.

## Historical datastore ownership — Claude Code, 2026-10-11 (session end state)

Historical session record, superseded by current Codex ownership below: user assigned the datastore conversion to this Claude Code session. Claude owned `backend-rust/datastore/**`, `tools/datastore_route_inventory.py` and the datastore checkpoints; main-app source untouched except the generated status pointer in `tools/route_inventory.py`.

State: datastore **111/132** latest registrations (was 12/132). Whole datastore suite **318 passed**; the only failure is the manual `write_blosc_outputs_for_java_oracle` (needs `WK_DS2_ORACLE_DIR`, expected). fmt, all-target clippy `-D warnings`, both inventory `--check`s clean. Log /tmp/webknossos-rust-ds-session-final-tests.log.

Done this session (evidence datastore-ds4-proxy-finddata-zarr.md, datastore-ds5-agglomerates.md): DataProxy 4, findData/histogram, Zarr streaming 64 (datasets + annotation private links via tracingstore client), maintenance routes (base dir, storage, trash delete, deletePaths, validatePaths, writeMirrors), exports download, AI model voxel size, JSON mappings, thumbnails (pure-Rust JPEG), uploads 9 (Redis RESP client, byte-compatible keys, resumable chunks, finish incl. unzip/explore), exploreRemote (full explore package), agglomerate files (Zarr3) + agglomerate data mapping. New deps: jpeg-encoder, zip, prost/prost-build/protox.

Remaining 21 routes (one coupled block): HDF5 subset reader (DS5a, also needed for HDF5 agglomerates which answer 501 today), segment index + statistics (13: segment index Zarr3/HDF5, MurmurHash3 x64_128 hashing — commons-codec jar for an oracle is in ~/Library/Caches/Coursier, segment statistics files, MeshMappingHelper incl. editable mappings via tracingstore), meshes (4: mesh files Zarr3/HDF5/precomputed, chunk listing, Draco decode for full-mesh STL — DS5c), ad-hoc mesh (marching cubes), connectomes (5). Also open: managed-S3 upload targets (501, needs S3 PutObject), JSON-mapping application for ad-hoc meshes, regional rewrite of short-style S3 URIs in explore. Scala oddities kept for parity and worth fixing on both sides: unfinishedUploads never enriches (quoted upload id in Redis), dataset upload clean-up leaves `voxelSize`, attachment upload dirs named `Some(<name>)__<id>`.

## Current priority and ownership — Codex, 2026-10-11

Latest user objective: FINISH DATASTORE; FOCUS SEGMENTINDEX FIRST. User confirmed Claude is stopped and this chat owns datastore/segmentIndex/HDF5. Preserve previous Claude continuation code. Segment index, seven statistics routes and HDF5 agglomerates are now implemented/verified. Compresso decoder remains written/checks but deferred/unverified/unintegrated: datastore-ds5-compresso.md. No C/libhdf5 runtime, no main-app/Scala edits. Next remaining codec/storage/legacy gaps and DS6.

LATEST Codex connectome milestone DONE:5 authenticated HDF5/Zarr3 routes, CSR/CSC single/multi synapse semantics, positions/partners/legends, actual Scala order/JSON/numeric/boundary goldens and cache/current-token/reload tests. Direct JHDF5 replay corrected shared dataset unsigned/Float32 conversion policy (C H5P_DEFAULT clamp assumptions did not match Scala's transfer callback). Whole datastore384 tests passed, zero failures/ignored; fmt/all-target clippy/inventories clean. Registrations132/132, not cutover/parity completion. Log /tmp/webknossos-rust-ds-connectomes-tests.log; restart datastore-ds5-connectomes.md. Next Compresso integration/native oracles, managed-S3/legacy and DS6. Goal active.

Previous Codex full/ad-hoc mesh milestone DONE: pure-Rust Draco→STL, all256 marching-cube configurations, typed JSON/agglomerate binary meshing, index/BFS orchestration, area-file/full-mesh fallback and caches;3 new routes. Registrations127/132; connectomes5 remain. Whole datastore375 tests passed, zero failures/ignored; clippy/fmt/inventories clean. Log /tmp/webknossos-rust-ds-full-mesh-final-tests.log. Restart datastore-ds5-draco-full-mesh.md. Next connectomes, Compresso, managed-S3/legacy and DS6; goal active.

Previous Codex mesh-file milestone DONE:3 new routes (file list, merged chunk list, ordered chunk data) across HDF5/Zarr3/sharded precomputed, manifest geometry/quantization/transforms, typed caches and invalidation. Real fragment bytes and actual compiled Scala manifest/JSON goldens match; remote current-token cache hits/gzip/unsigned/mapping/reload/boundaries verified. Whole datastore **358 passed, zero failures/ignored**, fmt/all-target clippy/inventories clean; /tmp/webknossos-rust-ds-mesh-files-tests.log. Registration coverage **124/132**, remaining8 registrations: fullMesh.stl, adHocMesh, surfaceArea, connectomes5; Compresso, managed-S3/legacy and DS6 also remain. Next pure-Rust Draco + full/ad-hoc geometry/surface-area fallback; candidate draco-core source audited only, not adopted/verified. Durable restart datastore-ds5-mesh-files.md. Goal active; no cutover/parity claim.

Previous HDF5 agglomerate milestone: mapped binary/index/statistics, caches/cumsum and graph/tree/position readers verified (348 tests), datastore-ds5-hdf5-agglomerates.md.

Previous statistics milestone: seven authenticated statistics routes verified (340 tests), datastore-ds5-segment-statistics.md. Surface-area route still pending actual full-mesh fallback.

Codex segment-index milestone DONE: HDF5 reader/service integrated; real-file h5py oracle, old/new chunk-index and compressed/big-endian generated variants, actual HTTP reads, reload and malformed Zarr validation pass. Whole datastore **331 passed, zero failures/ignored**, fmt/all-target clippy and both inventory checks clean; /tmp/webknossos-rust-ds-segment-index-tests.log. Durable restart evidence: datastore-ds5-segment-index.md. Pinned pure-Rust hdf5-reader0.9.1 (no native HDF5 runtime), narrow application subset. Next segment statistics attachments and index-based volume/bounding-box bucket scanning; broader HDF5 attachment integrations remain. Current user ownership confirmation supersedes historical Claude notes above/below.

## Previous datastore ownership — Codex, 2026-10-11

User confirmed Claude is stopped; this supersedes the historical Claude-active/reconfirmation note below. Codex owns datastore readers, datastore Cargo files/docs and reader checkpoints; main-app source remains untouched. WKW completed FIRST, then Zarr3 (zarrs 0.23.14 with pure Rust compressor plugins), N5 and OME 0.5 group wrapper. Whole datastore verification: **185 passed, 0 failed, 0 ignored**, fmt/all-target clippy clean, main-app route inventory check unchanged/clean. Log /tmp/webknossos-rust-ds-readers-tests.log. Rust datastore minimum raised to 1.91; no main-app MSRV change. Domain evidence: datastore-ds2-{wkw,zarr3,n5}.md and datastore/README.md.

Precomputed core reader milestone (Codex continuation): raw/sharded reads, JPEG gray/BGR, compressed segmentation, unsigned addressing/delta indexes and multichannel reads integrated. Complete datastore **195 tests passed, no failures/ignored**, fmt/clippy/inventory checks clean; /tmp/webknossos-rust-ds-precomputed-tests.log. Compresso pending DS5b; JPEG Java fixtures differ by max1 gray/max2 color. See datastore-ds2-precomputed.md for deliberate fixes to Scala's channel omission, 32-bit segmentation mask and boundary decoding.

DS3 milestone: request geometry, all-format DatasetArrayBucketProvider (50-array mag cache), BinaryDataService (5000-provider cache), clipping/assembly/batch outcomes/half-byte, error logging and AppState wiring implemented. Whole datastore **207 passed, 0 failed, 0 ignored**, fmt/all-target clippy/inventory clean; /tmp/webknossos-rust-ds-data-access-tests.log. Exact source/layer cache invalidation and current-token forwarding verified. No real agglomerate mapper or data HTTP routes yet; see datastore-ds3-data-access.md.

DS4 data-entrypoint milestone: DatasetCache plus four authenticated BinaryDataController data routes implemented. Complete datastore **217 passed, 0 failed, 0 ignored**, fmt/all-target clippy clean, main-app inventory unchanged and new datastore inventory **5/132** (health plus four data registrations). Log /tmp/webknossos-rust-ds-binary-routes-tests.log; exact contracts/deviations in datastore-ds4-binary-data.md. Current-token-after-cache, warm-cache denial, native reader oracles and JSON memory limit verified. WK RPC supplies resolved paths; do not invent local fallback in DatasetCache.

DS4 datasource milestone: DataSourceService disk loader (validation, attachments, path resolution, vault invalidation), disk PUT, cache DELETE and reload POST implemented. Whole datastore **228 passed, 0 failed, 0 ignored**, fmt/all-target clippy and inventories clean; datastore latest registrations **8/132**. Log /tmp/webknossos-rust-ds-source-reload-tests.log; contracts/deviations in datastore-ds4-datasource.md. Actual changed-byte reload and exact selective caches verified.

DS4 inbox milestone: BaseDirService, typed datasource/realpath reports, scanner, four directory/scan endpoints and main watcher implemented. Whole datastore **239 passed, 0 failed, 0 ignored**, fmt/all-target clippy/inventories clean; datastore latest registrations **12/132**. Log /tmp/webknossos-rust-ds-inbox-tests.log; contracts/deviations in datastore-ds4-inbox.md. Slow RPC/non-overlap/retry/abort, scoped auth, symlink ownership and report ordering verified. Unix permission checks use cached rustix1.1.5 (no main-app Cargo changes).

Next bounded batch: remaining reader encoding coverage, DS5b pure-Rust Compresso decoder with local C++ golden oracle (webknossos-jni/src/include/compresso.hpp). Then remaining datasource/BinaryData/Zarr streaming routes/services. Mapping/histogram/thumbnail services, remaining DS4 routes and DS5/DS6 remain. Compresso remains DS5b. Preserve current-user token propagation and no fake unsupported-format fill. Do not use zarrs async_subchunk_byte_range: it overflows on missing MAX/MAX shard entries. Our adapter validates untrusted index ranges and uses the working decode path. Goal remains active: datastore routes/services, DS5/DS6 parity and cutover are not finished. No PR/commit/deployment requested.


Updated 2026-10-10 22:45 UTC (usage-limit pauses 12:20-16:40 and ~18:00-22:10 UTC; user then wiped target dirs to reclaim disk and decided: port draco/compresso C++ to Rust, pure-Rust HDF5 subset). Active coordinator: Claude Code session (took over from Codex `/root`). NOTE: Codex resumed 11:30 UTC, spawned TI1/merge-reset recovery agents, and hit its usage limit again at 11:31 UTC; Claude coordinator continues. Do not run two coordinators at once: if you are Codex resuming, read this file and coordinate with the user first. Canonical directory: `/Users/therold/Programming/scalableminds/webknossos/backend-rust`. Read this file first after a usage reset; older ownership/session instructions in the history files are superseded.

## Objective and constraints

The full Rust backend migration goal remains active: main application first, then datastore and tracingstore engines (tracingstore engine: postponed for later). A completed route batch is not completion. User requests Sol 6.1 subagents, small bounded assignments, and durable checkpoints. Keep changes inside backend-rust; preserve unrelated tools/worktree. No rm on macOS. No commit, deployment or PR requested. Scala controllers/DAOs/protos/schema185 are authoritative; no placeholder behavior or route-count parity claims.

Every agent writes Status / Done / Next / Evidence at milestones and about every three minutes, and sends a concise report to parent. Finish the stated batch before accepting more. Parent owns src/lib.rs, config.rs, Cargo files, README, inventory and central verification. Coordinate shared-file edits before changing them. Never bootstrap schema.sql into an existing database; only fresh generated TestDb databases.

## Current ownership and restart actions

Takeover 2026-10-10 06:45 UTC: Claude Code (Opus 5.5) session is now the active coordinator; the Codex coordinator stopped ~05:41 UTC with TW1 started (no source) and N4d reopen source written but untested. Parent wired `annotation_reopen` (router(jobs_enabled)), and scaffolds `annotation_sandbox`, `annotation_transfer` (router(jobs_enabled) returning empty Router) and `time_interaction` (empty) into src/lib.rs so owners can compile without touching lib.rs. `cargo check --all-targets` passes after wiring.

Done since takeover (all focused tests + clippy clean per agent): TW1 planner (19 unit), N4d reopen (4 int), sandbox+transfer (3 int, 2 unit), TW2 writer (6 int, 2 unit; over-limit mail via shared MailSender), R2a reserve/reportMagUpload (2 int, 1 unit; pub(crate) helpers in remote_datastore_mag_upload.rs), N5b reservedIds/reserveIds (3 int; advisory lock shared with collaboration mode, real largestIdOrZero RPC). Parent: tokio sync feature, Config.time_tracking (+ RouteOptions.time_tracking), ONE shared `TimeInteractionWriter` + `TimeTrackingConfig` as router-wide Extensions in build_router, annotation_lists::default_settings extraction. Inventory 257/287.

Batch B3 (running):
- `r2b-attachment-upload` DONE (2 int + 1 unit, clippy clean; reuses R2a helpers).
- `annotation-info` DONE (6 int + 1 unit). Deviation: anonymous full_json uses placeholder requester (parent TODO: full_json taking Option<&AuthUser>); compound serializer local.
- `merge-reset` DONE after re-dispatch (6 int). Parent added TracingStoreClient::reset_to_base on the long (2 h) transport and a router-wide request-timeout exemption `uses_long_rpc` in lib.rs (reset, duplicate, both merges, createExplorational get max(request_timeout, 2 h)); unit test long_rpc_tests.
- `r2c-dataset-upload` DONE (2 int; LinkedLayer + add_initial_teams now pub(crate) in dataset_upload_paths.rs).
- `r2d-dataset-report` DONE (2 int; submit_job, write_data_source, resolve_linked_layers now pub(crate)). Slack/Mailchimp side effects log-only (no clients in crate). All 7 R2 datastore upload callbacks done.
- `ti1-tracing-init` DONE after re-dispatch (11 unit, clippy clean). TI2 requirements in checkpoints/tracing-initialization.md.
- `ti2a-save-rpcs` DONE (service_clients 6, tracingstore_client 14 tests; request_bytes, has_segment_index, 3 saves, 2 tracing GETs with recursive proto2 required-field checks; skeleton/volume decoders not yet replayed against ScalaPB oracle).
- `ti2b-create` DONE (8 int + 3 unit; createExplorational + createTracing). All main-app tracingstore callbacks done.
- DEPENDENCY DECISION (parent, 2026-10-10): crates.io is reachable from this machine (the old --offline rule came from the Codex sandbox). Added `quick-xml` 0.42 and `zip` 9 (default-features=false, deflate) via cargo add + cargo fetch into CARGO_HOME=/tmp/webknossos-rust-cargo; `--locked --offline` builds still work. Backups: /tmp/webknossos-rust-Cargo.{toml,lock}.bak. Tell the user.
- `nml-writer` DONE after re-dispatch (14 unit; byte-identical to Woodstox/txw2 golden docs via local Java oracle; Java double/float formatting incl. ties-to-even). Parent: download routes added to uses_long_rpc.
- `d1-download-rpcs` DONE (20 tracingstore_client tests). Parent: long (2 h) transport now has no response-size cap (Scala parity; default transport keeps WK_RPC_MAX_RESPONSE_BYTES); uses_long_rpc covers POST /tasks, /tasks/createFromFiles, /annotations/upload.
- `d2-download` DONE (6 int + 2 unit; compound downloads implemented; all zip RPCs on the uncapped long transport).
- Remaining main-app routes: upload (U2 after U1), createFromFiles (after U1), download x2 (D2 running). Inventory 283/287.
- `oidc` DONE (6 int + 4 unit; env WK_OIDC_ENABLED/PROVIDER_URL/CLIENT_ID/CLIENT_SECRET/SCOPE/VERBOSE_LOGGING/HTTP_TIMEOUT_SECONDS, WK_SSO_KEY; ring RS256/384/512). Parent: /api/features openIdConnectEnabled now follows config.oidc.enabled. PARENT TODO: README/.env docs for these env names.
- `webauthn-w1` DONE (checkpoint complete; 2 int + 9 cbor unit; webauthn4j oracle-pinned storage format).
- `webauthn-w2` DONE (4 int, 16 lib unit; all 4 WebAuthn routes).
- `task-creation` DONE (6 int + 4 unit; reusable create_tasks core for createFromFiles).
- `n4a-finish` DONE (5 int + 1 unit; finish/finishAll with writer after commit).
- `r4c-update-report` DONE (5 int + 2 unit). All main-app tracingstore callbacks except createTracing done.
- Parent central verification after B2 (B3 files in progress): full ignored-inclusive suite 331 passed, 0 failed, 0 ignored, 67 harnesses, exit 0, log /tmp/webknossos-rust-b2-verification.log; whole-crate clippy -D warnings clean before B3 dispatch.
- `duplicate` DONE (5 int + 2 unit; pub(crate) duplicate_in_tracing_store/insert_annotation). Scala parity kept: compound duplicate has no access gate. Known bug to fix: compound merge 500 when a dataset layer has no mags (datasets::data_source_for_rpc).
- `task-assign` DONE (3 int + 1 unit; reusable assignment API). Parent: TracingStoreClient::long_clients() accessor; duplicate + assign handlers now pass the 2 h transport; uses_long_rpc also covers POST /tasks/:id/assign and /user/tasks/request.
- `task-request` DONE (5 int; READ COMMITTED + FOR UPDATE + full re-check, 50 retries; maxOpenPerUser hard-coded 5).
- `nml-parser` DONE after re-dispatch (13 unit; not JVM-oracle-checked).
- Parent: axum `multipart` feature enabled (multer added to Cargo.lock via cargo fetch).
- `u1-upload-service` DONE (10 unit + 1 int; zip limits 10k entries / 2 GiB / depth 8 are new vs Scala).
- `u2-upload` DONE (6 int + 3 unit; 1 GiB body limit on its router). PARENT TODO: move upload/task_creation private RPC helpers (initialData, mapping save, merge volume/skeleton by contents) into TracingStoreClient.
- `create-from-files` DONE (4 int; no source changes needed).
- MAIN APP ROUTE COVERAGE COMPLETE: inventory 287/287, 0 Pending (2026-10-10 ~23:30 UTC). `rpc-consolidation` DONE (tracingstore_client 25 tests; upload/task/duplicate RPCs now TracingStoreClient methods). Parent: extracted the JDK-verified Java Double/Float formatter into src/java_format.rs; task_creation, credit_transactions, thumbnails and nml_writer now all use it (previous ad-hoc copies did not round ties to even). Central full suite after main-app completion: 524 passed, 0 failed, 0 ignored, 85 harnesses, exit 0 (log /tmp/webknossos-rust-main-complete-verification.log). `main-app-gaps` read-only audit -> checkpoints/main-app-gaps.md (non-route gaps: mail, background tasks, integrations).
- Third usage-limit pause ~00:58-05:30 local 2026-10-11 interrupted ds0b/ds1a/ds1b/gaps-audit. Parent: DS0b finalized (datastore suite green: lib 47, access 7, health 7, routing 6, wk_client 12); removed DS1b's undeclared gcs/s3/service mods temporarily (note in datavault/mod.rs). Duplicate UPath (models vs datavault) -> `ds1a-finish` (ds-verify-b) unifies into models::UPath + clippy-cleans models/datavault. `ds2-codecs` -> ds-verify (src/compression*). `main-app-gaps` DONE -> checkpoints/main-app-gaps.md (G1-G13, D1-D14). `ds1a-finish` DONE (canonical models::UPath; lib 48 + models 9 tests; Jackson-style writer; disk_writer port). Parent enabled serde_json preserve_order in the datastore crate (Play key-order parity); suite still green. `ds1b-finish` -> ds-verify-b (s3/gcs/service). `ds2-codecs` DONE (pure Rust incl. own Blosc1; verified both directions against the exact Java jars; JPEG/compresso/compressed_segmentation later). Parent registered `datareaders` module. `ds2-core` -> ds-verify (DatasetArray core + Zarr v2 + NGFF).
- Fourth usage-limit pause (~12:00-13:10 local 2026-10-11) interrupted smtp-mail, slack, credit-ticker, ds1b-finish, ds2-core. CONCURRENCY POLICY NOW: at most 3 agents at a time, agents must checkpoint after each file. Re-dispatched: smtp-mail finish (verify-a), credit-ticker finish (verify-c), ds1b-finish #2 (ds-verify-b) -> DONE (lib 63, datavault 20; SigV4 AWS vectors; ZipDataVault still missing = DS1c; DataVaultService not yet in AppState). `ds2-core` DONE (158 datastore tests; ChunkContentsCache port; real binaryData .zarray read). Decision: keep 2-d drop(1) chunk naming quirk (Scala parity). Parent pre-registered datareaders/{wkw,zarr3,n5,precomputed}. `ds2-wkw` -> ds-verify. Next: zarr3, n5, precomputed readers. `smtp-mail` DONE (21 templates, 22 golden HTML cases byte-identical to compiled Play templates; full suite 573/573, 88 harnesses). Parent wired router-wide Extension(SlackNotificationService::new(&config.slack)) (RouteOptions.slack). `slack-finish` DONE (8/9 G4 call sites; worker-liveness waits for G5; full suite 584 passed, 3 failed only in in-flight used_storage_scan fixtures). Parent wired slack::install_global + notice_startup in main.rs. Router service and global service have separate 30/min limiters (minor). `credit-ticker` DONE (7 unit + 4 DB; WK_CREDIT_TICKER_*; shared revoke/hand-out fns); parent wired spawn/shutdown in main.rs. Parent pre-wired Config.used_storage (dataset_storage::UsedStorageConfig scaffold). `used-storage-scan` DONE (6 unit + 6 DB; WK_USED_STORAGE_*); parent wired spawn/shutdown in main.rs. Main.rs now starts housekeeping, credit ticker, used-storage scan; Slack global + startup notice. Central full suite after gaps batch: 587 passed, 0 failed, 0 ignored, 90 harnesses, exit 0 (log /tmp/webknossos-rust-gaps-verification.log). Parent pre-wired Config.worker_liveness scaffold. `worker-liveness` (G5) DONE (8 unit + 3 DB; parent wired main.rs), `analytics-call-sites` (G6) -> verify-b. (Superseded: G5 and G7 are now done; remaining gaps are listed in "Open work items" at the top.)
- Main-app gaps batch: parent added `lettre` 0.11 (backups /tmp/webknossos-rust-Cargo.{toml,lock}.bak2), Config.mail (mail::MailConfig/config_from_values/MailSender::from_config scaffolds, router_with_config uses from_config) and Config.housekeeping (housekeeping::HousekeepingConfig/config_from_values scaffold), `scheduler`+`housekeeping` modules registered. `smtp-mail` -> verify-a (mail.rs + Mail call sites), `housekeeping` -> verify-b (scheduler.rs, housekeeping.rs). `housekeeping` DONE (11 unit + 9 DB tests; 6 jobs, advisory-locked, WK_HOUSEKEEPING_* switches, default enabled like Scala); parent wired spawn/shutdown into main.rs. Parent pre-wired Config.slack (slack::SlackConfig) and Config.credit_ticker (credit_ticker::CreditTickerConfig) scaffolds. `slack` -> verify-b, `credit-ticker` -> verify-c. PARENT TODO: wire their spawn/Extension lines from their reports. Then G6 analytics call sites, G7 used storage scan.
- DATASTORE started: parent created package backend-rust/datastore (own Cargo.toml/lock, target /tmp/webknossos-rust-ds-verify; health test + clippy pass). `ds0a-foundation` DONE (32 tests; WK_DS_* config, error JSON, CORS, versioning, Redis health). Parent pre-registered datastore modules access/models/wk_client. `ds0b-wk-client` -> ds-verify (wk_client.rs, access.rs, lib/main wiring). `ds1a-models` -> ds-verify-b (models.rs or models/).
- Parent: fixed config Debug leak-test false positive (OidcConfig label `client_credential_configured`). Central full suite (--no-fail-fast, --include-ignored, 2026-10-10 ~17:50 UTC, in-flight scaffolds included): 499 passed, 0 failed, 0 ignored, 82 harnesses, exit 0, log /tmp/webknossos-rust-b5-verification.log.
- Parent: maxOpenPerUser now configurable via WK_TASKS_MAX_OPEN_PER_USER (MiscConfig.max_open_tasks_per_user, default 5).
CRATE-WIDE DECISION: Scala `_ <- restrictions.allowX(user) ?~> msg ~> FORBIDDEN` binds Fox[Boolean] and does NOT stop on false (verified: AnnotationRestrictions returns Fox[Boolean], no implicit assert). Rust fails closed with Scala's status/message; document per route. Tell the user.
Inventory 267/287.
Remaining main-app routes (5 after WebAuthn): POST /tasks (running), createFromFiles, annotations upload, download typed+untyped. Older note: webauthn auth start/finalize (after W1), POST /tasks, POST /tasks/createFromFiles, POST /annotations/upload, GET download typed+untyped, + in-flight register start/finalize and /user/tasks/request. Plan: nml-writer -> download routes; nml-parser -> upload + createFromFiles; task creation (POST /tasks) needs TaskCreationService.
Old queue: annotation info typed/untyped (writer), handleTracingUpdateReport (writer + only_with_significant_changes), R2d reportDatasetUpload, createExplorational + createTracing (tracing initialization), duplicate/reset/merge, task assign/request/create/createFromFiles, annotation upload/download, OIDC3, WebAuthn4.

Disk constraint: /tmp volume ~35 GiB free (97%); each target dir ~20 GiB. Use at most verify, verify-a, verify-b, verify-c. `trash` does not free space.

Parent owns lib.rs/config.rs/Cargo/README/MIGRATION_STATUS/inventory, shared-helper extraction requests and central verification.

## Next phase

Datastore engine plan: checkpoints/datastore-plan.md (separate Cargo package backend-rust/datastore, phases DS0-DS6, open decisions HDF5/JNI/disk). Start DS0a once the last main-app routes (upload, createFromFiles, download) are integrated and centrally verified.

## Integrated progress

- Foundation: PostgreSQL/SQLx, Axum/Tokio, schema check, CRUD, permissions, Play-compatible browser/token auth and onboarding, datasets, users/teams/folders/scripts/projects/task types/task reads, organizations/credits/publications, time reports, info/analytics, jobs/worker/Voxelytics. Remaining side effects are documented in README/checkpoints.
- All 13 AI model routes now implemented, including uploads, training and inference submissions. J2 eight job submission routes are complete.
- Annotation saved+compound provider, original generated protobuf types, real tracingstore get/merge RPC, 60-minute compound cache and seven-day temporary datasource store, metadata/shared-team routes.
- R1 six datastore report/status/source callbacks, R3 four lookup/deletion callbacks; callback delete shares existing transaction-safe dataset deletion. R2 upload callbacks remain.
- R4a five tracingstore read callbacks and R4b protobuf updateAnnotation callback wired; reads share live service-key auth and real compound/temp caches. Update preserves existing stats/types, replaces layer set and description atomically, and supports reports before parent annotation creation (no schema185 FK).
- N5a session-specific mutex acquire/release wired with configurable default 120s expiry, transactional concurrency and blocked-user serializer. Expired leases can be reclaimed; hourly physical cleanup remains pending.
- N4b three lifecycle routes wired. Cancellation preserves task/annotation dependencies and invalidates three compound cache keys after successful finished-task cancellation; collaboration mode+reservation deletion is atomic.
- Parent protobuf correction rejects missing proto2 required fields inside user states/vectors/coordinates. All 31 acceptance fixtures were verified by the actual repository ScalaPB parser and the Rust decoder. Replay via tools/check_annotation_proto_scala.py; details in protobuf-compatibility.md.
- Current generated inventory: **250/287 main application method/path registrations**. Registration count is not behavioral parity or migration completion.

## Verification

- Current batch focused evidence: R3 callback3/3 + dataset lifecycle3/3; N4b4/4; targeted clippy+formatting pass. Whole-crate formatting and inventory check pass after parent fixture formatting.
- Prior adopted-code267-test and older230-test reports are historical. New central R3/N4b/protobuf suite275 passed with no failures or ignored tests; recovered terminal tool handle confirms exit0. Clippy all-targets passed. New R4a4/4, N5a5/5 and R4b3/3 focused tests passed. Whole clippy/fmt/inventory pass; new full suite287/287 passed, no ignored tests (session67309). No source edits after that run began, apart from already-compiled stable agent files; only documentation refreshes.
- Scala parser corpus replay:31/31 match. No complete Scala HTTP differential run, real worker run, datastore or tracingstore engine replacement has been performed.

## Next bounded queue

1. Current R4/N5a batch is complete and centrally verified. Next delegate TW1 pure time-interaction planner/core to jobs_run_finish (read its completed research checkpoint), and N4d reopen single route to annotation_contracts. Keep each bounded; parent coordinates one shared timewriter state/config and defers TW2 DB executor until planner is complete. Reopen is independent of writer.
2. N4a finish/finishAll2 needs real time-interaction writer/config/cache invalidation. Reopen1 does not use the writer; research found its Scala owner time gate is strictly AFTER configured30s+10s despite tooLate wording. See completed time-interaction-writer.md. TW2 needs transactional accounting with cache/mail publication after commit before finish routes are claimed. N5b reservedIds/reserveIds2 needs largest-ID tracingstore RPC and transaction advisory lock shared with collaboration mode (`annotation-reservations:<id>`). Transfer1 separately.
3. R2 datastore uploads7: split reservations and reports/unfinished list. R4 remaining update-report1 needs timewriter, createTracing1 needs tracing initialization.
4. Annotation info typed/untyped + sandbox/createExplorational, then duplicate/reset/merge/task assignment; task allocation/creation; annotation IO upload/download. Split each group to roughly2–5 routes, taking prerequisites first.
5. OIDC3 and WebAuthn ceremonies4; SMTP delivery and deferred integrations/background tasks.
6. Differential Play tests, observability/performance, schema ownership and staged cutover. Then datastore engine, then tracingstore engine including binary formats/codecs/FossilDB/update concurrency (tracingstore engine: postponed for later; the Scala tracingstore is kept for now).

## Reproducible verification

CARGO_HOME=/tmp/webknossos-rust-cargo. Parent target=/tmp/webknossos-rust-verify; agent A verify-a; agent B verify-b. Avoid concurrent builds in the same target. PostgreSQL15 isolated cluster is running on127.0.0.1:55439; URL below has CREATEDB. Network tests require sandbox escalation. Tests bootstrap only fresh wk_rust_test_<uuid> databases; a panic can leave its generated database for debugging.

```sh
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --manifest-path backend-rust/Cargo.toml --locked --offline -- --include-ignored
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify cargo clippy --manifest-path backend-rust/Cargo.toml --locked --offline --all-targets -- -D warnings
cargo fmt --manifest-path backend-rust/Cargo.toml --check
python3 backend-rust/tools/route_inventory.py
python3 backend-rust/tools/route_inventory.py --check
python3 backend-rust/tools/check_annotation_proto_scala.py
```

Only if PG is stopped: `/opt/homebrew/opt/postgresql@15/bin/pg_ctl -D /tmp/webknossos-rust-postgres/data -l /tmp/webknossos-rust-postgres/server.log -o '-h 127.0.0.1 -p 55439 -k /tmp/webknossos-rust-postgres' start`.

History: coordinator-2026-10-09-history.md and coordinator-2026-10-09-takeover-history.md. Detailed domain checkpoints are the recovery source for contracts, tests and intentional deviations.

## Codex datastore continuation — 2026-10-11

User confirmed Claude is stopped. Codex owns datastore readers and their checkpoints; no main-app edits. WKW first, then Zarr3/N5/precomputed; evaluate zarrs ecosystem. Existing WKW header/file/Morton source was unwired; now registered with new range-based WkwArrayFormat/open_wkw_array. Eight unit tests and four array integration tests pass. WKW still in progress pending independent golden fixtures, cache verification and whole-datastore checks. No reader route parity claimed.

WKW milestone: DONE; 174 datastore tests passed incl. ignored fixtures, fmt and all-target clippy clean. Native WKW fixtures checked in, details datastore-ds2-wkw.md. Next Zarr3 adapter evaluation; WKW source and fixtures owned by Codex. Main app untouched.
