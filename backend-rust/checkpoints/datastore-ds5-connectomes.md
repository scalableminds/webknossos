# DS5 connectomes

## Status

DONE: complete datastore384 tests passed, zero failures/ignored; fmt/all-target clippy -D warnings and both inventories clean. Latest registrations132/132. Codex owns datastore (user confirmed Claude stopped). Goal active: Compresso, managed-S3/legacy and DS6 remain; registration coverage is not parity/cutover completion.

## Done

- ConnectomeService reads local HDF5 and token-aware Zarr3: mapping metadata, CSR/CSC pointers, directed agglomerate pairs, incoming/outgoing synapse ranges, positions, partner ids and type legends.
- Single agglomerate includes all incoming/outgoing edges, self and external connections. Multi-agglomerate queries dedup for directed-pair iteration, exclude self and outside-set edges, and repeat results in the original requested order. CSR rows are loaded once per source instead of once per pair, preserving output order.
- Scala Set1–4 insertion order and CHAMP/hash-collision ordering reproduced;137 actual compiled Scala .toSet.toSeq cases verify sizes0–128 and large signed IDs. Pair order determines in/out list ordering.
- Typed source/layer/name/path/credential caches: HDF5 handles30, Zarr arrays/attrs1000 with shared chunk cache; exact scoped reload invalidation. Handle-cap and changed-byte HTTP invalidation tests pass.
- Five authenticated routes: GET connectomes, POST connectomes/synapses, positions, types and src/dst partners. Play schema errors, unsigned agglomerate envelopes and partner envelopes, signed synapse IDs/positions, request duplicates, malformed/missing formats and warm-cache denial covered. Actual remote storage requests forward each current token after array metadata cache hits.

## Contracts and conversions

HDF5 reads root attribute metadata/mapping_name; legacy type names remain the three hard-coded Scala strings. Zarr requires artifact_schema_version (no minimum gate), mapping_name and synapse_type_names. Malformed file-list entries are omitted independently.

Empty multi-ID queries and duplicate-only ID sets never call the reader (even unsupported format gives empty directed lists). HDF5 empty positions/partner/type requests open the file without looking up datasets; Zarr eagerly opens named arrays and type metadata. HDF5 negative/end/past synapse IDs fail; actual Scala Zarr fills0. Zarr scalar getLong uses signed Java MA storage widening and Java float→Long behavior; bulk CSR/CSC indexes require Long storage because Scala casts the underlying array. UInt8 type255 therefore reads255 in HDF5 and-1 in Zarr.

A direct JHDF5 oracle corrected the earlier C-only conversion assumption in the shared Hdf5Reader: dataset transfer callbacks reject negative signed→unsigned, fractional/sign/range loss in float→unsigned, and integer→Float32 precision loss. Exact nonnegative whole floats→UInt64 are accepted. Ordinary fractional Float64→Float32 remains accepted. H5Aread root attributes have no such transfer callback and retain native clamping. Prior hdf5-agglomerate checkpoint's dataset-clamp claim is superseded; unsigned stored IDs/positions and real files remain unchanged. Updated agglomerate numeric replay uses actual JHDF5, preserving the old C fixture only as historical API evidence.

Checked malformed-pointer arithmetic,64 MiB unsigned read/synapse-list bounds and fallible reservations prevent unbounded allocations. Large-list/resource-limit differential coverage remains DS6; ordinary supported file behavior is verified by the native/Scala corpus.

## Evidence

Whole --locked --offline --no-fail-fast --include-ignored suite:384 passed, zero failures/ignored,42 harnesses, exit0. Log /tmp/webknossos-rust-ds-connectomes-tests.log. New service5 and router4 tests plus changed JHDF5 numeric test pass; previous segment-index, agglomerate, mesh and full geometry suites remain green. fmt, all-target clippy -D warnings and both route inventories clean. No main-app/Scala changes, commit/PR/deployment or native runtime dependency.

Actual compiled Scala ConnectomeFileService/Hdf5ConnectomeFileService/ZarrConnectomeFileService produce all graph/JSON/boundary/numeric goldens (tools/GenerateConnectomeFixtures.java). Local oracle vault override supplies the actual FileSystemDataVault; actual DSChunkCacheService uses standalone-datastore.conf. Encoder fixture tables are independently generated with pinned h5py3.15.1/numpy2.3.4, contiguous/v1/v4 chunking, big-endian gzip/shuffle/Fletcher32, numeric variants, external/self and isolated nodes. Tools/GenerateHdf5NumericFixtures.java and InspectJHdf5Conversions.java verify actual JHDF5 conversion policies. See datastore/tests/fixtures/connectomes/README.md.

Java classes /tmp/wk-draco-oracle-classes, classpath datastore target/scala-3.8.4/classes plus exported dependencyClasspath; --enable-native-access=ALL-UNNAMED for bundled JHDF5. Python UV_CACHE_DIR=/tmp/wk-rust-reader-uv uv --offline with pinned h5py/numpy. Replay/runtime requires only Rust.

## Next

DS5b Compresso: source already written/checks but no golden corpus or integration; precomputed/mod.rs still explicitly rejects501. Obtain independent encoder streams (candidate upstream seung-lab/compresso3.2.2), replay actual repository compresso.hpp decoder and integrate precomputed/sharding/HTTP. Preserve pure-Rust runtime, native C++ only for fixture generation. Then managed-S3 PutObject upload targets, legacy/versioned gaps and regional short-S3 exploration rewrite, followed by DS6 differential/performance/config/cutover audit. Full datastore goal remains active.
