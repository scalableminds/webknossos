# Isolated real Scala/Rust replay harness

`run_live_replay.py` owns only new child processes and a fresh temporary output directory. It never attaches to or stops existing JVMs/Redis instances, deletes artifacts, compiles sources, or contacts a configured production WK server. Parent coordinates actual executions. Loopback listener permission is required; a restricted shell may need its normal approved execution context.

From the worktree root:

```sh
python3 -B backend-rust/tools/datastore_replay/run_live_replay.py \
  --binary /tmp/webknossos-rust-ds-verify/release/webknossos-datastore \
  --artifacts-root /Users/therold/Programming/scalableminds/webknossos \
  --source-root "$PWD" \
  --output /tmp/wk-ds6-live-new --rounds 3
```

Use a fresh `/tmp` output each run. `--binary` must be an already compiled executable. Defaults: system `redis-server`, 90s startup timeout, 15s per request timeout, 3 rounds. `--redis-binary`, `--startup-timeout` and `--request-timeout` override these. No build occurs; see `scala-launch.md` for cached Scala prerequisite provenance. Bind-to-zero selects dynamic ports; an intervening port race is detected through child exit/readiness rather than changing live services.

The harness generates the complete `--attachments` fixture/catalog/corpus into a fresh subtree (currently41 independent-golden cases), starts the WK/range server with two random accepted tokens plus an independent key, starts loopback Redis with persistence disabled, prepares real Scala argv/config, and launches the release Rust datastore. Scala/Rust use the same copied temporary data and isolated Redis. Upload/scan/watcher are disabled; global vault credentials, local whitelist, Slack and mirror writes are empty/off. Inherited WK_DS/WK_REPLAY/AWS/Google credential/proxy settings are filtered. The fixture authority supplies **both** `http.uri` settings so current-user-token remote range behavior deliberately exercises the same-authority policy.

Readiness requires real `/data/health`200 `Ok` responses and all four service children alive. Scala's health invokes actual JNI self-test. Replay uses the existing strict differential runner for every generated case and every round, preserving side-specific independent SHA256/JSON goldens. Known compressed-segmentation/JPEG/precomputed differences remain failing comparisons; no skip, tolerance or masking is applied. Fixture counters are captured separately, then only owned children receive SIGTERM, wait up to40s each, and receive kill+wait if necessary. Cleanup happens on success, mismatch, errors and interruption; datastores drain before Redis/fixture. No fixture directory is deleted.

Outputs retained: `summary.json` (readiness, categories, case names, child statuses, diagnostic RSS before/after and elapsed seconds), `report.json` (full sanitized case/round comparison), `counters.json`, per-child logs, safe PID-only `processes.json` and numeric `ports.json`, generated fixture manifests/goldens/catalog/corpus, Scala config/classpath/argv. Output root is mode700; secret-bearing Scala config is mode600. Shared secret is never in process argv or summary; do not publish the isolated config or entire output tree without reviewing it. Logs naturally include local service diagnostics; the harness never dumps environment variables, secrets, URLs or response bodies to its stdout report.

Exit0 means strict corpus/golden comparison passed; exit1 means visible mismatches; exit2 means preparation/startup/lifecycle/counter failure. An exit1 is expected while known cross-runtime divergences remain; inspect category/case results instead of changing assertions to make the run green. Timings/RSS are diagnostic snapshots, not production benchmarks or cutover gates. The harness additionally derives21strict contract cases from `dataset.template.json`: it locates `zarr2-raw` by datasource ID name (not fixed catalog index/ID), uses its layer and the generated primary/denied tokens, includes health, and adds v10/v14/v16 raw-data/metadata/health aliases. The checked-in template now uses the required GET raw mag literal `1-1-1`; the harness consumes it directly with no private query override or ignored comparison/status. Contract corpus/report are saved separately and contribute to the aggregate pass/exit result.


Validated2026-10-12 against actual cached Play/JNI and compiled release Rust:41cases×3rounds, all independent per-runtime goldens/status/header expectations passed, with15strict body mismatch results across five cases (`compressed-segmentation-bits32`, `compressed-segmentation-seg32`, `jpeg-gray-baseline`, `jpeg-gray-progressive`, `zip-zarr2-http-crop`). The mismatch exit1 is preserved. All owned children were reaped; no manual running pair changed. Check `datastore-ds6-live-harness.md` for exact retained evidence paths.


Contract validation retained at `/tmp/wk-ds6-live-release-20261012-c` (original invalid scalar-mag template) and `...-d` (valid GET mag). Final d phase21×3=63: all status expectations pass; raw GET/half-byte/readData POST, metadata/.zarray/missing layer and successful data/metadata aliases match exactly. Nine contract cases retain strict differences in error/health headers and negative-bucket batch behavior. Parent owns investigation; comparisons remain failing and no runtime changes were made.
