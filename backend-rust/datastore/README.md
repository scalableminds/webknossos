# Rust datastore

Incremental replacement of the Scala datastore. This is a separate Cargo package; the main application still uses its existing datastore RPCs. Reader implementation is not HTTP-route or cutover parity.

Requires **Rust 1.91 or newer** (zarrs 0.23.14). The main application package retains its own Rust requirement.

Implemented readers:

- WKW: raw/LZ4/LZ4HC blocks, Morton shard order, token-aware range reads, bounded single-flight shard index cache, missing-shard fill; native wkw golden fixtures.
- Zarr v2: existing Scala-compatible metadata, compression, C/F layout, channels/additional axes and shared chunk cache.
- Zarr v3: zarrs-backed bytes/endian, C/F transpose, gzip/zstd/Blosc/CRC32C and indexed sharding (start/end indices), token-aware vault adapter and bounded shard decoder caches; independent zarr-python fixtures. Gzip, zstd and Blosc use the existing Rust compressors, not zarrs's native codec features. zarrs still includes libz-sys as a build dependency.
- N5: raw, gzip (including useZlib), zlib, zstd and Blosc; block-local edge shapes and variable-length padding, big-endian values and Scala's default zyx axes. Independent oracle for a real repository gzip block. N5 LZ4/xz are rejected, as in Scala. Object-mode headers can be extracted; object payload decoding is not implemented.
- Neuroglancer precomputed: raw, JPEG and compressed_segmentation (uint32/uint64), irregular boundary chunks and voxel offsets, identity/x86 Murmur hashing, raw/gzip shard and minishard indexes, unsigned/backward delta offsets, range caches and multichannel reads. Compresso encoding remains pending. Native codec/hash and independent Python specification fixtures plus Java ImageIO JPEG fixtures.
- OME metadata: existing NGFF 0.4/0.5 models plus the Zarr3 attributes.ome group wrapper. Existing Scala models are retained rather than replaced with stricter ome_zarr_metadata validation. zarrs_n5 was evaluated but excludes the variable-length block mode Scala handles.

BinaryDataService and DatasetArrayBucketProvider now serve all five static formats internally: bounded mag/provider caches, shared chunk cache, cuboid assembly and clipping, batch outcomes, additional axes, uint24/half-byte conversion, current-token forwarding and exact reload invalidation. AppState owns the shared services. DatasetCache consumes resolved datasource RPCs, with usability/layer checks, bounded single-flight caching and manual invalidation. Four authenticated binary-data HTTP entrypoints are implemented (frontend POST data, GET cuboid data, POST readData, Knossos bucket.raw), including version aliases, Play schema errors and missing/failure headers. Disk datasource loading now validates metadata, discovers attachments with explicit metadata precedence, and resolves mag/attachment paths. Metadata PUT uses the backup writer; cache DELETE and reload POST clear actual reader/vault caches and refresh/report local metadata. Selective reload retains other layers, and reload checks datasource organization across RPC fetches. BaseDirService, selected/global datasource scanning and typed metadata/realpath reporting are implemented. Four scan/directory endpoints are authenticated; the filesystem watcher starts from main with configured initial delay, completion-based interval and retry. Zarr3/HDF5 agglomerate mapping, histograms and thumbnails are implemented. Further DS4 route batches are recorded in datastore-ds4-proxy-finddata-zarr.md.

Segment-index routes now read Zarr3 and local HDF5 attachments. The HDF5 subset uses pinned hdf5-reader0.9.1 with positional reads, bounded integer hyperslabs and a 100-file cache; it adds no native HDF5 runtime dependency. Real repository and independently generated contiguous/chunked, endian, gzip/shuffle/checksum fixtures verify the hash/position contract and reload behavior. Details: [segment-index checkpoint](../checkpoints/datastore-ds5-segment-index.md).

Seven segment-statistics routes read Zarr3 files and use the index plus actual binary buckets for volume/bounding-box fallback. Dense ids, format/mag/mapping compatibility, ordered metrics, agglomerate combination and exact source/layer cache invalidation are implemented. JNI scanner and compiled Scala math/JSON golden fixtures replay without native runtime dependencies. Complete datastore verification: 340 tests passed, fmt/clippy/inventories clean. Details: [statistics checkpoint](../checkpoints/datastore-ds5-segment-statistics.md).

