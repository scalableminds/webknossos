# Datastore HTTP differential replay

`../datastore_differential_replay.py` uses Python's standard library to replay the same read requests against independently running Scala and Rust datastore HTTP origins. It does not start services, seed datasets, reset caches, call write routes, or follow redirects. Configure both services against the same immutable fixture data and equivalent WEBKNOSSOS access configuration first. Use test accounts/tokens. Read requests can populate service caches and logs.

From `backend-rust`:

```sh
python3 tools/datastore_differential_replay.py \
  --scala http://127.0.0.1:9090 --rust http://127.0.0.1:9190 \
  --corpus tools/datastore_replay/health.json --rounds 3

# Set WK_REPLAY_TOKEN and WK_REPLAY_DENIED_TOKEN securely in the environment.
python3 tools/datastore_differential_replay.py \
  --scala http://127.0.0.1:9090 --rust http://127.0.0.1:9190 \
  --corpus tools/datastore_replay/dataset.template.json \
  --var dataset=012345678901234567890123 --var layer=color --rounds 3

python3 -m unittest discover -s tools -p test_datastore_differential_replay.py -v
```

The dataset ID above is a placeholder. Select a usable dataset/layer available identically to both implementations. Run the template independently for WKW, Zarr2, Zarr3, N5 and each precomputed codec (raw, JPEG, compressed segmentation, Compresso), including remote/zip-backed fixtures when available. Ensure the origin data intersects `[0,8)^3` and the negative bucket is outside its bounding box; otherwise adapt coordinates to your fixture. Select an integer layer compatible with half-byte packing. The invalid token must be nonempty and actually denied by the configured WK server. Expected error statuses reflect route contracts, but local authentication policies can differ: inspect and document intentional adjustments rather than weakening all assertions. Add a no-token case for anonymous-access policy when relevant.

Template cases cover GET raw cuboids, raw POST, ordered Webknossos batches with an empty bucket, half-byte output, metadata/Zarr array shape, missing layer, invalid ObjectId/query/body and authorization denial. `json` request bodies use actual Scala/Rust DTO names (`position`, `mag`, `cubeSize`). The corpus is an operator template, not a checked live oracle; neither included corpus has been run against a live Scala/Rust pair.

## Corpus and comparison contract

Version1 corpus has nonempty `cases`; each case has a unique safe `name`, approved absolute `path`, optional `method` (`GET` default), `query`, `query_env`, `headers_env`, `json`, `compare`, `expected_status`, `expected_sha256` and `expected_canonical_json_sha256`. Paths substitute `{dataset}`/`{layer}` (or other safe segment variables supplied with `--var`). Secrets belong only in environment variables via `query_env: {"token": "WK_REPLAY_TOKEN"}` or `headers_env: {"Authorization": "WK_REPLAY_AUTHORIZATION"}`. Authorization values are sent verbatim (include the desired scheme in the environment). Never put credentials in names, variables, paths, bodies, literal query values or checked-in corpus files. Literal token/key/password queries and unknown fields are rejected. The route allowlist is deliberately narrower than the datastore API; unsupported routes fail validation rather than being sent. No write override exists.

Every response comparison checks status and presence/values of content-type, content-encoding, content-disposition, cache-control, content-range, location, empty-bucket-indices, failure-bucket-indices, MISSING-BUCKETS, access-control-allow-origin and access-control-expose-headers. Header names are case insensitive. Bucket-index JSON whitespace and expose-header case/order are normalized; other header values remain exact. Duplicate header values are retained. Date, server, connection, transfer encoding and content length are excluded as transport/runtime details. Add contract headers explicitly to the runner before expanding coverage to routes that depend on them.

`bytes` compares exact response bytes. `json` compares parsed JSON with object-key ordering normalized, preserving array order and numeric representations/types, rejecting duplicate keys and nonfinite values. `auto` uses JSON only when both content types indicate application/json; otherwise it uses exact bytes. No error messages, numbers, IDs, timestamps or fields are ignored. JSON content-type charset differences remain a visible header mismatch. `expected_status` also asserts each endpoint's status, preventing identical denied/missing responses from passing success cases. Response-size overflow or transport failure is always a mismatch even when both fail.

Reports contain case identifiers, initial/warm round, status, timing milliseconds, categorical failures and mismatching field names only. URLs, tokens, request/response bodies and header values are never emitted, including in exception messages. Proxies from the environment are disabled. Redirect responses are compared without following them; redirect location is compared as a contract header but its value is not printed. TLS verification stays enabled. Max response bytes defaults to64MiB and request socket timeout to10seconds. A socket timeout is not a total replay deadline.

Exit codes:0 all cases/rounds match expectations;1 mismatch or transport failure;2 invalid configuration/corpus. Redirect stdout to an operator-chosen report file if needed.

## Timing and outstanding evidence

Round0 is labeled `initial`, not cold: the tool does not clear or verify cache state. Subsequent rounds are labeled `warm`, measuring repeated requests, not proving cache hits. Endpoint order alternates by round to reduce order bias. Timings include connection/open/read wall time and are diagnostic, not a benchmark or cutover threshold; use fixed hardware/data/concurrency and externally verified cache state for performance decisions.

