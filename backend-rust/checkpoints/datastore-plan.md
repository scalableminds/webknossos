# Datastore engine migration plan

Created 2026-10-10 by the Claude coordinator. Scope: replace `webknossos-datastore` (Scala, ~28k lines of hand-written code, 132 routes in `conf/datastore.latest.routes`) with a Rust service. Main-application routes are tracked in coordinator.md; this file tracks the datastore phase only. Same rules as coordinator.md: small bounded agents, one owner per file, Scala is authoritative, no placeholder behavior, checkpoints at milestones.

## Layout decision

- Separate Cargo package `backend-rust/datastore/` (binary `webknossos-datastore`), with its own `Cargo.toml`/`Cargo.lock` and its own target dir (`/tmp/webknossos-rust-ds-verify*`). It does not depend on the main-app crate, so main-app agents and datastore agents never break each other's builds.
- Small shared helpers (ObjectId, error JSON shape) are copied into the datastore crate rather than shared, until a workspace is worth the coordination cost.
- Codec/storage crates (crates.io is reachable): `lz4_flex`, `zstd`, `flate2`, `brotli`, `blosc-src`/`blosc` (C via cc), `object_store` (S3/GCS/HTTP/local vaults), `image`/`jpeg-decoder`+`jpeg-encoder`, `crc32c`. HDF5 → pure-Rust subset reader; draco/compresso → Rust port (see Decisions).

## Scala map (lines of hand-written code)

services 11.7k (binary data, mappings, agglomerates, meshes, segment index, connectome, uploads, data source repository/inbox), datareaders 4.4k (zarr, zarr3, n5, precomputed, wkw, codecs), controllers 3.0k, explore 2.1k, models 1.8k, storage 1.3k (caches, vault paths), datavault 1.2k (file/http/s3/gcs), helpers 1.2k, dataformats 0.7k, rpc 0.3k, image 0.3k.

Routes by controller: ZarrStreaming 64, DataSource 27, SegmentStatistics 11, BinaryData 10, Upload 9, DSMesh 4, DataProxy 4, Exports 1, DSAiModel 1, Application.health 1 (+ DSLegacyApiController versioned routes).

## Phases (each bullet = one bounded agent, ~45-60 min)

DS0 foundation
- DS0a crate skeleton: config (standalone-datastore.conf / application.conf `datastore.*` keys as env), Axum server, `/data/health`, error JSON, request logging, CORS as Scala, graceful shutdown. Parent creates the package and owns Cargo files.
- DS0b WK RPC client + auth: `DSRemoteWebknossosClient` (report status, validate user access tokens `/api/datastores/:name/validateUserAccess`, data source reporting), `UserAccessRequest` model, access-check extractor with token cache semantics.

DS1 models and vaults
- DS1a DataSource / DataLayer / mag / attachment JSON models with serde parity (datasource-properties.json), DataSourceId, element classes, bounding boxes, additional axes.
- DS1b data vault abstraction: local file + HTTP(S) range reads, then S3/GCS via object_store; VaultPath, credential handling (credentials resolved through WK `findCredential`), remote source descriptors.

DS2 chunk readers (pure, unit-tested against fixtures in `test/` / `binaryData/`)
- DS2a WKW reader (header, LZ4 blocks, morton order).
- DS2b Zarr v2 (.zarray, chunk keys, compressors: blosc, zstd, gzip/zlib, lz4, null; fill value; C/F order).
- DS2c Zarr v3 (codecs: bytes/endian, transpose, blosc, gzip, zstd, crc32c, sharding_indexed).
- DS2d N5 + Neuroglancer precomputed (raw, gzip, jpeg, compressed_segmentation).

DS3 data access core
- DS3a bucket/cuboid assembly from chunks, element-class conversions, mag selection, data request cache.
- DS3b BinaryDataService + mapping application (JSON mappings), histogram, thumbnails (JPEG encoding, color mapping).

