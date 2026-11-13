# Annotation upload service checkpoint (`src/annotation_upload_service.rs`)

Owner: u1-upload-service agent (target dir /tmp/webknossos-rust-verify-c). Library only, no routes.

## Status

DONE (2026-10-10). `AnnotationUploadService` (extractFromFiles/extractFromZip/extractFromNml,
wrapOrPrefixGroups), `NmlResults.MultiNmlParseResult` (+ `toBoxes`), the AnnotationIOController upload
helpers (nameForUploaded, descriptionForNMLs, wkUrlsForNMLs, returnError,
findDatasetForUploadedAnnotations) and `DatasetDAO.findOneByIdOrNameAndOrganization`.
No visibility changes elsewhere. 10 unit tests + 1 DB integration test pass; clippy/rustfmt clean.

## Scala truth

`app/models/annotation/AnnotationUploadService.scala`, `nml/NmlResults.scala`,
`util/.../io/ZipIO.scala` (`withUnziped`, `forallZipEntries`, `isFileHidden`),
`AnnotationIOController.scala` (upload helpers), `TaskController.createFromFiles`,
`DatasetDAO.findOneByIdOrNameAndOrganization`, `OrganizationDAO`, `Msg.scala`.

## Public API

Extraction (two-step; DB lookups happen exactly where Scala does them, one per parsed NML):
- `extract_from_files(files: Vec<(String, Bytes)>, params: SharedParsingParameters, use_zip_name: bool,
  limits: ExtractionLimits, lookup: &impl DatasetLookup) -> ApiResult<MultiNmlParseResult>`:
  pure part on `spawn_blocking` with `NmlParseContext::current()` per NML, then lookups.
- `prepare_files(files, &params, use_zip_name, &limits, &mut impl FnMut() -> NmlParseContext)
  -> Result<PreparedUpload, ExtractionLimitExceeded>` (pure, deterministic in tests) and
  `PreparedUpload::finish(&lookup).await -> ApiResult<MultiNmlParseResult>`; `nml_count()`.
- `ExtractionLimits { max_zip_entries: 10_000, max_extracted_bytes: 2 GiB, max_zip_nesting_depth: 8 }`
  (`Default`); `ExtractionLimitExceeded(String)` converts into `ApiError` 400. Rust-only: Scala has no
  limits (nested all-zip archives even recurse unboundedly).
- `DatasetLookup` trait (`find_dataset(id_opt, name, org) -> Future<ApiResult<Result<DatasetRef, String>>>`;
  inner `Err` = formatted failure chain that becomes the `NmlParseFailure`, outer = infrastructure error)
  and `PgDatasetLookup { pool, user_id }`.
- `find_one_by_id_or_name_and_organization(pool, user_id, id_opt, name, org)`: id → read-access
  `datasets_` lookup, else `Dataset “id” could not be found or accessed.`; no id → by `directoryName`
  in org (oldest `created` first), else by `name` if unique in org; failures
  `Dataset with name “n” could not be found or accessed.` (+ ` <~ Multiple datasets with this name exist
  in this organization. Specify dataset id to select correct one.` when ambiguous). Read access =
  `dataset_access::READ_PREDICATE` (no sharing token). `find_readable_dataset(pool, user_id, id)`.
- `MultiNmlParseResult { parse_results: Vec<NmlParseResult>, other_files: BTreeMap<String, Bytes> }`
  with `contains_failure()`, `data_zip_for(&layer)` (`getDataZipFrom`),
  `editable_mapping_edges_zip_for(&layer)` (`getEditableMappingEdgesZipFrom`), `to_boxes()`
  → `Vec<TracingBoxContainer { file_name, description, skeleton, volume:
  Result<Option<(UploadedVolumeLayer, Option<Bytes>)>, String>, dataset_id }>` (Scala `toBoxes`; errors
  are `Couldn’t parse file: f. err` / `Cannot create tasks from multi-layer volume annotations.`).
