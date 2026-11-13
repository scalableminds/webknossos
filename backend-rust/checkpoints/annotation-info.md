# Annotation info (typed + untyped) checkpoint

2026-10-10. Owner: annotation-info sub-agent (target /tmp/webknossos-rust-verify-a). Owns src/annotation_info.rs, tests/annotation_info.rs, this file. Router signature `router(jobs_enabled)` unchanged (already merged in lib.rs). No other files edited, no visibility changes.

## Status

Complete: GET `/annotations/:typ/:id/info` and GET `/annotations/:id/info` implemented and tested.

## Contract (Scala AnnotationController.info / infoWithoutType)

- UserAwareAction; `DBAccessContext(request.identity)`. **No sharing token** exists on these routes (routes file has only `timestamp`); anonymous requesters see Public saved annotations only (AnnotationDAO.anonymousReadAccessQ). `sharingToken` (dataset or private-link token) is ignored.
- `timestamp: Option[Long]`, bound before auth: absent = None; present uses the Long binder (`Cannot parse parameter timestamp as Long: ...`, 400; reuses `annotation_finish::parse_timestamp`).
- Order: `provider.provide(requester ctx, typ, id)` → failure (incl. invalid/case-wrong type) 404 `Annotation could not be found or accessed.` (anonymous: `... You may need to log in to see it.`); infra errors pass through → Cancelled 400 `This annotation is marked as cancelled and cannot be viewed.` → `restrictions_for` failure 404 `Could not determine annotation access restrictions.` → `!allowAccess` 403 `You are not authorized to view or edit this resource.` → publicWrites (non-5xx failure → 400 `Could not convert annotation to json.`) → time logging → lastActivity + analytics (fire-and-forget).
- Time logging: only when authenticated AND timestamp given AND the REQUESTED type is Task or Explorational (View/Orphan/TracingBase paths and compounds never log). Calls `writer.log_user_interaction_if_potential_contributor(pool, AccessContext::requester(Some(user)), user, annotation, owner, collaborationMode, ts)`; it runs AFTER serialization and its failure fails the request (Scala `<-`).
- Untyped: `provide_saved` under requester access, failure plain 404 `Annotation could not be found or accessed.` (no login hint, even anonymous), then the typed flow with the STORED type string (so a stored Explorational logs time; re-provides like Scala).
- Serialization: saved → `annotation_lists::full_json` with `restrictions` replaced by the provider restrictions. Anonymous saved → `full_json` with a stand-in requester `000000000000000000000000` (full_json reads globally; task JSON uses global=true) and `viewConfiguration` forced to null (Scala `runOptional(None)`; prevents owner-fallback leak). Compound → module-local `compound_json` (dataset/org/datastore/first tracing store global, owner = first requester compact user, task null, default settings, layers from merge with `stats:{}`, Internal/Active/OwnerOnly/unlocked, tags=[dataset name], created=modified=merge time). Teams/contributors/viewConfiguration are always empty/null for compounds because those tables FK `annotations(_id)`.
- Analytics `open_annotation` {annotation_id, annotation_owner_multiuser_id (live users_ lookup; missing → event dropped), annotation_dataset_id}; lastActivity `now()`; both spawned, never fail the request.

## Deviations

- Fail-closed allowAccess: Scala's `_ <- restrictions.allowAccess(..) ?~> .. ~> FORBIDDEN` binds a Fox[Boolean], so `false` does not actually short-circuit in Scala. Rust returns 403 (matches crate convention for edit/allowUpdate). Only observable for compounds (non-manager task readers get 403 instead of the merged compound); saved DAO read access is already at least as strict.
- `timestamp=` (empty) is a parse error (Play behavior for empty Option[Long] not verified).
- `AnnotationType.fromString ?~> invalidType ~> NOT_FOUND` is unreachable after provide (kept as 404 `invalid_type`).
- Suggested parent refactor: `annotation_lists::full_json(.., user: Option<&AuthUser>, ..)` would remove the anonymous stand-in.

## Evidence

- `cargo test --locked --offline --test annotation_info -- --include-ignored` (verify-a, PG 55439): 6 passed, 0 failed — owner full JSON + View alias + prefixed id + Task JSON/settings; anonymous Public only, sharing/private-link tokens ignored, no view-config leak; access denied 404s, admin Private read, cancelled 400, invalid type 404, bad timestamp 400; untyped == typed, stored type logs, unknown 404, invalid id 400; time logging matrix (no ts, View, owner Explorational/Task, OwnerOnly readers, Concurrent member, rejected requests); CompoundTask merge once/cache/owner/403 for non-manager/no logging/anonymous 404.
- `cargo test --lib annotation_info`: 1 passed (Option[Long] binder).
- `cargo clippy --locked --offline --all-targets -- -D warnings`: clean. `rustfmt --edition 2024 --check` on both files: clean.

## Next

Parent: regenerate inventory (`python3 tools/route_inventory.py`) and central verification.