DS4 routes (split ≤ ~6 routes per agent)
- BinaryDataController (10), DataSourceController (27 → ~5 agents: read/inbox, explore/remote add, update/reload, delete, paths/realpath), ZarrStreamingController (64 → mostly metadata + chunk passthrough; ~4 agents), UploadController (9, resumable uploads), DataProxy (4), Exports, DSAiModel, legacy versioned routes.

DS5 segmentation features
- DS5a pure-Rust HDF5 subset reader (superblock v0-v3 as used, object headers, B-tree v1/v2 chunk indexes, contiguous+chunked datasets, gzip/shuffle filters, attributes) validated on real WEBKNOSSOS fixture files.
- DS5b compresso port, DS5c draco encoder/decoder port (only what webknossos-jni exposes).
- DS5d agglomerate files, DS5e segment index, DS5f meshes (mesh files, ad-hoc meshing), DS5g connectome, DS5h segment statistics (11 routes).

DS6 parity and cutover
- Differential replay against the Scala datastore for representative datasets; performance checks (chunk throughput, caches); deployment config.

## Decisions (user, 2026-10-11)

1. HDF5: write a pure-Rust reader for exactly the subset WEBKNOSSOS uses (agglomerate files, mesh files, segment index, connectome as read by the Scala services via jhdf5). No libhdf5 / C dependency.
2. webknossos-jni (draco, compresso C++): PORT to Rust (no C++ linking). Keep codec output/decoding bit-compatible; build golden fixtures from the existing C++/JNI implementation where possible.
3. Disk: user reclaimed space (2026-10-11: 144 GiB free, all verify target dirs emptied). Still keep at most ~4 concurrent target dirs.

## Status

2026-10-10 22:45 UTC: package skeleton created by parent; DS0a dispatched.
2026-10-11 ~09:00 local: DS0a, DS0b, DS1a, DS2-codecs DONE; DS1b finishing (S3/GCS/service); DS2-core (DatasetArray + Zarr v2) running. Next: WKW, Zarr3, N5, Precomputed readers in parallel once DS2-core publishes its API.

Not started. Main-application routes (4 remaining as of 2026-10-10 ~18:00 UTC) finish first.

2026-10-11 Codex continuation (user confirmed Claude stopped): DS2a WKW DONE; 14 focused WKW tests, native WKW golden fixtures and complete datastore 174-test suite pass; fmt/clippy clean. DS2b Zarr v2 + legacy NGFF already implemented. Next DS2c Zarr3: evaluate zarrs adapter over existing token-aware vaults and DatasetArray. zarrs_n5 lacks varlen/object N5 chunk modes; ome_zarr_metadata covers 0.4/0.5 whereas existing Scala legacy metadata may be more permissive. Preserve established v2/NGFF compatibility rather than replacing it blindly.

2026-10-11 Codex reader batch DONE: DS2a WKW, DS2c Zarr3, N5 portion of DS2d + OME0.5 group wrapper. Datastore total **185 tests passed, zero failures/ignored**, fmt/clippy/inventory checks clean. zarrs 0.23.14 async/sharding/transpose/crc32c adopted with existing Rust gzip/zstd/blosc plugins; datastore MSRV1.91. Independent native WKW, zarr-python and real N5 golden fixtures included; see datastore/README.md and domain checkpoints for exact supported behavior/deviations. Existing Zarr2/NGFF APIs retained. zarrs_n5 and ome_zarr_metadata evaluated but not added (N5 variable mode missing; legacy NGFF behavior already ported). Next: precomputed (raw/sharding/JPEG/compressed_segmentation), compresso DS5b, then DS3 data service and DS4 routes. Full datastore conversion remains active.

2026-10-11 next Codex batch: precomputed core reader IMPLEMENTED (raw/JPEG/compressed_segmentation, ranges and shard/minishard caches, identity/x86 Murmur/unsigned IDs, voxel offsets/boundary shapes, multichannel/RGB). Native/Python specification/Java raster fixtures included; complete datastore 195 tests green with fmt/clippy/inventory. Compresso still DS5b; JPEG is layout-compatible with small recorded ImageIO differences rather than byte-identical. Exact deviations/evidence in datastore-ds2-precomputed.md. Next DS3a bucket provider and cuboid/type conversion, then DS3b BinaryDataService and DS4 routes; overall migration still active.


