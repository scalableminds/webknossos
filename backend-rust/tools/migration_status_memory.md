## Memory (RSS): Rust vs Scala

Measured 2026-10-17 for the **datastore only**. The main application was not measured: a Play main app needs PostgreSQL and FossilDB, so there is no comparable isolated pair yet.

Setup: `tools/datastore_replay/run_live_replay.py --breadth --bench`, with real Play/JNI Scala (`java -Xms256m -Xmx2g`) and the release Rust binary built 18:32 that day, which is before the last commit. Both ran on the same fixture data, each with its own Redis. A 0.5 s `ps` sampler recorded RSS for the whole 263 s run. Data is small (two 512×512×256 uint8 bench datasets plus the correctness fixtures), the client shares the machine, and the run is a single pass.

| Moment | Scala | Rust | Ratio |
| --- | ---: | ---: | ---: |
| Just after ready (idle) | 355 MiB (503 at first sample) | 9 MiB (25 at first sample) | ~40× |
| After correctness replay + breadth | 642 MiB | 33 MiB | ~19× |
| Peak under bench load | 2552 MiB | 355 MiB | ~7× |
| End of run (load stopped) | 1593 MiB | 355 MiB | ~4.5× |

Per bench scenario (RSS after the scenario, MiB, Scala / Rust):

| Scenario | RSS |
| --- | ---: |
| health | 760 / 34 |
| single bucket | 855 / 58 |
| 32-bucket batch (Zarr2) | 1644 / 210 |
| 32-bucket batch (Zarr3) | 1466 / 278 |
| readData 128³ | 1927 / 325 |
| Zarr streaming chunk GET | 1080 / 326 |
| histogram | 1720 / 355 |

Caveats:
- **Scala's peak is capped by `-Xmx2g`.** The JVM grows to its heap limit and does not return memory, so it is not a working-set measure. A production JVM with a larger heap would show a larger number.
- **Rust's growth tracks its caches.** It rose from 33 MiB to 355 MiB as the chunk and bucket caches filled, and never shrank. Defaults allow up to 2 GB for image chunks (`WK_DS_CACHE_IMAGE_ARRAY_CHUNKS_MAX_SIZE_BYTES`), so with a larger dataset it will climb well past 355 MiB. Only 32-bucket batch, readData and histogram added meaningful memory here.
- **The Rust numbers use the bounded cache defaults.** There are uncommitted cache changes in `datastore/src/cache/`, and the binary measured does not include them. Re-measure once they land.
- **Small data, one run.** Treat the ratios as indicative, not a capacity-planning input. A larger dataset and a long soak (leak check) are still outstanding.

Raw data: `/tmp/wk-mem-run1` (`bench.md`, `summary.json`) in the session temp directory. It will not survive a reboot.

