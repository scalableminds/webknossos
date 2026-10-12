# Tracingstore read callbacks (R4a)

Owner: `src/remote_tracingstore_reads.rs`, `tests/remote_tracingstore_reads.rs`, this checkpoint. Parent owns lib/shared modules.

## Status (complete)
- Five read handlers implemented and merged by parent. Final focused ignored-inclusive suite passed4/4 (session42169); library+owned-test clippy passed (session5252); owned rustfmt --check passed. Source/tests are stable; agent stopped edits. Parent owns central full-suite/all-target verification and inventory.
- Exactly five read callbacks; no create/update/report mutations.
- Router: `pub fn router() -> Router<AppState>`; parent declared/merged it in lib.rs. Existing parent router layers the shared `AnnotationProvider`, so temporary-store/cache state is reused.
- No shared helper edits needed: local `pub(crate) ValidatedTracingStore` delegates to `pub(crate) async fn validate_key(pool: &PgPool, key: &str) -> Result<(), CallbackError>`. CallbackError is the compact Api(ApiError)/Plain(StatusCode, static str) enum with IntoResponse and From<ApiError>; parent uses the validator after protobuf parsing for R4b. Validates `?key=` against any live tracingStores_ row; `{name}` is informational, matching TracingStoreService and existing user_access. Bad/unknown/deleted key ->403 **plain text** `Tracing store could not be found or accessed.`. Missing key ->400 query envelope. Key never selected/logged. Route-specific Path/Query binding precedes service auth.

## Exact routes and contracts
1. GET `/tracingstores/{name}/dataSource?key=&annotationId=` (`dataSourceForAnnotation`). Authenticate, then `AnnotationProvider.data_sources().find(id)`; a hit returns stored data_source verbatim, with no persisted annotation/dataset lookup. Otherwise globally find live annotation, then live dataset, render DatasetService.dataSourceFor (real paths, credential IDs). Missing annotation ->400 `Annotation could not be found or accessed.`. Missing dataset ->400 `Dataset “<dataset>” for annotation “<annotation>” does not exist or could not be accessed.`. Usable without voxel size ->400 `Dataset is marked as usable but has no voxel size.`.
2. GET `/tracingstores/{name}/datasetId?key=&annotationId=` (`datasetIdForAnnotation`). Same temporary-store precedence; hit returns dataset_id JSON string even if dataset no longer exists. On miss, same live annotation/dataset global checks/messages as above, then dataset ID JSON string. No source rendering or usable/voxel gate.
3. GET `/tracingstores/{name}/annotationId?key=&tracingId=` (`annotationIdForTracing`). `tracingId` is arbitrary string, **never ObjectId-parsed**. After auth, exact `dummyTracingId` ->JSON `000000000000000000000000`. Otherwise saved live annotation via unique annotation_layers.tracingId first; if absent/deleted/unparseable, fall back to `AnnotationProvider.find_cached_by_tracing_id` and return synthetic parent ID. Saved annotation takes precedence over cached compound. Neither branch reruns a compound handler or merge. Missing both ->400 `No annotation for tracing <literal>`.
4. GET `/tracingstores/{name}/dataStoreUri/{datasetId}?key=` (`dataStoreUriForDataset`). Path ID uses PathObjectId (prefix/uppercase compatible). Globally require live dataset ->404 `Dataset “<id>” could not be found or accessed.`. Globally lookup live datastore by trimmed stored name ->400 `Data store could not be found or accessed.`. Return internal `url` JSON string (not publicUrl). No caller-name/store/org restriction.
5. GET `/tracingstores/{name}/datasources/{datasetId}?key=` (`getDataSource`). Path ID binding as above. Globally require live dataset ->404 same dataset message, then service datasource JSON with real paths/credential IDs. Usable missing voxel ->400 message above; unusable source returns id/status and optional scale, no layers.