2026-10-11 Codex DS3 batch: DS3a and BinaryDataService core implemented and wired to AppState (all five static formats, shared chunk cache, bounded mag/provider caches, cuboid assembly, bounding-box clipping, batch outcome ordering, additional-axis batching, uint24 and high-nibble packing, dataset error logging, exact reload invalidation). 12 focused service tests and whole datastore **207 tests passed, zero failures/ignored**; fmt/clippy/inventory clean, /tmp/webknossos-rust-ds-data-access-tests.log. Agglomerate injection hook exists but actual mapping service is pending; requests requiring it fail explicitly. Compresso still pending and propagates501 rather than black data. Next DatasetCache/local mag-path resolution and authenticated binary-data routes, then remaining DS3b services/DS4/DS5/DS6. Domain evidence datastore-ds3-data-access.md; full conversion goal active.


2026-10-11 Codex DS4 binary-data batch: DatasetCache (RPC-resolved paths, TTL24h/idle1h/cap5000, single-flight, retry errors/manual invalidation) and four authenticated BinaryDataController data entrypoints implemented. Native fixtures for all static formats replay through the actual router; batch headers/order, schema validation, JSON body limit, version aliases and current-token forwarding after cache hits pass. Whole datastore **217 tests passed, zero failures/ignored**, fmt/clippy and both inventory checks clean; /tmp/webknossos-rust-ds-binary-routes-tests.log. New datastore/MIGRATION_STATUS.md tracks **5/132** latest registrations (four data plus health), not parity. Next disk DataSourceService and reload/cache invalidation, then remaining BinaryData/DS4 services and DS5/DS6. See datastore-ds4-binary-data.md for boundaries including pending real mapping and slow-request Slack delivery.


2026-10-11 Codex datasource batch: disk DataSourceService loading/path resolution/attachment discovery and vault invalidation plus three DataSourceController routes (PUT metadata on disk, DELETE invalidate cache, POST reload) implemented. Real backup/validation writer, changed-byte reload and selective exact layer/cache removal replayed; denial/cross-organization and RPC fallback/error paths verified. Whole datastore **228 tests passed, zero failures/ignored**, fmt/all-target clippy and both inventories clean; /tmp/webknossos-rust-ds-source-reload-tests.log. Latest datastore registrations **8/132**, not parity. Next BaseDirService/base-directory scanning and datasource/realpath report DTOs, checkInboxBlocking/scanRealPaths routes and watcher ticker. Contracts/deviations in datastore-ds4-datasource.md; DS3b remaining mapping/histogram/thumbnail, DS4/DS5/DS6 still pending.


2026-10-11 Codex inbox batch: BaseDirService, typed source/root/realpath reports, selected/global scan/dedup/symlink ownership, four directory/scan endpoints and filesystem watcher implemented. Metadata reports precede path reports, individual path failures remain nonfatal, RPC failures propagate; denied routes have no scan/create/report effects. Watcher non-overlap, initial/completion timing, retry, disabled/minimum settings and abort verified. Complete datastore **239 tests passed, zero failures/ignored**, fmt/clippy and inventory checks clean; /tmp/webknossos-rust-ds-inbox-tests.log. Latest datastore registrations **12/132**; evidence/deviations datastore-ds4-inbox.md. Added cached rustix1.1.5 fs on Unix for native permission checks. Next prioritize remaining reader encoding coverage: DS5b Compresso pure-Rust decoder, native C++ fixtures only (local583-line compresso.hpp), then remaining DS4 services/routes and DS5/DS6. Full goal active.


## Historical Claude continuation — 2026-10-11 19:30 local

User assigned the datastore conversion to the Claude Code session; Codex made no datastore edits after 17:49 and no datastore build was running. Claude now owns `backend-rust/datastore/**`, `tools/datastore_route_inventory.py` and the datastore checkpoints. Main-app source stays untouched apart from the generated status pointer in `tools/route_inventory.py`.

