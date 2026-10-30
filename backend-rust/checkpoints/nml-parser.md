# NML parser checkpoint (`src/nml_parser.rs`)

Owner: nml-parser agent (target dir /tmp/webknossos-rust-verify-c). Library only, no routes.

## Status

DONE (2026-10-10). Pure parser for the full Scala `NmlParser` surface (parameters, trees, nodes,
edges, branchpoints, comments, tree groups, tree/segment metadata, volume tags with segments and
segment groups, multi-component tree splitting, `TreeValidator`), plus `NmlResults` result types.
13 unit tests pass; whole-crate clippy `-D warnings` clean; rustfmt clean.

## Scala truth

`app/models/annotation/nml/NmlParser.scala`, `NmlResults.scala`, `NmlVolumeTag.scala`,
`AnnotationUploadService.scala` (`SharedParsingParameters`, `extractFromNml`), `TreeValidator.scala`,
`MultiComponentTreeSplitter.scala`, `GroupUtils.getAllTreeGroupIds`, `Msg.Nml`,
`Formatter.formatFailureChain`, `DatasetDAO.findOneByIdOrNameAndOrganization`.

## Public API

- `parse_nml(name, bytes, &SharedParsingParameters, &NmlParseContext) -> NmlParseOutcome`
  (`Parsed(Box<NmlParsedParameters>)` | `Failure(String)` | `Empty`). Scala `getParametersFromNML`.
- `SharedParsingParameters { overwriting_dataset_id, user_organization_id, is_task_upload,
  fallback_edit_position, fallback_edit_rotation, fallback_zoom_level }` (`useZipName` is the
  caller's business: apply `NmlParseResult::with_name(zip name)` to results of NMLs inside a zip).
- `NmlParseContext { now_millis, task_bounding_box_color }`, `NmlParseContext::current()`
  (wall clock + `random_color()`); injected so the parser is deterministic in tests.
- `NmlParsedParameters` (= Scala `NmlParsedParameters`; trees/groups already split + validated),
  `.validated_dataset_id() -> Result<Option<String>, String>` (ObjectId check, lower-cased, Scala
  message `The supplied resource id “x” is not a valid ObjectId.`),
  `.into_success(&DatasetRef, base_path) -> NmlParseSuccessWithoutFile` (= `nmlParametersToResult`:
  builds `SkeletonTracing` and per-volume `UploadedVolumeLayer { tracing: VolumeTracing,
  data_zip_location = basePath+location, name, edited_mapping_edges_location (basePath-prefixed),
  edited_mapping_base_mapping_name }`; volume `element_class=uint32`, bbox = task bbox or empty,
  `has_editable_mapping=Some(true)` iff edges location present, `has_segment_index=None`).
- `finish_parse_result(file_name, outcome, base_path, lookup) -> NmlParseResult` = Scala
  `extractFromNml` (sync lookup closure). Async callers can inline the same 3 steps.
- `NmlParseResult::{Success{file_name, success}, Failure{file_name, error}, Empty{file_name}}` with
  `file_name()`, `succeeded()`, `description()`, `with_name()`, `to_success()` (`Couldn’t parse file:
  {f}. {error}` / `Couldn’t parse file: {f}`); `file_name_without_extension()`.
- Message constants/functions: `MSG_PARAMETERS_NOT_FOUND`, `MSG_DUPLICATE_VOLUME_LAYER_NAMES`,
  `MSG_ADDITIONAL_COORDINATES_NOT_UNIQUE`, `msg_invalid_object_id`.

## Validations and messages (all covered by tests)

Failures are formatted like `formatFailureChain` (`outer <~ inner`). Order is Scala's: XML
well-formedness → parameters → comments → branchpoints → trees → tree groups → volumes →
duplicate volume names → split → TreeValidator → additional axes → experiment/editPosition...
- `No parameters section found.`
- `Invalid comment elements. <~ Invalid node id “x” in comment.`
- `Invalid branchpoint elements. <~ Invalid branchpoint node id “x”.`
- `Invalid tree elements. <~ Invalid tree id “x”.` / `... <~ Invalid nodes in tree N. <~ Invalid node
  id “x”.` / `... <~ Invalid node position for node id N.` / `... <~ Invalid edges in tree N. <~ Invalid
  edge “a-b”.`
- `Invalid tree group elements. <~ Invalid tree group id “x”.` (segment groups: invalid → silently empty)
- `Annotations with multiple volume layers must have a unique name for each layer.` (two unnamed volumes collide)
- TreeValidator: `Duplicate treeIds: …`, `Duplicate nodeIds: …`, `Duplicate edges in tree N:
  Edge(s,t,UnknownFieldSet(Map()))` (ScalaPB case-class toString), `Duplicate treeGroupIds: …`
  (reverse-BFS order), `Some treeGroups used in trees don't exist. treeGroups: …`, `Some branchPoints
  refer to non-existent nodes. branchPoints: …`, `Some comments refer to non-existent nodes. comments: …`.
  Edges to unknown nodes and self loops never reach the validator: the JGraphT splitter throws first →
  `Failed to parse NML '{name}': java.lang.IllegalArgumentException: no such vertex in graph: N` /
  `... loops not allowed` (both mirrored).
- `Additional coordinates do not have unique names.`
- Thrown exceptions (`Failed to parse NML '{name}': java.lang.NumberFormatException: For input string:
  "x"`): non-integer `additionalCoordinate-?` values (nodes, segments, editPosition — evaluated
  eagerly), segment `id`, complete segment anchor positions. `Box.combined` evaluates all elements,
  so a later exception beats an earlier Box failure (mirrored, tested).
- XML errors: `Failed to parse NML '{name}'. Error in Line L (column C): {message}`; empty document
  (no root element) → `Empty` (Scala "Premature end of file" → `NmlParseEmpty`).

Semantics mirrored: Java `parseInt/parseLong` (no trim, `+` allowed), `parseFloat/parseDouble`
(trim, f/d suffix, `NaN`/`Infinity`), case-insensitive booleans, `math.round(Float)` for float
positions, float colours widened to double, `isVisible` fallback from alpha (|a| > 1e-10), default
node viewport/mag 0 and radius 1, branchpoint time default `time - index`, comments/branchpoints per
node in reverse document order, empty-tree timestamp = now, legacy single `userBoundingBox` without
id (id 0), invalid user boxes skipped, non-task uploads append the task bbox as user bbox (`max id + 1`,
"task bounding box", random colour), `wkUrl = Some("")` when `<experiment>` lacks it, organization
falls back to the user's, split trees (`name_i`, new ids from max, new group prepended or nested as
first child, type/metadata dropped), `additionalCoordinate-<one \w char>` only, `stringListValue-<digits>`
sorted stably, scala-xml `Text.toString` re-escaping of those attribute values (`&` → `&amp;`),
prefixed element names matched by local name, prefixed attributes invisible to lookups, `xmlns*` dropped.

