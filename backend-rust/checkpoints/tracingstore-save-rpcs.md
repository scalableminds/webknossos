# Tracing store save/get RPCs (TI2a)

## Status

2026-10-10: TI2a DONE. Client layer only, no routes. Additive changes in
`src/service_clients.rs` and `src/tracingstore_client.rs`; no existing
signature or behavior changed.

## Public API

`crate::service_clients`:
- `PROTOBUF_CONTENT_TYPE = "application/x-protobuf"`.
- `ServiceClients::request_bytes(method, base, segments, query, content_type, body: Vec<u8>)
  -> Result<ServiceResponse, ServiceError>`: same URL validation, token
  (`token` query param first), redirect, size and error handling as `request`.
  Invalid header value -> `InvalidConfiguration`, caller `token` key -> `InvalidBaseUrl`.
- `ServiceClients::has_segment_index(datastore_url, &ObjectId dataset, layer) -> Result<bool, ServiceError>`:
  `GET {ds}/data/datasets/{id}/layers/{layer}/hasSegmentIndex?token=`, JSON boolean.

`crate::tracingstore_client` (methods on `TracingStoreClient`):
- `save_skeleton_tracing(url, &SkeletonTracing, new_tracing_id) -> Result<(), ServiceError>`:
  `POST /tracings/skeleton/save?token&newTracingId`, protobuf body, LONG timeout.
- `save_volume_tracing(url, &ObjectId annotation, new_tracing_id, &VolumeTracing,
  VolumeSaveDataSource { store, data_source: &Value, dataset_id }) -> Result<(), ServiceError>`:
  stores into `AnnotationDataSourceStore` first (unconditionally, also when the
  RPC then fails, as Scala), then `POST /tracings/volume/save?token&newTracingId`, default timeout.
  No initialData upload (not needed for explorationals / createTracing).
- `save_annotation_proto(url, &ObjectId annotation, &AnnotationProto) -> Result<(), ServiceError>`:
  `POST /tracings/annotation/save?token&annotationId`, default timeout.
- `get_skeleton_tracing(url, tracing_id, &ObjectId annotation, Option<i64> version)
  -> Result<SkeletonTracing, TracingStoreError>`: `GET /tracings/skeleton/{id}?token&annotationId[&version]`, LONG timeout.
- `get_volume_tracing(...)` same shape: `GET /tracings/volume/{id}`, default timeout
  (Scala `skipVolumeAndEdgesData = true` path: no zip/edges/mapping-info calls).
- `decode_skeleton_tracing` / `decode_volume_tracing(bytes) -> Result<_, TracingStoreError>`:
  prost decode + recursive proto2 required-field table (`required` module,
  transcribed from geometry/MetadataEntry/IdWithBool/SkeletonTracing/VolumeTracing.proto),
  every occurrence of every nested message checked (incl. recursive TreeGroup/SegmentGroup),
  groups rejected anywhere, unknown varint/length-delimited fields ignored,
  unrecognized enum values accepted (ScalaPB generates `Unrecognized`, verified in
  the generated `VolumeTracing.scala`/`Tree.scala`). Reuses `field_tags`/`has_required_fields`.
  `InvalidProtobuf` maps to 400 as before.

## Deviations / decisions

- hasSegmentIndex cache: NOT implemented on purpose. Scala's 1-minute `AlfuCache`
  is a field of `WKRemoteDataStoreClient`, and `AnnotationService.createVolumeTracing`
  does `new WKRemoteDataStoreClient(...)` per call, so the cache never serves a
  later request. Rust calls through every time, matching observable behavior.
- Layer-type assertions (`fetchNotSkeleton` / `fetchNotVolume`) are not in the
  client: caller dispatches on `PrecedenceFetchRequest.typ` (TI1) before calling.
- Skeleton/volume required-field tables were not replayed against the ScalaPB
  oracle (only AnnotationProto has a fixture corpus); they follow the same
  per-occurrence semantics the oracle confirmed for AnnotationProto.

## Notes for TI2b (createExplorational + createTracing routes)

- Datastore: `ServiceClients` (router Extension) `.has_segment_index(&datastore.url /*private*/, &dataset.id, layer)`
  only iff `VolumeTracingPlan::segment_index_lookup()` is `Some(layer)`.
- Precedence fetch (createTracing only): `match req.typ { Skeleton => get_skeleton_tracing,
  Volume => get_volume_tracing }(ts_url, &req.tracing_id, &req.annotation_id, req.version)`
  -> `FetchedPrecedenceTracing::{Skeleton, Volume}`. Long timeout for skeleton only.
