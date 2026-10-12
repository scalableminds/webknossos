# Managed-S3 signing oracle

`aws_sdk_signing.json` is produced by the AWS SDK **2.53.2** pinned in
`project/Dependencies.scala`, using its `AwsS3V4Signer`. It contains four
fixed-time signed PUT/part/complete/abort requests with nonempty payloads,
XML, encoded keys, query values containing `+/&=`, a nonstandard endpoint port
and a session token. All keys/secrets/tokens are explicit fixture values.

Generate with `backend-rust/tools/GenerateS3UploadSigningFixtures.java` on a
classpath containing that SDK version's jars and SLF4J. Compile with `javac -cp
<classpath> -d <temporary classes> <source>`; run with `java -cp <classes>:<classpath>
GenerateS3UploadSigningFixtures` and capture stdout as this JSON. No AWS SDK or
Java runtime is used by the Rust service.

`tests/managed_s3.rs` verifies these signatures and actual streamed bodies,
region retries, transient failures, ordered multipart assembly, escaped ETags,
abort-on-failure/interruption, HTTP-200 error XML, missing response fields,
empty/hidden/nested/escaped filenames and symlink boundaries. The upload router
tests cover dataset, mag, attachment, worker conversion, denial, missing
credentials, failure retention and reporting only after successful transfers.

Protocol references: [multipart limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html),
[complete, including embedded HTTP-200 errors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html),
[abort](https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html).
