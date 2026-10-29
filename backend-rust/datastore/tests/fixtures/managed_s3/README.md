# Managed-S3 fixtures

`scala_uri_rewrite.json` holds the S3 uri rewrites of the Scala helpers, replayed by
`tests/s3_uri_rewrite.rs`.

Request signing is done by the `object_store` crate. `tests/managed_s3.rs` verifies the
uploaded bodies, the bucket region, transient failures, ordered multipart assembly, escaped
ETags, abort-on-failure/interruption, HTTP-200 error XML, missing response fields,
empty/hidden/nested/escaped filenames and symlink boundaries. The upload router tests cover
dataset, mag, attachment, worker conversion, denial, missing credentials, failure retention and
reporting only after successful transfers.

Protocol references: [multipart limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html),
[complete, including embedded HTTP-200 errors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html),
[abort](https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html).
