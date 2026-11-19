# DS5 segment statistics — Codex continuation, 2026-10-11

## Status

Implemented and verified seven segment-statistics routes. Whole datastore **340 tests passed, zero failures/ignored**; fmt, all-target clippy and inventories clean. Latest registration coverage121/132; this is not full conversion/parity. User confirmed Claude is stopped and Codex owns segmentIndex/HDF5. Goal remains full datastore conversion.

## Done

- Added StatisticsFileService over dense Zarr3 metric tables: typed attachment cache identity, attributes/schema>=11, dense-id endpoints check, ordered metric discovery, finest-mag fallback, mag/mapping compatibility and local/remote batching. Integer/float dtype conversion follows ucar getters, and float metrics reject nonfinite JSON values.
- Added Scala-compatible volume rescaling, volume-weighted center and parallel-axis covariance combination. Unmapped statistics can be combined for agglomerates; a file computed for another mapping cannot be remapped. Center/covariance units remain mag1; only volume is rescaled.
- Added IndexStatisticsService: caches10000 each for volume/bounding box, oversegment expansion, distinct target-mag index buckets, real BinaryDataService requests and missing=0/failure=error behavior. Bounds scan the outside walls of the index-position box, as Scala does. Live bucket batches capped32; additionalCoordinates ignored per Scala#7556.
- Wired7 new authenticated routes (file info, volume, bounding box, center, covariance, max distance, sphericity) and all result/array/chunk caches into source/layer invalidation. Volume prefers compatible statistics files and falls back on any file failure; bounding boxes always use the index. Surface-area route remains pending the full-mesh fallback; no partial registration.

## Evidence

Nine focused tests pass: all seven actual routes, numerical-remapping, signed/unsigned scanner, malformed/missing file and changed-byte reload through the actual DELETE dataset cache endpoint. Unauthorized requests remain denied after warm cache hits; invalid body fields fail before RPC. Root attributes with absent mag use finest layer mag; empty mapping string means unmapped. Missing/corrupt/old-version/non-dense/incompatible statistics files fall back for volume while file-only metrics fail. Scala sources: SegmentStatisticsController.scala, SegmentStatisticsFileService.scala, SegmentStatisticsMath.scala, SegmentIndexFileService.scala, helpers/SegmentStatistics.scala and native bucketScanner.cpp.

Full datastore **340 passed, 0 failed, 0 ignored** with --locked --offline --no-fail-fast -- --include-ignored, WK_DS2_ORACLE_DIR=/tmp/wk-ds2-oracle-wkw; log /tmp/webknossos-rust-ds-segment-statistics-tests.log. fmt, all-target clippy -D warnings and both route inventories --check clean. No main-app/Scala source edits. Surface-area fallback and HDF5 agglomerate mapping remain required work, not parity claims.

Golden oracle tools: GenerateBucketScannerFixtures.java invokes native count/bounds entrypoints from the repository bucketScanner.cpp + jniutils.cpp (temporary dylib built with clang++/JDK JNI headers; no runtime native link). GenerateStatisticsMathFixtures.java calls the actual existing compiled Scala SegmentStatisticsMath$ methods; fractional center/covariance and Long overflow volume-rescale values match exactly. GenerateStatisticsInfoFixture.java calls the actual derived Play Json.format writer; absent mappingName must be omitted. Checked-in JSON fixtures under tests/fixtures/segment_index require no JNI/Scala/Python tooling to replay.

Regeneration: javac/java with datastore target/scala-3.8.4/classes plus target/streams/compile/dependencyClasspath/_global/streams/export as the classpath; oracle classes under /tmp/wk-statistics-oracle-classes. Scanner native build: clang++ -std=c++17 -shared -fPIC with JDK include and include/darwin and webknossos-jni/src/include, sources webknossos-jni/src/{bucketScanner,jniutils}.cpp, output /tmp/wk-statistics-bucket-scanner.dylib. Run fully qualified com.scalableminds.webknossos.datastore.helpers.GenerateBucketScannerFixtures with this absolute library path; redirect stdout to bucket_scanner_oracle.json. Run GenerateStatisticsMathFixtures and GenerateStatisticsInfoFixture to regenerate the respective math/info JSON fixtures.

## Next

HDF5 agglomerate integration next (already-registered seven agglomerate endpoints and actual data mapper currently reject HDF5). Existing AgglomerateService Zarr3 methods use an array abstraction; extend the HDF5 adapter for integer/float rows, variable matrix columns, root attrs and cached handles, verify real files plus native/JHDF5 fixtures, and repair attachment cache keys/chunk invalidation as for segment index. Then mesh-derived surface area and HDF5 mesh/connectome integrations, Compresso/Draco, managed-S3 and DS6 parity/cutover.
