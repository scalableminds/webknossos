# DS2d N5 — Codex 2026-10-11

Status: DONE (reader batch; see documented deviations and DS6 follow-up).
Done: metadata parse, numeric dtype mapping, shape/300MiB limits, existing pure Rust N5 compressor factory (raw/gzip/zlib/lz4/zstd/blosc), big-endian block header extraction (default and variable modes, mode2 header extraction), own block shape and zero-padding, F layout, Scala default zyx axis order, optional channel/additional axes. Invalid dimensions/rank/overflow fail explicitly. numElements ignored for padding exactly as Scala. zarrs_n5 not used because it rejects variable-length mode read by Scala; source at docs.rs/zarrs_n5/latest/zarrs_n5/ documents this limitation.
Next: synthetic/edge/variable tests, Java/Python oracle on real binaryData N5, fmt/clippy/full datastore suite. Object-mode N5 remains header-only like Scala (no object payload decoding).
Evidence: all-target cargo check passes; focused tests compiling.

Milestone: four integration tests pass: raw/gzip/zstd/useZlib edge blocks and both axis conventions, mode1 padding ignoring element count, absent chunks, malformed metadata/headers, real binaryData N5 gzip block compared with independent stdlib gzip + NumPy oracle. Fixtures checked in under datastore/tests/fixtures/n5/real_gzip; replay generator tools/generate_n5_fixture.py. Correction: Scala N5 factory rejects lz4/xz; preserved (Blosc's inner LZ4 is supported). Decompression is bounded by actual block byte count; shape metadata/actual blocks remain capped at 300 MiB. Complete suite/fmt/clippy verification in progress.

Final batch verification: 185 datastore tests passed, 0 failed/ignored with --include-ignored and WK_DS2_ORACLE_DIR=/tmp/wk-ds2-oracle-wkw; log /tmp/webknossos-rust-ds-readers-tests.log. fmt --check and all-target clippy -D warnings clean. Main-app route inventory --check clean. Next: precomputed reader, then DS3. No main-app source changed.