- createExplorational saves per params (serial): skeleton -> `save_skeleton_tracing(ts, &t, &new_id)`;
  volume -> `save_volume_tracing(ts, &annotation_id, &new_id, &t, VolumeSaveDataSource {
  store: annotation_provider.data_sources(), data_source: &rendered_usable_data_source_json,
  dataset_id: &dataset.id })`. Then `save_annotation_proto(ts, &annotation_id, &AnnotationProto {
  description: "", version: 0, annotation_layers: [AnnotationLayerProto { tracing_id, name, typ }],
  earliest_accessible_version: 0, ..Default })`. Map any error ?~> `CREATE_TRACINGS_FAILED`
  then `Msg.Annotation.createFailed` (Scala message chain, not the raw ServiceError).
- createTracing response: `InitialTracing::encode_to_vec()` with `PROTOBUF_CONTENT_TYPE`; no saves.
- Tracing store URL: `find_first_tracing_store_url` / `first_tracing_store_url` (existing).

## Evidence

- `cargo test --locked --offline --test tracingstore_client --test service_clients -- --include-ignored`
  (target verify-b, DB URL set): service_clients 6 passed (3 new), tracingstore_client
  14 passed (7 new, incl. 1 DB test), 0 failed, 0 ignored.
- `cargo clippy --locked --offline --all-targets -- -D warnings` (verify-b): clean.
- `rustfmt --edition 2024 --check` on the 4 owned source/test files: clean.

## Download RPCs (D1)

2026-10-10: DONE. Client layer only, additive in `src/tracingstore_client.rs`
(no existing signature changed); 6 new tests appended to `tests/tracingstore_client.rs`
(per-path `RoutedMock`). Reuses `nml_writer::{VolumeDataZipFormat, NmlVoxelSize, java_double}`.

Public API (methods on `TracingStoreClient`, token via shared transport):
- `fetch_volume_layer(url, VolumeLayerFetch { tracing_id, annotation_id, version,
  skip_volume_and_edges_data, volume_data_zip_format, voxel_size: Option<&NmlVoxelSize> })
  -> Result<FetchedVolumeLayer { tracing, data, edited_mapping_edges, base_mapping_name }, TracingStoreError>`:
  Scala `getVolumeTracing` in full. Tracing GET (default timeout), then unless skipped:
  `has_editable_mapping != Some(true)` -> allDataZip; else editedEdgesZip then mapping info.
  Layer-type assertion (`fetchNotVolume`) stays with the caller.
- `get_volume_data_zip(url, tracing_id, &annotation_id, version, format, voxel_size) -> Result<Vec<u8>, ServiceError>`:
  `GET /tracings/volume/{id}/allDataZip?token&volumeDataZipFormat&annotationId[&version][&voxelSizeFactor&voxelSizeUnit]`, LONG.
  `voxelSizeFactor` = `java_double(x),java_double(y),java_double(z)` (Vec3Double.toUriLiteral), unit = LengthUnit name.
- `get_volume_data(url, tracing_id, format, voxel_size) -> Result<Vec<u8>, ServiceError>`: compound
  `getVolumeData`, same endpoint without annotationId/version, LONG.
- `get_edited_mapping_edges_zip(url, tracing_id, version) -> Result<Vec<u8>, ServiceError>`:
  `GET /tracings/mapping/{id}/editedEdgesZip?token[&version]` (no annotationId, as Scala), LONG.
- `get_base_mapping_name(url, tracing_id, &annotation_id, version) -> Result<String, ServiceError>`:
  `GET /tracings/mapping/{id}/info?token[&version]&annotationId`, LONG. Body must be a JSON object
  with string `baseMappingName`, otherwise `ServiceError::InvalidJson` (502).
- `get_skeleton_tracings` / `get_volume_tracings(url, &[Option<String>]) -> Result<Vec<Option<_>>, TracingStoreError>`:
  `POST /tracings/{skeleton|volume}/getMultiple?token`, JSON body `[{"tracingId":..} | null]`, LONG,
  serial batches of `GET_MULTIPLE_BATCH_SIZE` (1000, AnnotationService `grouped(1000)`), results
  flattened in order; empty input -> no RPC. Response length not checked (Scala zips).
- `decode_skeleton_tracings` / `decode_volume_tracings(bytes)`: `SkeletonTracings`/`VolumeTracings`
  with the per-occurrence required-field tables applied to every present `*TracingOpt.tracing`.

Deviations / notes for D2:
- Zip responses are bounded by `WK_RPC_MAX_RESPONSE_BYTES` (default 64 MiB, shared by both
  transports) -> `ResponseTooLarge`; Scala's `getWithBytesResponse` is unbounded. Large volume
  downloads need that limit raised (parent decision; no config change made here).
- Batching lives in the client (Scala does it in AnnotationService) so D2 can pass the full list.
- Errors are the raw `ServiceError`/`TracingStoreError`; D2 must apply the Scala message chain
  (`fetchVolumeLayerFailed`, `annotation.download.failed`, ...).

