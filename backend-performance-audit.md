# WEBKNOSSOS Backend — Performance & Memory Audit

Scope: Scala backend (`app/`, `webknossos-datastore/`, `webknossos-tracingstore/`, `util/`) and SQL schema. Findings from five parallel deep-dive audits: **SQL/DAO**, **image-data loading**, **annotation update actions**, **download/duplication**, and **cross-cutting concurrency/memory**. Top items were spot-verified against the working tree (branch `fix-no-overlap-chunk-loading`); file:line references are accurate. No code was changed.

---

## The 5 highest-leverage problems

These dominate everything else — worth fixing first.

### 1. Dashboard annotation lists fire ~10,000–15,000 queries per request
`app/models/annotation/AnnotationService.scala:761` (`publicWrites`) is called inside `Fox.serialCombined` over up to 1000 annotations (`app/controllers/UserController.scala:127,190`; `app/controllers/AnnotationController.scala:374`). Each call issues ~12–15 queries (dataset, org, task, taskType, dataStore, tracingStore, contributors, teams…), many identical across the list. The default page size is `DefaultAnnotationListLimit = 1000` (`AnnotationService.scala:106`).

**Fix:** the Explorational tab already solved this with a single-query compact writer (`findAllListableExplorationals` + `writeCompactInfo`, `Annotation.scala:408` / `AnnotationService.scala:876`). Apply the same batching to the Task tab: fetch datasets/tasks/taskTypes/users by `WHERE _id IN (...)` once, and hoist the constant `tracingStore`/`dataStore` lookups out of the loop.

### 2. Every volume brush/erase forces a full annotation re-materialization
`webknossos-tracingstore/.../AnnotationTransactionService.scala:277` calls `findVolume(…, version=None)`, which runs the *entire* lazy-materialization pipeline (`TSAnnotationService.getWithTracings:89-114`): load all tracings, replay pending updates, re-flush protos — just to read a few header fields (mags, elementClass, hasSegmentIndex, fallbackLayer). This is the highest-frequency write in the product, turned from O(bucket-bytes) into O(whole-annotation).

**Fix:** fetch only the committed volume header at the base version without triggering full `applyPendingUpdates`/flush; apply bucket mutations against the last materialized volume tracing directly.

### 3. Compound download holds every annotation's full volume data in heap at once
`app/models/annotation/AnnotationService.scala:645-693` (`getVolumeDataObjects`) builds `List[Option[Array[Byte]]]` where each array is an entire volume zip, and materializes the whole `List[List[DownloadAnnotation]]` before zipping starts. A project/task-type download of hundreds of volume annotations = guaranteed OOM vector. Compounded by:
- `app/models/annotation/WKRemoteTracingStoreClient.scala:343-352` re-buffering each zip in memory via `.getWithBytesResponse`, then handing another full copy to the zipper (`AnnotationIOController.scala:568`).
- `util/src/main/scala/com/scalableminds/util/io/ZipIO.scala:31-41` reading whole files via `Files.readAllBytes`.

**Fix:** stream annotation-by-annotation to the output zip (fetch tracing + data to a temp file, write entry, release), instead of pre-collecting all `Array[Byte]`.

### 4. Missing index on `user_team_roles(_team)`
`schema/schema.sql:474` has only `PRIMARY KEY (_user, _team)`, which cannot serve `_team`-only predicates. `_team` is the join/filter key in nearly every access-control check (dataset `readAccessQ` `Dataset.scala:221`, folder `rawAccessQ` `Folder.scala:194,241`, annotation delete access, `User.scala:125,178,365,591`). **Verified: no such index exists.**

**Fix:** `CREATE INDEX ON webknossos.user_team_roles(_team);` — one line, touches every permission check. Same reverse-join gap on:
- `folder_paths(_descendant)` (`schema.sql:673`, PK `(_ancestor, _descendant)`)
- `dataset_allowedTeams(_team)` (`schema.sql:198`)
- `folder_allowedTeams(_team)` (`schema.sql:680`)
- `annotation_sharedTeams(_team)` (`schema.sql:66`)

### 5. Image decode/decompress/copy runs on Play's request dispatcher
`webknossos-datastore/.../datareaders/ChunkReader.scala:55`, `Compressor.scala` (Blosc/zstd/gzip/jpeg), `MultiArrayUtils.copyRange` all chain CPU-bound work onto the injected default `ec` (`BinaryDataServiceHolder.scala:24`), which is the same pool serving HTTP. A burst of concurrent bucket requests floods it → tail-latency spikes across the whole datastore.

