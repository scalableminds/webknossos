# DS6 datastore notification integration

## Status

Implemented and verified: current-source whole datastore436 tests pass, zero failures/ignored; fmt/all-target clippy/inventories clean. No external webhook contacted or deployment performed.

## Done

- Scala SlackClient/DSSlackNotificationService attachments, titles/colors and strict 30-message/one-minute windows ported with synchronized reservations. First actual send starts the window, including delayed first-use and exact 60s boundary. Empty URI disables sending; HTTP failures are nonfatal, timeout bounded, redirects disabled and webhook URL omitted from error logs.
- AppState owns shared notifier; internal health problems notify. Binary data POST notices after >10 minutes (authorization precedes timer), including failed source lookup results. Upload chunk/finish POST routes log non-success; finish notices after >2 minutes. Existing request responses preserved.
- Intentional payload privacy difference: all query/fragment values, URL userinfo, upstream error bodies and internal exception details omitted. Alerts retain route/status/timing and refer operators to service logs. Verbose logs describe sending without payloads. Unversioned and v10–13 legacy upload chunk/finish aliases share the observer; GET probes and reserve routes are excluded. Actual latest/unversioned/versioned malformed-form and legacy finish-schema responses verify routing.

## Next

Parent full datastore fmt/clippy/tests and inventory checks; real service-pair/configuration/performance rehearsal and cutover remain DS6. Configure webhook only when operator enables delivery; none configured in tests outside ephemeral localhost mocks.

## Evidence

Authoritative Scala datavault/slacknotification/{SlackClient,DSSlackNotificationService}, BinaryDataController, UploadController and ApplicationHealthService. Rust tests/slack.rs verifies actual HTTP attachment JSON, rate suppression, disabled mode, generic internal-problem hook and failed upload form response. Tests/zip_data_routes.rs independently verifies real ZIP-backed data/missing-fill/authorization/warm-cache/reload behavior. Focused logs /tmp/webknossos-rust-ds-integration-focused.log (initial missing-Zarr-fill expectation corrected) and /tmp/webknossos-rust-ds-zip-route.log (passes). Rate-window unit tests pass; whole current-source suite436 passes in /tmp/webknossos-rust-ds-continuation-final-tests.log and all-target clippy clean in /tmp/webknossos-rust-ds-continuation-clippy-final.log. Latest/unversioned/v10 upload-form failures and v13 finish-schema failures also pass actual local webhook verification.