Baseline before this batch: 238 passed; only `write_blosc_outputs_for_java_oracle` fails without `WK_DS2_ORACLE_DIR` (manual oracle, expected). Latest datastore registrations 12/132.

### Remaining 120 routes, classified by what they need

| Batch | Routes | Needs | Status |
| --- | ---: | --- | --- |
| B1 DataProxyController | 4 | vault paths, ByteRange, DatasetCache (all exist) | DONE |
| B2 findData + histogram | 2 | FindDataService over BinaryDataService | DONE |
| B3 Zarr streaming, datasets (`/zarr`, `/zarr3`, `/zarr3_experimental`) | 32 | .zarray/.zattrs/zarr.json/NGFF generation, directory HTML, cube reads via BinaryDataService | DONE |
| B4 DataSourceController misc + Exports + DSAiModel | 8 | getOneBaseDirForOrgaAbsolute, measureUsedStorage, deleteOnDisk, deletePaths, validatePaths, writeMirrors, exports download, effectiveVoxelSize | DONE |
| B5 JSON mappings | 2 (+mapping application) | MappingService (JSON mapping files), listMappings, mappingJson | DONE (routes; JSON mapping application lands with adHocMesh) |
| B6 Zarr streaming, annotation private links | 32 | WK annotation-source RPC + tracingstore volume proxy | DONE |
| B7 thumbnails | 2 | renderer, color maps, pure-Rust JPEG encoder, histogram (B2) | DONE |
| B8 uploads | 9 | resumable chunk store, Redis upload state, unpack/finish | DONE (managed-S3 signed streaming/multipart uploads verified) |
| B9 exploreRemote | 1 | explore module (2.1k Scala lines) | DONE (also used by finishUpload) |
| DS5 (HDF5-backed) | 26 | agglomerates 6, connectomes 5, meshes 4 + adHocMesh 1, segment index/statistics 11 (minus pure-geometry parts) — pure-Rust HDF5 subset first | queued |
| Legacy versioned overrides | n/a | DSLegacyApiController | DONE (DTO/native golden + HTTP verification) |

Order: B1 → B2 → B3 → B4 → B5, then B6–B9 and DS5. Each batch ends with focused router tests (mock WK), whole datastore suite, fmt, clippy and `python3 tools/datastore_route_inventory.py --check`.

2026-10-11 Claude B1–B3 DONE: DataProxy 4, findData/histogram 2, Zarr dataset streaming 32 → datastore 50/132. Whole datastore 262 passed (only the manual Blosc oracle needs WK_DS2_ORACLE_DIR); fmt/clippy/inventories clean. Evidence datastore-ds4-proxy-finddata-zarr.md. Next B4.

2026-10-11 Claude B4–B9 DONE → datastore 104/132. Remaining 28 routes are attachment/segment features (agglomerates 6, connectomes 5, meshes 4 + adHocMesh 1, segment index/statistics 11, plus listing endpoints) that need the DS5 HDF5 subset reader and Zarr3 attachment readers. Evidence in datastore-ds4-proxy-finddata-zarr.md.

2026-10-11 Claude DS5 agglomerates (Zarr3) DONE → 111/132; HDF5 agglomerates 501 pending DS5a. Evidence datastore-ds5-agglomerates.md. Next: Zarr3 variants of meshes/segment index/connectomes/statistics where Scala has them, then DS5a HDF5 subset reader.


2026-10-11 USER PRIORITY CHANGE: finish datastore, focus segmentIndex FIRST. User confirmed Claude is stopped; Codex owns segmentIndex/HDF5. Preserve existing Claude B1–B9/DS5 additions. Current source includes Zarr3 SegmentIndexService +3 routes; HDF5 still501. First port the pure-Rust HDF5 subset required for segment-index attributes/uint64 offsets+hash rows/uint16 positions, verify real2.1MiB l4_sample fixture and generated variants, wire cache/invalidation/HTTP. Then remaining segment statistics/datastore features and DS6. Compresso source written/checks but has no fixtures or integration yet; deferred per priority, datastore-ds5-compresso.md.

