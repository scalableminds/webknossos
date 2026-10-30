# Annotation download (D2) checkpoint

2026-10-11. Agent `d2-download-finish` (target `/tmp/webknossos-rust-verify-a`). Owns `src/annotation_download.rs`, `tests/annotation_download.rs`, this file.

## Status

DONE. Both routes are implemented and tested: `GET /annotations/:typ/:id/download` and `GET /annotations/:id/download`, saved and compound. Parent still has to do two things: regenerate `MIGRATION_STATUS.md` (`--check` reports it stale; both routes are still listed as Pending), and decide on raising `WK_RPC_MAX_RESPONSE_BYTES` for large volume zips (see D1).

## Contract (Scala `AnnotationIOController.download*`)

- UserAwareAction. Query params: `version` (Long), `skipVolumeData` (Play Boolean binder), `volumeDataZipFormat` (`wkw`|`zarr3`; an unknown value falls back to wkw). Binder failures return 400. Logged-in users get the `download_annotation` analytics event. `View` returns 400 "Cannot download View annotation".
- Untyped route: `provideAnnotation(id)`, then 404 `annotation.notFound`, then the typed flow using the stored type.
- Saved annotations (`downloadExplorational`, all failures wrapped with "Could not download annotation.", which keeps the inner status):
  1. Provide (404).
  2. Restrictions.
  3. `nameFor`: the annotation name, otherwise `normalize(dataset__task|explorational__abbrev__hash6)`. The owner MultiUser is unreadable for anonymous requesters, so the user part is empty for them.
  4. allowDownload: fails closed with 403.
  5. Dataset (404), then organization (404).
  - Skeleton-only: a raw NML with `application/xml` and `.nml`. Otherwise a zip (`application/zip`) holding `<name>.nml`, then per volume layer `data[_i]_<layer>.zip` and `editedMappingEdges[_i]_<layer>.zip` (level 1).
  - `Content-Disposition: attachment; filename="<URLEncoder(name+ext), + -> %20>"`.
  - `version` is forwarded to every tracing-store fetch.
- Compound (`downloadProject/Task/TaskType`): requires a user (403 `notAllowed`). Parent lookups use requester DAO access (404 with the `Msg.*.notFound(id)` texts).
  - `Fox.assertTrue(isTeamManagerOrAdminOf(team))` returns 403 `notAllowed` on failure. This is a real assert in Scala, so no deviation.
  - Annotations: finished Task annotations of the project (no access predicate), of the task, or of the type's tasks (list access, LIMIT 1000). Task annotations are filtered with the annotation read predicate.
  - `zipAnnotations`: annotations are grouped by dataset. Per group: dataset read under the requester, single-layer checks (`multiLayers*NotImplemented`), `getMultiple` for skeletons and volumes, and version-less wkw `allDataZip` unless skipping. Then the per-annotation lookups: owner via the UserDAO read predicate (`User.notFound`), MultiUser, task (`Task.notFound`), `nameForAnnotation` (ignores `annotation.name`), dataset, organization.
  - NML layers are named `Skeleton`/`Volume`, with no user states and no requester. `volume_filename` is `<name>_data.zip`.
  - Outer entries are `<name>.nml`, or `<name>.zip` containing `<name>_data.zip` then `<name>.nml`.
  - The header is `attachment; ` + Play `HttpHeaderParameterEncoding("filename", normalize(<project name|taskId|taskType summary>_nmls.zip))`. It was ported and checked against `play_3-3.0.11.jar`: quoted printable ASCII minus `"\%`, `?` placeholders, and `filename*=utf-8''` with lowercase hex.
  - `version` and `volumeDataZipFormat` are ignored for compound downloads.

## What was incomplete before this pass, and fixes

- Compound download was a `not implemented` stub. It is now fully implemented.
- The saved-path task lookup used a home-grown predicate. It now uses the provider's `TaskDAO.readAccessQ` (organization-scoped).
- No integration tests existed. They have been added.

## Deviations

- **allowDownload fails closed.** Scala binds the `Fox[Boolean]` without asserting it. Rust returns 403 "You do not have permission to download this annotation." (outer message "Could not download annotation."). This follows the crate-wide decision.
- **Responses are buffered in memory**, not written to a temp file. Zip containers are not byte-identical to Java's `ZipOutputStream`; entry names, order, contents and the DEFLATE method are.
- **Unordered Scala queries get a deterministic order.** Project and task annotations are ordered by `created,_id`, task-type tasks by `_id`. Dataset groups keep first-appearance order; Scala `groupBy` matches this only for 4 or fewer datasets.
- **Fox.Empty chains.** When a `Fox.Empty` is wrapped (missing owner or task in the saved path), the Rust chain carries one extra descriptive cause. The outer messages and statuses are unchanged.

## Evidence

- `cargo test --locked --offline --test annotation_download -- --include-ignored`: 6 passed, 0 failed. Coverage:
  - Skeleton-only NML: headers, URL-encoded name, `nameForAnnotation` for member and anonymous, version forwarding, bad version returns 400.
  - Hybrid: entry order, data and edited-edges zips passed through, base mapping, zarr3 and voxel query, single-layer naming, unknown format falls back to wkw.
  - `skipVolumeData`.
  - Permissions: 404 for unreadable annotations, fail-closed 403 with no RPCs.
  - Untyped route resolves the stored type; unknown id returns 404; View returns 400.
  - Compound: project, task and task type for a manager and an admin; nested zips; `getMultiple` bodies; version-less wkw `allDataZip`; skip; 403 for member and anonymous; 404 for an unknown project.
  - Play encoding table.
- `cargo test --lib annotation_download`: 2 passed.
- `cargo clippy --locked --offline --all-targets -- -D warnings`: clean for the whole crate.
- `rustfmt --edition 2024 --check` on the owned files: clean.
