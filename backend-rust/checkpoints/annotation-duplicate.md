# Annotation duplicate checkpoint

2026-10-10. Owner: annotation-duplicate sub-agent (target /tmp/webknossos-rust-verify-c). Owns src/annotation_duplicate.rs, tests/annotation_duplicate.rs, this file. Router signature `annotation_duplicate::router(jobs_enabled)` unchanged (already merged by parent). No other files edited, no visibility changes.

## Contract (Scala AnnotationController.duplicate / duplicateAnnotation)

- `POST /annotations/:typ/:id/duplicate`, SecuredAction (401), no body, no query params.
- Order: `provideAnnotation(typ, id, user) ~> 404` (no `?~>` message: provider message kept, e.g. `Annotation could not be found or accessed.`, `Invalid AnnotationType: x`) → duplicateAnnotation `?~> Could not duplicate annotation.` → `restrictionsFor(typ, id)` of the ORIGINAL `?~> restrictions.notFound ~> 404` → `publicWrites(new, user, original restrictions) ?~> publicWritesFailed` → `JsonOk(json)` (plain JSON, no `messages`).
- No `allowX` gate, no state check (Cancelled rows duplicate), no time tracking, no team/sharing copy.
- duplicateAnnotation: dataset `datasets_` read globally (`notFoundForAnnotation ~> 404`) → `isUsable` (`notUsable`, 400) → only if the source has `_task`: usableDataSourceFor (no voxel size → `DataSource.notFound ~> 404`; box = BoundingBox.union of all layer boxes, empty = zeros) → first live tracing store (`TracingStore.notFound`) → RPC → AnnotationLayer.fromProto (stats `{}`) → createFrom(user, dataset, layers, Explorational, name None → "", source description, newId) → insertOne. All failures are rendered as `Could not duplicate annotation.` keeping ParamFailure status (404 dataset/data source, upstream RPC status), otherwise 400. Database faults stay 5xx (crate convention).
- New row: Explorational, no task, owner = requester, source dataset + description, name "", Internal, Active, OwnerOnly, unlocked, tags `{}`, tracingTime NULL, created = modified = now (ms), layers from the RPC response.
- Compounds: provider merge/cache as usual; source id = task/project/task-type id, owner = compound owner (first requester), no task (isFromTask=false, no box), description "". Restrictions in the response are the compound restrictions of the requester.

## RPC (WKRemoteTracingStoreClient.duplicateAnnotation)

`POST {tracingStore.url}/tracings/annotation/:annotationId/duplicate?token=&newAnnotationId=&version=&datasetBoundingBox=&isFromTask=&ownerId=&requestingUserId=`, empty body, AnnotationProto response (`decode_annotation_proto`). `None` options omitted; box literal `x,y,z,w,h,d`.

Implemented in src/annotation_duplicate.rs on the shared `ServiceClients` extension because `TracingStoreClient` fields are private. **Parent TODO** — move into src/tracingstore_client.rs:

```rust
pub async fn duplicate_annotation(&self, tracing_store_url: &str, request: &DuplicateAnnotationRequest)
    -> Result<AnnotationProto, TracingStoreError> {
    let response = self.long_clients.request(Method::POST, tracing_store_url,
        &["tracings", "annotation", request.source_annotation_id.as_str(), "duplicate"],
        &request.query(), None).await?;
    decode_annotation_proto(&response.bytes)
}
```
(plus move `DuplicateAnnotationRequest` + its `query()`), then switch `duplicate_in_tracing_store` to take `&TracingStoreClient`.

## Shared helpers (pub(crate), for task assignment)

- `DuplicateAnnotationRequest { source_annotation_id, new_annotation_id, owner_id, requesting_user_id, version: Option<i64>, is_from_task: bool, dataset_bounding_box: Option<[i32; 6]> }`
- `duplicate_in_tracing_store(pool: &PgPool, clients: &ServiceClients, request: &DuplicateAnnotationRequest) -> Result<Vec<AnnotationLayer>, ProviderError>` — first tracing store + RPC + fromProto, no DB writes. Wrap the error with the caller's message (`error.wrap(..)`).
  - AnnotationService.createAnnotationFor (task assignment): source = TracingBase id (`findBaseIdForTask`), new id = Initializing annotation id, owner = TracingBase `_user`, requester = assignee, `version: None`, `is_from_task: false` (Scala comment: isFromTask is for duplicating a task annotation, not assignment), `dataset_bounding_box: None`. Before it Scala checks dataset found (`notFoundForAnnotation`) + usable (`notUsable`). Then AnnotationDAO.updateInitialized (UPDATE the Initializing row: `_user`=assignee, Task, Active, created=modified=now, other fields from the base; delete + re-insert layers, transactionally) — NOT `insert_annotation`.
- `insert_annotation(&mut PgConnection, &NewAnnotation, &[AnnotationLayer])` — AnnotationDAO.insertOne (row + layers, stats `{}`), inside the caller's transaction.
- `duplicate_source_in_tracing_store(pool, clients, &DuplicateSource, new_id, requester_id)` — controller duplicateAnnotation up to the insert (dataset/usable/data-source box checks + shared step).
- `layers_from_proto(&AnnotationProto)`, `duplicate_annotation_rpc(..)`.

## Deviations

- RPC uses the default request timeout instead of `withLongTimeout` (2 h) until moved into `TracingStoreClient` (see TODO).
- Insert, restrictions and serialization run in one transaction committed last: a restrictions/serializer failure leaves no row (Scala commits the insert first). Tracing-store data created by the RPC is orphaned on any later failure (as in Scala).
- RPC transport failures other than an upstream status (connection/timeout/invalid protobuf) render 400 (Fox failure without status), like annotation_merge.
- Insert constraint violations (e.g. a returned tracing id already in use) are 409 crate-convention errors, not 400 duplicateFailed.

## Observations for parent

- Scala parity means a non-manager team member who can provide a compound (task readable) can duplicate it and gets an owned copy of the merged annotations (response restrictions allowAccess=false). There is no `allowX` check in Scala's duplicate, so the crate-wide fail-closed decision does not apply; parent may want to decide whether to gate compounds on `allow_access`.
- The compound provider's temporary data source (`datasets::data_source_for_rpc`) returns 500 for dataset layers without mags (test works around it by deleting the seeded layers).

## Status / Done / Next / Evidence

Status: COMPLETE.
Done: route + shared helpers + 2 unit tests in src/annotation_duplicate.rs; tests/annotation_duplicate.rs (5 DB tests with recording mock tracing store): member/owner success (exact RPC path/method/empty body/query keys+order/params, response fields, DB row + layers, View alias via /api/v12, original untouched); Task annotation sends union box + isFromTask=true, no-voxel-size 404 and unusable 400 before RPC; 401/404 (private, foreign org, unknown, invalid type)/400 invalid id, Cancelled allowed; upstream 500/400/404 status kept, invalid protobuf 400, colliding tracing id 409 with full rollback, no tracing store 400, unreachable store 400 — no rows in all failure cases; CompoundTask merge + duplicate of task id (owner = first requester, no box), non-manager member allowed with compound restrictions, unknown CompoundProject 404.
Next: parent moves RPC into TracingStoreClient (long timeout), regenerates inventory (`python3 tools/route_inventory.py`), central verification.
Evidence: `cargo test --locked --offline --test annotation_duplicate -- --include-ignored` (verify-c, PG 55439): 5 passed, 0 failed. `cargo test --lib annotation_duplicate`: 2 passed. `cargo clippy --locked --offline --all-targets -- -D warnings`: clean (exit 0). `rustfmt --edition 2024 --check` on both files: clean.
