# DS6 isolated fixture server

## Status
DONE for isolated server/tooling batch —5 actual HTTP/subprocess tests pass and both generated catalog/corpora validate (27datasets/29cases and28datasets/41cases). No real Scala/Rust datastore process launched by this agent.

## Done
Read actual Scala DSRemoteWebknossosClient/Rust WkClient, access DTOs and HTTP vault behavior. Catalog v1 agrees with zip_vault: replay-ds/replay-org, unique000000-prefixed test dataset IDs, actual dataSource DTOs, relative rootPath and remoteFiles aliases. Placeholder expansion supports fixture root/origin/token. Key/token from environment only, wrong tokens and non-read/unknown-resource access denied, known dataset/root/credential RPCs, status/report acknowledgements scoped to replay identity, unknown RPC404. Loopback dynamic-port lifecycle, safe counters, bounded streaming ranges and unauthenticated HEAD compatible with Scala probing.

## Next
Parent launches paired actual services and records live reports/counters. Fixture server CLI/ready-origin schema supplied to parent; no live parity claim in this tooling checkpoint. Keep production identities, networks and writes excluded.

## Evidence
Source references: datastore/src/{wk_client,access}.rs, datastore/src/datavault/{credential,http}.rs; webknossos-datastore services/DSRemoteWebknossosClient.scala. Server files only beneath explicitly supplied existing temporary fixture directory; relative escapes rejected.

Verification2026-10-12: `python3 -m unittest discover -s backend-rust/tools/datastore_replay -p test_fixture_server.py -v`5passed (2.886s), approved escalation for temporary loopback HTTP/subprocess tests. RealHTTP tested key/accepted-primary/alternate/wrong/crossorg/missing-token auth, non-read and unknown-resource denial, actual datasource/root/credential DTOs, unsupported callbacks404, report scoping, anonymousHEAD/full/range/suffix/open/416/no-token GET, primary→alternate→denied accesses, safe counters, stdout readiness/SIGTERM clean shutdown/no secrets, temp-root and symlink escapes. Replay runner independently extended per parent: string/per-side expected_sha256 and expected_canonical_json_sha256, read-only connectome GET/POST exact allowlist;11 focused replay tests pass (12.766s). Both initial and attachment corpora validate.
