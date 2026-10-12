# DS2-core checkpoint (agent ds2-core restart, target /tmp/webknossos-rust-ds-verify)

Status: DONE (2026-10-11). Generic chunked-array core + Zarr v2 + OME-NGFF metadata implemented under `datastore/src/datareaders/`, tests in `datastore/tests/datareaders_zarr.rs`. Cargo.toml unchanged (no new deps; concurrency via an own `join_all` over `poll_fn`).

## Files
- `datareaders/mod.rs` re-exports; `data_type.rs` (ArrayDataType, ArrayOrder, DimensionSeparator, ByteOrder, JavaNumber, FillValue); `axis_order.rs` (inherent helpers on `models::AxisOrder`, FullAxisOrder); `nd_array.rs` (ucar MultiArray subset + MultiArrayUtils + BytesConverter); `chunk_utils.rs`; `header.rs` (DatasetHeader trait); `chunk.rs` (ChunkContents, typing, ArrayFormat hooks, read_chunk); `cache.rs` (ChunkContentsCache); `dataset_array.rs` (DatasetArray); `zarr/{header,array,ngff}.rs`.

## Public API for the WKW / Zarr3 / N5 / Precomputed agents (`webknossos_datastore::datareaders`)
- Implement `DatasetHeader` (Send+Sync+Debug) for the format header. Required: `dataset_shape() -> Option<&[i64]>` (physical), `chunk_shape() -> &[i32]`, `dimension_separator()`, `fill_value() -> &FillValue`, `order() -> ArrayOrder`, `resolved_data_type() -> ArrayDataType`, `compressor() -> DsResult<&Compressor>` (Result = Scala lazy failure, surfaces as `Could not decompress data chunk.`), `voxel_offset() -> &[i32]`. Overridable: `byte_order()` (default BigEndian), `chunk_shape_at_index(&[i64])`, `is_sharded()`. Provided: `fill_value_number()` (`"NaN"`/unknown → 0, `"Infinity"`/`"-Infinity"` → max/min value of the dtype, Scala quirks kept), `fill_value_boolean()`, `bytes_per_element()`, `bytes_per_chunk()` (i64), `rank()`, `element_class()`, `bounding_box(&AxisOrder)`.
- Implement `ArrayFormat` (Send+Sync+Debug) for the Scala subclass overrides: `chunk_filename(chunk_index, default_name) -> String` (WKW/Zarr3/Precomputed), `sharded_chunk_path_and_range(&VaultPath, chunk_index, user_token) -> BoxFuture<VaultResult<(VaultPath, ByteRange)>>` (NotFound = fill value), `read_chunk_bytes_and_shape(header, path, range, user_token) -> BoxFuture<VaultResult<ChunkBytesAndShape>>` (N5/Zarr3 codecs; default `default_read_chunk_bytes_and_shape` = read + `header.compressor().decompress`). `DefaultArrayFormat` = Zarr v2.
- Build: `DatasetArray::new(vault_path, data_source_id, layer_name, Arc<dyn DatasetHeader>, axis_order, channel_index: Option<i32>, additional_axes: Option<Vec<AdditionalAxis>>, Arc<ChunkContentsCache>, Arc<dyn ArrayFormat>)`; check `assert_chunk_size_limit(header.bytes_per_chunk())` first like Scala `open`.
- Read: `read_bytes_with_additional_coordinates(offset_xyz: Vec3Int, shape_xyz: Vec3Int, Option<&[RequestedAdditionalCoordinate]>, should_read_uint24, user_token) -> DsResult<Vec<u8>>` (bucket bytes exactly as Scala); `read_as_multi_array(offset: &[i64], shape: &[i32], user_token) -> DsResult<NdArray>` (+ `read_as_multi_array_1d`) for attachments; `nd_array::to_long_array`. `RequestedAdditionalCoordinate {name, value, length}` (`From<&models::AdditionalCoordinate>`; models' type lacks the request-only `length`).
- Zarr v2: `zarr::open_zarr_array(path, id, layer, Option<AxisOrder>, channel_index, additional_axes, cache, user_token)`, `zarr::parse_zarr_header(bytes)`, `ZarrHeader::{from_json, from_layer, to_json, check_data_type}`, `zarr::ngff::{NgffMetadata, NgffMetadataV0_5, NgffMultiscalesItem(V0_5), NgffAxis(length_unit), NgffDataset, NgffCoordinateTransformation, NgffOmeroMetadata, NgffChannelAttributes, NgffChannelWindow, NgffGroupHeader, NgffLabelsGroup}` + `from_name_voxel_size_and_mags`.
- Utilities: `FullAxisOrder` (permutations, `to_wk_libs_json`), `compute_chunk_indices`, `header::nd_bounding_box_wk_libs_dict`, `ArrayDataType::{from_wkw_type_id, to_wkw_id, from_element_class, element_class}`.

## Cache decision
Ported: `ChunkContentsCache::new(max_size_bytes)` = Scala `ChunkCacheService.sharedChunkContentsCache` (AlfuCache weighted by `sizeBytes/1000` KB, max `floor(maxSizeBytes/1000)`, default `DEFAULT_MAX_SIZE_BYTES` 2 GB = `cache.image_array_chunks_max_size_bytes`, TTL 2 h, TTI 1 h, single-flight loads, failures not cached). Keys exactly Scala: `"<orgId>/<dirName>__<layerName>__<vaultPath>__chunk_<i0,i1,...>"` (physical index, no token). Eviction is LRU instead of W-TinyLFU. PARENT TODO: create ONE `Arc<ChunkContentsCache>` from config in AppState when the data routes come (DS3).

## Deviations / notes
- The cache stores decompressed on-disk bytes (or a fill marker); typed and shortcut views are derived per read. Scala caches whichever MultiArray was loaded first (a flat BYTE shortcut array can poison a later partial read of the same chunk); the Rust behaviour is the intended one. Big-endian dtypes are byte-swapped on every typed read (not cached typed).
- Shortcut path kept bit-exact: one whole F-order chunk in cxyz order returns the raw decompressed bytes (big-endian dtypes stay big-endian, missing chunk = `fillValue.byteValue` repeated) — Scala behaviour, tested.
- 2-d arrays: chunk file names use Scala's `chunkIndex.drop(1)`, which drops the FIRST physical index although the adapter appends z LAST (looks like a Scala bug; works by accident for single-chunk axes). Kept for parity — PARENT decision whether to fix in both.
- `readAsMultiArray` has no single-chunk shortcut (Scala's `case chunkIndex :: Nil` never matches the ArraySeq). F-order arrays are not permuted there (Scala too).
- `readAsFortranOrder` total offset uses Scala's `zip(voxelOffset).padTo(len, 0)` (missing voxel offset entries make the offset 0, e.g. the 2-d z).
- Bool arrays: non-shortcut reads fail with the Scala ClassCastException text (BytesConverter casts boolean[] to byte[]).
- Chunk fetches run concurrently; copies happen after all fetches (Scala copies as each completes); the first failure in chunk order is returned.
- Short chunk data: all types fail with `Could not wrap and type chunk data.` (Scala BYTE arrays fail later in copyRange). Decompression is bounded by the codec default (1 GiB) instead of unbounded.
- `bytes_per_chunk` is 64-bit (Scala Int product can wrap).
- Play fill-value reads verified against play-json 3.0.6 bytecode: Long if `isValidLong`, else Float (`BigDecimal.toFloat`) — so `0.1` on an f8 array fills with `(double)0.1f`; `null`/missing → 0.
- NGFF: serde derive; Scala-defaulted fields are required (plain `Json.format`), but JSON error texts are serde's, not Play's.
- Not ported (later phases): DatasetArray `toString` class name, `NDBoundingBox` case class (only `nd_bounding_box_wk_libs_dict`), Zarr v2 writing of chunks, the bucket provider (`DatasetArrayBucketProvider`, DS3).

## Evidence (2026-10-11, target /tmp/webknossos-rust-ds-verify)
- `cargo test --locked --offline`: lib 81 passed (18 datareaders units: data_type 3, axis_order 3, nd_array 3, chunk_utils 2, cache 1, zarr header 4, ngff 2), tests/datareaders_zarr.rs 7 passed, access 7, compression 9 (+1 ignored, not ours), datavault 20, health 7, models 9, routing 6, wk_client 12; 0 failed.
- datareaders_zarr.rs: synthetic arrays written by the test (null, blosc lz4+shuffle, zstd, gzip, zlib; `.` and `/` separators; C and F order; `>u2`, `<u2`, `|u1`, `<i8`): zyx C-order reads across chunk borders, padded border chunks, missing chunk → fill value, out-of-range → zeros; F-order cxyz shortcut (raw bytes incl. big endian, byteValue fill) and unaligned typed reads; uint24 channel interleaving and channel index; additional axis single + batched (repacked into z slot) + error chains; 2-d adapter and `readAsMultiArray`/`toLongArray`; decompression failure chain, cache hit after file deletion, header missing/invalid/chunk-limit errors; real local `binaryData/**/.zarray` (10 files, blosc lz4, `<u8 <i8 <f4 >u2 |u1 <f8`) parse and their first bucket reads (9 non-zero) — skipped when binaryData is absent.
- `cargo clippy --locked --offline --all-targets -- -D warnings`: clean. `cargo fmt --check`: clean.

## Next (for the coordinator)
- DS2a WKW, DS2c Zarr3, DS2d N5/Precomputed plug in via `DatasetHeader` + `ArrayFormat` (see API). No JVM oracle comparison of bucket bytes was run (the test expectations are derived from the Scala code); a differential run against the Scala datastore on the local binaryData zarr datasets is recommended in DS3.


## Coordinator decisions (2026-10-11)

- 2-d chunk filename `drop(1)` quirk: KEEP Scala parity (files on disk were written/read by Scala; changing Scala is out of scope). Revisit only together with a Scala change.
- Parent pre-registered datareaders submodules wkw, zarr3, n5, precomputed (scaffold mod.rs each) so format agents never edit datareaders/mod.rs.


DS3 integration update (Codex 2026-10-11): AppState now owns the shared chunk cache; DatasetArrayBucketProvider is implemented. Chunk cache source/layer identity now uses a JSON scope instead of delimiter-only strings, with exact selective invalidation (color and color__extra tested). Full-chunk shortcut also checks actual chunk shape: boundary N5/precomputed blocks must pad via typed assembly. Historical cache-key/shortcut descriptions above refer to the initial DS2 version. Existing full nominal F-order endian/fill behavior remains. Whole datastore207 tests pass; DS3 checkpoint has current evidence.
