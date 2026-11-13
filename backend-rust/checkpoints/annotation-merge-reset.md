# Annotation merge/reset checkpoint

Updated 2026-10-10. Owner: Claude sub-agent `merge-reset-finish` (target verify-a).

## Status

DONE. Typed merge, untyped merge and reset are reviewed against Scala and covered by integration tests. One open item (reset timeout) for the parent.

## Done

- Reviewed src/annotation_merge.rs and src/annotation_reset.rs against AnnotationController merge/mergeWithoutType/reset, AnnotationMerger.mergeTwo/mergeN, AnnotationService.resetToBase, TracingStoreService.clientFor and WKRemoteTracingStoreClient mergeAnnotationsByIds/resetToBase. Found no concrete deviations needing a code change. Only the reset doc comment changed, to record the open timeout item.
- New tests/annotation_merge_reset.rs (6 integration tests, mock tracing store that records method, path, query and body):
  - merge success: a new Explorational row owned by the requester, with B's dataset, Internal, Active, empty name, OwnerOnly and layers with `{}` stats. The response is the serializer JSON plus the success message. The RPC query (token, toTemporaryStore=false, newAnnotationId, requestingUserId, remapSegmentIds) and body are checked. remapSegmentIds=false is forwarded, and an invalid boolean gives 400 with no RPC.
  - untyped merge resolves the stored type (Task). An unknown ID gives 404 Annotation.notFound.
  - merge 404 cases: a private annotation on either side, the untyped route, a missing merged ID and a foreign-organization admin. A malformed ID gives 400 and a missing token gives 401. No RPC is sent and no rows are written.
  - merge RPC failure: an upstream 500 keeps its status, and an unreachable store gives 400. Both return Merge.failed and add no annotation or layer rows.
  - reset by the project team manager and by the org admin: POST `/tracings/annotation/:id/resetToBase` with only `token`. The response is the serializer JSON plus Reset.success. No rows are written.
  - reset denials: the ordinary owner gets 404 Msg.notFound (assertTrue). Unreadable or unknown annotations get 404 Annotation.notFound. A non-task annotation gets 400 Reset.failed with no RPC. An upstream 503 keeps its status.

## Intentional deviations

- The Scala `allowAccess(user) ?~> noAccessOnMerged ~> FORBIDDEN` check binds Fox[Boolean]. Rust fails closed instead, as decided crate-wide. It cannot trigger for an Internal annotation owned by the requester.
- Merge: Scala commits insertOne before publicWrites. Rust serializes inside the insert transaction, so a serializer failure leaves no main-app row behind. The tracing-store annotation still exists in both cases.

## Open items for parent

- The reset RPC uses the shared ServiceClients transport with the configured request timeout, not Scala's `withLongTimeout` (2 h). ServiceClients has no per-request timeout, and TracingStoreClient's long transport is private. Suggested fix: add `TracingStoreClient::reset_to_base` on `long_clients` in tracingstore_client.rs.
- Both routes, including merge's long-timeout RPC, are still capped by the router-wide `request_timeout` middleware in lib.rs. A long-RPC route exemption is needed for parity.

## Evidence

- `cargo test --locked --offline --test annotation_merge_reset -- --include-ignored`: 6 passed, 0 failed.
- `cargo clippy --locked --offline --all-targets -- -D warnings` (verify-a): clean.
- `rustfmt --edition 2024 --check` on the owned files: clean.

Scala `_ <- restrictions.allowAccess(user)` note and contract references are unchanged from the previous checkpoint. Tests create only fresh TestDb databases.
