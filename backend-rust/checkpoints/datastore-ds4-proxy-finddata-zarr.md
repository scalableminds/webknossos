# DS4 checkpoint — DataProxy, findData/histogram, Zarr streaming (datasets)

Claude Code, 2026-10-11 evening. Batches B1–B3 of datastore-plan.md "Claude continuation".

## Implemented (36 new registrations, datastore total 50/132)

- B1 `src/controllers/data_proxy.rs`: `proxy/layers/:layer/mags/:mag/*path`, `mags/info`, `attachments/:type/:name/*path`, `proxy/datasource-properties.json`.
  - `*path` is taken from the raw (undecoded) request path like Play; `validatePath` checks `..`, leading `/`, lowercase `%2e%2e` and `%2f` only (as Scala).
  - Range header via existing `ByteRange::from_range_header`; 206 for ranges, `Accept-Ranges: bytes`, `Content-Encoding` passthrough, `Content-Range` from the vault. No remote-origin headers (controller default).
  - `mags/info` drops scales without a matching mag basename and rekeys with `toMagLiteral(allowScalar = true)` (`1-1-1` → `1`).
  - Adapted datasource paths are relative `LocalUPath`s → `./layers/<l>/mags/<mag>` (Scala `toString` adds `./`).
- B2 `src/services/find_data.rs` + `findData`/`histogram` in `controllers/binary_data.rs`: `createPositions` (wrapping Int arithmetic, aligned, first-occurrence distinct), first non-zero voxel x-fastest (offset added unscaled, as Scala), mags sorted by maxDim; histograms with Scala bin functions, uint24 per-channel (unfiltered, bin 0 cleared), float bins in f32 (Java oracle: max value lands in bin 254 for range 1..3), double → MatchError failure. Play renders whole doubles as integers (`play_f64`).
- B3 `src/services/zarr_streaming.rs` + `src/controllers/zarr_streaming.rs`: all 32 dataset routes under `/zarr`, `/zarr3`, `/zarr3_experimental` (directory HTML, `.zgroup`, `.zattrs`, layer/mag `zarr.json`, `.zarray`, datasource-properties.json, raw cubes).
  - Controller `defaultErrorCode = NOT_FOUND`: route-layer middleware maps 400 → 404, except when the `datasetId` segment fails ObjectId binding (Play binder error stays 400).
  - Raw cube: missing layer 503, coordinate/mag errors 404, any missing/failed bucket 500 `Failed to load zarr chunk for streaming.`
  - JSON is rendered through `PlayValue` (whole doubles without `.0`), which the pre-existing NGFF structs did not do on their own.
  - Twirl `datastoreZarrDatasourceDir` reproduced including whitespace of the `map` block and the stripped `@* *@` comment line.

## Tests

`tests/data_proxy_routes.rs` (6), `tests/find_data_routes.rs` (4), `tests/zarr_streaming_routes.rs` (5), unit tests in data_proxy (2), find_data (4), zarr_streaming (3). Whole datastore: 262 passed; only `write_blosc_outputs_for_java_oracle` fails without `WK_DS2_ORACLE_DIR` (manual oracle, same as baseline). Log /tmp/webknossos-rust-ds-b1-b3-tests.log. fmt/clippy (all targets, -D warnings) clean; both inventories `--check` clean.

## Known gaps

- Annotation private-link Zarr routes (32) need `getAnnotationSource` RPC + tracingstore client (B6).
- Raw cubes with `appliedAgglomerate` are not requested by these routes; agglomerate mapping remains pending (DS5).
- No differential replay against the Scala datastore yet (DS6).

## B4 addendum — maintenance routes, exports, AI model (8 registrations → 58/132)

