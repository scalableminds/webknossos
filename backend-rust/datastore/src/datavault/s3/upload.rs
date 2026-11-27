//! Managed uploads: single `PutObject` for small files, multipart uploads (one part in memory
//! at a time) above [`PART_BYTES`]. Failed and cancelled multipart uploads are aborted.
use super::{S3DataVault, VaultError, VaultResult, cloud};
use object_store::{
    Attribute, Attributes, MultipartUpload, PutMultipartOptions, PutOptions, PutPayload,
};
use std::path::Path;
use tokio::io::AsyncReadExt;

const PART_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PART_BYTES: u64 = 5 * 1024 * 1024 * 1024;
const MAX_PARTS: u64 = 10_000;
const CONTENT_TYPE: &str = "application/octet-stream";

fn part_size(length: u64) -> VaultResult<u64> {
    let size = PART_BYTES.max(length.div_ceil(MAX_PARTS));
    if size > MAX_PART_BYTES {
        return Err(VaultError::failure(
            "File exceeds S3 multipart upload limits.",
        ));
    }
    Ok(size)
}

fn attributes() -> Attributes {
    Attributes::from_iter([(Attribute::ContentType, CONTENT_TYPE)])
}

impl S3DataVault {
    /// Upload one regular file to `target`.
    pub async fn upload_file(&self, file: &Path, target: &super::UPath) -> VaultResult<()> {
        let key = Self::object_key(target)?;
        let location = cloud::object_path(&key)?;
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
        let store = self.store().await?;
        if length <= PART_BYTES {
            let bytes = tokio::fs::read(file).await.map_err(VaultError::exception)?;
            let options = PutOptions {
                attributes: attributes(),
                ..PutOptions::default()
            };
            store
                .put_opts(&location, PutPayload::from(bytes), options)
                .await
                .map_err(cloud::failure)?;
            return Ok(());
        }
        let options = PutMultipartOptions {
            attributes: attributes(),
            ..PutMultipartOptions::default()
        };
        let upload = store
            .put_multipart_opts(&location, options)
            .await
            .map_err(cloud::failure)?;
        let mut guard = AbortGuard(Some(upload));
        let result = async {
            let mut source = tokio::fs::File::open(file)
                .await
                .map_err(VaultError::exception)?;
            let mut remaining = length;
            while remaining > 0 {
                let count = part_size.min(remaining);
                let mut part = vec![0; count as usize];
                source
                    .read_exact(&mut part)
                    .await
                    .map_err(VaultError::exception)?;
                guard
                    .upload()
                    .put_part(PutPayload::from(part))
                    .await
                    .map_err(cloud::failure)?;
                remaining -= count;
            }
            guard.upload().complete().await.map_err(cloud::failure)?;
            Ok(())
        }
        .await;
        let mut upload = guard
            .0
            .take()
            .expect("the guard holds the upload until here");
        if result.is_err()
            && let Err(error) = upload.abort().await
        {
            tracing::warn!("Aborting failed S3 upload failed: {error}");
        }
        result
    }
}

/// Aborts the multipart upload if the upload future is dropped before it finished.
struct AbortGuard(Option<Box<dyn MultipartUpload>>);

impl AbortGuard {
    fn upload(&mut self) -> &mut Box<dyn MultipartUpload> {
        self.0
            .as_mut()
            .expect("the guard holds the upload until it finished")
    }
}

impl Drop for AbortGuard {
    fn drop(&mut self) {
        let Some(mut upload) = self.0.take() else {
            return;
        };
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Err(error) = upload.abort().await {
                    tracing::warn!("Aborting interrupted S3 upload failed: {error}");
                }
            });
        }
    }
}

#[cfg(test)]
mod datavault_upload_tests;
