# N5b annotation reserved IDs checkpoint

2026-10-10. Owner files: src/annotation_reservations.rs, tests/annotation_reservations.rs, this checkpoint. Router signature `router(_jobs_enabled: bool)` unchanged (parent-registered).

## Status
DONE. Both routes implemented and tested; no edits outside owned files, no visibility changes.

## Contract (Scala AnnotationController.reservedIds/reserveIds, AnnotationReservedIdsService/DAO)
- GET `/annotations/{id}/reservedIds?tracingId=&domain=`: missing query param 400 (`Missing parameter: <name>`, mutex convention). Untyped saved provider lookup ~>404, restrictionsFor ~>404 `Could not determine annotation access restrictions.`, allowAccess else 403 Msg.notAllowed. Domain is case-sensitive AnnotationIdDomain (Segment, SegmentGroup, Tree, Node, TreeGroup, BoundingBox); invalid = Fox Empty -> 404 `Could not find or access the requested resource.` (checked after access, as Scala). Returns JSON array of the caller's ids for annotation+tracing+domain (Rust adds ORDER BY id; Scala unordered).
- POST `/annotations/{id}/reserveIds` body `{domain,tracingId,numberOfIdsToReserve:Int,idsToRelease:[Long]}`, all required; invalid body/domain -> 400 `Invalid JSON request body.` (existing extractor envelope). Provider/restrictions as above, allowUpdate else 403, then `numberOfIdsToReserve > 10` -> 403 `Cannot reserve more than 10 ids in one request.`. Limit is `pub const NUMBER_OF_IDS_TO_RESERVE_PER_REQUEST = 10` (hard-coded `private val` in Scala, not config). <=0 reserves nothing (Scala empty range) but still releases.
- Allocation: MAX(id) over all users for annotation+tracing+domain; if none, RPC `GET {firstTracingStore.url}/tracings/annotation/{id}/largestIdOrZero?tracingId=&domain=&token=<rpc>` (JSON Long). Reserved = largest+1 .. largest+n, inserted for caller, then caller's idsToRelease (same tracing/domain) deleted; returns reserved list. Released maximum can be re-issued (Scala parity). Missing tracing store 400 Msg.TracingStore.notFound; upstream failures use shared ServiceError mapping (status preserved), nothing inserted.

## Concurrency / deviations
- Scala in-process semaphore replaced by `pg_advisory_xact_lock(hashtextextended('annotation-reservations:<id>',0))`, the same key annotation_lifecycle takes for collaboration-mode changes. Both routes take it inside one transaction (GET for parity).
- Under the lock reserveIds re-reads the live annotation (non-locking, on the transaction connection) and rechecks allowUpdate, so a reservation racing a Concurrent->OwnerOnly switch cannot leave stale rows (Scala had this race). No row lock: avoids holding the annotation row during the RPC.
- The RPC runs while holding the advisory lock/transaction (as Scala holds its semaphore); only the first reservation per tracing/domain calls it.
- Overflow beyond i64 -> 400 `Cannot reserve ids beyond the largest supported id.` (Scala overflows silently).
- RPC uses `Extension<ServiceClients>` (same ServiceClientConfig/RPC token as TracingStoreClient) via `annotation_reservations::largest_id_or_zero`; parent may move it into TracingStoreClient later.

## Evidence
- `CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-c WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --locked --offline --test annotation_reservations -- --include-ignored`: 3/3 passed, repeated 6x stable. Lib unit test 1/1.
- Tests: 404 missing/private/foreign, 403 read-only collaborator and Finished, query/body domain validation, missing params, limit 10/11 (no RPC on denial), tracingstore max + exact RPC path/query/token, continuation across users, per-domain/tracing independence, user-scoped release, reserve+release in one request, upstream 400 rollback, deleted tracing store 400, 20 concurrent clients via independent routers -> 100 unique contiguous ids with one RPC, mode change racing reservations -> no surviving rows and post-change collaborator 403.
- `cargo clippy --locked --offline --all-targets -- -D warnings` (verify-c): clean. rustfmt --check on owned files: clean.

## Next
None for N5b. Parent: optionally add `largest_id_or_zero` to TracingStoreClient; inventory regeneration.