## Reuse and implementation boundaries
- Temporary data source: existing `AnnotationProvider.data_sources()` public find/store methods, shared clones; seven-day TTL. Cached compounds: existing public find_cached_by_tracing_id (60-minute TTL). Do not fake persisted annotations or cache fallbacks.
- Dataset rendering: `datasets::data_source_for_rpc(pool,id,true)` includes mag/attachment credential IDs and resolves realPath over stored paths, as Scala service-to-service contract. Credentials/passwords/store keys are not returned. Temporary-store hits are already rendered genuine data sources and must be returned verbatim.
- Preflight dataset isUsable/voxel checks in module-local read helper to preserve Scala 400; generic datasource helper currently returns 500 for usable-without-voxel. No global behavior change planned.
- Global annotation queries use live annotations_ without end-user permission filtering; these are service-key callbacks. Reuse `annotation_provider::dataset_not_found_for_annotation` message.
- Original Scala failure statuses use default Fox Failure400 / Empty404, with explicit dataset path failures404. No uniform missing-resource404 adaptation.
- Service authentication database errors retain shared Rust ApiError behavior (existing user_access does so), rather than swallowing infrastructure errors as authentication denials.

## Verified focused coverage
- Key is global regardless name, wrong/missing/deleted key, error content type/plain-text body, no user token, query/path ID normalization and invalid prefixes in query, arbitrary tracing IDs and exact dummy behavior after authentication.
- Saved private annotation globally readable with valid service key; source/dataset ID consistency; missing/deleted annotation and dataset exact messages/statuses; canceled/finished annotations remain lookupable when live.
- Genuine provider temporary-store hit takes precedence over persisted annotation (and succeeds without persisted rows); source returned verbatim including credential IDs and dataset ID.
- Saved tracing lookup plus cached compound fallback from a real provider merge with local protobuf mock; precedence and cache invalidation via existing provider API; no new RPC when resolving tracing IDs.
- Dataset direct datasource paths/attachment/mag credential-ID exposure, unusable variants, usable-no-voxel400, missing/deleted datasets404, internal datastore URI and deleted store400, informational caller names and datastore organization restrictions ignored by global contract.
- Tests use TestDb's fresh uniquely named databases (PG55439), never schema bootstrap on admin/existing DB. verify-a target, shared cached Cargo home; no rm. Focused tests + library/test clippy/rustfmt passed; parent owns central all-target/full suite/inventory.

## Sources examined
- `app/controllers/WKRemoteTracingStoreController.scala` read methods; `conf/webknossos.latest.routes` lines170–175.
- `app/models/annotation/TracingStore.scala` validateAccess: global key and plain403.
- `AnnotationInformationProvider.scala::annotationForTracing`, `Annotation.scala::findOneByTracingId` and `findAnnotationIdByTracingId`, `AnnotationDataSourceTemporaryStore.scala` seven-day store.
- `DatasetService.scala::dataSourceFor`, `dataStoreFor`; `TracingId.scala::dummy`, `ObjectId.scala::dummyId`.
- Rust `user_access`, `annotation_provider`, `datasets`, `dataset_lifecycle`, `remote_datastore` and parent provider extension wiring.

## Done / Next / Evidence
- Done: src/remote_tracingstore_reads.rs and tests/remote_tracingstore_reads.rs. Five GET routes, global plain-text service auth, temporary-store precedence, saved-before-cached tracing lookup, metadata/layer parse failure fallback, real paths/credential IDs and exact read failure statuses. Shared source files untouched.
- Done: four tests cover binding/auth/dummy/arbitrary IDs; private saved sources and lifecycle/deletion/unusable cases; verbatim temporary sources; genuine CompoundProject merge against local protobuf HTTP mock, saved precedence, malformed saved enum fallback, cache invalidation and exactly one merge RPC.
- Next: parent central full suite, all-target clippy and inventory. No further source edits assigned.
- Evidence: final suite session42169 passed4/4; clippy --lib --test remote_tracingstore_reads -- -D warnings session5252 passed; rustfmt --edition2024 --check owned files passed.
- Fixture corrections: pendingInstances starts1 because insertion of the task annotation decrements it; malformed-type fixture inserts a new row because the real schema makes annotation type immutable. An attempted whitespace datastore fixture was removed because datastore_ref enforces names; implementation still trims stored names as Scala does. All fixture schema changes are confined to the fresh generated TestDb. Failed test databases may remain for debugging under TestDb policy.

```sh
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-a WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --manifest-path backend-rust/Cargo.toml --locked --offline --test remote_tracingstore_reads -- --include-ignored
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-a cargo clippy --manifest-path backend-rust/Cargo.toml --locked --offline --lib --test remote_tracingstore_reads -- -D warnings
rustfmt --edition 2024 --check backend-rust/src/remote_tracingstore_reads.rs backend-rust/tests/remote_tracingstore_reads.rs
```