JPEG numerical tolerance is **deferred**. Standard-library Python does not decode JPEG pixels. Encoded JPEG responses remain exact byte comparisons; decoded raw voxel responses from JPEG-backed datasets also remain exact. Known Scala/Rust differences (up to1 gray/2 color intensity levels) must be recorded as mismatches until an independently validated opt-in pixel decoder/tolerance policy exists. There is no silent acceptance and no fake parity claim.

Read-only local inventory on2026-10-12 showed Redis and PostgreSQL listeners but no JVM/datastore listener on9090. Real differential execution requires separately provisioned services/fixture datasets/tokens; this work's actual HTTP evidence is the local mock-server test suite only. Existing native Scala/JNI reader oracles elsewhere are complementary evidence, not a live HTTP replay.


## Independent expected bytes and JSON

`expected_sha256` asserts a lowercase64-digit SHA256 against the actual body independently for each runtime. A digest string checks both endpoints; an object such as `{"scala":"<64-digit digest>"}` checks only the named side(s). This prevents two identical wrong bodies from establishing correctness. `expected_canonical_json_sha256` uses the same string/object forms but hashes UTF8 bytes of the runner's `canonical_json` representation (object keys sorted, compact separators, unescaped Unicode). Invalid JSON fails that assertion. Digests and actual body content are not emitted in reports; failures are categorical `expected_sha256:scala` etc. A side-specific oracle never suppresses strict cross-runtime body mismatch. Keep native-Java JPEG goldens scoped to Scala and record Rust/Scala disagreement until the separately documented numerical-tolerance work is validated.

A separately generated golden map can be merged into an operator-owned runtime corpus: use `sha256` from the matching case, and `golden_service` (`both`, `scala`, `rust`) to choose the string or per-side object. JSON cases use their independently generated `canonical_json_sha256`. The runner does not infer correctness from pair equality and does not modify the checked-in corpus or source fixtures.

## Isolated WK RPC and range fixture service

`fixture_server.py` supplies only the WK callbacks needed by read replay/startup, without contacting a real application backend. Set `WK_REPLAY_FIXTURE_KEY` and `WK_REPLAY_TOKEN` to nonempty distinct test-only values. It never logs query strings, keys, tokens, payloads or filesystem paths.

```sh
python3 tools/datastore_replay/fixture_server.py \
  --root /tmp/wk-ds6-fixtures-attachments \
  --catalog /tmp/wk-ds6-fixtures-attachments/catalog.json --port 0

python3 -m unittest discover -s tools/datastore_replay -p test_fixture_server.py -v
```

The first flushed stdout line is `{"ready":true,"origin":"http://127.0.0.1:<port>"}`. `/health` reports ready; `/counters` returns only categorical aggregate counters. SIGTERM/SIGINT stop the server and emit `{"stopped":true,"counters":{...}}`. The server binds only127.0.0.1; port0 allocates a free port. Parent launch coordination must point both datastores' WEBKNOSSOS URI to this origin, use datastore name `replay-ds` and matching key. To exercise current-user-token forwarding into HTTP vaults, configure their public `http.uri` to this fixture origin (listen ports can differ), because Scala/Rust forward user tokens only to their own public authority. Optional alternate accepted token: repeat `--token-env WK_REPLAY_TOKEN --token-env WK_REPLAY_TOKEN_ALT`; counters distinguish primary/alternate/denied without exposing values.

Catalog v1 must use `organization: "replay-org"`, `datastore: "replay-ds"`, and nonempty `datasets` containing unique `000000`-prefixed24-digit hexadecimal `datasetId`, actual `dataSource` DTO JSON with matching source organization, and relative `rootPath`. The explicit existing fixture root must be a child directory under temporary storage. Root/file paths cannot escape it through absolute paths, `..` or symlinks. DataSource placeholders `${FIXTURE_ROOT}` and `${FIXTURE_ORIGIN}` resolve at runtime. Optional `remoteFiles` maps safe aliases to `{ "path":"relative/file", "requireToken":true }`, served at `/files/<alias>`; paths must exist beneath the fixture root. These routes support full GET, single prefix/open/suffix byte range,416 invalid range, and HEAD with size/Accept-Ranges metadata. HEAD is anonymous for actual Scala probe behavior; protected GET requires an accepted X-Auth-Token.

Every `/api/datastores/replay-ds/` RPC requires the fixture key. Access validation grants only accepted user token + known catalog dataset + `dataset/read`; all unknown/wrong/cross-organization tokens and non-read actions are denied. Dataset lookup, datasource, local root and credential calls return known catalog values only; missing/unsupported RPC404. Credentials are limited to `replay-*` IDs and actual XAuthTokenCredential DTOs with `tokenValue: "${FIXTURE_TOKEN}"`; expansion returns the test token. Status PATCH and datasource/realpath reports acknowledge only replay identity, count requests and never alter catalog or write fixtures. These acknowledgements are isolated startup scaffolding, not proofs of production callback behavior. Tracingstore/annotation/upload/deletion RPCs are deliberately unsupported. Only the parent launches actual Scala/Rust processes; the focused server tests use temporary loopback fixtures.
