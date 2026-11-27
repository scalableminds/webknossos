# DS6 representative immutable fixture catalog

## Status
DONE bounded fixture/corpus assembly (2026-10-12): stdlib-only runtime catalogs generated at `/tmp/wk-ds6-fixtures` and optional attachment revision `/tmp/wk-ds6-fixtures-attachments`; parent launching actual Scala/Rust services. No paired response parity claimed yet.

## Done
- New `tools/datastore_replay/generate_fixture_catalog.py` copies native/independent source fixtures without altering them, assembles Zarr2 and stored ZIP, and writes only a new `/tmp` runtime root.
- Catalog v1 aligned with WK stub owner: organization replay-org, datastore replay-ds, datasetIds 24hex prefix000000, RPC dataSource DTOs with resolved path placeholders `${FIXTURE_ROOT}`/`${FIXTURE_ORIGIN}` and dataset rootPath.
-27datasets/29readData cases: native WKW raw/LZ4/LZ4HC, coordinate Zarr2 crop/missing-fill/clipping, local+actual HTTP ZIP,8Zarr3 codec/sharding variants, real N5 gzip,4precomputed raw/shard/hash encodings,3Compresso layouts, compressed segmentation uint32/uint64/fullwidth mask, gray baseline/progressive JPEG.
- Per-case immutable oracle bytes plus SHA256/status/length; complete fixture manifest records SHA256/file lengths.
- Three known intentional differences are explicit cases INCLUDED in default strict byte corpus: Java JPEG IDCT rounding (2cases) and Scala fullwidth compressed-segmentation mask (1case).

## Next
- Parent actual paired HTTP replay and golden verification; inspect discrepancies before parity claims.
- Parent extend approved read-only runner routes for connectome POSTs, then replay the optional attachment revision.

## Evidence
- `python3 tools/datastore_replay/generate_fixture_catalog.py --output /tmp/wk-ds6-fixtures`:27datasets,29cases,3known divergence cases generated.
- Existing native-reader route tests provide authoritative origins/shapes/source contracts; expected.bin/raw and Java/native .decoded fixtures provide independent golden bytes.
- Python stdlib only; source fixtures unchanged; existing output root rejected to preserve immutability.

## Attachment milestone
- Optional `--attachments` copies contiguous and filtered/chunked-v4 HDF5 and Zarr3 connectome files unchanged.12actual HTTP read-only synapses/positions/types/destination cases use compiled Scala JSON oracle outputs.
- Generated separate immutable `/tmp/wk-ds6-fixtures-attachments`:28datasets/41cases/3known-divergence cases. Initial data fixture root remains unchanged.
- Golden map adds expected_json/canonical_json_sha256 for JSON cases. Parent/stub agent informed that current runner allowlist must explicitly admit read-only connectome POSTs before replay.
- Stdlib validation confirms unique 24hex prefixed IDs, corpus/golden case-name bijection, and200success expectation for all cases in both catalogs. No HTTP responses claimed by this fixture generator task.

## Actual paired compressed-segmentation diagnosis (2026-10-12)
- Read-only POSTs against live Scala19491/Rust19494 and immutable independent goldens: seg32 both200/240bytes; seg64 both200/480bytes; bits32 both200/8bytes.
- **New Scala bug found, Rust/native correct**: `util/.../ByteUtils.scala:intToBytes` shifts by4bits rather than8. `CompressedSegmentation32.valueToBytes` calls it; uint32 value0x10 is serialized `10 01 00 00` instead of `10 00 00 00`. First seg32 diff byte33 at voxel8(x3,y1,z0), Scala272 versus native/Rust16. Stdlib emulation of Scala's nibble-shift serialization reproduces the complete live240byte response exactly.
- seg32 native/Rust SHA256 `3364cf1aab57b6bc43b25f7f2733c42def0bae43d2c3d5d9e41a97d4066667d4`; Scala `8deccb6c267bf67fdb482bbc9b87fe9859c3f1be9a565e0fe4ce5a5cfcc3e2de`.
- seg64 native/Scala/Rust SHA256 `fb2919593ee3a67c0ed7771ed9a40946c144413d72af5aca6ee1f69f0382dda7` matches. Its serializer shifts8bits as expected.
- bits32 exhibits both known Scala32bit index-mask bug and newly identified nibble serializer bug. Native/Rust bytes `efbeaddeedfecefa` hash `e0b8324a2fd7d7f1ec07f45a9776d3331f2469a814d873a33e94feb796b14686`; Scala bytes `efeebedbefeebedb` hash `ef3ccbd0da356f1e114d485590b6feb9b2b5a9bd390caf3961c0c70bccdadd5c`. Emulating first-LUT selection plus nibble serialization reproduces entire live response.
- Reported promptly to parent; no source/runtime edits. This mismatch is not general uint32/native decoder parity and must remain explicit strict comparison coverage. Parent owns whether/how to record a deliberate Scala bug fix policy.

## Final strict corpus/golden integration
- Parent authorized documented new Scala uint32 nibble serialization divergence: generator labels seg32 native golden Rust-only, bits32 reason covers BOTH mask-zero and nibble serializer bugs. Independent Scala emulation writes dedicated golden files and Scala expected_sha256 side hashes; exact actual HTTP bytes confirmed for both.
- Every corpus case embeds supported runner expected_sha256 side objects (29binary cases) or expected_canonical_json_sha256 side objects (12attachment JSON cases). Exact-pair comparisons remain strict and mismatches FAIL; no skip or tolerance added.
- Parent proved actual Play3.0.12 `withHttpHeaders` rebuilds headers from an empty TreeMap, dropping previously set X-Auth-Token on ranged remote ZIP requests (javap). RemoteZIP case records Scala defect, native/Rust golden only. This does not establish a Rust runtime defect; parent owns public/credential-origin test-gap policy.
- Generated fresh full immutable `/tmp/wk-ds6-fixtures-final`:28datasets,41cases,5explicit known differences. Initial roots unchanged.
- Latest differential runner `prepare` accepts all41cases; every case has embedded golden hashes. Scala seg32/bits32 emulator output byte-for-byte equals live responses captured earlier.
