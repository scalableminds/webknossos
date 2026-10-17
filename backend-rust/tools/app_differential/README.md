# Main application differential tests (Play vs Rust)

Replays the same HTTP requests against the Scala/Play application and the Rust backend, both running on identical database clones, and compares responses and the resulting database state. Standard-library Python only.

## Topology (`stack.py`)

| Process | Port | Notes |
| --- | --- | --- |
| Play (main app + embedded datastore/tracingstore) | 19590 | `target/universal/stage`, DB `wk_diff_play` |
| Rust backend | 19591 | `target/release/webknossos-backend`, DB `wk_diff_rust` |
| Scala standalone datastore (Rust side) | 19595 | calls back Rust |
| Scala standalone tracingstore (Rust side) | 19596 | calls back Rust |
| Redis (Play side, no persistence) | 19592 | |
| Redis (Rust side's stores, no persistence) | 19594 | separate: datastore upload state is keyed by the client's upload id |
| FossilDB (shared, temporary data dir) | 19593 | jar from the main clone |
| OIDC mock provider (`oidc_mock.py`) | 19589 | discovery, JWKS, token endpoint; the `code` selects the answer |

The Rust side needs its own stores because the stores call back the main application (access checks, data sources, annotation reports) at their configured WK URI. Both databases are `CREATE DATABASE … TEMPLATE wk_diff_seed` clones; `wk_diff_seed` is a fresh database from `schema/schema.sql` filled by Play's own initial-data insertion. Only `wk_diff_*` databases are created or dropped. The Rust process gets Play's dev configuration (features JSON fetched from Play, cookie signer secret, sample organization, email verification off, commit info, upload-to-paths prefix = its datastore's base directory). Jobs and voxelytics are enabled (`features.jobsEnabled/voxelyticsEnabled`) and `reset` inserts Play's dev worker (`tools/postgres/dbtool.js enable-jobs`, key `secretWorkerKey`) into both clones.

```sh
# once per worktree (JDK 21): sbt -java-home /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home -batch stage
cargo build --release --locked
python3 tools/app_differential/stack.py seed      # (re)create wk_diff_seed via Play
python3 tools/app_differential/stack.py reset     # fresh clones; records the reset time
python3 tools/app_differential/stack.py start
python3 tools/app_differential/replay.py tools/app_differential/corpus/*.json --db-diff --report /tmp/wk-diff/report.json
python3 tools/app_differential/stack.py restart-rust   # after a rebuild; keeps the databases
python3 tools/app_differential/stack.py stop
```

Second pass for passkeys (the https public URI is opt-in because Play's embedded datastore reports `http.uri` as its own URL, which breaks Play's datastore calls for the other corpora; no TLS is involved, the URI is only compared as a string):

```sh
python3 tools/app_differential/stack.py stop && python3 tools/app_differential/stack.py reset
WK_DIFF_PUBLIC_URI=https://localhost:19590 python3 tools/app_differential/stack.py start
python3 tools/app_differential/replay.py tools/app_differential/corpus/webauthn.json --db-diff
```

Logs are in `/tmp/wk-diff/logs/`. Run `reset` (requires `stop`) before a run whose `--db-diff` should be meaningful.

## Comparison rules (`replay.py`)

Strict by default: status, selected headers (content type, cache control, location, content disposition, CORS origin, frame options) and the JSON body including key presence, array order and number types. Normalizations are explicit and counted in the summary:

- **Id bijection.** Differing 24-hex ObjectIds or UUIDs at the same position, captured values, and ids embedded at the same positions in otherwise equal texts must map 1:1 for the whole run. Ids present in the seed must be identical.
- **Run-time timestamps.** Epoch milliseconds or ISO times written since `reset` are equal within `--time-tolerance` (120 s); run-time milliseconds embedded in strings (`name.deleted.at.<ms>`) are masked.
- **Side rewrites** (corpus): literal substrings that legitimately differ per side (store URLs, data directories).
- **Zip bodies** are compared per entry (name → text), so compression and zip timestamps don't matter; download file names map id suffixes through the bijection.

Everything else must be declared in the corpus with a reason: `header_divergences`, `drop_play_chain_messages` (Play's `{"chain": …}` entries are dropped when Rust sends none and compared without the server time when it does), `unordered_keys` (order-free arrays such as `annotationLayers`, which Play orders by random tracing id), per-step `unordered`, `ignore` (`[*]` matches any index), `expected_divergence`, and `db_divergences` for tables (a reason string for the whole table, or `{"reason", "rows": [{column: value}]}` for matching rows only). The exit code is 1 for any undeclared mismatch or database difference.

Steps with `"service": "datastore"` (or `tracingstore`) go to Play's embedded store vs the standalone store serving Rust; both are Scala, so `X-Frame-Options` and chain messages are not compared there. `multipart` bodies take `fields` and `files` (`content`, `content_b64` or `content_path` relative to the repository root). A corpus with `"run_last": reason` runs after the others (auth.json changes shared credentials).

`--db-diff` dumps every `webknossos` base table on both sides and compares them as multisets after the same normalizations (generated ids that never appeared in a response become `<unpaired-id>`/`<unpaired-uuid>`). This catches side effects that responses hide (e.g. duplicated credit grants, extra time-span updates).

Reports redact fields whose names contain token/password/secret/key/cookie. The sample credentials in the corpora are Play's public dev fixtures; never use real credentials.

## Corpora

- `read.json`: GET routes across the seeded organization, anonymous/invalid-token/missing/invalid-id variants.
- `admin_crud.json`: teams, users, scripts, task types, projects, folders, datasets, configurations, maintenances, short links, organization; negative cases; a second user via cookie login.
- `annotations_tasks.json`: explorational and task annotation lifecycle through the real tracingstores (create, info, edit, sharing, mutex, duplicate, NML download, merge, private links, transfer, finish/reopen, task create/request/finish/assign/delete).

- `auth.json`: login/logout/tokens/registration/invites/password change and reset, logout everywhere (runs last).
- `jobs_ai.json`: worker protocol (request/status/cancel/retry/voxelytics attach), job submissions and lists, AI model upload-to-path/update/delete, trainings, inferences with Play's pretrained models.
- `oidc.json`: OIDC login redirect and callback against `oidc_mock.py` (existing/new users, access-token-only claims, bad signature, expired token, missing claim, non-JWT, provider error).
- `webauthn.json`: passkey registration/authentication with the virtual ES256 authenticator in `webauthn_client.py` (request bodies are built per side from its captured challenge via `"hook"` steps); needs a stack started with `WK_DIFF_PUBLIC_URI=https://localhost:19590` (passkeys refuse http) and is skipped otherwise, see below.
- `uploads.json`: dataset upload through the datastores (reserve, chunk, finish, cancel, unfinished uploads) with `test/dataset/test-dataset.zip`, upload-to-paths, delete.

## Benchmark and coexistence

```sh
python3 tools/app_differential/stack.py stop && python3 tools/app_differential/stack.py reset --volume && python3 tools/app_differential/stack.py start
python3 tools/app_differential/bench.py --report /tmp/wk-diff/bench.json --markdown /tmp/wk-diff/bench.md   # needs oha
python3 tools/app_differential/coexist.py   # second Rust instance on Play's database (port 19597)
```

`bench.py` alternates sides per endpoint, warms up, measures concurrency 1 and 32 with `oha` (`cargo install oha --locked --root /tmp/wk-diff/tools`) and records CPU per request and RSS of each main-app process. `coexist.py` checks cross-backend sessions/tokens, writes visible to the other backend, annotation mutexes in both directions and that Rust's credit ticker does not duplicate Play's grant; it reports the known store-RPC-token blocker as KNOWN.

Current results and every declared divergence with its reasoning: `checkpoints/cutover.md`.