## Caller responsibilities (POST /annotations/upload, POST /tasks/createFromFiles)

Scala interleaves exactly one DB access per NML, after the pure parse succeeded
(`nmlParametersToResult`):
1. `parse_nml(...)`. `Empty` → `NmlParseEmpty(name)`; `Failure(msg)` → `NmlParseFailure(name, msg)`.
2. `validated_dataset_id()`; on `Err(msg)` → `NmlParseFailure(name, msg)`.
3. Dataset lookup with the requesting user's access context, Scala
   `findOneByIdOrNameAndOrganization(idOpt, datasetName, organizationId)`:
   id given → `findOne(id)` (access-checked) else failure chained under
   `Dataset “{id}” could not be found or accessed.`; no id → by directory name in organization, then
   by name if unique in organization, failure chained under `Dataset with name “{name}” could not be
   found or accessed.` The formatted chain becomes the `NmlParseFailure` error. Note `organizationId`
   comes from `<experiment organization>` or the user's organization (no org access check here).
4. `into_success(&dataset, base_path)`; `base_path = Some(zip file path)` for NMLs inside a zip, and
   other zip entries are keyed `zipPath + entryName` (`MultiNmlParseResult.otherFiles`).
Callers must also implement (not in this module): zip handling / nested zips (`extractFromFiles`),
`useZipName`, `wrapOrPrefixGroups`, `MultiNmlParseResult.toBoxes` (task creation: >1 volume layer →
`Cannot create tasks from multi-layer volume annotations.`), `differentDatasets` checks, and setting
`isTaskUpload=true` + `overwritingDatasetId` for task creation.

## Deviations (documented, not tested against the JVM)

- XML error text/line/column come from quick-xml, not Xerces; only the prefix format and a few
  Xerces messages (DOCTYPE disallowed, undeclared entity, prolog/trailing content, unclosed root,
  invalid UTF-8) are mimicked. Only UTF-8 input (BOM allowed); declared non-UTF-8 encodings are not
  transcoded.
- Java `parseInt` accepts non-ASCII Unicode digits and `parseDouble` hex floats; Rust rejects both.
- `NmlParseContext.now_millis` is taken once per file, not per empty tree.

## Done / Next / Evidence

- Done: implementation + 13 unit tests (full happy path incl. volumes, into_success, task upload +
  fallbacks, legacy/default parameters, visibility, empty docs, malformed XML, 10 element-validation
  messages, 9 TreeValidator/splitter messages, exception precedence, splitting, result wrapper,
  Java conversions).
- Next (other agents): wire into `POST /annotations/upload` and `POST /tasks/createFromFiles`
  with zip extraction and dataset lookup as above; optional round-trip test with `nml_writer`.
- Evidence: `cargo test --locked --offline --lib nml_parser` → 13 passed, 0 failed;
  `cargo clippy --locked --offline --all-targets -- -D warnings` → exit 0;
  `rustfmt --edition 2024 --check src/nml_parser.rs` → clean.