Evidence (verify-b): `cargo test --locked --offline --test tracingstore_client -- --include-ignored`
20 passed (6 new), 0 failed, 0 ignored. Whole-crate `cargo clippy --all-targets -D warnings` clean
(after the concurrent task_creation.rs errors cleared). rustfmt --edition 2024 --check clean on owned files.

## RPC consolidation (rpc-consolidation)

2026-10-11: DONE. Private tracing-store RPC helpers moved out of route modules into
`TracingStoreClient`; duplicates deleted; route behavior unchanged (transports,
timeouts, caps, paths, queries, bodies identical). All new methods are on the LONG
(2 h, uncapped) transport, as the code they replace.

New public API (`crate::tracingstore_client`):
- `upload_volume_initial_data(url, &annotation_id, tracing_id, min_mag: Option<i32>, max_mag: Option<i32>, data: Vec<u8>) -> Result<(), ServiceError>`:
  `POST /tracings/volume/{id}/initialData?token&annotationId[&minMag][&maxMag]`, octet-stream. Upload passes
  `None, None` (empty MagRestrictions), task creation its MagRestrictions (replaces its private copy).
- `save_editable_mapping(url, &annotation_id, tracing_id, base_mapping_name, start_version, edges_zip: Vec<u8>) -> Result<i64, ServiceError>`:
  `POST /tracings/mapping/{id}/save?token&annotationId&baseMappingName&startVersion`, octet-stream, JSON Long
  response (else `InvalidJson`). The presence match (`(None, None)` → 0, one missing → incomplete-information
  failure) stays in `annotation_upload::save_editable_mapping_if_present`.
- `merge_volume_tracings_by_contents(url, &annotation_id, new_tracing_id, &[VolumeTracing], packed_initial_data: Vec<u8>, VolumeSaveDataSource) -> Result<(), ServiceError>`:
  initializeForMerge (thinned protobuf) → temp data-source store → `{id}/initialDataMultiple?annotationId`
  (octet-stream) → `mergedFromContents?newTracingId` (full protobuf). Stops at the first failure.
  `pack_volume_data_zips` stays in annotation_upload; the caller now packs BEFORE the first RPC (Scala packs
  after initializeForMerge; in-memory zip packing cannot fail in practice, so only that unreachable error
  ordering differs).
- `merge_skeleton_tracings_by_contents(url, new_tracing_id, &[&SkeletonTracing]) -> Result<(), ServiceError>`:
  `POST /tracings/skeleton/mergedFromContents?newTracingId`, `SkeletonTracings` protobuf.
- `save_skeleton_tracings(url, &SkeletonTracingsWithIds) -> Result<Vec<SaveMultipleResult>, ServiceError>`:
  `POST /tracings/skeleton/saveMultiple`, protobuf, JSON `List[Box[Boolean]]` parsed into
  `SaveMultipleResult::{Full, Empty, Failure(String)}` (else `InvalidJson`). task_creation builds the body and
  maps results to its `SaveBox`/`TaskFailure`.
- `duplicate_annotation(url, &DuplicateAnnotationRequest) -> Result<AnnotationProto, TracingStoreError>`:
  `POST /tracings/annotation/{id}/duplicate?token&newAnnotationId[&version][&datasetBoundingBox]&isFromTask&ownerId&requestingUserId`,
  empty body, validated AnnotationProto. `DuplicateAnnotationRequest` moved here (now `pub`).
  `annotation_duplicate::{duplicate_in_tracing_store, duplicate_source_in_tracing_store}` and
  `task_assignment::{create_annotation_for, initialize_task_annotation}` now take `&TracingStoreClient`
  instead of `&ServiceClients` (callers no longer pass `long_clients()`).

Still private in route modules (not moved): task_creation `duplicate_skeleton_tracing` /
`duplicate_volume_tracing` (they use task_creation's own `java_double`, which differs from
`nml_writer::java_double`; unify that first). `long_clients()` stays for them.

Evidence (verify-a, PG 55439, `--include-ignored`): tracingstore_client 25 passed (5 new: initialData +
mapping save, volume merge by contents incl. thinning/stop-on-failure/store order, skeleton merge + saveMultiple
box parsing, duplicate query order + decode errors, long-timeout coverage of all 6 methods); annotation_upload 6,
task_creation 6, task_creation_from_files 4, annotation_duplicate 5, task_assignment 3, task_request 5,
annotation_merge_reset 6; all 0 failed / 0 ignored. Lib unit tests of the touched modules 9 passed (the
duplicate query-order unit test moved to the integration harness). Whole-crate clippy `-D warnings` clean;
`rustfmt --edition 2024 --check` clean on the 7 edited files.
