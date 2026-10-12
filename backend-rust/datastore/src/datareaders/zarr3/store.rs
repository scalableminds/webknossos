//! Read-only zarrs store using existing credentialized, token-aware datastore vaults.
use crate::datavault::{ByteRange, VaultError, VaultPath};
use futures::{StreamExt, stream};
use zarrs::storage::{
    AsyncMaybeBytesIterator, AsyncReadableStorageTraits, StorageError, StoreKey,
    byte_range::{ByteRange as ZRange, ByteRangeIterator},
};

#[derive(Clone)]
pub struct VaultStore {
    pub root: VaultPath,
    pub token: Option<String>,
    pub index: Option<IndexValidation>,
}
#[derive(Debug, Clone)]
pub struct IndexValidation {
    pub range: ByteRange,
    pub big_endian: bool,
    pub checksum: bool,
}
impl IndexValidation {
    fn validate(&self, bytes: &[u8]) -> Result<(), StorageError> {
        let invalid = || StorageError::Other("Invalid Zarr3 shard index byte range".into());
        let payload = if self.checksum {
            bytes
                .get(..bytes.len().checked_sub(4).ok_or_else(invalid)?)
                .ok_or_else(invalid)?
        } else {
            bytes
        };
        let (pairs, rest) = payload.as_chunks::<16>();
        if !rest.is_empty() {
            return Err(invalid());
        }
        for pair in pairs {
            let number = |b: [u8; 8]| {
                if self.big_endian {
                    u64::from_be_bytes(b)
                } else {
                    u64::from_le_bytes(b)
                }
            };
            let offset = number(pair[..8].try_into().expect("8 bytes"));
            let size = number(pair[8..].try_into().expect("8 bytes"));
            if offset == u64::MAX && size == u64::MAX {
                continue;
            }
            let end = offset.checked_add(size).ok_or_else(invalid)?;
            if end > i64::MAX as u64 || size > 1024 * 1024 * 1024 {
                return Err(invalid());
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for VaultStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VaultStore")
            .field("root", &self.root)
            .field("token_configured", &self.token.is_some())
            .finish()
    }
}
impl VaultStore {
    async fn read(
        &self,
        key: &StoreKey,
        range: ZRange,
    ) -> Result<Option<bytes::Bytes>, StorageError> {
        let path = self.root.join(key.as_str());
        let range = match range {
            ZRange::FromStart(start, Some(len)) => ByteRange::StartEnd {
                start,
                end: start
                    .checked_add(len)
                    .ok_or_else(|| StorageError::Other("Byte range overflow".into()))?,
            },
            ZRange::FromStart(0, None) => ByteRange::Complete,
            ZRange::FromStart(start, None) => {
                let Some(end) = self.size_key(key).await? else {
                    return Ok(None);
                };
                if start > end {
                    return Err(StorageError::Other("Byte range exceeds file".into()));
                }
                ByteRange::StartEnd { start, end }
            }
            ZRange::Suffix(length) => ByteRange::Suffix { length },
        };
        match path.read_bytes(range, self.token.as_deref()).await {
            Ok(b) => {
                if let Some(index) = &self.index
                    && range == index.range
                {
                    index.validate(&b)?;
                }
                Ok(Some(b))
            }
            Err(VaultError::NotFound) => Ok(None),
            Err(VaultError::Failure(e)) => Err(StorageError::Other(e.to_string())),
        }
    }
}
#[async_trait::async_trait]
impl AsyncReadableStorageTraits for VaultStore {
    async fn get_partial_many<'a>(
        &'a self,
        key: &StoreKey,
        ranges: ByteRangeIterator<'a>,
    ) -> Result<AsyncMaybeBytesIterator<'a>, StorageError> {
        let mut results = Vec::new();
        for range in ranges {
            let Some(bytes) = self.read(key, range).await? else {
                return Ok(None);
            };
            results.push(Ok(bytes));
        }
        Ok(Some(stream::iter(results).boxed()))
    }
    async fn size_key(&self, key: &StoreKey) -> Result<Option<u64>, StorageError> {
        let path = self.root.join(key.as_str());
        if let Ok(local) = path.upath().to_local_path() {
            return match tokio::fs::metadata(local).await {
                Ok(m) => Ok(Some(m.len())),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(StorageError::from(e)),
            };
        }
        match path
            .read_bytes_encoding_and_range_header(
                ByteRange::StartEnd { start: 0, end: 1 },
                self.token.as_deref(),
            )
            .await
        {
            Ok(raw) => raw
                .content_range
                .and_then(|r| r.rsplit('/').next().and_then(|s| s.parse().ok()))
                .map(Some)
                .ok_or_else(|| StorageError::UnknownKeySize(key.clone())),
            Err(VaultError::NotFound) => Ok(None),
            Err(VaultError::Failure(e)) => Err(StorageError::Other(e.to_string())),
        }
    }
    fn supports_get_partial(&self) -> bool {
        true
    }
}
