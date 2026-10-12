# NML writer checkpoint

2026-10-10. Agent `nml-writer` (target `/tmp/webknossos-rust-verify-b`). Owns `src/nml_writer.rs` (registered `pub mod nml_writer;`, library only, no routes) and this file.

## Status

DONE. Pure renderer ported from `app/models/annotation/nml/NmlWriter.scala` (+ `renderUserState` from `AnnotationUserStateUtils.scala`, `selectLayerWithPrecedenceFetched`, `FetchedAnnotationLayer.volumeDataZipName/editedMappingEdgesZipName`). The download routes are NOT implemented; notes for them are below.

## Public API (`crate::nml_writer`)

- `write_nml(&NmlWriteInput) -> Result<String, NmlWriteError>`: the complete document (UTF-8, no XML declaration, no trailing newline).
- `NmlWriteInput<'a>` = the `toNmlStream` arguments: `layers: Vec<NmlLayer>` (Scala order: explorational passes skeleton layers first, then volume layers; volume indices count volumes only), `annotation_user_states: &[AnnotationUserStateProto]` (from `getAnnotationProto`; compound passes `&[]`), `requesting_user_id: Option<&str>` (compound: `None`), `annotation_owner_id`, `annotation_owner_name` (owner MultiUser fullName), `annotation: Option<NmlAnnotation { id, description, has_task }>`, `task_id: Option<&str>`, `voxel_size: Option<&NmlVoxelSize { factor: [f64; 3], unit }>` (unit = LengthUnit name, e.g. `nanometer`), `volume_filename: Option<&str>` (compound: `<name>_data.zip`), `organization_id`, `wk_url` (`conf.Http.uri`), `dataset_name`, `dataset_id`, `skip_volume_data`, `volume_data_zip_format: VolumeDataZipFormat`, `writer_git_commit` (BuildInfo.commitHash), `timestamp_millis` (now).
- `NmlLayer { tracing_id, name, tracing: NmlLayerTracing::{Skeleton(&SkeletonTracing), Volume(&VolumeTracing)}, has_edited_mapping_edges (editedEdgesZip was fetched), base_mapping_name (mapping info `baseMappingName`) }`. Pass tracings exactly as fetched; user state is applied inside.
- `VolumeDataZipFormat::{Wkw (default), Zarr3}` with `parse` (exact, case-sensitive like `ExtendedEnumeration.fromString`) and `as_str`.
- `volume_data_zip_name(layer_name, index, is_single)` -> `data[_<i>]_<name>.zip`; `edited_mapping_edges_zip_name(...)` -> `editedMappingEdges[_<i>]_<name>.zip`.
- `java_double(f64)` / `java_float(f32)`: Java `Double.toString`/`Float.toString` (also needed for the `voxelSizeFactor` query param, `Vec3Double.toUriLiteral` = `x,y,z`).
- `NmlWriteError::{MultipleSkeletons, VolumeNameForMultiple, NoLayers, InvalidCharacter(char)}`; `Display` = Scala `Msg.Annotation.Download.*` / `Msg.Annotation.downloadNoLayers` / Woodstox exception text.

## Formatting rules (verified against the real libraries)

- txw2 4.0.9 `IndentingXMLStreamWriter` over Woodstox 7.2.2 (exact runtime classpath jars from `target/streams/runtime/dependencyClasspath`): two-space indent, `\n`, childless elements self-close as `<x .../>`, no XML declaration, `</things>` is last (no newline). The skip-data comment sits on the `<volume ...>` line: `<volume ...><!--Note that volume data was omitted when downloading this annotation.-->`.
- Attribute escaping: `&`->`&amp;`, `<`->`&lt;`, `"`->`&quot;`, TAB/LF/CR -> `&#x9;`/`&#xa;`/`&#xd;`, U+FFFE/U+FFFF -> `&#xfffe;`/`&#xffff;`; `>`, `'`, `]]>`, U+007F..., U+2028, non-BMP written raw (UTF-8). Other chars < 0x20 make Woodstox throw -> `InvalidCharacter` (NUL has its own message). Attribute names are written raw and duplicates are not checked (same as Woodstox).
- Numbers: Int/Long `toString`; proto `uint64` (segment ids, largestSegmentId) are Scala `Long` -> values > i64::MAX print negative. Doubles/floats use JDK 19+ shortest-repr `toString` (`1.0`, `1.0E7`, `9.99E-4`, `-0.0`, `NaN`, `Infinity`, `4.9E-324`). Missing voxel size renders `-1` (boxed Int), not `-1.0`; `unit` is then omitted. Unset colors render four empty attributes.
- Section/attribute order, optional attributes, `description` only when an annotation is given, `taskBoundingBox` from skeleton `boundingBox` or (volume source only) `v.boundingBox` when the annotation has a task, legacy `userBoundingBox` appended with id 0, nodes sorted by id with later duplicate ids dropped, branchpoints sorted by descending timestamp (stable, wrapping negation), comments flattened in tree order, tree groups `isExpanded` default true with user-state overlay only on top-level groups, segment groups without `isExpanded`, segment anchor additional coordinates only with an anchor, `mappingName`/`mappingIsLocked` only without editable mapping, location/format omitted when skipping data or when edited-mapping edges were fetched.

