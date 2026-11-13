# DS1a datastore models checkpoint

Owner: ds1a sub-agent (finished by the ds1a-finish agent, 2026-10-11). Files: backend-rust/datastore/src/models/** , tests/models.rs, tests/fixtures/models/*, this file. Also touched (UPath unification + clippy only): src/datavault/{mod,uri,http}.rs; src/datavault/upath.rs trashed.

## Status

DONE (2026-10-11). Models complete vs Scala for the DS1 scope; whole package clippy `-D warnings` clean, `cargo fmt --check` clean, `cargo test` green.

## API (crate::models)

- `upath`: the ONE canonical `UPath` (`Local(LocalPath) | Remote(RemotePath) | ZipEntry(Box<UPath>, String)`), merged from the DS1a and DS1b drafts. Scala `helpers/UPath.scala` semantics: `parse` (= `fromString`, errors are `DsError` with Scala message + `exception` = `java.lang.Exception: …` / `java.nio.file.InvalidPathException: …`), `from_local_path`, `join` (`/ String`), `join_upath` (`/ UPath`), `is_absolute/relative/remote/local`, `scheme`, `to_local_path`, `to_zip_entry`, `to_absolute`, `to_real`, `resolved_in`, `relativized_in` (process cwd) + `relativized_in_cwd` (explicit cwd, testable), `basename`, `parent`, `starts_with`, `Display`/`FromStr`, serde (string), `from_json` (Play reads). `to_remote_uri` lives in `datavault/uri.rs` as an inherent impl so models stay free of URI parsing. Consts: `ZIP_SEPARATOR_*`, `ZIP_RELEVANT_FILE_EXTENSIONS`, `SCHEME_FILE`. `crate::datavault` re-exports `UPath`, `LocalPath`, `RemotePath`.
- `datasource`: `DataSource` (Usable/Unusable; reads Unusable first), `UsableDataSource`, `UnusableDataSource`, `DataSourceId` (`name`/`team`), `StaticLayer` + `LayerKind` (Color / Segmentation{largest_segment_id: u64 bits, mappings}), `MagLocator` (+ legacy `WkwResolution` reads), `AxisOrder`, `LegacyDataVaultCredential`, `VoxelSize` (+ `scaled`, `ratio`, `from_factor_and_unit_with_default`), `AdditionalAxis` (+ `merge`, `merge_and_assert_same`, `coordinate_space`, `intersect_with_additional_coordinates`, `highest_value`), `AdditionalCoordinate`, `CoordinateTransformation`, `ThinPlateSplineCorrespondences`, `LayerAttachment` (+ `resolved_path`, `local_path`), `DataLayerAttachments` (+ merge/drop_missing/with_added/get_by_type_and_name*/mapped/mapped_with_type/rename_by_map/resolved_in/relativized_in/contains_duplicate_names), `status` consts, UnsignedLong helpers (`read_unsigned_long`, `unsigned_long_envelope`, `downgrade_to_plain_number_if_safe`), validation (`validation_errors`, `validation_error_json`), disk form (`OnDiskDataSource`, `to_properties_json`, `to_properties_file_content`).
- `disk_writer`: Scala `DataSourceToDiskWriter` (`update_data_source_on_disk[_at]`, `assert_valid_data_source`, `relativize_paths_of_data_source`; backup log append, `getLines().mkString("\n")` semantics). Blocking IO; callers use `spawn_blocking`.
- `enums`: `ElementClass` (+ helpers), `DataFormat`, `LayerCategory`, `CoordinateTransformationType`, `LayerAttachmentType`, `LayerAttachmentDataformat`, `LengthUnit` (abbreviations on read).
- `geometry`: `Vec3Int`/`Vec3Double` (arithmetic now `std::ops::{Add,Sub,Mul,Div,Neg}`; JVM wrapping int semantics), `BoundingBox` (+ literals, mag scaling).
- `json`: Play-compatible readers (`Fields` accumulating / `lookup` short-circuit), Play number rendering, `pretty_print` and `pretty_print_serialize` (Jackson `DefaultPrettyPrinter` as a serde_json `Formatter`).

