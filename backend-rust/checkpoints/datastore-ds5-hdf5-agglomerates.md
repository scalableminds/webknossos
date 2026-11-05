# DS5 HDF5 agglomerates — Codex continuation, 2026-10-11

## Status

Implemented and verified HDF5 agglomerate endpoints and mapped-data/index/statistics paths. Whole datastore **348 passed, zero failures/ignored**, fmt/all-target clippy/inventories clean. Claude is stopped; Codex owns datastore/segmentIndex/HDF5. Full goal remains active; latest registrations remain121/132 because this fills the HDF5 branch of existing routes.

## Done

- Extended Hdf5Reader for mixed-width signed/unsigned integers and float32/float64 affinity rows, variable matrix widths, bounded chunk and selection sizes. JHDF5UnsignedLongReader bytecode confirms H5T_NATIVE_UINT64 conversion; historical C oracle clamped signed negatives to0; this dataset behavior is SUPERSEDED by the actual JHDF5 transfer-callback oracle in datastore-ds5-connectomes.md (negative unsigned reads fail). UInt64 bits remain.
- Added Hdf5AgglomerateService: configured handle cap15/default ID LRU625000/centered block512, optional cumsum parser and spatial range selection, chunked mapping read range, fresh uncached graph/tree/position/segment-list/largest-ID readers. Arc-held cached handles survive eviction during active reads. Existing pure-Rust hdf5-reader engine only; direct lru0.16.4 already present transitively, no extra codec/native dependency.
- Wired all already-registered agglomerate endpoints and actual BinaryDataService mapper to HDF5. HDF5 largest ID is offsets length minus1 (Scala Zarr variant returns length). Trees reuse existing protobuf/default builder. HDF5 narrow integer mapping inputs widen unsigned even when class is signed, matching DataConverter; float/double inputs pass through.
- Replaced Zarr agglomerate delimiter keys/dummy dataset scope with typed source/layer/path/name/credential keys and actual source chunk-cache scope/invalidation.

## Evidence

Real test-agglomerate-file agglomerate_view_70 is21KiB and has U32 positions/U64 segment mapping/edges/offsets/F32 affinities. Sample_e2006...agglomerate_view_100 is31KiB, I32 positions/U32 edges/segments/U64 offsets/F32 affinities. Both now replay against independently extracted h5py graph/mapping/position/list oracles. Generated earliest contiguous, earliest B-tree chunked and latest chunked big-endian gzip+shuffle+Fletcher32 variants pass. Copies/oracles under tests/fixtures/agglomerates; generator tools/generate_hdf5_agglomerate_fixtures.py uses pinned h5py3.15.1/numpy2.3.4 only for creation.

Numeric conversion golden uses native HDF5 H5Dread with H5T_NATIVE_UINT64 and H5T_NATIVE_FLOAT (tools/hdf5_numeric_oracle.c, /tmp/wk-hdf5-numeric-oracle), validating signed-negative clamp0, all1/2/4/8-byte integer widths, UInt64MAX and F64→F32. Runtime remains pure Rust. This also corrected the initial segment-index adapter's signed-source casts to actual HDF5 conversion behavior; unsigned stored IDs/positions are unchanged. Positive-count offset exactly at dataset end now fails like JHDF5.

Six focused HDF5 tests pass: real/generated tables and graphs, configured file/ID LRU eviction, graph/tree fresh-open behavior, replacement-inode mapping invalidation, limits, cumsum small/split/spatial/empty ranges and malformed-load retries. All existing agglomerate router tests pass with actual HDF5 data/mapping/graph/tree/position/largest-ID/protobuf lookups. Statistics tests verify HDF5 mapping expansion through index queries, bucket fallback and file metrics. Zarr typed-cache reload/malformed-range regression passes. BinaryDataService now counts shared chunk removal before mapper invalidation touches the same scope, preserving returned counts. ID LRU grows lazily while retaining the configured625000 bound.

Full suite **348 passed, 0 failed, 0 ignored**, --locked --offline --no-fail-fast -- --include-ignored, WK_DS2_ORACLE_DIR=/tmp/wk-ds2-oracle-wkw; log /tmp/webknossos-rust-ds-hdf5-agglomerates-tests.log. Final ID-cache allocation adjustment verified by focused18-test HDF5+binary-data replay; fmt/all-target clippy -D warnings and both inventories --check clean. No main-app/Scala code edits, commit/PR/deployment.

Intentional malformed-file protections: zero cumsum dimensions, missing/duplicate/mismatched boxes, inverted ranges and overflow are errors; range walk capped10M visits. Scala can loop or throw for these invalid inputs. Individual HDF5 reads bounded64MiB and chunks300MiB; valid configured graph sizes are read in32K-row batches. Full DS6 differential/throughput benchmark remains pending.

## Next

Meshes next: inspect Scala mesh-file Zarr3/HDF5/precomputed readers, chunk-list/lod/fragment interfaces and full-mesh service/Draco contract. Port verified metadata/chunk reads and full/ad-hoc geometry so the pending surface-area route has its actual fallback. Then connectomes5, Compresso/Draco completion, managed-S3 upload targets, legacy overrides and DS6 differential/throughput/configuration/cutover work. Original full goal remains intact.

2026-10-12 correction: actual JHDF5 dataset read callback rejects signed-negative→unsigned and integer→Float32 precision loss, unlike H5Dread/H5P_DEFAULT. Shared reader and numeric replay corrected; root attributes still clamp because H5Aread has no callback. New oracle fixtures/agglomerates/jhdf5_numeric_oracle.json, tools/GenerateHdf5NumericFixtures.java; complete datastore384 green. See datastore-ds5-connectomes.md.