- `src/services/dataset_files.rs`: `move_to_trash` (`<root>/../.trash/<dir>`, ` (n)` dedup up to 15, existing targets never replaced), Commons-IO-style `delete_directory_recursively` (symlinks unlinked, regular files refused), `delete_local_paths_from_disk` (only inside configured local base dirs; all attempted, first failure returned), `measure_storage_for_paths` (absolute local or managed S3; unparsable path fails the request; per-path failures logged and dropped), `write_mirror` (`.mirror/<dir>` via `<dir>.new`, symlinked mags/attachments, properties = regular JSON minus `resolutions`, readme).
- DataSourceController: `getOneBaseDirForOrgaAbsolute`, `measureUsedStorage/:org`, `:id/deleteOnDisk?rootPath`, `deletePaths` (returns managed-S3 paths), `validatePaths`, `writeMirrors?failOnError` (disabled config answers `[]` before access check; results as `[id, path]` tuples).
- `src/controllers/exports.rs`: `exports/:jobId/download` streams the file with Play `Content-Disposition` encoding (ASCII `?` fallback + RFC 5987 `filename*`); MIME table limited to export formats (zip/tiff/json/txt/png/jpeg/gzip/tar, else octet-stream) — deliberate subset of Play's MimeTypes. `aiModels/effectiveVoxelSize` reads `model/statistics.json` `scale`.
- Tests: `tests/maintenance_routes.rs` (7) + unit tests (3).

## B5/B6 addendum (34 registrations → 92/132)

