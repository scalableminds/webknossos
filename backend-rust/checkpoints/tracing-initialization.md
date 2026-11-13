# Tracing initialization core (TI1)

## Status

2026-10-10: TI1 DONE (`ti1-finish`). Pure library `src/tracing_initialization.rs`:
no HTTP routes, no RPCs, no DB. Module is `#![allow(dead_code)]` until TI2 wires it.
Parent owns lib.rs/config/route registration and central verification.

## Done

- Ports `AnnotationService.createTracingForExplorational` / `createVolumeTracing`,
  `AnnotationLayerPrecedence` (combineLargestSegmentIdsByPrecedence,
  selectLayerWithPrecedence, fetchOldPrecedenceLayer minus the RPC,
  extractPrecedenceProperties, adaptSkeleton/VolumeTracing incl. user states),
  `SkeletonTracingDefaults`/`VolumeTracingDefaults`, `VolumeTracingMags.magsForVolumeTracing`,
  `MagRestrictions`, `ElementClass.largestSegmentIdIsInRange/toProto`,
  `UsableDataSource.boundingBox/center/additionalAxesUnion` (JVM Int wrapping,
  Float truncation, Scala 2.13 `mutable.HashMap` iteration order) and the
  `AnnotationLayerParameters` Play JSON codec (`WithDefaultValues`).
- ti1-finish: fixed all clippy findings (`MagRestrictions::to_json` takes `self`,
  five `clone_on_copy` on proto Copy types), rustfmt. Focused re-review against
  Scala (AnnotationService, AnnotationLayerPrecedence, defaults, VolumeTracingMags,
  ElementClass, BoundingBox, AdditionalAxis.merge, AnnotationLayerParameters):
  no behavioral deviation found, so no behavior changed.
- Known, accepted deviation: Scala `userStates...toMap` iterates in insertion
  order only for <= 4 distinct users (Map1..Map4); from 5 users it is an immutable
  CHAMP HashMap keyed by `ObjectId` case-class hash. Rust always uses first-seen
  order (last value wins), so the *order* of appended user states in
  `adapt_*_tracing` can differ for >= 5 users of the old precedence layer.
  Content is identical; order is semantically irrelevant.

## Public API (`crate::tracing_initialization`, all `pub(crate)`)

- `AnnotationLayerParameters { typ, fallback_layer_name, auto_fallback_layer,
  mapping_name, mag_restrictions, name, additional_axes }` with
  `from_json`/`to_json`, serde `Deserialize`/`Serialize`, `name_with_default()`.
  `MagRestrictions { min, max }`.
- `ExplorationalDataset { data_source: &DataSource, dataset_name, organization_id }`.
- `precedence_fetch_request(existing_annotation_id, existing_layers, previous_version)
  -> Result<Option<PrecedenceFetchRequest { annotation_id, tracing_id, layer_name, typ, version }>>`.
- `FetchedPrecedenceTracing::{Skeleton, Volume}` -> `RedundantTracingProperties::extract`.
- `build_skeleton_tracing(dataset, created_ts)`;
  `plan_volume_tracing(dataset, params) -> VolumeTracingPlan`
  (`segment_index_lookup() -> Option<&str>`, `build(has_segment_index, created_ts)`).
- `adapt_skeleton_tracing` / `adapt_volume_tracing(tracing, Option<&RedundantTracingProperties>)`.
- Convenience: `create_tracing_for_explorational(dataset, params, old_precedence,
  fallback_has_segment_index, created_ts) -> InitialTracing` (plan+build+adapt).
- `InitialTracing::{Skeleton, Volume}` with `layer_type()`, `encode_to_vec()`;
  `layer_name(params, tracing)` (createLayersForExplorational naming).
- `TracingInitError` (`message()` = Scala text, `None` = Empty Fox for missing
  fallback layer) and message constants `CREATE_TRACINGS_FAILED`,
  `DATA_STORE_NOT_FOUND_FOR_DATASET`, `MAG_RESTRICTIONS_TOO_TIGHT`,
  `FETCH_OLD_PRECEDENCE_LAYER_NEEDS_ANNOTATION_ID`.
- `data_source_bounding_box`, `data_source_center`, `additional_axes_union`,
  `mags_for_volume_tracing`, `largest_segment_id_is_in_range`, `element_class_to_proto`.

## TI2 requirements

Scala order in `createTracingForExplorational` (errors surface in this order):
1. `dataStoreDAO.findOneByName(dataset._dataStore)` ?~> `DATA_STORE_NOT_FOUND_FOR_DATASET`;
   `datasetService.usableDataSourceFor(dataset)` (Rust: `dataset_source::load`, keep
   the rendered JSON too for the temp store); `tracingStoreService.clientFor(dataset)`.
