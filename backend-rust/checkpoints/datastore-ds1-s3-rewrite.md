# DS1/DS4 short-S3 exploration rewriting — Codex 2026-10-12

Status: DONE. Before remote exploration, short s3://bucket/key URLs are rewritten
to s3://s3.<region>.amazonaws.com/bucket/key. HeadBucket determines the region
from its header even on a denied response; missing/error lookups fall back to
s3.amazonaws.com. Explicit exploration credentials (or configured environment
credentials) are used; managed-upload global credentials do not silently enter
this lookup. Existing endpoint/virtual-hosted/HTTP/local URLs are unchanged.
Zip entry paths rewrite their outer archive path while keeping the inner path.

The existing Scala URI helper behavior is preserved: retain raw path escapes,
drop query/fragment during short-style rewrite, retain the bucket-only form.
`tools/GenerateS3UriFixtures.java` generates 16 actual Scala helper cases under
`datastore/tests/fixtures/managed_s3/scala_uri_rewrite.json`. The runtime uses
`DataVaultService.insert_s3_endpoint_if_missing` and the existing signed S3 client.

Two focused tests verify native cases, explicit/anonymous credentials, missing
headers, failed transports, archive paths and actual authenticated exploreRemote
receipts. Denied requests produce no region or metadata storage calls. Existing
local exploration remains unchanged.

Whole datastore: **416 passed, 0 failed, 0 ignored across 47 harnesses**;
`/tmp/webknossos-rust-ds-s3-uri-final-tests.log`. fmt, all-target clippy `-D warnings`
and both inventories clean. No live AWS calls; all storage endpoints were local
fixtures. Next zip vaults, then DS6 differential/performance/config/cutover.