- B5 `src/services/mapping.rs`: `mappings` lists `<localRoot>/<layer>/mappings/*.json` (virtual datasets without local root → `[]`); sorted, whereas Scala returns an unordered `Set` (deliberate). `mappings/:name` returns the raw file bytes; names containing `/` or `\` are refused (Play decodes `%2F`; Scala would traverse — deliberate hardening). Parsing/applying JSON mappings is deferred to the ad-hoc mesh consumer.
- B6 private links: `src/models/annotation.rs` (`AnnotationSource`), `src/tracingstore_client.rs` (Scala `DSRemoteTracingstoreClient` Zarr methods), 32 `/annotations/{zarr,zarr3,zarr3_experimental}/:accessTokenOrId/…` routes. Volume annotation layers go to the tracingstore with the private-link token when `accessViaPrivateLink`, else the caller's token; other layers reuse the dataset handlers **without** a dataset access check (as Scala). Tracingstore JSON is passed through `PlayValue`; `.zarray` and `zarrSource` layers are parsed and re-written like Scala; `zarr.json`, `.zattrs`, `.zgroup` are passed through as JSON (Scala's typed re-write would drop unknown fields — accepted, both sides are WEBKNOSSOS services).
- The 404-default middleware treats `/annotations/…` as binder-free (private-link ids are Strings).
- Tests: `tests/mapping_routes.rs` (2), `tests/zarr_private_link_routes.rs` (4), unit test in mapping (1).

## B7 addendum — thumbnails (2 registrations → 94/132)

- `src/services/thumbnail.rs` ports `DSThumbnailService` + `ImageCreator`: intensity normalisation (Java `Math.round`, IEEE clamp), colour/invert, uint24 RGB, segment colours (frontend jet permutation with float32 rounding — 12-id Java oracle table pinned in tests), opacity/alpha, nearest-neighbour resize, Additive/Cover/CoverWithBlackAsTransparent blending, segmentation SrcOver.
- JPEG: `jpeg-encoder` 0.7.1 (pure Rust, new datastore dependency) at quality 100, 4:2:0, standard Huffman tables like ImageIO quality 1.0; bytes differ from ImageIO (DCT/colour rounding), decoded pixels within ±4 in tests. Images with alpha are refused like ImageIO ("Bogus input colorspace").
- `src/controllers/thumbnails.rs`: `layerThumbnail` (query binders incl. `Option[Double]` messages), `datasetThumbnail` (JSON body, per-layer dimension validation, serial layer rendering). Requested agglomerate mappings on segmentation layers answer 501 until the DS5 mapper exists (Scala would render mapped data; rendering the zero fallback would be fake output).
- Tests: `tests/thumbnail_routes.rs` (3), unit tests (7).

## B8a addendum — uploads without finish (8 registrations → 102/132)

- `src/redis_store.rs`: RESP client (one lazily reconnected connection, 1 s connect / 60 s command timeout) for GET/SET/SETEX/EXISTS/DEL/EXPIRE/TTL/SADD/SISMEMBER/SREM/SMEMBERS with Scala failure shapes (`Redis access exception on <authority>: …`, `Redis access failure`).
- `src/services/upload.rs`: `UploadMetadataStore` per domain with byte-identical Scala keys and JSON values (tests pin them), reservation, resumable chunk writes at `(n-1)*chunkSize` (only for new chunks; failed writes remove the chunk from the set), cancel, convert-job clean-up (`enforceContainedIn`), orphan clean-up 10 s after start (main.rs).
- `src/controllers/upload.rs`: reserve dataset/mag/attachment (raw body forwarded to WK, typed validation for Play-style errors), `GET/POST upload/:domain` (test/upload chunk; Play form errors `error.required`/`error.number`), `unfinishedUploads`, `cancelUpload`, `cleanUpUploadFiles`.
- Scala parity kept on purpose (worth fixing on both sides later): (1) `uploadIdByDataSourceId` is stored JSON-encoded but read raw, so `unfinishedUploads` never enriches entries and answers `[]`; (2) dataset clean-up leaves the `voxelSize` key until expiry; (3) `cancelUpload` ignores clean-up failures.
- Upload file paths are checked lexically for `..` escapes (Scala's `relativize` check is weaker for non-normalized paths).
- Tests: `tests/upload_routes.rs` (6, including a real `redis-server` smoke test when the binary is on PATH; skipped otherwise), in-process fake Redis `tests/fake_redis`.

## B8b addendum — finishUpload (1 registration → 103/132)

- `src/services/upload_finish.rs`: size/chunk checks, raw backup to `.trash/uploadBackup__<id>`, single-zip unzip (`zip` 9.0.1, STORED/DEFLATED only like Java `ZipFile`; hidden files and `__MACOSX` skipped except `.zarray`/`.zattrs`; common-prefix truncation at `color`/`segmentation` boundaries; zip-slip rejected) or common-root move, Redis/upload-dir clean-up, failure clean-up (trash next to the unpack dir + WK `deleteDataset`), type detection (Scala order), WKW layer/mag repair, explored datasource path validation, unreferenced-file deletion (including the properties file, like Scala), Commons-IO-style moves, report to WK. Mag/attachment uploads move to `<orga>/<dir>/<layer>/<mag>__<ObjectId>` / `<type>/Some(<name>)__<ObjectId>` (Scala interpolates the `Option` from `normalizeStrong` — kept for parity, flagged).
- Not yet supported, explicit 501 (wrapped in `Could not finalize upload …`): uploads that need exploration (Zarr/Zarr3/N5/precomputed without properties — B9 explore module) and organizations whose upload target is managed S3 (needs S3 PutObject).
- Tests: `tests/upload_finish_routes.rs` (5), unit tests (3).

## B9 addendum — explore (1 registration → 104/132)

- `src/explore.rs` ports the Scala explore package: WEBKNOSSOS Zarr datasource, OME-NGFF v0.4/v0.5 (omero channel view configs, labels, additional axes, translations, unit unification), Zarr v2/v3 arrays, N5 multiscales / compact multiscales / array, Neuroglancer precomputed (+ mesh attachment), Neuroglancer URIs (fragment decoding, nested sources); `adaptLayersAndVoxelSize` (power-of-two mags, unique-by-maxDim check, preferred voxel size + affine transformation), unique layer names; remote service (whitelist for local paths, credentials via `findCredential`, zip entry detection, all explorers per path with first success in explorer order, recursive search 10 children × 3 levels, `Empty` when nothing found) and `ExploreLocalLayerService` (used by `finishUpload` for Zarr/Zarr3/N5/precomputed uploads, including multi-layer uploads).
- `POST /datasets/exploreRemote` (report cleared for `file:` URIs, Scala report wording).
- Deviations: report lines are appended in explorer order (Scala appends as parallel futures complete); short-style `s3://bucket/key` URIs are not rewritten to the regional endpoint (`insertS3EndpointIfMissing`, needs bucket-region lookup) — they are explored with the vault's default endpoint handling.
- `Zarr3Header::for_exploration` added for metadata-only Zarr3 headers.
- Tests: `tests/explore_routes.rs` (4), unit tests (5), finish tests now cover NGFF uploads and failed exploration.
