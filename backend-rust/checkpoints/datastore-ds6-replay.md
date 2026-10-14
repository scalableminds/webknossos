# DS6 differential HTTP replay

## Status
DONE for bounded tooling batch — standard-library runner, corpus templates and11 focused actual HTTP tests pass. Live parity and cutover remain unverified.

## Done
Read Scala latest routes/BinaryDataController and Rust binary_data/data_requests contracts. Implemented guarded read routes (including read-only POST data/readData), environment credentials, no redirects or proxy use, bounded responses, status/header/JSON/bytes comparison and per-round timing with alternating request order. Missing/empty/failure bucket headers compared including presence; JSON ordering normalized only, array order/types preserved. Reports exclude URLs and response/request content.

## Next
Operator must provision paired Scala/Rust datastore services with equivalent immutable fixtures and access configuration, run the health/dataset corpora for every format/codec/storage backend, inspect categorical mismatches and retain reports. Parent integrates tooling and runs central verification. JPEG numerical tolerance explicitly deferred because stdlib does not decode JPEG. No live datastore pair is running on expected port9090; do not claim parity based on mocks.

## Evidence
Read-only `lsof -nP -iTCP -sTCP:LISTEN` on2026-10-12: Redis6379 and Postgres5432/55439 available; no JVM or datastore9090 listener. No service startup, credentials, writes, deployment or database bootstrap attempted.

Focused verification: `python3 -m unittest discover -s backend-rust/tools -p test_datastore_differential_replay.py -v` —11 passed (2026-10-12). Initial sandbox run could not bind sockets; approved escalation enabled temporary127.0.0.1 HTTP mocks. Actual requests, credential forwarding, status/error comparisons, expected-success assertions, warm rounds, JSON ordering/types/duplicates, binary mismatch, bucket-header whitespace/absence, no redirect following, max-body bound and forbidden paths/methods/credentials tested. No source/shared central file edits. Operating contract and explicit JPEG deferral: tools/datastore_replay/README.md.

Integration review: cache-control, content-range and location added to exact presence/value comparison; actual local HTTP tests verify changed/missing headers produce categorical mismatches, redirects remain unfollowed and secret-bearing Location values stay absent from reports.

Follow-up parent integration: expected_sha256 and expected_canonical_json_sha256 (both/per-side) independently assert actual bodies, preserving strict pair mismatches and categorical secret-free output. Actual read-only connectome GET/synapse POST allowlist added for generated native HDF5/Zarr attachment corpus. Final11 focused tests pass;29-case initial and41-case attachment generated corpora validate.
