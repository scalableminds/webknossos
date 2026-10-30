# Annotation sandbox + transfer checkpoint

2026-10-10. Owner: `sandbox-transfer` sub-agent (target /tmp/webknossos-rust-verify-c). Owns src/annotation_sandbox.rs, src/annotation_transfer.rs, tests/annotation_sandbox_transfer.rs and this file. Both routers keep the coordinator signature `router(jobs_enabled: bool)` already merged in lib.rs.

## Status

Both routes implemented and tested. No shared files edited.

## Contract notes

GET `/datasets/:datasetId/sandbox/:typ` (UserAwareAction, `sharingToken` query):
- Dataset read via `dataset_access::can_read(user, token)`: user grants plus token are additive (URLSharing.fallbackTokenAccessContext). Failure is 404 `Dataset “<id>” could not be found or accessed.`. This check runs before the type is looked at.
- `TracingType.fromString` is case-sensitive. An unknown value gives Fox.Empty, which is 404 `Could not find or access the requested resource.`. `volume`/`hybrid` give 400 `Sandbox annotations are currently available as skeleton only.`.
- Synthetic Annotation, never persisted: `_id`/`_user` are `000000000000000000000000`, with one layer `{tracingId:"dummyTracingId",typ:Skeleton,name:Skeleton,stats:{}}`. Scala defaults apply (Internal, Active, Explorational, OwnerOnly, unlocked, empty name/description, no task/tags, tracingTime null) and created=modified=now in ms.
- publicWrites: the dataset name, organization, datastore (`datasets::public_datastore_json_on_connection`) and first tracing store are read globally. The dummy owner gives owner/user null. teams/contributors are `[]` and viewConfiguration is null because no row references the dummy ID. tags=[dataset name]. Settings are the skeleton defaults (orthogonal+flight).
- Restrictions come from the real `annotation_access::restrictions` applied to a synthetic `AnnotationMetadata` with `owner_organization: None`. The owner lookup fails, so all four flags are false for everyone, admins included.
- Any non-5xx serializer failure (e.g. no tracing store) is wrapped as 400 `Could not convert annotation to json.`.
- The dataset `lastUsedTimes` are not touched (Scala does not touch them either).

PATCH `/annotations/:typ/:id/transfer` (SecuredAction, body `{userId}`):
- `restrictions_for` under requester context. Invalid type, missing/unreadable annotation and missing compound parent each return 404 `Could not determine annotation access restrictions.`. `!allowFinish` returns 403 `You are not authorized to view or edit this resource.`; compounds never allow finishing.
- Target user under UserDAO read access (`users::READ_ACCESS_PREDICATE`: self, team-managed members, or users of an organization the requester administrates). Failure returns 400 `User “<id>” could not be found or accessed.`. This means a plain owner cannot hand an annotation to another user unless they manage that user's team.
- `provide(typ,id)` failure is wrapped as 400 `Annotation could not be found or accessed.`.
- Transaction: lock the readable row and re-check allowFinish (403 if the row changed concurrently). Then re-check target readability. Then check that the transferee can read the dataset (READ_PREDICATE with `$1=target`, no sharing token); failure returns 400 `Cannot transfer annotation to a user who has no access to the dataset.`. Then `lock_update_access` (400 `No update access.`), then `UPDATE annotations SET _user`, then commit.
- After commit: reload through the provider under the requester (an unwrapped provider error defaults to 400), then `annotation_lists::full_json`. `restrictions` is overridden with the pre-transfer restrictions of the requester, as in Scala's `publicWrites(updated, user, Some(restrictions))`. The response is plain JsonOk with no messages.
- Deliberate Scala parity: the commit happens BEFORE the reload. A non-admin handing over a Private annotation therefore gets 400 `Annotation could not be found or accessed.`, but the owner change persists. Rolling back would block that transfer entirely.
- No compound or other cache invalidation. Scala clears none, and compound content does not depend on saved-annotation ownership.

## Known deviations / requests

- Axum extracts auth before the JSON body. An unauthenticated request with an invalid body therefore gets 401 instead of Play's body-parser 400. Invalid bodies return 400 `Invalid JSON request body.` (crate-wide extractor text, not Play's JsError text).
- Extraction request for the parent: the non-task `settings` literal in `annotation_lists::full_json` is duplicated in `annotation_sandbox::skeleton_settings`. Suggested: `pub(crate) fn default_settings(skeleton: bool) -> Value` in annotation_lists, used by both.

## Evidence

- `cargo test --test annotation_sandbox_transfer -- --include-ignored` (verify-c, PG 55439): 3/3 passed.
- `cargo test --lib annotation_sandbox`: 2/2 unit tests passed.
- `rustfmt --edition 2024 --check` on the three owned files: clean.
- `cargo clippy --all-targets -- -D warnings`: the only failure is in parent-owned src/config.rs:52 (`derivable_impls`, being edited concurrently). With `-A clippy::derivable_impls` the whole crate, including the owned files, is clean.

## Next

None for this batch. Parent: run inventory regeneration and central verification.
