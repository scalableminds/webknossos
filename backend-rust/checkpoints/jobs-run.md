# Job submission routes (batch J2)

Owner files: `src/job_submission.rs`, `tests/job_submission.rs`, focused edits in `src/jobs.rs`, `src/auth.rs`,
`tests/authentication.rs`.

## Status
- Status: J2 complete and centrally verified (2026-10-09). Older Claude ownership is superseded by current Codex resume.
- Done: audited all eight existing routes against JobController and submitJob/submitPaidJob. Parent wired router(enabled) and module. Existing implementation compiles with shared jobs helpers as currently exposed.
- Done additionally: auth::authenticate admits Job tokens and still rejects ResetPassword; HTTP test added for Job expiry, idle timeout, deletion and logout cutoff. Paid expected-submit failure now commits reservation/refund audit rows together, with Scala state/comment/link fields; unexpected DB errors roll back both job and reservation.
- Done additionally: five jobs/run DB HTTP tests cover all eight successful routes, target-mag cost rounding/reservation linkage, storage accounting (mags plus attachments), permissions/workers/jobs-disabled errors, reservation/refund pairs, forced insertion failure rollback, concurrent balance exhaustion, public foreign dataset export, and animation plan gates. Fixed old negative ceilDiv unit assertion against actual Scala MathUtils implementation; made box-volume overflow explicitly wrap as Scala Long does (prevents debug-only panic). Named refund fixture row resolves central clippy type_complexity finding.
- Next step: all central gates passed; see final evidence below. J2 owner has no remaining route implementation work; do not claim full backend migration completion.
- Evidence: cargo check --locked --offline passed. Escalated focused DB HTTP suite authentication 10/10 + job_submission 5/5 passed (session 11228). J2 unit tests 5/5 passed after ceilDiv assertion fix (session 11848). rustfmt --check --edition 2024 on all four owned code/test files passed. Final repeat after named refund row also passed authentication 10/10 and job_submission 5/5 (session 12152). Test env CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-b WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres. Local TCP required escalation; no production/admin DB bootstrapping performed. No lib/config/Cargo/inventory edits by J2 owner.
- Limits: datastore HTTP was exercised against a local mock; no real compute worker or Scala differential end-to-end run. Existing global telemetry/Slack notification parity is outside this focused J2 completion. Serializable contention returns existing API 409/retry behavior rather than silently overspending.

## Central integration verification (2026-10-09)

Coordinator integrated this batch and ran the full suite: 230 passed, 0 failed, 0 ignored (session87523; log /tmp/webknossos-rust-j2-j5a-verification.log). Global formatting, all-target clippy -D warnings and regenerated route inventory checks pass. Batch is centrally verified; main-application remainder and separate engine migration remain active.