2. Old precedence: `precedence_fetch_request(...)`; if `Some(req)` fetch it, decode,
   `RedundantTracingProperties::extract`. Only the createTracing callback has
   existing layers; createExplorational passes `None, &[], None` (no RPC).
3. Skeleton: `build_skeleton_tracing`. Volume: `plan_volume_tracing` (fallback /
   largestSegmentId range / magRestrictionsTooTight), then the datastore RPC iff
   `segment_index_lookup()` is `Some(layer)`, then `plan.build(...)`.
4. `adapt_*_tracing` with step 2's properties.

RPCs needed (all main app -> store, `token` = process RPC token query param;
proto bodies use `Content-Type: application/x-protobuf`, raw `toByteArray`):

| Scala client method | Request | Timeout | Response |
|---|---|---|---|
| `WKRemoteTracingStoreClient.getSkeletonTracing` | `GET {ts}/tracings/skeleton/{tracingId}?annotationId=&version=` (version omitted when None) | long (2 h) | SkeletonTracing proto; Scala first asserts layer typ Skeleton (`Msg.Annotation.Download.fetchNotSkeleton`) |
| `getVolumeTracing(..., skipVolumeAndEdgesData = true, wkw, voxelSize)` | `GET {ts}/tracings/volume/{tracingId}?annotationId=&version=` only (skip flag => no allDataZip / editedEdgesZip / mapping info calls) | default | VolumeTracing proto; asserts typ Volume (`fetchNotVolume`) |
| `WKRemoteDataStoreClient.hasSegmentIndexFile(datasetId, layer)` | `GET {ds}/data/datasets/{datasetId}/layers/{layer}/hasSegmentIndex` (`.silent`) | default | JSON boolean; Scala caches per (datasetId, layer) for 1 min |
| `saveSkeletonTracing(tracing, newTracingId)` | `POST {ts}/tracings/skeleton/save?newTracingId=` body SkeletonTracing proto | long | ignored (Fox[Unit]) |
| `saveVolumeTracing(annotationId, newTracingId, tracing, dataSource, datasetId)` | first `AnnotationDataSourceStore::store(annotationId, dataSourceJson, datasetId)` (annotation_provider.rs, exists), then `POST {ts}/tracings/volume/save?newTracingId=` body VolumeTracing proto (no initialData for explorationals) | default | ignored |
| `saveAnnotationProto(annotationId, proto)` | `POST {ts}/tracings/annotation/save?annotationId=` body `AnnotationProto { description: "", version: 0, annotation_layers: [AnnotationLayerProto{tracing_id, name, typ}], earliest_accessible_version: 0 }` | default | ignored |

Present in `src/tracingstore_client.rs`: only `get_annotation_proto`,
`merge_annotations_by_ids` (+ `find_first_tracing_store_url`, `decode_annotation_proto`).
Missing: the two tracing GETs (need proto2 required-field validation like
`decode_annotation_proto`, else `InvalidProtobuf`), the three proto-body POSTs
(`ServiceClients::request` only sends JSON bodies; `post_bytes_external` never
attaches the token and uses octet-stream, so a token-carrying protobuf POST is
needed in service_clients.rs, parent-owned), and a datastore `hasSegmentIndex`
call (`ServiceClients::get_json::<bool>` fits; add a 1-minute cache if desired).

Route wiring:
- `POST /datasets/:datasetId/createExplorational` (AnnotationController, secured):
  body `List[AnnotationLayerParameters]` (`Vec<AnnotationLayerParameters>` via serde;
  Play validateJson 400 on failure); dataset 404 `Msg.Dataset.notFound`; for each
  params serially: create tracing (no precedence), `layer_name`, new tracing id =
  `TracingId.generate` (random UUID string), save skeleton/volume; then
  saveAnnotationProto; any failure ?~> `CREATE_TRACINGS_FAILED` then ?~>
  `Msg.Annotation.createFailed`; insert annotation (explorational, layers with
  `AnnotationLayerStatistics.zeroedForType`); analytics + mailchimp side effects;
  respond `publicWrites(annotation, user)`.
- `POST /tracingstores/:name/createTracing?key&annotationId&previousVersion`
  (WKRemoteTracingStoreController, tracingstore key auth, GlobalAccessContext):
  body AnnotationLayerParameters; annotation `Msg.Annotation.notFound`; dataset;
  `precedence_fetch_request(Some(annotation id), &annotation.layers, Some(previousVersion))`
  -> fetch -> build -> adapt; respond `InitialTracing::encode_to_vec()` with
  `application/x-protobuf`. No save calls here (tracingstore persists).

## Evidence

- `cargo test --locked --offline --lib tracing_initialization` (target verify-b):
  11 passed, 0 failed.
- `cargo clippy --locked --offline --all-targets -- -D warnings` (verify-b): exit 0.
- `rustfmt --edition 2024 --check src/tracing_initialization.rs`: clean.
