# Full-stack dataset loading benchmark: Scala vs Rust (2026-11-05)

Measured on the `rust` branch at `02b48c93df`, on one macOS machine (Apple silicon, 32 GB). The load client ran on the same machine. Single session; contributes to DC2 in [datastore-cutover.md](datastore-cutover.md) (remote stores, cold/warm).

## Setup

| | Scala stack | Rust stack |
| --- | --- | --- |
| Main app | Play (`sbt stage`, JDK 21, `-Xmx4G`) | `webknossos-backend` release |
| Datastore | standalone Scala datastore (`-Xmx12G`) | `webknossos-datastore` release |
| Database | `pg_dump` copy of the dev DB `webknossos` | second copy, datastore URL pointing at the Rust datastore |
| Redis | own instance | own instance |

- Both datastores read the same `binaryData` folder (doScan off) and have the same 2 GB chunk cache (`imageArrayChunks.maxSizeBytes` / `WK_DS_CACHE_IMAGE_ARRAY_CHUNKS_MAX_SIZE_BYTES`).
- **One "dataset open"** replays what the viewer does on open:
  - `GET /api/datasets/:id` on the app;
  - the histogram of every color layer;
  - `POST .../layers/:layer/data` batches of 6 buckets (32³) covering the three orthogonal 512-voxel planes through the dataset centre, at the finest and the next coarser mag, centre first;
  - 6 requests in flight (the browser connection limit and the viewer's pull-queue batch size);
  - additional axes at their lower bound (t = 0).
  
  The datastore validates the token with its app, so every layer of the stack is exercised.
- **Cold:** both stacks freshly restarted, JIT/pools warmed on unrelated datasets, OS page cache of local data evicted with `vmtouch -e` before each side's pass. Remote sources are fetched once before round 1 so the CDN/S3 edge is equally warm for both sides. 3 rounds, side order alternating.
- **Warm:** each dataset's open repeated immediately after its own load, 5× per side, alternating, 2 rounds (n = 10). Cycling through all datasets between warm passes does not work: the combined working set exceeds the chunk caches and "warm" turns into mostly cold.
- **Correctness:** every response is hashed and compared across sides. All datasets are byte-identical, except the JPEG ones (`cosem`, `h01`), which are compared by status, length and bucket headers. Their decoders differ by at most 1 gray level (measured on 7.8 M voxels: 1.2 % differ by 1). There were zero mismatches, zero non-200 responses and zero failed buckets in every pass.
- **Bounding boxes:** h01, morgan2020 and FAFB are huge. Their layer bounding boxes were restricted to a central 2048×2048×256 box (chunk-aligned; 88–99 % non-zero voxels) so the histogram does not span the whole volume.

## Datasets

| Dataset | Storage | Format |
| --- | --- | --- |
| `l4_sample` | local | WKW, uint8 color + uint32 segmentation, 5 mags |
| `l4_sample_zarr3_sharded` | local | sharded Zarr3, same volume (mirror of static.webknossos.org) |
| `fibsem-uint16` | local | N5 uint16, 2 mags |
| `idr0101A-4d` | local | Zarr2, 4 channel layers, t axis, 1 mag |
| `l4_sample_remote` | HTTPS (static.webknossos.org) | sharded Zarr3, same volume as `l4_sample` |
| `cosem` | S3 (`janelia-cosem-datasets`) | precomputed, JPEG |
| `morgan2020_lgn_em_s3` | S3 (`bossdb-open-data/morgan2020/lgn/em`) | precomputed raw, 512×512×16 chunks |
| `idr0101A_13457227_https` | HTTPS (EBI) | Zarr2 OME 0.4, 4 channels, t axis, 2048² chunks; `@4-4-1` = only the mag of the local copy |
| `h01_4nm_raw_gcs` | GCS (`h01-release/.../4nm_raw`) | precomputed JPEG, sharded |
| `fafb_ffn1_segmentation_gcs` | GCS (`fafb-ffn1-20200412/segmentation`) | precomputed uint64 compressed_segmentation, sharded |

The three L4 variants return identical bytes, so they compare WKW, local Zarr3 and remote Zarr3 on the same data.

## Results

Wall time of one full dataset open, median (min–max). Ratio = Rust ÷ Scala, so below 1 means Rust is faster.

| Dataset | Cold Scala | Cold Rust | Cold ratio | Warm Scala | Warm Rust | Warm ratio |
| --- | --- | --- | --- | --- | --- | --- |
| `l4_sample` | 434 ms (399–501) | 141 ms (135–169) | 0.33 | 186 ms | 102 ms | 0.55 |
| `l4_sample_zarr3_sharded` | 282 ms (241–301) | 389 ms (378–443) | **1.38** | 139 ms | 95 ms | 0.68 |
| `fibsem-uint16` | 360 ms (345–424) | 140 ms (134–144) | 0.39 | 56 ms | 66 ms | **1.18** |
| `idr0101A-4d` | 628 ms (398–762) | 143 ms (132–146) | 0.23 | 228 ms | 114 ms | 0.50 |
| `l4_sample_remote` | 7.2 s (6.2–7.3) | 7.0 s (6.9–7.7) | 0.98 | 143 ms | 102 ms | 0.71 |
| `cosem` | 12.3 s (12.2–12.9) | 13.3 s (9.1–13.8) | 1.08 | 75 ms | 52 ms | 0.69 |
| `morgan2020_lgn_em_s3` | 24.6 s (20.1–25.1) | 24.9 s (23.9–25.5) | 1.01 | 51 ms | 37 ms | 0.72 |
| `idr0101A_13457227_https` | 77.9 s (15.5–118.6) | 15.9 s (15.8–16.3) | 0.20 | **13.4 s** (0.4–93) | 252 ms | 0.02 |
| `idr0101A_13457227_https@4-4-1` | 6.1 s (2.4–10.1) | 1.7 s (1.6–2.4) | 0.28 | 168 ms | 110 ms | 0.65 |
| `h01_4nm_raw_gcs` | **124 s** (108–129) | **11.9 s** (10.9–12.2) | **0.10** | 53 ms | 44 ms | 0.83 |
| `fafb_ffn1_segmentation_gcs` | **53.3 s** (48.0–55.8) | **7.3 s** (6.3–8.5) | **0.14** | **15.6 s** (0.1–34) | 76 ms | 0.005 |

Peak datastore RSS: Rust 0.4–3.5 GB; the Scala JVM grew to 8.7 GB. The JVM keeps heap it has grown to, so its figure is not a like-for-like working-set measure.

Startup until healthy: Rust app and datastore about 0.26 s each, Play and the Scala datastore 2.0–2.9 s.

## Findings

1. **Local data:** Rust is 2.5–4× faster cold and up to 2× faster warm.
2. **Rust regressions to look at:**
   - Cold local sharded Zarr3 is 1.4× slower, consistently (ranges do not overlap). This points at shard decoding or shard-index loading.
   - Warm N5 is about 1.2× slower; this was 1.34× in an earlier run.
3. **S3 and HTTPS cold are a tie (network-bound).** An earlier single run had Rust 11–32 % slower on remote cold; repeat runs showed that was internet variance. Three cold rounds are too few to separate the backends on remote data.
4. **GCS cold is 7–10× slower on Scala.** This is a Scala bug, fixed in [PR #10365](https://github.com/scalableminds/webknossos/pull/10365) (h01 cold open 122 s → 12.7 s, histogram 52 s → 3.5 s, as measured in that PR). Two causes, both counted on the wire:
   - every read made a ranged media GET plus a separate metadata GET;
   - the blocking java-storage calls ran inside Future callbacks on Pekko's default dispatcher without `blocking {}`, so at most 1 GCS request was in flight.
   
   Rust (`datavault/gcs.rs`) does one async ranged GET per read.
5. **Scala does not keep two datasets warm:** the full remote IDR load and FAFB. Their warm p95 request times are 1.6–1.9 s versus about 4 ms on Rust, so Scala re-fetches data it should already hold. Likely cause: chunk-cache eviction (IDR chunks are 8 MB decompressed and one open needs well over 2 GB), possibly plus GC pressure near the heap limit. Rust kept both warm at under 1 GB RSS, which suggests it caches at a finer grain. Neither side's cause is verified.
6. **Scala crash under memory pressure.** With `-Xmx4G` the Scala datastore died with SIGSEGV while loading the remote IDR dataset. The heap was full, `NewByteArray` returned null, and the `blosc-java` JNI wrapper (`com.scalableminds:blosc-java:0.3-1.21.6`, `Java_com_scalableminds_bloscjava_Blosc__1decompress` → `jni_SetByteArrayRegion`) does not check for that, so the JVM crashed instead of throwing `OutOfMemoryError`. Production runs `-Xmx20G` (`.github/Dockerfile.datastore`), but any heap exhaustion takes the whole datastore down. The Rust datastore has no equivalent failure mode here.

## Caveats

- One machine, macOS, client on the same host. Remote passes go over the public internet.
- Local "cold" evicts the OS page cache, but the files sit on a fast local NVMe disk.
- Scala ran without the PR #10365 fix; GCS numbers for Scala will change once it lands.
- The harness is not committed. It lives as `dsbench.py` (stack start/stop, DB copies, workload, cold/warm passes) in the session scratchpad. Ask for it if the benchmark should be rerun on Linux or production-like hardware (DC2 next step).