- `wrap_or_prefix_groups(results, create_group_for_each_file)`.
- `name_for_uploaded(&[&str])`, `description_for_nmls(&[Option<&str>])`, `wk_urls_for_nmls(&[Option<&str>])`,
  `upload_metadata(&successes) -> (name, description, wk_url)` (all three over successful results).
- `upload_error_messages(&results)`, `return_error(&results) -> Response` (400,
  `{"messages":[{"error":"Could not parse file “f”: err"},…]}`, or `NML upload failed` if nothing failed).
- `uploaded_annotations_dataset_and_organization(&skeletons, &volumes, &dataset_ids)` (pure) and
  `find_dataset_for_uploaded_annotations(pool, user_id, this_host, &skeletons, &volumes, &dataset_ids, wk_url)
  -> ApiResult<DatasetRef>`; `this_host` = `config.public_url` without trailing `/` (`conf.Http.uri`).
- Messages: `MSG_DIFFERENT_DATASETS`, `MSG_UPLOAD_SUCCESS`, `MSG_FILE_NOT_FOUND`, `MSG_UPLOAD_FAILED`,
  `MSG_MULTI_LAYER_TASK_VOLUME`, `msg_parse_failed`, `msg_dataset_not_found`, `msg_dataset_name_not_found`.

## Extraction semantics mirrored (unit-tested)

- Name ends with `.zip` (case-sensitive) → zip; unopenable zip skipped silently; anything else is parsed
  as an NML under its own name (no base path, never renamed by `useZipName`).
- Zip with only `.zip` entries (raw names; dirs/hidden excluded; vacuously true when empty) → entries
  unpacked and each processed again as a file named by its key; only nested results are kept.
- Otherwise entries in central-directory order; skip `…/` dirs, hidden (last component starts with `.`)
  and `__MACOSX*`; absolute or `..`-escaping paths stop the archive (earlier entries kept), as does an
  unreadable entry; Java `Path.normalize` applied; `.nml` → parsed (name = normalized entry path, base path
  = zip path), other → `other_files[path + entryPath]` (later duplicate replaces). One zip's NML results
  come out in REVERSE entry order (Scala prepends). `useZipName` renames only successes.
- `combineWith`: results appended in file order; an earlier other-file key wins.
- Paths: Scala uses `File.getPath` (multipart temp file / temp file of a nested zip). Rust stand-ins:
  `upload-{index}/` for the n-th uploaded file, `{key}/` for a nested zip stored under `key`. So
  `data_zip_location` = `upload-0/data_Volume.zip` matches `other_files` keys. Nested-zip NMLs with
  `useZipName` are named `upload-0/inner.zip` (Scala: `<temp path>inner.zip`; then nameForUploaded strips
  `.zip`).
- wrapOrPrefixGroups: group per file named `fileNameWithoutExtension` (`.nml`/`.zip`, case-insensitive),
  id = max(all nested group ids, 0) + 1, tree groups `isExpanded=Some(true)`, segment groups `None`,
  only items without group are moved; skipped when no items and no groups. Prefix mode only when >1 results
  (failures count): `name up to last '.'` + `_` + tree name; segments never renamed.
- nameForUploaded: exactly one name → strip trailing `.nml` (Java `$`, also before a final line terminator)
  then remove every `.zip`. descriptionForNMLs: drop `""`, Java-trim, unique else "". wkUrlsForNMLs:
  unique `Option` value (None counts) else "".

## For U2: `POST /annotations/upload` (AnnotationIOController.upload)

Multipart: files (`f.filename`, bytes), data parts `createGroupForEachFile` (== "true"), `datasetId`
(overwritingDatasetId), `description`, `fallbackEditPosition` (`Vec3Int.fromUriLiteral`),
`fallbackEditRotation` (`Vec3Double.fromUriLiteral`), `fallbackZoomLevel` (`toDoubleOpt`); first value each.
1. Parse fallbacks (failures → 400 Fox failure).
2. `extract_from_files(files, SharedParsingParameters{overwriting_dataset_id, user_organization_id:
   user.organization_id, is_task_upload:false, fallbacks}, use_zip_name=true, limits, &PgDatasetLookup{pool,
   user_id})`.
