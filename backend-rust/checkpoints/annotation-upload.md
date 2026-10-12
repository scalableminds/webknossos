# Annotation upload (U2): POST /annotations/upload

Owner: u2-upload sub-agent (target /tmp/webknossos-rust-verify-c). Files: src/annotation_upload.rs,
tests/annotation_upload.rs, this file. `annotation_upload::router(jobs_enabled)` signature unchanged
(flag unused). No other files edited, no visibility changes.

## Status

2026-10-11: COMPLETE (skeleton and volume paths).

## Contract (AnnotationIOController.upload)

- Multipart: every file part (any field name, in request order) + data parts `createGroupForEachFile`
  (`== "true"`), `datasetId`, `description`, `fallbackEditPosition` (Vec3Int.fromUriLiteral:
  `\d+,\d+,\d+`, Integer.parseInt), `fallbackEditRotation` (Vec3Double.fromUriLiteral: trim, split `,`
  dropping trailing empties, every element Java parseDouble, >=3), `fallbackZoomLevel` (parseDouble);
  first value each. Unparsable fallback → Fox.empty → 404 `Could not find or access the requested resource.`
- extract_from_files(useZipName=true, isTaskUpload=false) → wrap_or_prefix_groups → no successes →
  return_error (400 `{"messages":[{"error":"Could not parse file “f”: …"}]}` or `NML upload failed`).
- name/description/wkUrl over successes; form `description` overrides. find_dataset_for_uploaded_annotations
  (U1). usableDataSourceFor (annotation_create::usable_data_source). adaptVolumeTracingsToFallbackLayer:
  datastore lookup ALWAYS (`DataStore.notFoundForDataset`, also for skeleton-only uploads), per volume
  layer: fallback = first segmentation layer with the tracing's fallbackLayer name (else dropped to None),
  bbox only if empty (fallback box / data-source union), elementClass (fallback or uint32),
  largestSegmentId precedence, mags magsForVolumeTracing, hasSegmentIndex = datastore RPC iff fallback
  else true. Then tracing store (`TracingStore.notFound`).
- mergeAndSaveVolumeLayers (rules checked before any RPC, Scala order): duplicate fallback in a group;
  >1 groups with a multi-layer group; >1 groups with editedMappingEdgesLocation. One group: per layer
  `POST /tracings/mapping/:id/save?annotationId&baseMappingName&startVersion` (long, octet-stream, JSON Long;
  only if edges zip AND base name; one of them → `Could not store editable mapping, either file or
  baseMappingName is missing.`), mappingName = new tracing id when edges location set, `volume/save`
  (temp data source first), `volume/:id/initialData?annotationId` (long, octet-stream, data zip, no
  minMag/maxMag) if the data zip exists; name `name` or `Volume{idx}`; earliestAccessibleVersion =
  final startVersion iff any mapping versions saved, else 0. Several groups: `volume/initializeForMerge`
  (thinned: no segments/groups/user boxes/user states), temp data source, `volume/:id/initialDataMultiple
  ?annotationId` (long, zip of present data zips in order), `volume/mergedFromContents` (full) → one
  `Volume` layer.
- mergeAndSaveSkeletonLayers: every success contributes a skeleton (so every upload gets a `Skeleton`
  layer, as Scala) → `skeleton/mergedFromContents?newTracingId` (long).
- saveAnnotationProto (description, v0, skeleton layers then volume layers, earliestAccessibleVersion),
  then one transaction insert_annotation (Explorational/Internal/OwnerOnly/Active, name = nameForUploaded
  or "", statistics `{}` = AnnotationLayerStatistics.unknown), then analytics `upload_annotation`
  `{annotation_id}`. Response `{"annotation":{"typ":"Explorational","id":…},"messages":[{"success":
  "Successfully uploaded annotation file."}]}`.
- RPC failures keep the upstream status (crate ServiceError message); transport errors 400. Insert is last:
  no rows on any failure (tracing-store data orphaned, as Scala).

## RPC helpers to move into TracingStoreClient (private in annotation_upload.rs)

`upload_initial_data` (volume/:id/initialData without mag restrictions; task_creation has its own copy),
`save_editable_mapping_if_present` (mapping/:id/save), `merge_volume_tracings_by_contents`
(initializeForMerge + initialDataMultiple + volume/mergedFromContents, incl. pack_volume_data_zips),
`merge_skeleton_tracings_by_contents` (skeleton/mergedFromContents). All on `long_clients()`.
NOTE: Scala sends initializeForMerge and volume/mergedFromContents WITHOUT withLongTimeout; here they use
the long transport too (only lengthens the timeout).

## Deviations

- Missing `createGroupForEachFile` part: Scala `dataParts(...)` (Map.apply) throws → 500; Rust treats as false.
- Malformed multipart → 400 `Could not parse multipart request.` (Play rejects in the body parser); 413
  above 1 GiB. Body limit raised to 1 GiB (Play maxDiskBuffer) on this router only; parts held in memory.
- Packed initialDataMultiple entries are named `{index}_{basename}` (Scala: temp-file names; ignored by
  the tracing store).
- Layer names failing the DB check (`^[A-Za-z0-9\-_\.\$]+$`, e.g. NML volume name with a space) → 400
  `Invalid resource values.` after all RPCs, no row (Scala: SQL failure at insert as well).
- Java parseDouble: hex float literals not supported.
- Auth (401) before the multipart body is read.

## Evidence

- `cargo test --locked --offline --test annotation_upload -- --include-ignored` (verify-c, PG 55439):
  6 passed (single NML skeleton rows/RPC bodies/401; multi NML + groups + description override +
  fallback 404; zip NML + volume data (hasSegmentIndex, adapted volume proto, initialData body); editable
  mapping (startVersion/earliest 4/mappingName) + 2-volume merge (initializeForMerge/initialDataMultiple
  packing/mergedFromContents) + merge-rule 400 without RPC; parse failure / no files / unknown dataset /
  foreign org / different datasets; annotation save 503, initialData 500, unusable dataset → no rows).
- `cargo test --lib annotation_upload::` 3 passed (fallback literal parsers, merge rules, zip packing).
- `cargo clippy --locked --offline --all-targets -- -D warnings` clean; `rustfmt --edition 2024 --check`
  on both owned files clean.