Agglomerate endpoints and binary-data mappings support both Zarr3 and local HDF5. HDF5 handles and ID blocks use the configured caches; optional cumsum ranges support single/split reads and spatial selection. Graph/tree/position readers reopen files per operation. Independent real-file and native numeric-conversion fixtures, eviction/reload and mapped statistics/index queries pass. Details: [HDF5 agglomerate checkpoint](../checkpoints/datastore-ds5-hdf5-agglomerates.md).

Mesh-file listing, merged LOD/chunk metadata and ordered opaque chunk-data routes support HDF5, Zarr3 and sharded precomputed, including gzip indexes/manifests, transform/quantization metadata and unsigned IDs. Real bytes and actual Scala manifest/JSON goldens, cached access/token forwarding and HTTP changed-byte reload verify the contract. Complete datastore358 tests and fmt/clippy/inventory checks pass. Details: [mesh-file checkpoint](../checkpoints/datastore-ds5-mesh-files.md).

Full/ad-hoc meshes and surface-area routes now use pure-Rust draco-core2.3.2, mapped integer cuboids and marching cubes. Native JNI and compiled Scala goldens verify all256 cube configurations, triangle/STL ordering and areas; indexed and neighbor traversal, current-token remote reads, cache invalidation and timeout behavior are covered. Whole datastore375 tests passed with fmt/clippy/inventories clean. Details: [mesh geometry checkpoint](../checkpoints/datastore-ds5-draco-full-mesh.md).

Connectome routes support HDF5/Zarr3 CSR/CSC queries, exact ordered synapse lists, positions, unsigned partners and legends. Actual compiled Scala/JHDF5 goldens verify conversions and boundary behavior; remote tokens, cache bounds/reload and authorization are covered. Whole datastore384 tests passed, fmt/clippy/inventories clean; latest registrations132/132. Details: [connectome checkpoint](../checkpoints/datastore-ds5-connectomes.md).

Compresso and managed-S3/legacy/DS6 work are still pending; registration coverage is not migration completion. See MIGRATION_STATUS.md for generated route registrations and ../checkpoints/datastore-plan.md for phase ownership.

Compatibility notes: WKW's Scala big-endian typed-read/default shortcut discrepancy is preserved. Zarr3 uses physical 2D chunk addresses; Zarr2 retains Scala's legacy naming quirk. Zarr3 sharded missing chunks use decoded numeric fill values (Scala's aligned F shortcut can instead repeat the fill's low byte). Nested big-endian shard payloads are interpreted correctly by zarrs; Scala only inspects top-level bytes codecs. Only C/F transpose orders are accepted. Precomputed represents channels explicitly instead of retaining Scala's rank3 channel omission, and rejects incorrect raw byte counts. Compressed segmentation fixes the full-width 32-bit mask and uses actual boundary chunk shapes. JPEG uses the same gray/BGR raster layout as Java ImageIO but baseline/progressive oracle fixtures differ by up to 1 gray or 2 color intensity levels; broader image parity remains DS6 work. Smaller actual chunks now use padded assembly instead of the nominal full-chunk shortcut. Cache scopes use JSON-encoded datasource/layer identity for exact invalidation. These differences need differential coverage in DS6 before cutover.

Verification (existing mock-server tests need localhost permission):

```sh
mkdir -p /tmp/wk-ds2-oracle
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-ds-verify WK_DS2_ORACLE_DIR=/tmp/wk-ds2-oracle cargo test --manifest-path backend-rust/datastore/Cargo.toml --locked --offline --no-fail-fast -- --include-ignored
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-ds-verify cargo clippy --manifest-path backend-rust/datastore/Cargo.toml --locked --offline --all-targets -- -D warnings
cargo fmt --manifest-path backend-rust/datastore/Cargo.toml --check
python3 backend-rust/tools/datastore_route_inventory.py --check
```

Fixture generators are ../tools/generate_wkw_fixtures.py, generate_zarr3_fixtures.py, generate_n5_fixture.py, generate_precomputed_fixtures.py, generate_segment_index_fixtures.py and GenerateJpegFixtures.java. Golden replay requires no Python dependencies.
