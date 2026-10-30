# Annotation create (TI2b): createExplorational + createTracing

## Status

2026-10-10: DONE. Owner: ti2b sub-agent (target /tmp/webknossos-rust-verify-b).
Files: src/annotation_create.rs, src/remote_tracingstore_create.rs (both scaffolds
already merged by parent, signatures unchanged), tests/annotation_create.rs,
this file. No visibility changes elsewhere; no other files edited.

## Contract

`POST /datasets/:datasetId/createExplorational` (AnnotationController, secured):
- Body `List[AnnotationLayerParameters]` (TI1 serde codec; invalid -> 400
  `Invalid JSON request body.`). Auth (401) runs before the body here; Play parses
  the body first (only differs for unauthenticated + invalid body).
- `datasetDAO.findOne` under user access (`dataset_access::can_read`) -> 404
  `Dataset “id” could not be found or accessed.`
- createExplorationalFor: new ObjectId; createLayersForExplorational =
  first tracing store (`TracingStore.notFound`) -> usableDataSourceFor
  (unusable -> `notUsable`; usable without voxel size ->
  `usableButNoVoxelSize ?~> DataSource.notFound ~> 404`) -> per params SERIALLY:
  datastore by `trim(_dataStore)` in `dataStores_` (`DataStore.notFoundForDataset`),
  skeleton defaults or volume plan (fallback / largestSegmentId range / mags) ->
  `hasSegmentIndex` datastore RPC only with a fallback layer -> build -> layer name ->
  `TracingId.generate` (UUID v4 string) -> save skeleton (long timeout) / volume
  (registers temp data source first) -> `saveAnnotationProto` (description "",
  version 0, layers, earliestAccessibleVersion 0).
- Every failure above renders `Could not create annotation.` (chain
  `Could not set up annotation layers.`, inner); ParamFailure status kept
  (404 data source, upstream RPC status), else 400. Missing fallback layer is
  Fox.empty -> 400 after wrapping. DB faults stay 5xx.
- Only after all RPCs: one transaction = `insert_annotation` (annotation_duplicate,
  Explorational/Internal/OwnerOnly/Active, name/description "", created=modified=now ms)
  + per-layer `statistics = AnnotationLayerStatistics.zeroedForType` UPDATE
  (insert_annotation writes `{}`) + `annotation_lists::full_json` (publicWrites,
  failure -> 400 `Could not convert annotation to json.`), then commit.
- After commit: `analytics::track("create_annotation", {annotation_id,
  annotation_dataset_id})`; Mailchimp `HasAnnotated` tag is debug-log only (no client).
- Response: plain JSON (JsonOk), the serializer of the new annotation.

`POST /tracingstores/:name/createTracing?key&annotationId&previousVersion`
(WKRemoteTracingStoreController, GlobalAccessContext):
- Query binding (400), then JSON body (400 / 415), then `validate_key` (403 plain
  `Tracing store could not be found or accessed.`, any path name).
- `annotations_` row -> else 400 `Annotation could not be found or accessed.`;
  dataset `datasets_` -> else Fox.empty 404 `Msg.notFound`.
- createTracingForExplorational order: datastore -> usable data source -> tracing
  store -> old precedence (`precedence_fetch_request(Some(id), layers,
  Some(previousVersion))`: skeleton layers first, min tracingId;
  `GET /tracings/{skeleton|volume}/{id}?annotationId&version`) -> build -> adapt.
- Response `200 application/x-protobuf`, `InitialTracing::encode_to_vec()`. No saves.
  Errors unwrapped (RPC upstream status kept, invalid fallback = 404 Msg.notFound).

Shared pub(crate) helpers in annotation_create.rs: `DatasetFacts`/`find_dataset`,
`UsableSource`/`usable_data_source`, `tracing_store_url`, `data_store_url`,
`TracingContext`, `fetch_precedence_properties`, `create_tracing`, `CREATE_FAILED`.

## Deviations / notes

- `#![allow(dead_code)]` in src/tracing_initialization.rs left in place: after
  wiring, `AnnotationLayerParameters::name_with_default`, `InitialTracing::layer_type`
  and `create_tracing_for_explorational` (convenience that cannot skip the RPC)
  are still unused (probed by removing the attribute, then restored).
- Datastore `hasSegmentIndex` has no 1-minute cache (see tracingstore-save-rpcs.md).
- Tracing-store data saved before a later failure is orphaned (as in Scala); the
  temporary data source entry for a failed volume save also stays (as Scala).
- Insert + serializer in one transaction committed last: a serializer failure leaves
  no row (Scala commits the insert first). Analytics only after commit.
- Known crate bug inherited: `datasets::data_source_for_rpc` 500s for dataset layers
  without mags (tests seed mags).

## Status / Done / Next / Evidence

Status: COMPLETE.
Done: both routes; 3 unit tests (zeroed stats, Empty wrapping, upstream status
through wrapping); 8 DB integration tests with one mock server acting as tracing
store + datastore: skeleton-only (exact RPC paths/query keys/proto bodies, response,
row, zeroed stats), volume with auto fallback (hasSegmentIndex GET, volume body:
fallback/largestSegmentId/elementClass/hasSegmentIndex=false/mapping/bbox/mags,
layer named after fallback), skeleton+volume serial (no datastore call, mag
restrictions, names, temp data source served), invalid fallback (color, missing)
and too-tight mags -> 400 createFailed with no row, invalid body 400, 401;
unknown/foreign dataset 404, unusable 400; RPC failures 500/400/503 keep status, no
rows, no tracing store 400; createTracing wrong key 403 (body validated first),
unknown annotation 400, success bytes decode to adapted volume/skeleton (precedence
skeleton fetched with version=7, user boxes + legacy box id 0, user states), no
precedence fetch without layers, Fox.empty fallback 404, upstream 502 kept.
Next: parent central verification + `python3 tools/route_inventory.py` (two routes).
Evidence (verify-b, PG 55439): `cargo test --test annotation_create -- --include-ignored`
8 passed, 0 failed; `cargo test --lib annotation_create` 3 passed;
`cargo clippy --all-targets -- -D warnings` exit 0; `rustfmt --edition 2024 --check`
on the three owned files clean.
