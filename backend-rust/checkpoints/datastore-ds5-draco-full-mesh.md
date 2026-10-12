# DS5 Draco, full/ad-hoc meshes and surface area

## Status

DONE: complete datastore375 tests passed, zero failures/ignored; fmt/all-target clippy/inventories clean. Codex owns datastore (user confirmed Claude stopped). Goal active. Latest registration coverage127/132: only connectomes5 remain unregistered. Compresso, managed-S3/legacy and DS6 remain; this is not cutover/parity completion.

## Done

- Pinned draco-core2.3.2 with decoder/legacy/valence features and defaults off. Source audited: pure Rust, unsafe forbidden, no build script/native link. Application limits face count before decode to the native Int32 STL ceiling; malformed/truncated inputs fail.
- Draco→raw STL, ad-hoc vertices→STL, header/face count combination, Float surface area. Offset, anisotropic scale, integer quantization and triangle ordering reproduce actual JNI/Scala goldens.
- Marching cubes table and implementation: all256 memberships, 32-cell tiles in x/y/z order, cells in z/y/x order, Float offset/scale, six neighbor faces excluding their far edges.
- Binary cuboid meshing for all8 integer classes: storage-width segment narrowing, JSON mapping of both data and selected segment, explicit HDF5/Zarr agglomerate application including mags above16, additional-coordinate/version forwarding. Typed mapping cache with configured capacity and reload invalidation. Semaphore uses configured actor-pool size, includes queue waiting in timeout, and retains its slot until blocking CPU work finishes even if the caller times out.
- Full meshes: HDF5/Zarr3/precomputed fragments decoded serially; indexed33-sample/32-cell chunks and iterative129-sample/128-cell BFS with bounded concurrent requests, dedup and exact per-wave ordering. Vec of waves avoids repeatedly copying the accumulated chunk list.
- Surface area: prefer compatible Zarr3 statistics surfaces; fall back to an exactly mapping-compatible mesh file or indexed ad-hoc meshing. Sum raw chunk areas without allocating a combined STL. Scoped10000-entry area cache and source reload invalidation.
- Authenticated routes: POST meshes/fullMesh.stl, POST adHocMesh, POST segmentStatistics/surfaceArea. Real and synthetic files, HTTP geometry, mappings, neighbors, cache changes/denial, invalid bodies/LOD/encoding, missing seeds and empty meshes replayed. Remote full-mesh reads forward the current token after metadata/index cache hits.

## Compatibility decisions

- Preserve Scala's historical adHocMeshToStl normal indexing (faceIndex, not9*faceIndex): later face normals can be wrong. Vertex positions and surface area are unaffected. Degenerate ad-hoc normals remain NaN; JNI Draco normals remain zero for zero-length cross products.
- Preserve normals before affine scaling, diagonal-only full-mesh transforms, requested-segment addressing for precomputed fragments (Scala ignores unmappedSegmentId here), and rejection of draco+gzip for full mesh.
- Surface-area fallback ignores annotationVersion per Scala and supplies no seed. A selected mesh whose mapping differs falls back to indexed meshing; without an index this fails for missing seed.
- Deliberate fix: restrict newly enqueued BFS cuboids to those intersecting layer bounds. BinaryDataService clips samples to those bounds, so nonzero geometry/order is unchanged; background0 now completes instead of following zero-filled space forever. Checked coordinate arithmetic rejects overflow.
- JSON mappings parse standard JSON and signed Long-compatible numeric values/strings; narrowed duplicate keys and identity fallback match the actual compiled Scala parser. Cache keys include storage width (avoids Scala's erased typed-cache collisions) and reload clears parsed mappings.
- Broader Draco legacy/metadata/prediction-mode corpus and performance remain DS6 coverage. Enabled decoder features alone are not proof of parity beyond the golden corpus.

## Evidence

Previous complete baseline358 tests. New focused mesh router9, geometry6 and semaphore-timeout unit test pass; statistics surface-file priority is also checked. Final suite375 passed, zero failures/ignored, exit0; log /tmp/webknossos-rust-ds-full-mesh-final-tests.log. All-target clippy -D warnings, fmt check and both route inventory checks clean.

Fixture sources: tools/draco_fixture_encoder.cpp (native Draco1.5.7 inputs only), GenerateDracoFixtures.java (actual repository JNI dracoToStlDecoder.cpp + jniutils.cpp, -ffp-contract=off), GenerateStlGeometryFixtures.java (actual compiled Scala MarchingCubes/FullMeshHelper/Play FloatWrites), GenerateJsonMappingFixtures.java (actual Scala MappingParser), generate_full_mesh_fixtures.py (independent h5py3.15.1/numpy2.3.4 containers). Runtime/replay uses only Rust; no native HDF5/Draco link. Fixture details tests/fixtures/draco/README.md.

Temporary JNI library /tmp/wk-draco-stl-oracle.dylib; encoder /tmp/wk-draco-fixture-encoder; Java classes /tmp/wk-draco-oracle-classes. Java classpath: datastore target/scala-3.8.4/classes plus target/streams/compile/dependencyClasspath/_global/streams/export. Python UV_CACHE_DIR=/tmp/wk-rust-reader-uv with --offline pinned h5py/numpy.

## Next

Connectome5 routes/readers first. Source inspection: services/connectome/{ConnectomeFileService,ConnectomeFileUtils,Hdf5ConnectomeFileService,ZarrConnectomeFileService}. Read DataSourceController320–411. HDF5 cache30, Zarr arrays/attrs default1000; root string attr metadata/mapping_name; legacy hard-coded type legend. CSR/CSC offsets → contiguous synapse ranges. Single agglomerate includes all external/self connections; multiple IDs enumerate distinct directed pairs excluding self and return results in requested order (duplicates repeat). Scala .toSet.toSeq order affects list ordering for larger sets; obtain an actual compiled Scala ordering oracle. No local real connectome binary fixture discovered (repository datasource references remote storage); generate native HDF5/Zarr oracle tables and replay actual compiled Scala service where possible. Preserve current-token cache behavior and join caches to reload. Then Compresso integration/native oracles, managed-S3/legacy gaps and DS6 differential/performance/config/cutover.
