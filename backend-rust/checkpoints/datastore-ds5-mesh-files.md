# DS5 mesh-file readers — Codex continuation, 2026-10-11

## Status

Implemented and verified mesh-file readers and3 routes for HDF5, Zarr3 and sharded precomputed. Whole datastore **358 passed, zero failures/ignored**, fmt/all-target clippy/inventories clean; registrations124/132. User confirmed Claude stopped, Codex owns datastore. Full goal remains active; full STL, ad-hoc mesh and surface-area fallback still required.

## Done

- Bounded Neuroglancer manifest parser (per-lod scales/vertex offsets, column-major positions and fragment sizes), exact f32 local positioning and precomputed quantization/transforms, per-lod group merge and UnsignedLong JSON chunks.
- MeshFileService: typed attachment identity, Zarr3 array/attributes cache with actual source/layer chunk scope, HDF530-handle cache with active Arc lifetime, precomputed100-metadata cache and existing verified shard/minishard reader. HDF5 scalar/matrix float attrs, signed version attr and byte reads added to pure-Rust adapter.
- Preserved Scala differences: malformed Zarr entries skipped in file list, HDF5 version failures become0/mapping failures None, precomputed list version7 without opening info; local segment failures are omitted from merged chunks, precomputed failures propagate. Physical read sorting preserves request concatenation order; gzip encoding response header.
- Added3 authenticated routes (meshes, meshes/chunks, meshes/chunks/data), token propagation and source/layer invalidation. Full STL and surface-area routes remain unregistered until full geometry/Draco fallback exists.

## Evidence

- tools/generate_mesh_fixtures.py uses pinned h5py3.15.1/numpy2.3.4 to create generated HDF5/Zarr3 and raw/gzip-sharded precomputed inputs, including unsignedMAX IDs, multiple LODs and gzip-member fragment payloads. HDF5 metadata covers U32 bucket/version attrs and F32 scalar/matrix attrs as well as real I64/F64.
- tools/GenerateMeshManifestFixture.java calls actual compiled Scala manifest parser, Hdf5MeshFileService/NeuroglancerPrecomputedMeshFileService enrichment and derived Play JSON writer. Generated local/precomputed float transforms and real manifests match exactly. The copied36KiB real mesh file and raw payload provide fragment-byte oracle checks. Goldens under tests/fixtures/meshes; replay needs no native/Scala/Python runtime.
-10 tests cover parser truncation/all prefixes/nonfinite/overflow, all formats and both shard encodings, merged LODs/missing segment differences, unsigned envelopes, sorted read order, gzip header+actual multi-member decoding, body validation/range checks/native zero-size boundaries, cached authorization denial, actual HTTP changed-byte invalidation and current-token-after-cache forwarding to remote manifests/fragments (metadata/index cache hits do not capture token).
- Full datastore **358 passed, 0 failed, 0 ignored**, --locked --offline --no-fail-fast -- --include-ignored, WK_DS2_ORACLE_DIR=/tmp/wk-ds2-oracle-wkw; /tmp/webknossos-rust-ds-mesh-files-tests.log. fmt/all-target clippy -D warnings and both inventories --check clean.

## Next

Draco→raw STL and full/ad-hoc mesh orchestration, then surface-area route with actual file/ad-hoc fallback. Local JNI reference webknossos-jni/src/dracoToStlDecoder.cpp: POSITION mapped bytes read as F32; if vertexQuantizationBits>0 reinterpret low16 bits and scale by1/(2^bits-1), compute normal before position offset and anisotropic scaling, then50-byte triangle records. Preserve arithmetic/face ordering with actual C++ golden fixtures; no native runtime link.

Candidate pure-Rust engine researched (not added): draco-core2.3.1 downloaded/audited Cargo metadata under /tmp/webknossos-rust-cargo/registry/src/index.crates.io-1949cf8c6b5b557f/draco-core-2.3.1. MSRV1.88, build=false, unsafe_code=forbid, only bytemuck runtime dependency. Choose decoder+edgebreaker_valence_decode+legacy_bitstream_decode with defaults off; audit actual APIs/limits and compare native fixtures before adoption. cargo info reports latest2.3.2, so inspect the current patch as well. Primary sources [upstream support matrix](https://github.com/Filyus/draco-rust/blob/main/crates/draco-core/SUPPORT_MATRIX.md), [published package](https://docs.rs/crate/draco-core/2.3.1). Byte metadata/chunk support does not prove codec parity. Legacy/current real Draco streams and integer POSITION handling need explicit goldens.

Connectomes5, Compresso completion, managed-S3/legacy and DS6 remain. Goal unchanged; no main-app/Scala code edits, commit/PR/deployment.
