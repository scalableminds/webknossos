# DS6 isolated live-process replay harness

## Status

2026-10-12 DONE: lifecycle orchestrator, operating guide and actual coordinated fresh-port Scala/Rust execution verified. Full parity remains unproven; five strict differences retained. Scope tools/datastore_replay/run_live_replay.py, live-harness.md, this checkpoint only. No runtime Scala/Rust source edits.

## Done

- Fresh temporary fixture generator --attachments, complete embedded independent-golden corpus (reject unexpectedly fewer than41 cases), random key/two accepted tokens/one denied token, loopback dynamic ports.
- Starts independent persistence-off Redis, WK/range fixture, actual Scala cached artifacts via prepare_scala JSON argv and compiled release Rust binary. Same fixture origin as both public URIs exercises same-authority user-token range fixture.
- Explicit dedicated temporary data, no uploads/scans/watcher/whitelist/global credentials/Slack/mirrors; filters inherited datastore/test/remote-cloud/proxy overrides.
- Real health readiness and all-service liveness, three strict replay rounds, complete sanitized comparisons/counters/categories, diagnostic timings and ps PID-only RSS. Keeps known divergences failing.
- Finally terminates/awaits only tracked child PIDs; reverse order drains datastores while fixture/Redis available,40s grace then kill/wait. Handles INT/TERM without skipping cleanup. Retains all artifacts; no deletion or build.
- Guide CLI/defaults/artifacts/security/exit codes and scope limits documented.

## Next

- Parent owns metadata/error/auth extension and measured benchmark; harness runs the complete generated independent-golden corpus. Existing19491–4 manual services remain untouched.
- Parent investigating divergences/performance; no tolerance/skip added.

## Evidence

- `python3 -B .../run_live_replay.py --help`: succeeds.
- AST syntax parsing and one owned sleeping subprocess SIGTERM+wait check passed; generated lifecycle temp directory retained.
- Dynamic-port check in restricted shell returns PermissionError bind denied; no services started by that check. No production or behavioral-parity claim.

- Actual approved loopback run `/tmp/wk-ds6-live-release-20261012-a`:41cases×3=123 comparisons,15body mismatches across exactly five documented cases; no independent golden, status, header or transport failures. Readiness passed both real `/data/health` checks. Elapsed7.788s diagnostic.
- All spawned children waited/reaped: generate/prepare/fixture/Redis/Rust exit0; Scala143 (Java SIGTERM). Counters access_primary_granted56, datasource56, remote_range6, remote_primary6, remote_head2, remote_request11, remote_denied3.
- New safe PID/port artifacts added after first validation; a fresh second run `/tmp/wk-ds6-live-release-20261012-b` validates this recording plus child reaping (evidence below).
- Second live run b:41×3 again, exactly15body-only mismatches, all golden/status/header assertions pass;7.534s diagnostic. PID/port artifacts verified; ps PID-only lookup confirms all6 children absent after cleanup. Four dynamic ports distinct.


## Contract extension milestone — DONE

- Added separate21-case contract phase using datasource name `zarr2-raw`, discovered ID/layer, generated primary/denied environment, complete template plus health and v10/v14/v16 raw/metadata/health aliases. Name-based lookup validated with altered catalog ID; all21 route cases validate under existing read-only allowlist.
- c actual fresh pair: baseline123 unchanged; contract63 exposed both400 on template raw GET mag `1`. Authoritative Scala requestRawCuboid and Rust from_mag_literal(false) require `x-y-z`; derived harness query now uses `1-1-1`. Original template and c evidence preserved, no runtime changes.
- d actual fresh pair `/tmp/wk-ds6-live-release-20261012-d`: baseline123 exact5strictbody cases×3, no per-runtime golden/header/status failures. Contract63 all expected statuses pass; raw GET/half-byte/POST, metadata/.zarray/missing layer, all raw and metadata aliases fully match.
- Contract nine differing case names: batch-with-missing (body, failure/missing bucket headers), invalid-object-id/invalid-query (body/content-type/cache-control/CORS), invalid-json-schema (cache-control/CORS), unauthorized (content-type), health base/v10/v14/v16 (content-type). Totals failure3,missing3,body9,cache-control9,CORS9,content-type21. Retained strictly, parent investigates.
- c/d all children waited/reaped (Scala143, all other0); d elapsed7.723s diagnostic. Report count/expected-status/passing-success cases assertions pass. Existing manual pair untouched; no benchmark hook added.

- Parent-authorized final template correction: all5 GET data mag literals in checked-in dataset.template.json changed to1-1-1; private harness override removed. Original c/d evidence retained. Further live run held until parent runtime-fix decisions.
- After checked-in template correction, full existing differential replay unittest suite:11passed, including checked-in corpus validator (approved ephemeral loopback context). Diff check clean. No new full pair run after parent hold.
