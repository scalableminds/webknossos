//! Scala `FileSystemDataVault`.
//!
//! The vault itself only requires local, absolute paths; whether a user may reference a local
//! path at all is decided by `DataVaultService::path_is_allowed_to_add_directly` (local directory
//! whitelist), exactly as in Scala.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use bytes::Bytes;

use super::{BoxFuture, ByteRange, DataVault, Encoding, RawRead, UPath, VaultError, VaultResult};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct FileSystemDataVault;

impl FileSystemDataVault {
    fn local_path(path: &UPath) -> VaultResult<PathBuf> {
        let local = path.to_local_path().map_err(|e| {
            VaultError::Failure(e).wrap(format!(
                "trying to read from FileSystemDataVault, but path {path} is not local."
            ))
        })?;
        if !path.is_absolute() {
            return Err(VaultError::failure(format!(
                "trying to read from FileSystemDataVault, but path {path} is not absolute."
            )));
        }
        Ok(local)
    }
}

fn io_failure(error: std::io::Error) -> VaultError {
    VaultError::exception(error)
}

/// Java `AsynchronousFileChannel.read` into a buffer of `length` bytes: a short read (EOF) leaves
/// the rest of the buffer zero, and Scala returns the whole buffer.
fn read_at(path: &Path, position: u64, length: u64) -> VaultResult<Vec<u8>> {
    let length = usize::try_from(length)
        .ok()
        .filter(|l| *l <= i32::MAX as usize)
        .ok_or_else(|| VaultError::exception("java.lang.ArithmeticException: integer overflow"))?;
    let mut file = File::open(path).map_err(io_failure)?;
    file.seek(SeekFrom::Start(position)).map_err(io_failure)?;
    let mut buffer = vec![0u8; length];
    let mut filled = 0;
    while filled < length {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(io_failure(e)),
        }
    }
    Ok(buffer)
}

fn read_local(path: &Path, range: ByteRange) -> VaultResult<RawRead> {
    // Scala `Files.exists` (follows symlinks; directories exist too).
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(VaultError::NotFound),
        Err(e) => return Err(io_failure(e)),
    };
    let file_size = metadata.len();
    let (bytes, content_range) = match range {
        ByteRange::Complete => (read_at(path, 0, file_size)?, None),
        ByteRange::StartEnd { start, end } => (
            read_at(path, start, end.saturating_sub(start))?,
            range.to_content_range_header_with_length(file_size),
        ),
        ByteRange::Suffix { length } => {
            let start = file_size.saturating_sub(length);
            (
                read_at(path, start, file_size - start)?,
                range.to_content_range_header_with_length(file_size),
            )
        }
    };
    Ok(RawRead {
        bytes: Bytes::from(bytes),
        encoding: Encoding::Identity,
        content_range,
    })
}

/// Commons-IO `FileUtils.sizeOfAsBigInteger`: file length, or the recursive sum of file lengths of
/// a directory (symbolic links are not followed).
fn size_of(path: &Path) -> std::io::Result<u64> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_dir() {
        return Ok(metadata.len());
    }
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let metadata = std::fs::symlink_metadata(entry.path())?;
            if metadata.is_dir() {
                stack.push(entry.path());
            } else if metadata.is_file() {
                total += metadata.len();
            }
        }
    }
    Ok(total)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> VaultResult<T> + Send + 'static,
) -> VaultResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(VaultError::exception)?
}

impl DataVault for FileSystemDataVault {
    fn read_bytes_encoding_and_range_header<'a>(
        &'a self,
        path: &'a UPath,
        range: ByteRange,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<RawRead>> {
        Box::pin(async move {
            let local = Self::local_path(path)?;
            blocking(move || read_local(&local, range)).await
        })
    }

    fn list_directory<'a>(
        &'a self,
        path: &'a UPath,
        max_items: usize,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<UPath>>> {
        Box::pin(async move {
            let local = Self::local_path(path)?;
            blocking(move || {
                if !local.is_dir() {
                    return Ok(Vec::new());
                }
                let mut directories: Vec<PathBuf> = std::fs::read_dir(&local)
                    .map_err(io_failure)?
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .filter(|p| p.is_dir())
                    .collect();
                // Java `Files.list` order is unspecified; sort for deterministic truncation.
                directories.sort();
                Ok(directories
                    .iter()
                    .take(max_items)
                    .map(|p| UPath::from_local_path(p))
                    .collect())
            })
            .await
        })
    }

    fn used_storage_bytes<'a>(
        &'a self,
        path: &'a UPath,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<u64>> {
        Box::pin(async move {
            let local = Self::local_path(path)?;
            blocking(move || {
                size_of(&local).map_err(|e| io_failure(e).wrap("Failed to get used storage bytes"))
            })
            .await
        })
    }

    fn kind(&self) -> &'static str {
        "FileSystemDataVault"
    }
}
