//! Managed uploads using replayable, bounded file streams; fixture/HTTP parity in tests.
use super::{
    S3DataVault, S3Response, VaultError, VaultResult, parse_error_body, query, sdk_failure,
};
use bytes::Bytes;
use reqwest::Method;
use ring::digest;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

const PART_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PART_BYTES: u64 = 5 * 1024 * 1024 * 1024;
const MAX_PARTS: u64 = 10_000;
const STREAM_BYTES: usize = 128 * 1024;
const MAX_ATTEMPTS: u32 = 10; // Scala's upload S3 client StandardRetryStrategy.

pub(super) enum UploadBody {
    File {
        path: PathBuf,
        start: u64,
        length: u64,
        sha256: String,
    },
    Xml {
        bytes: Bytes,
        sha256: String,
    },
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl UploadBody {
    async fn file(path: &Path, start: u64, length: u64) -> VaultResult<Self> {
        let mut file = tokio::fs::File::open(path)
            .await
            .map_err(VaultError::exception)?;
        file.seek(std::io::SeekFrom::Start(start))
            .await
            .map_err(VaultError::exception)?;
        let mut context = digest::Context::new(&digest::SHA256);
        let mut remaining = length;
        let mut buffer = vec![0; STREAM_BYTES];
        while remaining > 0 {
            let wanted = remaining.min(buffer.len() as u64) as usize;
            file.read_exact(&mut buffer[..wanted])
                .await
                .map_err(VaultError::exception)?;
            context.update(&buffer[..wanted]);
            remaining -= wanted as u64;
        }
        Ok(Self::File {
            path: path.to_owned(),
            start,
            length,
            sha256: hex(context.finish().as_ref()),
        })
    }
    fn xml(bytes: String) -> Self {
        Self::Xml {
            sha256: hex(digest::digest(&digest::SHA256, bytes.as_bytes()).as_ref()),
            bytes: Bytes::from(bytes),
        }
    }
    pub(super) fn sha256(&self) -> &str {
        match self {
            Self::File { sha256, .. } | Self::Xml { sha256, .. } => sha256,
        }
    }
    pub(super) fn length(&self) -> u64 {
        match self {
            Self::File { length, .. } => *length,
            Self::Xml { bytes, .. } => bytes.len() as u64,
        }
    }
    pub(super) fn content_type(&self) -> &'static str {
        match self {
            Self::File { .. } => "application/octet-stream",
            Self::Xml { .. } => "application/xml",
        }
    }
    pub(super) async fn body(&self) -> VaultResult<reqwest::Body> {
        match self {
            Self::Xml { bytes, .. } => Ok(reqwest::Body::from(bytes.clone())),
            Self::File {
                path,
                start,
                length,
                ..
            } => {
                let mut file = tokio::fs::File::open(path)
                    .await
                    .map_err(VaultError::exception)?;
                file.seek(std::io::SeekFrom::Start(*start))
                    .await
                    .map_err(VaultError::exception)?;
                let stream = futures::stream::try_unfold(
                    (file, *length),
                    |(mut file, remaining)| async move {
                        if remaining == 0 {
                            return Ok::<_, std::io::Error>(None);
                        }
                        let count = remaining.min(STREAM_BYTES as u64) as usize;
                        let mut bytes = vec![0; count];
                        file.read_exact(&mut bytes).await?;
                        Ok(Some((Bytes::from(bytes), (file, remaining - count as u64))))
                    },
                );
                Ok(reqwest::Body::wrap_stream(stream))
            }
        }
    }
}

fn part_size(length: u64) -> VaultResult<u64> {
    let size = PART_BYTES.max(length.div_ceil(MAX_PARTS));
    if size > MAX_PART_BYTES {
        return Err(VaultError::failure(
            "File exceeds S3 multipart upload limits.",
        ));
    }
    Ok(size)
}