3. `wrapped = wrap_or_prefix_groups(parsed.parse_results.clone(), create_group)`; `successes =
   wrapped.filter(succeeded)`; empty → `return_error(&parsed.parse_results)`.
4. `(name, description, wk_url) = upload_metadata(&successes)`; description overridden by the form value.
5. skeletons = each success's `skeleton_tracing`; `volume_groups` = each success's `volume_layers`, non-empty
   only; `dataset = find_dataset_for_uploaded_annotations(pool, user, this_host, skeletons, flatten(volume
   groups), dataset_ids, &wk_url)`.
6. Not in this module: `datasetService.usableDataSourceFor`, `adaptVolumeTracingsToFallbackLayer`
   (needs data source + datastore `canHaveSegmentIndex` RPC; reuse `tracing_initialization`
   `mags_for_volume_tracing`, `combine_largest_segment_ids_by_precedence`, `element_class_to_proto`,
   `data_source_bounding_box`), then mergeAndSaveVolumeLayers: duplicate fallback layer in a group →
   `Cannot save annotation with multiple volume layers that have the same fallback segmentation layer.`;
   >1 groups and any with >1 layer → `Cannot merge multiple annotations that each have multiple volume
   layers.`; >1 groups with edited mapping → `Cannot merge multiple annotations with editable mapping
   (proofreading) edges.`; 1 group → per layer saveEditableMappingIfPresent (edges zip via
   `editable_mapping_edges_zip_for`) + saveVolumeTracing with `data_zip_for` as initialData, layer name
   `name` or `Volume{idx}`; else mergeVolumeTracingsByContents with all data zips → one `Volume` layer.
   Skeletons: one mergedFromContents → `Skeleton` layer. Then saveAnnotationProto, insert Explorational
   annotation (name, description), response `{"annotation":{"typ","id"}}` + `MSG_UPLOAD_SUCCESS`.

## For `POST /tasks/createFromFiles` (TaskController)

Filter files whose lowercase name ends with `.nml`/`.zip`; none → `MSG_FILE_NOT_FOUND`. Then
`extract_from_files(files, SharedParsingParameters{is_task_upload: true, user_organization_id, ..},
use_zip_name=false, …)` and `to_boxes()`; feed into task_creation (`RequestedTask`, `VolumeBase.initial_data
= data.map(|b| b.to_vec())`), see checkpoints/task-creation.md.

## Deviations

- Outer extraction errors: DB errors during a lookup abort the request (500) instead of becoming a
  per-file NmlParseFailure; limit violations reject the upload (400, Rust-only messages).
- Zip parsing by the `zip` crate: archives Java's ZipFile accepts but the crate rejects are skipped
  (and vice versa); a non-decodable entry name stops the archive.
- Nested-zip ordering: insertion order (Scala `Map` iteration is insertion order only up to 4 entries,
  hash order beyond).
- `findOrganizationIdForDataset` (used only when no tracing carries an organization, which the parser never
  produces) has malformed SQL in Scala (`WHERE … WHERE`) and would always fail with 403; Rust runs the
  intended query.
- Failure chains from `?~>` are not rendered as `{"chain": …}` messages; all failures in
  findDatasetForUploadedAnnotations originate from Empty boxes, so Scala has no chain there either.

## Done / Next / Evidence

- Done: implementation, unit + DB integration tests, docs above.
- Next (U2): route wiring as described; tracingstore mergedFromContents / initialData RPCs.
- Evidence: `cargo test --locked --offline --lib annotation_upload_service` → 10 passed;
  `WK_RUST_TEST_DATABASE_URL=… cargo test --locked --offline --test annotation_upload_service --
  --include-ignored` → 1 passed; `cargo clippy --locked --offline --all-targets -- -D warnings` → exit 0;
  `rustfmt --edition 2024 --check` on both files → clean.
