# DS5b Compresso — Codex 2026-10-12

Status: DONE. User reconfirmed Claude is stopped and Codex owns the datastore.
The bounded pure-Rust decoder is integrated into precomputed plain and sharded
chunk reads. Runtime has no C++/JNI linkage or new codec dependency.

## Implementation and contract

`datastore/src/datareaders/precomputed/compresso.rs` decodes v0/v1 streams,
1/2/4/8-byte labels/windows, connectivity 4/6, 3D/ragged windows, streaming RLE
boundaries, first-raster components and literal/boundary instructions. It limits
output to 300 MiB and scratch storage to 512 MiB; tables, lengths, steps and
indexes are checked. Corrupt streams the unchecked native decoder can read out
of bounds are rejected. Version 1 has its z-index validated before decode.

Precomputed `mod.rs` now accepts Compresso and validates the header's spatial
shape and label width against the actual chunk metadata, including edge chunks.
Equal byte counts alone are insufficient. Only one channel is accepted.
Decoded bytes retain x-fastest little-endian labels. Shard lookup/gzip/range
caches remain shared with the existing precomputed formats. Unsupported encodings
still return 501; their service test now uses an unknown encoding.

Actual repository JNI replay required two error-contract corrections: include
`An error occurred in native code:` before the Compresso error, and reject a raw
zero output length before inspecting invalid magic/version/type flags. Safe
native instruction errors 1–7/12 and short-header messages are exact goldens.

## Verification

- Independent `compresso==3.2.2` + `numpy==2.3.4` generated 1,848 valid cases.
  Repository `compresso.hpp` and Rust both returned identical original voxel
  bytes for every case. Includes maximum labels, component index thresholds,
  window widths 1/2/4/8, v0/v1, 4/6 connectivity and 3D windows.
- 324 representative pairs checked in under `datastore/tests/fixtures/compresso`.
  18 actual compiled JNI error/literal fixtures establish strings and precedence.
  Corrupt tables, truncated streams, missing literals, bad steps/indexes and
  oversized output are exercised only by the checked Rust decoder.
- 12 full precomputed volumes (four widths × plain/raw-shard/gzip-shard), with
  voxel offsets, ragged edges, missing chunks, reverse shard payload order and
  unsigned backward offset deltas. Each independent fragment also matched C++.
  Full/cropped bytes replay through DatasetArray and the authenticated data router.
- Denial prevents source lookup; cached remote fragments use the current token
  for new shard reads; invalidation exposes changed/corrupt data. For an aligned
  failed bucket the binary route preserves empty-body/missing/failure headers.
  Scala-compatible partial cuboid assembly keeps its existing logged zero-fill
  behavior; this milestone does not change that service contract.

Complete datastore: **393 passed, 0 failed, 0 ignored across 44 harnesses**,
`/tmp/webknossos-rust-ds-compresso-tests.log`. fmt, all-target clippy `-D warnings`
and both route inventories clean. Registrations remain 132/132, not parity/cutover.
Fixture-only generators are in `tools/generate_compresso_*.py`,
`tools/compresso_fixture_decoder.{cpp,rs}`, `tools/GenerateCompressoFixtures.java`
and `tools/select_compresso_fixtures.py`; fixture README documents reproduction.

Restart checks use `CARGO_HOME=/tmp/webknossos-rust-cargo`,
`CARGO_TARGET_DIR=/tmp/webknossos-rust-ds-verify`,
`WK_DS2_ORACLE_DIR=/tmp/wk-ds2-oracle-wkw` with
`cargo test --manifest-path backend-rust/datastore/Cargo.toml --locked --offline --no-fail-fast -- --include-ignored`.

Next: managed-S3 uploads, legacy/version overrides, regional short-S3 rewrite;
DS6 differential replay, performance/configuration and eventual cutover. Existing
JPEG/Zarr/geometry compatibility deviations still require DS6 evaluation.

Historical 2026-10-11: initial decoder written/checks, deferred while segmentIndex
was prioritized. That unverified/deferred state is superseded by this milestone.
