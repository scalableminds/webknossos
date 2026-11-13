# Annotation listing migration checkpoint

Updated 2026-10-09. Agent tasks_stage2. Owned NEW src/annotation_lists.rs, tests/annotation_lists.rs, this checkpoint; may extend annotation_access.rs. Parent owns lib/config/docs/central Cargo. Prior tasks: task routes four DB tests pass, annotation private links/source four DB tests pass; checkpoints retain evidence. Current task: DB-backed annotation listings/serialization and user/task routes. Inspect exact controller/DAO/serializer semantics and implement complete DB-only routes. Exclude /info or other remote version-data responses unless actual dependency supported. Initial inspection now, no source files created yet. Next: establish route contracts and serializer fields, notify parent, implement and write isolated schema DB tests, parent central verification.

## Implementation milestone

Created src/annotation_lists.rs with six DB-only routes: /user/annotations, /user/tasks, /users/{id}/annotations, /users/{id}/tasks, /annotations/readable, /tasks/{id}/annotations. router(jobs_enabled:bool) matches parent feature wiring. Compact explorationals preserve owner compact privacy, annotation layer stats, shared teams, dataset/org metadata, tags+dataset name, descending ObjectId pagination/count, visibility/state/owner-lock/collaboration. Shared grants additionally require dataset access; owned grants do not; compact rows require live owner/dataset/org and a layer, counts preserve DAO differences. Compact JDBC Long-null parser yields tracingTime 0; full yields null.

pub(crate) full_json(connection,user,id,jobs_enabled) implements database-only AnnotationService.publicWrites: real owner/contributors, runtime restrictions, requester view config with owner fallback, stores public JSON/jobs feature, global nested task/settings, tags/layers and all annotation fields. Reuses parent-exposed tasks::public_json and datasets::public_datastore_json_on_connection. /info excluded because tracing version information is remote.

Parent notified to wire and compile. Reported existing shared tasktype settings optional-field canonicalization gap (preferredMode/min/max None must be omitted under Play Json.format); parent owns helper fix. Isolated DB tests next. No Cargo commands by this agent.

## Test milestone

Created tests/annotation_lists.rs with three ignored isolated-schema DB integration tests covering compact exact fields/privacy/timestamps/tag dedup/ordering/state/count/layerless count divergence; owned versus shared/contributor grants with dataset access and dataset filter; user read/edit permissions versus annotation visibility; full task serializer fields/real task status/owner/contributors/view config/restrictions/stores/private-key omission, task manager/admin route visibility, pagination and counts. rustfmt passed. Parent central compilation/DB verification pending. Unsupported extra datasetId query ignored outside readable route, matching route signatures.

## Parent review fix

Scoped full owner/contributor compact team membership JSON to each user's own organization, consistent with parent shared user JSON policy; stale/deleted teams excluded by live view. Added stored malformed foreign team and deleted team membership rows for owner/contributor in full task test, asserting only correct live same-org membership is emitted. Aligned user-edit "unteamed" check to live same-org memberships. Parent corrected shared tasktype settings optional null omission and exposed nested task helper. Await central results.