2026-10-11 Codex segment-index milestone DONE: local HDF5 attachment reader integrated (pinned pure-Rust hdf5-reader0.9.1, no native HDF5 runtime), verified against real l4_sample h5py oracle plus contiguous/old+new chunk-index/gzip/shuffle/checksum/big-endian variants. HDF5/Zarr table bounds, typed cache keys, actual changed-byte reload and nonpositive request geometry rejection covered. Whole datastore **331 passed, 0 failed, 0 ignored**, fmt/all-target clippy/inventories clean; log /tmp/webknossos-rust-ds-segment-index-tests.log. Registration count remains114/132; HDF5 segment-index routes now read data instead of501. Next remaining segment statistics with statistics-file metrics and BinaryDataService bucket scanning; HDF5 agglomerates/meshes/connectomes and DS6 still pending. Details datastore-ds5-segment-index.md.

2026-10-11 Codex segment-statistics milestone DONE: seven more routes (file info, volume, bounding box, covariance, max distance, center of mass, sphericity), Zarr3 metric/dense-id/attribute readers and index-based binary bucket scanners, exact remapping math and all caches joined to reload. Real JNI count/bounds and actual compiled Scala math/JSON goldens replay independently; actual HTTP cache invalidation verifies changed bytes. Whole datastore **340 passed, 0 failed, 0 ignored**, fmt/all-target clippy/inventories clean; /tmp/webknossos-rust-ds-segment-statistics-tests.log. Registrations121/132, surface-area route still pending its full-mesh fallback. Next HDF5 agglomerate integration, then meshes/surface area/connectomes and remaining codec/storage/DS6 gaps. Evidence datastore-ds5-segment-statistics.md; full goal remains active.

2026-10-11 Codex HDF5 agglomerate milestone DONE: real/generated mixed-width/filtered files, numeric conversion oracle, configured handle+ID block LRU and cumsum range selection; graphs/trees/positions/segments/largest-ID and actual binary-data mappings integrated. Mapped index/statistics requests now work with HDF5; typed Zarr cache identities and changed-byte invalidation repaired. Whole datastore **348 passed, 0 failed, 0 ignored**, fmt/all-target clippy/inventories clean; /tmp/webknossos-rust-ds-hdf5-agglomerates-tests.log. Registration count remains121/132; fills unsupported format branch of existing7 agglomerate routes. Next meshes/surface-area full fallback, connectomes5, codecs/managed-S3/legacy and DS6. Evidence datastore-ds5-hdf5-agglomerates.md. Runtime pure Rust; native HDF5 used only to generate checked-in numeric goldens. Full goal active.

2026-10-11 Codex mesh-file milestone DONE:3 routes across HDF5/Zarr3/sharded precomputed (metadata and opaque fragment reads), exact compiled Scala manifest/float transform/JSON and real HDF5 byte oracles, gzip/unsigned IDs, remapping, remote token-after-cache, native zero-size bounds and HTTP reload. Whole datastore **358 passed, zero failures/ignored**, fmt/all-target clippy/inventories clean; /tmp/webknossos-rust-ds-mesh-files-tests.log. Registration coverage124/132; fullMesh.stl, adHocMesh, surfaceArea and connectomes5 remain. Next pure-Rust Draco/full/ad-hoc geometry plus surface-area fallback; draco-core candidate source audited but not adopted/verified. See datastore-ds5-mesh-files.md. Compresso/managed-S3/legacy/DS6 remain; full goal active.


