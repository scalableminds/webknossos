# DS5 checkpoint — agglomerate files (Zarr3)

Claude Code, 2026-10-11. 7 registrations → datastore 111/132.

- Protobuf: the datastore crate now generates `SkeletonTracing`, `AgglomerateGraph`, `ListOfLong` from `webknossos-datastore/proto` (build.rs, prost 0.14 + protox 0.10 like the main crate; no `protoc`).
- `src/services/agglomerate.rs`: Scala `AgglomerateService` + `ZarrAgglomerateService` over Zarr3 attachment groups (cached `DatasetArray`s per file/array, `read_as_multi_array`), native bucket-scanner ports (`collectSegmentIds`, `applySegmentIdMapping`: unmapped → 0, little-endian truncation), tree (Scala node/skeleton defaults, 1-based node ids, `|toInt|` tree id, edge limits from config), graph (segment ids, local-index edges, float affinities), largest id (first dimension of the offsets array, as Scala), segment→agglomerate lookups (30 parallel, order kept), segment position (unsigned binary search).
- Registered as `BinaryDataService`'s agglomerate mapper: `mappingName`/`appliedAgglomerate` data requests are mapped for Zarr3 agglomerate files.
- `src/controllers/agglomerates.rs`: list, tree + skeleton, agglomerateGraph, largestAgglomerateId (UnsignedLong envelope), agglomeratesForSegments (protobuf in/out, `Invalid protobuf request body`), positionForSegment.
- HDF5 agglomerate files answer 501 (`HDF5 agglomerate files are not yet supported by the Rust datastore.`) until the DS5a HDF5 subset reader exists; thumbnails with an HDF5 mapping also answer 501 instead of rendering zeros. Missing agglomerate files keep Scala semantics (`Empty` → 404 on routes, failed bucket → zero thumbnail).
- Tests: `tests/agglomerate_routes.rs` (3, hand-built Zarr3 agglomerate fixture incl. mapped data read), unit test (1).