**Fix:** run decompression + typing + copy on a dedicated bounded `ExecutionContext` (fixed size ≈ #cores), separate from Play's default dispatcher.

---

## Confirmed memory leaks / correctness-under-concurrency

| # | Location | Problem | Fix |
|---|----------|---------|-----|
| M1 | `webknossos-datastore/.../storage/S3ClientPool.scala:32-37` | Both `AlfuCache` pools lack `onRemovalFn`, so evicted `S3AsyncClient`s (each owning a Netty event-loop group + 64-connection pool) leak threads/sockets/off-heap memory. **Verified.** | Add `onRemovalFn = Some((_, box) => box.foreach(_.close()))` — pattern already used in `ManagedS3Service.scala:34`. |
| M2 | `app/models/user/time/TimeSpanService.scala:61,120` | Unsynchronized `mutable.HashMap` (`lastUserActivities`) mutated per-request on an eager singleton → lost updates + HashMap corruption/spin under concurrent resize; also unbounded. **Verified.** | `ConcurrentHashMap` / `AlfuCache` with atomic compute. |
| M3 | `webknossos-datastore/.../services/mesh/AdHocMeshService.scala:56` | `Await.result` inside `AdHocMeshActor` (RoundRobinPool of 8) on the shared default dispatcher, blocking up to 30s per thread. **Verified.** | `pipeTo sender()` or a dedicated blocking dispatcher. |
| M4 | `webknossos-tracingstore/.../files/TempFileService.scala:25` | Plain `mutable.Set` mutated by request threads and the cleanup job, which removes elements *while iterating* → `ConcurrentModificationException` + temp-file disk leak. | Concurrent collection; snapshot before iterating. |
| M5 | `webknossos-datastore/.../storage/RedisTemporaryStore.scala:93,101,113` | `KEYS` command (O(N) full-keyspace scan, blocks single-threaded Redis) used for lookups on the uncommitted-updates path (`AnnotationTransactionService.scala:136,140`). | `SCAN` (cursor-based) or explicit index sets. |
| M6 | `webknossos-datastore/.../storage/TemporaryStore.scala:12` | Coarse global `synchronized` on every get/insert + unbounded map. | `ConcurrentHashMap` / bounded cache. |
| M7 | `app/models/analytics/AnalyticsService.scala:130` | `sessionIdStore` never evicted (slow leak, bounded by user count). | `AlfuCache` with TTL. |
| M8 | `webknossos-datastore/.../services/DatasetErrorLoggingService.scala:30,42` | `recentErrors` mutable map written concurrently from bucket-loading error paths (can corrupt, not just miscount). | `ConcurrentHashMap`/atomic counters. |
| M9 | `util/.../cache/LRUConcurrentCache.scala:53-54,72-73` | `size()` and no-arg `clear()` bypass the `cache.synchronized` guard used everywhere else. | Guard them too. |

---

## SQL / DAO (beyond #1 and #4)

### High
- **`webknossos.jobs` has no secondary indexes** — `Job.reserveNextJob` (`app/models/job/Job.scala:349`) does a seq-scan+sort at `Serializable` with 50 retries; every worker polls continuously. Same unindexed columns in `countUnassignedPendingForDataStore`, `countUnfinishedByWorker`. **Fix:** `CREATE INDEX ON webknossos.jobs (_dataStore, command, created) WHERE state='PENDING' AND manualState IS NULL AND _worker IS NULL;` + `CREATE INDEX ON webknossos.jobs(_worker);`
- **Dataset search = unanchored substring scan** — `app/models/dataset/Dataset.scala:438` uses `POSITION(token IN LOWER(name)) > 0` (≡ `LIKE '%…%'`), full-scanning `datasets_` on every keystroke of dashboard search. **Fix:** `pg_trgm` GIN index + rewrite to `LOWER(name) LIKE '%'||token||'%'`.
- **`credit_transactions._paid_job` unindexed + per-row LATERAL** in job listing (`app/models/job/Job.scala:175`). **Fix:** `CREATE INDEX ON webknossos.credit_transactions(_paid_job);` and `(_organization)`.
- **N+1 bulk task creation** — `app/models/task/TaskCreationService.scala:577` re-resolves the same project/script/team-manager check per task (up to 1000) plus single-row inserts. **Fix:** resolve distinct project/script/team checks once into a `Map`; batched `insertMany`.

### Medium
- **`findAllCompactWithFilters` aggregates the entire users table before filtering** — `app/models/user/User.scala:279`, no LIMIT; cost scales with installation size, not requesting org.
- **`getArtifactChecksums` full-scans an unbounded events table** — `app/models/voxelytics/VoxelyticsDAO.scala:794`, `SELECT DISTINCT ON(...) *` with no `WHERE`.
- **`Job.findAllCompact` unbounded + unindexable JSONB predicate** — `app/models/job/Job.scala:166`.
- **`TaskTypeInformationHandler` N+1 over all tasks of a task type** — `app/models/annotation/handler/TaskTypeInformationHandler.scala:37`. **Fix:** single `WHERE _task IN (...)`.
- **`TimeSpanService.flushToDb` N+1 inserts + per-row lookups** — `app/models/user/time/TimeSpanService.scala:190`.
- **`ORDER BY RANDOM()` full-sort in task assignment** — `app/models/task/Task.scala:220`.

### Lower
- Unbounded `findAll` variants + missing `projects(created)` index — `Task.scala:83`, `User.scala:148`, `Project.scala:69`.
- Voxelytics lookups by non-leading PK column — `VoxelyticsDAO.scala:224,372` (`hash` / `workflow_hash`).
- Annotation `readAccessQWithPrefix` (`Annotation.scala:270`) uses correlated per-row `users_` subqueries — fine for `findOne`, costly on list scans.

---

## Image-data hot path (beyond #5)

- **Typed-chunk decoding uses `MemoryCacheImageInputStream` per chunk** — `ChunkTyper.scala:66-135`: an 8KB-block caching stream over data already fully in memory, on every 16/32/64-bit chunk (all segmentation). **Fix:** `ByteBuffer.wrap(bytes).order(...).asIntBuffer().get(typedStorage)`.
- **C-order arrays always take the slow partial-copy branch** — `DatasetArray.scala:305-318`: the zero-copy shortcut requires F-order, but Zarr/Zarr3/N5/precomputed default to C-order, so even aligned single-chunk reads pay full typing + per-voxel `copyRange` + byte re-encode. **Fix:** add a C-order aligned fast path.
- **Per-chunk cache key is a freshly interpolated long string** — `DatasetArray.scala:251-262`: allocation + `mkString` + long-string hashing on the hottest lookup in the system. **Fix:** case-class key or precomputed prefix.
- **`copyRange` copies voxel-by-voxel via ucar `IndexIterator`** — `MultiArrayUtils.scala:104-168`: ~32K virtual calls per bucket. **Fix:** row-wise `System.arraycopy` on contiguous inner runs.
- **`BytesConverter` re-serializes every typed chunk back to bytes** — `datareaders/BytesConverter.scala:11-49` (called from `DatasetArray.readBytes:129`): extra full-size buffer alloc+copy to undo the typing.
- **`FileSystemDataVault` allocates a direct ByteBuffer + opens a new channel per read** — `datavault/FileSystemDataVault.scala:56-93`.
- **Precomputed chunk lookup linear-scans the minishard index** — `NeuroglancerPrecomputedShardingUtils.scala:131-140`: O(n) per chunk. **Fix:** cache as `Map[Long, (Long,Long)]`.
- **Serial where should be parallel:** `BucketProvider.loadMultiple` (`BucketProvider.scala:13-18`, `Fox.serialSequence`); multi-bucket conversions (`BinaryDataService.scala:98`).
- **Cheap allocation fixes:** `Array.fill(...)(0)` → `new Array` (`BinaryDataService.scala:138`); JPEG triple-copy (`Compressor.scala:305-314`); O(n²) `concatenateBuckets` (`FindDataService.scala:59-62`); element-wise boxing in `DataConverter.toBytes` (`DataConverter.scala:53-83`).

---

## Annotation write path & download (beyond #2, #3)

- **N+1 serial FossilDB gets for skeleton tree bodies** during materialization — `TSAnnotationService.scala:790-807`. **Fix:** batch via `getMultipleKeysByList`.
- **Per-group flush + remote WK HTTP call when catching up K pending updates** — `TSAnnotationService.scala:636-716`: K full-proto writes + K network round-trips instead of one at the target version.
- **Blocking WK round-trip before every commit** — `AnnotationTransactionService.scala:222-223`, for what is a statistics/timestamp report. **Fix:** async / batch it.
- **Segment-index removals do per-segment (N+1) lookups** — `VolumeSegmentIndexService.scala:91-94` (additions path already batches). **Fix:** batch via `getMultiple`.
- **`applyImmediatelyIfNeeded` re-materializes on the write path** — `AnnotationTransactionService.scala:240-249` (second full replay on save latency).
- **Serial per-bucket work in duplication/merge** — `VolumeTracingService.scala:700,1060-1077`, including `loadBucket` per bucket instead of batched `loadBuckets` (`VolumeTracingBucketHelper.scala:186`), and N+1 segment-index fetches.
- **Stream/file-handle leaks on download error paths** — `AnnotationIOController.scala:510-513,566-580`; `AnnotationService.createZip`; `ZipIO.zip:79-104`. Closes only on the success branch. **Fix:** `try/finally` / Fox bracket.
- **A new `ActorSystem()` created inside the download controller** — `AnnotationIOController.scala:85` instead of injecting the app's.
- **`NmlWriter` copies/dedupes all skeleton nodes in memory** — `NmlWriter.scala:389` (`nodes.toSet`). **Fix:** dedup with a seen-set of IDs.

---

## Blocking calls & systemic patterns

- **Synchronous gRPC on the async EC** — `FossilDBClient.scala:164` (`blockingStub.getMultipleKeys`), driven from iterator `next()` during large annotation/volume exports (`VolumeTracingBucketHelper.scala:453`, `VersionedFossilDbIterator.scala:23`, `EditableMappingStreams.scala:30,87`). Risk: thread starvation during exports.
- **`Thread.sleep` in the SQL retry loop** — `app/utils/sql/SimpleSQLDAO.scala:41`, called with `retryCount=50` → up to ~1s of pure sleep on the Slick EC under write contention. **Fix:** `pekko.after(...)`.
- **`Thread.sleep` in storage-scan job** — `app/models/storage/UsedStorageService.scala:101`.
- **`Fox.combined` / `Fox.sequence` = unbounded fan-out** — `util/.../tools/Fox.scala:75-81` wraps `Future.sequence` with no bound; ~277 call sites, some fanning over chunk indices/mags/segments (`DatasetArray.scala:181,220`). `Fox.batchCombined(seq, parallelity)` (line 103) already exists as the bounded alternative. **Policy decision:** route large/unbounded collections through it for backpressure.
- **WS client timeouts set to 2 hours** — `webknossos-datastore/conf/standalone-datastore.conf:32-34`: a hung remote can hold a connection (and awaiting thread) for 2h.
- **Regex compiled per-call in NML parsing** — `app/models/annotation/nml/NmlParser.scala:295,610`, recompiled for every element of large NMLs. **Fix:** hoist to `private val`.

---

## Suggested sequencing

**Near-zero-risk one-liners (land immediately):**
- Indexes: `user_team_roles(_team)`, `folder_paths(_descendant)`, jobs partial index + `jobs(_worker)`, `credit_transactions(_paid_job, _organization)`, allowedTeams/sharedTeams reverse indexes.
- `S3ClientPool` `onRemovalFn` (M1); `TimeSpanService` → `ConcurrentHashMap` (M2); `Array.fill`→`new Array`; hoist NML regexes.

**Structural (real latency/memory wins, need design care):**
- #1 batched Task-tab writer; #2 avoid full materialization on bucket writes; #3 streaming compound download; #5 dedicated decode pool + C-order fast path (#5 cluster with image-data items).

---

## Already well-optimized (verified, no action)

- `AlfuCache` (Caffeine) is bounded with weight/TTL/eviction; the chunk cache (`ChunkCacheService.scala`) is byte-weighted.
- Bucket data & segment-index writes are batched (`VolumeBucketBuffer`/`VolumeSegmentIndexBuffer` + `putMultiple`, prefetch via `getMultipleKeysByList`); one version increment per group.
- `EditableMappingUpdater` buffers writes, flushes once per group.
- `Hdf5FileCache`/`AgglomerateFileCache` ref-count and close native readers on eviction.
- `ManagedS3Service` transfer-manager cache closes on removal (the correct pattern M1 is missing).
- Compact list paths (`findAllListableExplorationals`, `findAllCompactWithSearch`) are single well-structured queries — the template to apply to finding #1.