## JSON decisions

- Reads are hand-written over `serde_json::Value` mirroring Play error paths/messages; `Deserialize` impls delegate to `from_json`.
- Writes follow Play field order (case-class order; layer: `category` first, `mappings` then `largestSegmentId`, `resolutions`+`numChannels` last). `largestSegmentId` is the UnsignedLong bigint envelope in Play writes; the disk form downgrades ≤ 2^53-1 to a plain number and drops `resolutions`, also recursively inside pass-through view configurations (Scala applies both recursively to the whole JSON).
- `to_properties_file_content` serializes directly (no `Value` detour) because this package's serde_json has no `preserve_order`: a `Value` object is key-sorted. `to_properties_json()` therefore returns a key-sorted `Value` (content equal, order not).
- Invalid UPath JSON error: `Invalid UPath: Failure(<msg>,Full(<exception toString>),Empty)` (case-class `toString` of the `tryo` failure).

## Deviations / open points

- PARENT DECISION NEEDED: enable `serde_json` feature `preserve_order` (Cargo.toml/Cargo.lock, parent-owned; indexmap is already in the lock). Without it, pass-through JSON (`defaultViewConfiguration`, `adminViewConfiguration`, `existingDataSourceProperties`) is re-emitted key-sorted, whereas Play keeps insertion order. Model-defined fields are unaffected.
- `mappings` (`Set[String]`) keeps first-seen order (Scala: insertion order up to 4 elements, hash order above). `AdditionalAxis.merge` output keeps first-seen order (Scala iterates a mutable HashMap).
- JSON numbers are f64 in serde_json: plain-number `largestSegmentId` beyond 2^53 loses precision before `BigDecimal.toLong` emulation (Scala reads exact BigDecimal). Envelope values are exact.
- Jackson escapes control characters with uppercase hex (`\u001F`), serde_json lowercase; irrelevant for real properties files.
- `DataSourceValidation`'s `ParamFailure(JsArray)` cannot be expressed by `crate::error::DsError` (owned elsewhere); `DiskWriteError::Invalid(Value)` + `messages_body()` carries the exact `{"messages": [...]}` body. PARENT TODO: a `DsError` variant/body override for ParamFailure-with-JsArray when routes need it.
- IO error texts approximate Java (`<path> (<OS reason>)`, `java.io.FileNotFoundException:` prefix for the backup log).
- Not modelled (belong to later phases): `doesContainBucket` (BucketPosition, DS3), proto conversions (`toProto`/`fromProto`), `LayerAttachment.scanForFiles` (inbox scanning, DS4), `combinedOverSegmentIdsWithAutoBatching`.

## Evidence (2026-10-11)

- `cargo test --locked --offline` (target /tmp/webknossos-rust-ds-verify-b): lib 48 passed (models: upath 6, geometry 4, json 4, enums 2, disk_writer 1; datavault incl. `upath_to_remote_uri`), tests/models.rs 9 passed, access 7, health 7, routing 6, wk_client 12; 0 failed.
- `cargo clippy --locked --offline --all-targets -- -D warnings`: clean. `cargo fmt --check`: clean.
- Golden fixtures tests/fixtures/models/{legacy_wkw,zarr3_full}.{input,disk}.json: disk outputs hand-derived from the Scala sources (not JVM-oracle-produced); legacy upgrade (wkwResolutions, array scale, scalar mags, dropped empty view config/transformations, deduplicated mappings, unknown keys dropped), full current form (zip/remote/relative paths, axisOrder, credentials, affine matrix, additional axes, attachments with WithDefaultValues lists, uint64 max envelope, recursive resolutions/largestSegmentId patching in view configs, µm → micrometer), fixed point on re-read.
- Local probe (not committed; binaryData/ is gitignored user data): all 29 local `datasource-properties.json` files parse as usable; re-written output is semantically equal for the 11 current-format files, all other diffs are the expected Scala upgrades (legacy keys, array scale, path normalization, dropped unknown keys, default attachment lists). Byte order differs only because those files were written by older Scala versions (different layer field order).
