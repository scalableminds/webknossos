# DS2a WKW reader checkpoint (agent ds2-wkw, target /tmp/webknossos-rust-ds-verify)

Status: IN PROGRESS (started 2026-10-11).

## Plan
1. `datastore/src/datareaders/wkw/header.rs`: `WkwHeader` (Scala `dataformats/wkw/WKWHeader`): parse with Scala messages (`Error reading WKW header: ...`), `ChunkType` Raw/LZ4/LZ4HC (ids 1..3), jump table optional, `write_to` (header file + data file), `DatasetHeader` impl (datasetShape None, chunk shape [c,b,b,b], F order, fill 0, cxyz, sharded, Null/Lz4 compressor, little endian? -> check).
2. `wkw/morton.rs`: Scala `MortonEncoding.mortonEncode`.
3. `wkw/array.rs`: `WkwArrayFormat` (ArrayFormat: chunk filename `z{z}/y{y}/x{x}.wkw`, sharded path+range via jump table range read `[8, 8+8n)`, per-array parsed shard index cache), `open_wkw_array(path, id, layer, cache, token)`.
4. Tests: unit (header parse/errors, morton, jump table), `datastore/tests/datareaders_wkw.rs` synthetic (raw, lz4, multi-block files, missing file -> fill, multichannel) + golden binaryData reads.

## Done
- (nothing yet)

## Codex continuation — 2026-10-11

Status: IN PROGRESS. Claude stopped (user confirmed). Adopted and registered existing header/file/Morton implementations. Added array.rs: cxyz, Morton shard addressing, range-only jump table/block reads, retryable single-flight shard index cache (1000 entries, 2h/1h TTL/idle, LRU deviation), missing shards -> zero fill. Reject malformed negative/inverted ranges and zero channels; enforce existing 300 MiB chunk limit.
Done: 8 existing unit tests + 4 new integration tests pass (raw/LZ4/LZ4HC, cross-block/shard, RGB/default channel, missing shards, truncated table/retry, negative index/offset, Scala multibyte shortcut/typed byte-order discrepancy).
Next: independent fixture oracle, cache/range recording tests, full datastore fmt/clippy/test; only then other readers.
Evidence: CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-ds-verify cargo test --manifest-path backend-rust/datastore/Cargo.toml --locked --offline --lib datareaders::wkw and --test datareaders_wkw passed.

## Completed — Codex, 2026-10-11

Status: DONE (reader). All WKW modules registered; ranged array reads implemented. Native wkw==1.1.24 fixtures (raw/LZ4/LZ4HC RGB, two shards) checked in under datastore/tests/fixtures/wkw; replay generator tools/generate_wkw_fixtures.py. Six integration tests + eight WKW unit tests pass. Cache test records exactly header + one index + two block reads during concurrent loads and verifies token propagation. Index load failures are removed/retried; negative/nonmonotonic offsets rejected. Deviation: LRU eviction; malformed range/zero-channel and 300 MiB chunk checks fail explicitly. Scala WKW default big-endian typed path vs unchanged aligned shortcut preserved and tested. LZ4HC helper writer uses fast encoding (valid decoding, not byte-identical high-compression encoding); reader supports native HC fixtures.
Evidence: whole datastore 174 passed, zero failed/ignored including oracle-export and local binaryData Zarr scan (WK_DS2_ORACLE_DIR=/tmp/wk-ds2-oracle-wkw, --include-ignored). Log /tmp/webknossos-rust-ds-wkw-tests.log. cargo fmt --check and all-target clippy -D warnings clean.
Next: Zarr3 crate adapter, then N5/precomputed. DS3/reader routing integration remains later phase work.
