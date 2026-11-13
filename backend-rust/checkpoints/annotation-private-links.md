# Annotation access and private links checkpoint

Updated: 2026-10-09. Agent: tasks_stage2.

Ownership: NEW src/annotation_access.rs, src/annotation_private_links.rs, tests/annotation_private_links.rs, this checkpoint. Parent owns module/router wiring, documentation/inventory and central Cargo runs. Dataset agent owns dataset_access.rs; coordinate helper changes only.

Task: Implement annotation access metadata foundation and six zarrPrivateLinks CRUD routes. annotationSource only if full correct behavior can be implemented without remote tracing calls. Preserve requester access, expiration, lifecycle and soft-delete behavior. Never fabricate annotation responses. Initial stage: inspect Scala controllers/DAOs/restrictions and schema; no implementation yet. No Cargo commands by this agent.

Next: establish exact route/request/response contracts, private-link access grants and checks; communicate contract early, implement bound transactional SQL and isolated database tests, get parent central verification, update checkpoint each milestone.

## Contract/implementation milestone

Seven implemented routes: six /zarrPrivateLinks CRUD plus /annotations/source/{accessTokenOrId}. Source is feasible without remote calls: persisted annotation layers/statistics and dataset/datastore/tracingstore public metadata only. No fabricated full annotation JSON.

Link DAO is owner-only: admins/managers cannot list/read/update/delete another owner's links. Successful create/rebind must still target requester-owned live annotations because the Scala post-insert lookup uses that owner grant; Rust rejects and rolls back atomically rather than leaving an inaccessible link. Mutation checks ignore Finished and isLockedByOwner, matching AnnotationDAO grants. GET rejects expiration<=now; lists include expired; updates/deletes permit expired links; all deletion is soft.

Source first resolves live unexpired access token; otherwise parses ObjectId and uses only query userToken (headers ignored), invalid token becomes anonymous, anonymous annotation read requires Public. Scalar source selection requires live annotation/dataset/organization/datastore/tracingstore. Layer JSON fields include tracingId/typ/name/stats, ordered by tracingId. Source token lookup is read-only and accepts token types as Scala does, with existing Rust revocation/account safeguards.

Foundation has separate DAO read/mutate and runtime restriction contracts, plus owned/shared list predicate. Runtime restrictions include state/owner-lock/collaboration/mutex and task manager rules; task context absence denies access/finish where Scala task lookup fails.

Both new source files created and rustfmt passed. Parent notified to wire and compile. Two unit tests cover Scala Instant formats and secure token shape/uniqueness. Isolated DB tests pending, next immediate step.

## Tests milestone

Created tests/annotation_private_links.rs with four ignored isolated-schema DB tests: complete owner CRUD/expiration/rebind/stable token/soft-delete lifecycle; owner-only versus admin/member/foreign grants with atomic rejected operations and Finished/locked semantics; annotation source private/public/query token/header ignored/Job token/metadata/stats/expiration/missing tracingstore; DAO read versus runtime edit/finish/soft-finish/collaboration/mutex defaults. rustfmt passed. Parent central compile/DB results pending.

## Parent review fixes

Removed unused auth import. Token generation now uses existing getrandom::fill on twelve bytes plus base64 URL_SAFE_NO_PAD, returning ApiResult and handling RNG failure; replaced manual UUID/encoder implementation at parent's request. Shared annotation list predicate now joins live teams restricted to requester organization, preventing stale/deleted/foreign team grants. Source token-type exception is explicitly documented (query userToken only, including Job/ResetPassword; AuthUser still only Authentication/DataStore). Added ResetPassword source test, source token expiration and duplicate rejection, and no-lastUsed touch assertions. Ready for central compile and all four ignored DB tests.

## Additional foundation coverage/review

Added task-manager foundation assertions within existing DB test: private task annotation DAO read denial versus runtime manager access/finish grant; DAO mutation manager grant; soft-deleted project removes runtime grant. Checked public success/expiration message wording against util Msg and aligned private-link delete/expiration messages. No known unresolved current-route implementation issue before central DB run; mutable metadata helpers intentionally distinguish DAO and runtime permissions.

## Verified result

Parent reports central compile and all four annotation private-link integration DB tests passed against real isolated schema. Current route work complete, awaiting parent batch-wide final checks. Additional read-only final contract review confirmed AnnotationSource has no optional fields (all emitted), annotationLayers use stats and tracingId order, public URLs only, link publicWrites explicitly emits expirationDateTime null, missing optional expiration request clears it, and expired-link fallback to ObjectId parsing matches controller.

Recommendation for future modules: factor Scala Instant deserialization into a shared generic module with optional and required serde helpers; parser currently lives in annotation_private_links and supports millis number/string or ISO timestamp. Dataset agent requested reuse for sortingKey. Parent authorization/coordinating shared extraction pending; do not edit parent-owned shared module.

## Shared Instant extraction

Parent authorized and is creating crate::instant::optional. Private-link Parameters.expiration now delegates to that generic serde helper; removed domain-local expiration deserializer and unused Deserializer import. Existing format-regression unit test remains in private-link module to guard endpoint contract. rustfmt passed; parent notified for final central checks after shared module wiring.