## Fixes made in this pass

1. Number formatting ties: Rust's shortest form rounds exact ties up, Java picks the even digit (e.g. float `-391289.125` -> Java `-391289.12`, Rust gave `.13`; 127/250052 random cases differed). Now re-rounds to the shortest length with exact ties-to-even (also covers Java's length-2 rule for 1-digit results). After the fix 250052/250052 random+edge doubles/floats match JDK 25.
2. U+FFFE/U+FFFF are now emitted as character references like Woodstox (were raw).
3. NUL error message matches Woodstox ("Invalid null character in text to output").

## Known differences / limits

- Scala streams into the response/zip and leaves a truncated document on failure; Rust returns `Err` with no output (caller maps to Scala's error message/status).
- Unknown `Tree.type` enum values render `Unrecognized(n)` (ScalaPB case-class toString); prost keeps unknown proto2 enum values, ScalaPB proto2 behavior for unknown enum values not verified (unreachable in practice).
- `minBy(_.tracingId)` compares UTF-16, Rust compares bytes; identical for ASCII tracing ids (UUIDs).
- `timestamp`/`writerGitCommit` are caller-supplied; Rust build has no BuildInfo commit hash yet (parent decision: env var or `""`).

## Evidence

- `cargo test --locked --offline --lib nml_writer`: 14 passed, 0 failed (4 full golden documents: skeleton-only with task/user states/all tree features; two-volume task with editable mapping + data layer; compound-style hybrid with fixed volume name and no voxel size; skipped volume data; plus precedence, error, escaping, zip-name, Double/Float/uint64 tables).
- Oracle (`/tmp/nml-writer-oracle/Oracle.java`, not checked in; run with `java -cp woodstox-core-7.2.2:stax2-api-4.3.0:txw2-4.0.9 Oracle.java xml|num`): all 4 golden documents re-serialized from their event sequence by Woodstox+txw2 are byte-identical; 250052 Double/Float values identical to JDK 25 `toString` (production CI uses Temurin 21; same algorithm since JDK 19).
- `cargo clippy --locked --offline --all-targets -- -D warnings` was clean for the whole crate after the final nml_writer edit; a later re-run failed only on `src/nml_parser.rs:334` (`clone_on_copy`, owned by the concurrent nml-parser agent) with zero findings in `src/nml_writer.rs`. `rustfmt --edition 2024 --check src/nml_writer.rs` clean.
- No repository NML fixtures produced by the Scala writer exist (frontend snapshots come from the JS writer; `NMLUnitTestSuite` only round-trips).

## Notes for the download routes (next agent)

Routes (`conf/webknossos.latest.routes`, `AnnotationIOController.scala`):
- `GET /annotations/:typ/:id/download?version=&skipVolumeData=&volumeDataZipFormat=` -> `download`.
- `GET /annotations/:id/download?...same` -> `downloadWithoutType`: `provider.provideAnnotation(id, identity)` (`annotation.notFound`, 404) then delegates with `annotation.typ`.
- Query params are `version` (Long, applies to every tracingstore fetch; there is NO skeletonVersion/volumeVersion), `skipVolumeData` (default false), `volumeDataZipFormat` (`wkw`|`zarr3`; unknown/absent -> `wkw`; compound always `wkw`).
- `UserAwareAction` (anonymous allowed). Logged-in users: analytics `DownloadAnnotationEvent(user, id, typ)` (log-only is acceptable). `AnnotationIdentifier.parse(typ, id)` failure -> 400; `View` -> failure "Cannot download View annotation".

Explorational/Task (`downloadExplorational`, all failures additionally tagged `annotation.download.failed` text "Could not download annotation."):
1. `provider.provideAnnotation(typ, id, user)` -> 404; `restrictionsFor(typ, id)`; `nameFor(annotation)` = `annotation.name` if non-empty else `normalize("<datasetName>__<taskId|explorational>__<owner abbreviatedName>__<last 6 chars of id>")` (TextUtils.normalize umlaut map).
2. `restrictions.allowDownload(user)` (= allowAccess) `?~> annotation.download.notAllowed ~> 403`. Scala binds the Boolean without asserting (see coordinator CRATE-WIDE DECISION): Rust fails closed with message "You do not have permission to download this annotation." and 403; document it.
3. Dataset (GlobalAccessContext, 404 `Msg.Dataset.notFoundForAnnotation`), organization (404).
4. Skeleton-only (`tracingType == skeleton`): for each skeleton layer `GET {ts}/tracings/skeleton/{tracingId}?annotationId=&version=` (long timeout; `TracingStoreClient::get_skeleton_tracing`), then `GET /tracings/annotation/{id}?version=` (`get_annotation_proto`), owner user + MultiUser fullName, optional task; render with `annotation=Some`, `volume_filename=None`, `requesting_user_id=user id`. Response: raw NML, `Content-Type: application/xml`, `.nml`.
5. Volume/hybrid: per volume layer `GET /tracings/volume/{tracingId}?annotationId=&version=` (DEFAULT timeout); then unless skip: if NOT `hasEditableMapping` -> `GET /tracings/volume/{tracingId}/allDataZip?volumeDataZipFormat=&annotationId=&version=&voxelSizeFactor=<java_double x,y,z>&voxelSizeUnit=<unit>` (LONG timeout, bytes; voxel params omitted when the dataset has no voxel size); if `hasEditableMapping` -> `GET /tracings/mapping/{tracingId}/editedEdgesZip?version=` (long, bytes) and `GET /tracings/mapping/{tracingId}/info?version=&annotationId=` (long, JSON `baseMappingName` string required). Then skeleton layers (long), owner, task (`task.notFound`), annotation proto. Layers passed skeletons first, then volumes. Messages: `fetchVolumeLayerFailed`, `fetchSkeletonLayerFailed`, `findUserFailed`, `zipNmlFailed`, `hybridToFileFailed`, `skeletonToFileFailed`, `writeToFileFailed` (Msg.Annotation.Download).
   Zip (`application/zip`, `.zip`): entry `<name>.nml` first (default deflate), then for each volume layer in order: `data[_i]_<layerName>.zip` (volume bytes) and `editedMappingEdges[_i]_<layerName>.zip`, deflate BEST_SPEED (level 1). `is_single` = exactly one volume layer. Java ZipOutputStream (DEFLATED, data descriptors); byte parity of the zip container is not required, entry names/order/content are.
6. Header: `Content-Disposition: attachment; filename="<enc>"` where `<enc>` = `URLEncoder.encode(name + ext, UTF-8).replace("+", "%20")` (Java form encoding: `[A-Za-z0-9.*_-]` kept, everything else `%XX` uppercase UTF-8; `java_url_encode` exists privately in `src/auth_oidc.rs`, ask parent to share).
7. Missing tracingstore RPCs in `src/tracingstore_client.rs` (parent-owned): allDataZip (bytes, long), editedEdgesZip (bytes, long), mapping info (JSON, long), and for compound: `POST /tracings/skeleton/getMultiple` and `/tracings/volume/getMultiple` (JSON body `[ {"tracingId": ...} | null ]`, proto `SkeletonTracings`/`VolumeTracings`, long, batches of 1000) plus allDataZip without annotationId/version. The protobuf wrapper messages need decoders with required-field checks.
8. Register both routes in `uses_long_rpc` (request timeout exemption) like other 2 h RPC routes.

Compound (`CompoundProject`/`CompoundTask`/`CompoundTaskType`): user required (`notAllowed` 403), project/task/taskType 404 (`Msg.Project.notFound(id)` etc.), requester must be team manager or admin of the project's / task type's team (403 `notAllowed`). Annotations: finished annotations of the project (`findAllFinishedForProject`), of the task (`annotationsFor(task)` filtered Finished), or of all tasks of the task type. Per annotation: at most one skeleton and one volume layer (else failure), layers named `Skeleton`/`Volume`, `annotation_user_states=&[]`, `requesting_user_id=None`, `volume_filename=Some("<name>_data.zip")`, format `wkw`, voxel size of the dataset, `<name>` = `SavedTracingInformationHandler.nameForAnnotation` (ignores `annotation.name`). Volume data fetched unless skipVolumeData (no editable-mapping exclusion; `has_edited_mapping_edges=false`, no base mapping). Outer zip entries in annotation order (grouped by dataset): with volume data -> `<name>.zip` containing `<name>_data.zip` then `<name>.nml`; otherwise `<name>.nml`. Response via `Ok.sendPath(..., inline=false, fileName=normalize(<project.name | taskId | taskType.summary> + "_nmls.zip"))`: Play sets Content-Type from extension (application/zip) and Content-Disposition `attachment; filename="..."` (Play `HttpHeaderParameterEncoding`, adds `filename*=utf-8''...` for non-ASCII; verify against Play before claiming parity). `version` and `volumeDataZipFormat` are ignored for compound.
