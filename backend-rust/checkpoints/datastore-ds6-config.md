# DS6 configuration and deployment audit

## Status

2026-10-12: bounded audit, configuration/lifecycle fixes and deployment documentation complete; focused checks pass. Production cutover, deployment performance and full Scala differential parity remain unverified. Owner: DS6 configuration subagent; owns config.rs/main.rs and new .env.example/DEPLOYMENT.md. Parent integrating/verifying Slack separately.

## Done

- Compared authoritative standalone-datastore.conf, integrated application.conf, DataStoreConfig.scala and Rust config/runtime wiring. All 33 supported WK_DS_* settings included in shell-compatible `.env.example`; verified exact key-set coverage against parser literals, shell syntax/load and three JSON fields.
- `DEPLOYMENT.md`: complete env-to-Scala mapping/defaults/formats, standalone versus integrated defaults, unsupported Play/Redis/outbound-timeout settings, secret handling limitations, startup side effects, build/rehearsal commands and staged acceptance/cutover/rollback gates.
- Fixed config accepting scheduler intervals that only failed after listener bind: ping and enabled watcher now require >=100ms. Disabled watcher keeps Scala semantics (positive short intervals accepted). Boundary unit test covers 99/100ms and disabled watcher.
- Fixed main waiting indefinitely for a signal after server task failure. Select server completion versus signal, abort/await background tasks on either, drain on signal and abort/await server on deadline. Added tests for server error, signal drain and forced deadline cancellation.
- Confirmed every substantive datastore config field has runtime consumers except Slack at initial audit; parent has since added Slack module/AppState health, binary-data and upload hooks (verified by source inspection). No Scala source-watcher Slack hooks found: ApplicationHealthService internal error, BinaryDataController slow data, UploadController failed/slow upload hooks exist.

## Next

- Parent integrated Slack and current/legacy route observers; documentation updated. Full-suite final verification recorded in coordinator.md.
- Deployment operator must supply actual registration/key/public URLs, translated deployed overrides, backup/restore evidence, representative differential and performance results before traffic changes. No live deployment performed.
- Existing limitations deliberately not expanded into speculative settings: default key only warns; unknown env names ignored; startup does not check WK/Redis readiness; HTTP URI independent of listen port; Redis plaintext/no auth/TLS/database selection; health only Redis/recent internal problems.
- Startup ping updates registered URL and unconditional orphan cleanup may mutate/delete upload staging after 10s, even watcher disabled. Candidate rehearsal requires copied data, isolated Redis and separate WK identity/stub. Never use a new empty Redis against production upload directories.
- Secret Debug and dedicated credential parser errors are redacted, but malformed base-directory/whitelist config serde diagnostics, remote URI logs and upstream RPC body previews are not universal secret sanitizers. Require secrets only in dedicated secret fields and redacted proxy logs.

## Evidence

- Source references: `webknossos-datastore/conf/standalone-datastore.conf`, `conf/application.conf` datastore block, `DataStoreConfig.scala`; Rust config.rs/main.rs/lib.rs/wk_client.rs/access.rs/services/source_scan.rs/services/upload.rs/datavault/service.rs.
- `CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-ds-verify cargo test --manifest-path backend-rust/datastore/Cargo.toml --locked --offline config::tests`: 9 config tests passed, none failed (other suites filtered).
- `zsh -n backend-rust/datastore/.env.example`; shell source plus JSON parse; Python parser/example key-set equality: all pass, 33 keys.
- `cargo test --manifest-path backend-rust/datastore/Cargo.toml --locked --offline --bin webknossos-datastore` with the same CARGO_HOME/CARGO_TARGET_DIR: 3 lifecycle tests passed, none failed.
- Focused bin `cargo clippy --locked --offline --bin webknossos-datastore -- -D warnings`: clean. `cargo fmt --manifest-path backend-rust/datastore/Cargo.toml --check` and `git diff --check` clean. Parent owns whole-suite/all-target final checks.