impl S3DataVault {
    /// One file, bounded memory regardless of file/part size. Every retry reopens the range.
    /// Multipart parts/complete errors are followed by AbortMultipartUpload. Cancellation has
    /// a best-effort asynchronous abort guard as well.
    pub async fn upload_file(
        self: &Arc<Self>,
        file: &Path,
        target: &super::UPath,
    ) -> VaultResult<()> {
        let key = Self::object_key(target)?;
        let metadata = tokio::fs::metadata(file)
            .await
            .map_err(VaultError::exception)?;
        if !metadata.is_file() {
            return Err(VaultError::failure(
                "S3 upload source must be a regular file.",
            ));
        }
        let length = metadata.len();
        let part_size = part_size(length)?;
        if length <= PART_BYTES {
            let body = UploadBody::file(file, 0, length).await?;
            self.send_upload(Method::PUT, &key, &[], Some(&body))
                .await?;
            return Ok(());
        }
        let response = self
            .send_upload(Method::POST, &key, &query(&[("uploads", "")]), None)
            .await?;
        let upload_id = xml_field(&response.body, "UploadId")?;
        let mut guard = MultipartGuard {
            vault: Arc::clone(self),
            key: key.clone(),
            upload_id: upload_id.clone(),
            disarmed: false,
        };
        let result = async {
            let mut parts = String::new();
            let mut start = 0;
            let mut number = 1;
            while start < length {
                let count = part_size.min(length - start);
                let body = UploadBody::file(file, start, count).await?;
                let pairs = vec![("partNumber".into(), number.to_string()), ("uploadId".into(), upload_id.clone())];
                let response = self.send_upload(Method::PUT, &key, &pairs, Some(&body)).await?;
                let etag = response.header("etag").ok_or_else(|| VaultError::failure("S3 UploadPart response is missing ETag."))?;
                parts.push_str(&format!("<Part><PartNumber>{number}</PartNumber><ETag>{}</ETag></Part>", quick_xml::escape::escape(&etag)));
                start += count;
                number += 1;
            }
            let body = UploadBody::xml(format!("<CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">{parts}</CompleteMultipartUpload>"));
            let pairs = vec![("uploadId".into(), upload_id.clone())];
            let response = self.send_upload(Method::POST, &key, &pairs, Some(&body)).await?;
            // An HTTP 200 with whitespace/error XML must not publish an uploaded dataset.
            xml_field(&response.body, "ETag")?;
            Ok(())
        }.await;
        guard.disarmed = result.is_ok() || self.abort_upload(&key, &upload_id).await.is_ok();
        result
    }

    async fn abort_upload(&self, key: &str, upload_id: &str) -> VaultResult<()> {
        self.send_upload(
            Method::DELETE,
            key,
            &query(&[("uploadId", upload_id)]),
            None,
        )
        .await
        .map(|_| ())
    }

    async fn send_upload(
        &self,
        method: Method,
        key: &str,
        pairs: &[(String, String)],
        payload: Option<&UploadBody>,
    ) -> VaultResult<S3Response> {
        let bucket = self.bucket()?;
        let mut region = self.cached_region(bucket);
        for attempt in 0..MAX_ATTEMPTS {
            let response = self
                .send_once_with_payload(
                    method.clone(),
                    bucket,
                    Some(key),
                    pairs,
                    None,
                    &region,
                    payload,
                )
                .await;
            match response {
                Ok(response) => {
                    let error = parse_error_body(&response.body);
                    if response.status.is_success() && error.code.is_none() {
                        return Ok(response);
                    }
                    if matches!(self.endpoint, super::Endpoint::Aws { .. })
                        && let Some(new_region) =
                            self.redirect_region(bucket, &region, &response).await
                        && new_region != region
                    {
                        region = new_region;
                        self.bucket_regions
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .insert(bucket.to_owned(), region.clone());
                        if attempt + 1 < MAX_ATTEMPTS {
                            continue;
                        }
                    }
                    let retry = response.status.is_server_error()
                        || response.status.as_u16() == 429
                        || matches!(
                            error.code.as_deref(),
                            Some(
                                "SlowDown"
                                    | "InternalError"
                                    | "RequestTimeout"
                                    | "ServiceUnavailable"
                            )
                        );
                    if !retry || attempt + 1 == MAX_ATTEMPTS {
                        return Err(sdk_failure(&response));
                    }
                }
                Err(error) if attempt + 1 == MAX_ATTEMPTS => return Err(error),
                Err(_) => (),
            }
            tokio::time::sleep(Duration::from_millis((100u64 << attempt).min(5_000))).await;
        }
        unreachable!("bounded retries return on their last attempt")
    }
}

struct MultipartGuard {
    vault: Arc<S3DataVault>,
    key: String,
    upload_id: String,
    disarmed: bool,
}
impl Drop for MultipartGuard {
    fn drop(&mut self) {
        if self.disarmed {
            return;
        }
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let (vault, key, id) = (
                Arc::clone(&self.vault),
                self.key.clone(),
                self.upload_id.clone(),
            );
            runtime.spawn(async move {
                if let Err(error) = vault.abort_upload(&key, &id).await {
                    tracing::warn!("Aborting interrupted S3 upload failed: {error}");
                }
            });
        }
    }
}

fn xml_field(bytes: &[u8], field: &str) -> VaultResult<String> {
    let mut reader = quick_xml::Reader::from_reader(bytes);
    loop {
        match reader.read_event() {
            Ok(quick_xml::events::Event::Start(e)) if e.local_name().as_ref() == field => {
                let value = reader.read_text(e.name()).map_err(VaultError::exception)?;
                let value = quick_xml::escape::unescape(value.trim())
                    .map_err(VaultError::exception)?
                    .into_owned();
                if value.is_empty() {
                    return Err(VaultError::failure(format!("Empty S3 {field} response.")));
                }
                return Ok(value);
            }
            Ok(quick_xml::events::Event::Eof) => {
                return Err(VaultError::failure(format!(
                    "S3 response is missing {field}."
                )));
            }
            Err(e) => return Err(VaultError::exception(e)),
            _ => (),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multipart_limits_bound_part_count_and_accept_large_parts_without_allocation() {
        assert_eq!(part_size(0).unwrap(), PART_BYTES);
        assert_eq!(part_size(PART_BYTES * MAX_PARTS).unwrap(), PART_BYTES);
        assert_eq!(
            part_size(MAX_PART_BYTES * MAX_PARTS).unwrap(),
            MAX_PART_BYTES
        );
        assert!(part_size(MAX_PART_BYTES * MAX_PARTS + 1).is_err());
    }
}
