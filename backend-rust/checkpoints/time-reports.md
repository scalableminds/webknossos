# Time tracking and reports (batch M2)

Owner files: `src/time_tracking.rs`, `src/reports.rs`, `tests/time_tracking.rs`, `tests/reports.rs`.

## Status
- Status: done (6/6 routes implemented, wired, tested).
- Done: GET /users/:id/loggedTime, /time/user/:userId/spans, /time/user/:userId/summedByAnnotation,
  /time/overview, /teams/:id/availableTasksReport, /teams/:id/projectProgressReport.
  `pub mod reports; pub mod time_tracking;` + `.merge(...)` in src/lib.rs.
  tests/time_tracking.rs (4 DB tests), tests/reports.rs (2 DB tests); full suite, clippy -D warnings, rustfmt green.
- In-flight: none.
- Next step: coordinator regenerates MIGRATION_STATUS.md (`python3 tools/route_inventory.py`); not touched here.

## Contract notes
- All routes are `SecuredAction`. Error texts match Msg.* (User/Team notFound, notAllowed, TimeTracking.*, Annotation.typesEmpty, ObjectId.invalid).
- User lookup = UserDAO.readAccessQ (self, admin of the user's org, or manager of a team the user is in), organization-scoped like the rest of the crate; team memberships are joined through `teams_` (team deletion deletes memberships, so equivalent).
- loggedTime: 403 unless isEditableBy (manageable, or target has no teams). All non-deleted spans (incl. time 0), grouped by UTC month, sorted, `durationInSeconds` = summed millis truncated.
- spans/summedByAnnotation: parse order projectIds -> types -> states -> user (404) -> manageable-or-self (403). `start` inclusive, `end` exclusive, epoch millis; `time > 0`; empty types -> `[]`. `timeSpanCreated` epoch millis. summedByAnnotation inner-joins annotation_layers (annotations without layers are dropped, as in Scala).
- overview: teamIds ("Invalid team ids.") -> types -> states -> non-empty types -> only Task/Explorational -> projectIds. Users = listable (listAccessQ: readable and not unlisted unless superuser) users, or active members of the given teams, plus active listable admins of the requester's org.
- Reports: team must be readable (member or org admin) -> 404 otherwise. availableTasks lists active, listable, non-unlisted team members that neither manage the team nor administer its org; counts are not team- or blacklist-limited (as in Scala).

## Gaps / deliberate deviations
- Empty `annotationStates` (with non-empty types): Scala emits `IN ()` -> SQL syntax error -> 400 "SQL Failure: ..."; Rust returns `[]`.
- Missing/non-numeric required query params: Rust 400 "Invalid query parameters." (Play: its own binder message).
- Resolved 2026-10-09: PathObjectId now normalizes hexadecimal case and accepts Play’s `prefix-<id>` form; JSON/query ObjectIds stay prefix-free.
- Results carry a deterministic ORDER BY where Scala has none (spans by created/_id, overview and progress by id).
- JSON object key order follows jsonb (semantically irrelevant).