2026-10-11 Codex full/ad-hoc mesh milestone DONE: pure-Rust draco-core2.3.2 decode→STL, exact JNI/Scala geometry/area/mapping goldens (all256 cube configurations), all8 integer storage types, JSON/HDF5/Zarr mappings, index/BFS full-mesh orchestration, statistics-file/mesh surface fallback, caches/current-token/auth/timeout/reload. Three routes complete; registrations127/132. Whole datastore375 tests passed, zero failures/ignored, fmt/all-target clippy/inventories clean; /tmp/webknossos-rust-ds-full-mesh-final-tests.log. Deliberate bounded-background traversal fix and preserved Scala normal/transform/addressing quirks recorded in datastore-ds5-draco-full-mesh.md. Next connectomes5 (source inspection recorded), then Compresso/native oracles, managed-S3/legacy and DS6. Full goal active.


2026-10-12 Codex connectomes DONE: last5 latest routes, HDF5/Zarr3 CSR/CSC synapses, positions, unsigned partners and legends; exact actual compiled Scala service/Set/JSON/numeric/boundary goldens, caches/reload/current-token/auth verified. Direct JHDF5 callback replay also corrected dataset unsigned and integer→Float32 conversion behavior in the shared HDF5 adapter. Whole datastore384 tests passed, zero failures/ignored, fmt/all-target clippy/inventories clean; /tmp/webknossos-rust-ds-connectomes-tests.log. Latest registrations132/132; Compresso, managed-S3/legacy and DS6 still open. Details/restart datastore-ds5-connectomes.md. Full goal active; no cutover/parity claim.

2026-10-12 Codex Compresso milestone DONE (user reconfirmed Claude stopped/Codex owns datastore): pure-Rust decoder integrated into precomputed plain and raw/gzip sharded reads. Independent compresso3.2.2 encoder → repository C++ decoder → Rust matched1,848 valid cases;324 checked-in cases,18 actual JNI error/literal goldens and12 offset/ragged/missing/sharded volumes. Headers must match metadata shape/label width; exact JNI error prefix and zero-output precedence preserved. Actual authenticated router/current-token/cache/reload/denial and malformed bounds verified. Whole datastore **393 passed,0failed,0ignored**, fmt/all-target clippy/inventories clean; log /tmp/webknossos-rust-ds-compresso-tests.log. Registrations132/132; durable evidence datastore-ds5-compresso.md. Next managed-S3/legacy/regional short-S3 rewrite and DS6; conversion remains unfinished.

2026-10-12 Codex managed-S3 milestone DONE: directory transfers with matching global credentials, signed streamed PUT/multipart, bounded memory, 10-attempt transient/regional retries, embedded HTTP-200 errors and failed/cancelled multipart aborts. Dataset/mag/attachment finish routes report adapted remote paths only after successful transfers; conversion stays local, denials have no storage effects, failures retain staged data. Native pinned AWS SDK signing goldens match. Whole datastore **406 passed, 0 failed, 0 ignored**, fmt/clippy/inventories clean; log /tmp/webknossos-rust-ds-managed-s3-tests.log. Evidence datastore-ds4-managed-s3.md. Next legacy/version overrides, regional short-S3 rewrite, zip vaults and DS6; migration unfinished.

2026-10-12 Codex legacy milestone DONE: all versioned overrides plus unversioned old chunk routes; exact compiled Scala DTO/default/error cases, safe-ID envelope downgrade, linked-layer resolution/authorization, manual reservation without Redis, finish body/response adaptation and version boundaries. Whole datastore **414 passed, 0 failed, 0 ignored**, fmt/clippy/inventories clean; `/tmp/webknossos-rust-ds-legacy-tests.log`; restart datastore-ds4-legacy.md. Latest132/132 unchanged; next regional short-S3 rewrite, zip vaults and DS6.

2026-10-12 Codex short-S3 exploration rewrite DONE: HeadBucket region response (including denied response headers), explicit credential/environment behavior, global fallback on missing/error lookup, raw URI and zip outer-path rewriting match actual Scala helper goldens; authenticated exploreRemote returns rewritten paths and denied requests never reach storage. Whole datastore **416 passed,0failed,0ignored**, fmt/clippy/inventories clean; `/tmp/webknossos-rust-ds-s3-uri-final-tests.log`; datastore-ds1-s3-rewrite.md. Next zip vaults and DS6.
