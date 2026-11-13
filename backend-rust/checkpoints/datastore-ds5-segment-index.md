# DS5 segment index — Codex continuation, 2026-10-11

## Status

User confirmed Claude is stopped and Codex owns segmentIndex/HDF5. Existing Claude services/routes are the baseline. HDF5 segment-index reads implemented and verified. Full datastore conversion remains active; 114/132 latest route registrations, segment statistics next.

## Done

- Added pinned `hdf5-reader = 0.9.1`, default features disabled, as the pure-Rust HDF5 parsing engine. Audited downloaded source/API/dependencies; no libhdf5 or C/C++ codec runtime/build dependency added. Adapter uses positional FileStorage, 8 MiB per-file chunk cache, bounded integer hyperslabs and root integer/string attributes. This avoids duplicating HDF5 object-header/index/filter parsing while retaining a narrow application API.
- SegmentIndexService reads local HDF5 attachments with a 100-entry cache; Arc-held handles survive eviction while active reads finish. Explicit source/layer invalidation closes cached handles when their last reference is released. Missing/corrupt files do not poison subsequent loads.
- Preserved unsigned remainder, identity/Murmur3 second-half hashing of big-endian IDs, uint64 bit patterns, Scala's extra hash-table row read (clipped at HDF5 dataset edge), signed Short conversion of uint16 positions, missing-segment empty responses and deferred dtype validation.
- Replaced delimiter-based Zarr attachment cache keys with typed source/layer/name/path/credential keys and real dataset/layer chunk-cache scope. Invalidating segment index now also removes its shared chunks. Added checks for zero bucket count, inverted/out-of-range/excessive table spans.
- Request geometry rejects nonpositive mag/cube dimensions with 400 instead of allowing division-by-zero panics. Additional coordinates now receive schema validation. Deduplication preserves first occurrence with a HashSet.

## Evidence

- Adapter/service all-target cargo check passed.
- Real 2.1 MiB `binaryData/sample_organization/l4_sample/segmentation/segment_index/l4_sample_segment_index_file.hdf5`: 20 selected segment queries throughout the hash table, including the last entry, match independently extracted h5py positions. Root attributes match. Earliest superblock/object headers, variable-length strings, contiguous uint64/uint16 datasets exercised. Copied unchanged to tests/fixtures/segment_index/real_l4_sample.hdf5 so regression replay does not depend on ignored local binaryData files.
- Generated earliest contiguous, earliest B-tree v1 chunked and latest big-endian chunked gzip+shuffle+Fletcher32 files pass reads, including uint64 MAX and uint16 32768/65535 signed conversions. Checked-in fixture generator uses h5py3.15.1/numpy2.3.4 only for golden-oracle creation; neither is a runtime dependency.
- Test cases cover malformed tables/zero buckets/unsupported dtype, invalid selections, retry after corrupt file replacement and exact layer invalidation. Zarr changed-byte reload test proves cached chunks are discarded; malformed offset ranges return errors. HTTP HDF5 single/multi query, unsigned envelopes, schema rejection and existing Zarr mapping routes pass. JHDF519.04.1 `HDF5BaseReader.getSpaceParameters` bytecode confirms hyperslabs clip requested block dimensions with Math.min at the dataset edge (local /tmp/wk-hdf5-java-basereader.txt).
- Whole datastore suite **331 passed, 0 failed, 0 ignored**, `--locked --offline --no-fail-fast -- --include-ignored`, with `WK_DS2_ORACLE_DIR=/tmp/wk-ds2-oracle-wkw`; log `/tmp/webknossos-rust-ds-segment-index-tests.log`. fmt, all-target clippy `-D warnings`, both route inventory `--check`s clean. Dependency tree audit saved `/tmp/wk-hdf5-reader-dependencies.txt`. Do not infer broader HDF5 agglomerate/mesh/connectome parity from this subset.

## Next

Port segment statistics: Zarr3 statistics attachments (dense ids, attributes, metrics and remapping), volume/bounding-box fallback scanning actual BinaryDataService buckets, then remaining mesh-derived statistics. Scala contracts: services/segmentindex/SegmentIndexFileService.scala, helpers/SegmentStatistics.scala, services/segmentstatistics/SegmentStatisticsFileService.scala and SegmentStatisticsMath.scala, controllers/SegmentStatisticsController.scala. Index-based statistics intentionally ignore additionalCoordinates as Scala does (#7556); result-cache invalidation must join the existing source/layer reload hook. HDF5 agglomerates/meshes/connectomes remain separate integrations; Compresso remains deferred/unverified.
