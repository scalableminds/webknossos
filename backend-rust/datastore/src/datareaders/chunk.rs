//! Scala `ChunkReader` and `ChunkTyper` / `ShortcutChunkTyper`.
//!
//! A chunk is cached in its decompressed on-disk form ([`ChunkContents`]); the typed view (Scala
//! `ChunkTyper.wrapAndType`, values converted to little endian, shape reversed for `F` order) and
//! the shortcut view (Scala `ShortcutChunkTyper`, raw bytes as a flat byte array) are derived on
//! use. Scala caches whichever view was loaded first under the same key.

use std::sync::Arc;

use super::data_type::{ArrayDataType, ArrayOrder, ByteOrder};
use super::header::DatasetHeader;
use super::nd_array::{MaDataType, NdArray, create_filled_array, element_count, filled_storage};
use crate::datavault::{BoxFuture, ByteRange, VaultError, VaultPath, VaultResult};
use crate::error::{DsError, DsResult};

/// Scala `Msg.Dataset.Chunk.*`.
pub const MSG_DECOMPRESS_FAILED: &str = "Could not decompress data chunk.";
pub const MSG_CREATE_FROM_FILL_VALUE_FAILED: &str = "Could not create chunk from fill value.";
pub const MSG_SHORTCUT_CREATE_FROM_FILL_VALUE_FAILED: &str =
    "Could not create chunk from fill value (shortcut path).";
pub const MSG_SHORTCUT_WRAP_AND_TYPE_FAILED: &str =
    "Could not wrap and type chunk data (shortcut path).";
pub const MSG_WRAP_AND_TYPE_FAILED: &str = "Could not wrap and type chunk data.";

/// Decompressed chunk bytes and the chunk's own shape, if it reports one (N5).
pub type ChunkBytesAndShape = (Vec<u8>, Option<Vec<i32>>);

/// The contents of one chunk as read from storage (before typing).
#[derive(Debug, Clone, PartialEq)]
pub enum ChunkContents {
    /// Decompressed chunk bytes in the header's byte order and memory order; `shape` is the
    /// chunk shape reported by the chunk itself (N5) or the metadata shape.
    Bytes {
        bytes: Arc<Vec<u8>>,
        shape: Vec<i32>,
    },
    /// Missing chunk (Scala `Empty`): filled with the header's fill value.
    Fill { shape: Vec<i32> },
}

fn shape_usize(shape: &[i32]) -> DsResult<Vec<usize>> {
    shape
        .iter()
        .map(|&d| {
            usize::try_from(d).map_err(|_| {
                let message = format!("{d}");
                DsError {
                    exception: Some(format!("java.lang.NegativeArraySizeException: {message}")),
                    ..DsError::failure(message)
                }
            })
        })
        .collect()
}

/// Scala `ChunkTyper.chunkShapeOrdered`.
pub fn chunk_shape_ordered(header: &dyn DatasetHeader, shape: &[i32]) -> Vec<i32> {
    if header.order() == ArrayOrder::F {
        shape.iter().rev().copied().collect()
    } else {
        shape.to_vec()
    }
}

impl ChunkContents {
    /// Approximate Scala cache weight (`MultiArray.getSizeBytes`).
    pub fn size_bytes(&self, header: &dyn DatasetHeader) -> usize {
        match self {
            Self::Bytes { bytes, .. } => bytes.len(),
            Self::Fill { shape } => shape
                .iter()
                .map(|&d| d.max(0) as usize)
                .product::<usize>()
                .saturating_mul(header.bytes_per_element()),
        }
    }

    /// Scala `ShortcutChunkTyper.wrapAndType` / `createFromFillValue`: a flat byte array (raw
    /// bytes, or `product(shape) * bytesPerElement` bytes of `fillValueNumber.byteValue`).
    pub fn shortcut_view(&self, header: &dyn DatasetHeader) -> DsResult<NdArray> {
        match self {
            Self::Bytes { bytes, .. } => {
                NdArray::from_storage(MaDataType::Byte, vec![bytes.len()], Arc::clone(bytes))
                    .map_err(|e| e.wrap(MSG_SHORTCUT_WRAP_AND_TYPE_FAILED))
            }
            Self::Fill { shape } => {
                let count = shape_usize(shape)
                    .and_then(|s| {
                        element_count(&s)
                            .and_then(|n| n.checked_mul(header.bytes_per_element()))
                            .ok_or_else(|| DsError::failure("array size overflow"))
                    })
                    .map_err(|e| e.wrap(MSG_SHORTCUT_CREATE_FROM_FILL_VALUE_FAILED))?;
                let storage = filled_storage(
                    MaDataType::Byte,
                    count,
                    header.fill_value_number(),
                    header.fill_value_boolean(),
                );
                NdArray::from_storage(MaDataType::Byte, vec![count], Arc::new(storage))
            }
        }
    }

    /// Scala `ChunkTyper.wrapAndType` / `createFromFillValue` for the header's data type.
    pub fn typed_view(&self, header: &dyn DatasetHeader) -> DsResult<NdArray> {
        let data_type = header.resolved_data_type();
        let ma_type = MaDataType::for_array_data_type(data_type);
        match self {
            Self::Fill { shape } => {
                let ordered = shape_usize(&chunk_shape_ordered(header, shape))
                    .map_err(|e| e.wrap(MSG_CREATE_FROM_FILL_VALUE_FAILED))?;
                create_filled_array(
                    ma_type,
                    ordered,
                    header.fill_value_number(),
                    header.fill_value_boolean(),
                )
                .map_err(|e| e.wrap(MSG_CREATE_FROM_FILL_VALUE_FAILED))
            }
            Self::Bytes { bytes, shape } => wrap_and_type(header, data_type, ma_type, bytes, shape)
                .map_err(|e| e.wrap(MSG_WRAP_AND_TYPE_FAILED)),
        }
    }
}

fn buffer_underflow() -> DsError {
    DsError {
        exception: Some("java.nio.BufferUnderflowException".into()),
        ..DsError::failure("java.nio.BufferUnderflowException")
    }
}

fn wrap_and_type(
    header: &dyn DatasetHeader,
    data_type: ArrayDataType,
    ma_type: MaDataType,
    bytes: &Arc<Vec<u8>>,
    shape: &[i32],
) -> DsResult<NdArray> {
    let ordered = shape_usize(&chunk_shape_ordered(header, shape))?;
    let count = element_count(&ordered).ok_or_else(|| DsError::failure("array size overflow"))?;
    let size = ma_type.size();
    if data_type == ArrayDataType::Bool {
        // Scala: `bytes.zipWithIndex.foreach { typedStorage(i) = b != 0 }`
        if bytes.len() > count {
            let message = format!("Index {count} out of bounds for length {count}");
            return Err(DsError {
                exception: Some(format!(
                    "java.lang.ArrayIndexOutOfBoundsException: {message}"
                )),
                ..DsError::failure(message)
            });
        }
        let mut storage: Vec<u8> = bytes.iter().map(|&b| u8::from(b != 0)).collect();
        storage.resize(count, 0);
        return NdArray::from_storage(ma_type, ordered, Arc::new(storage));
    }
    let needed = count
        .checked_mul(size)
        .ok_or_else(|| DsError::failure("array size overflow"))?;
    if bytes.len() < needed {
        return Err(buffer_underflow());
    }
    let storage = if size == 1 || header.byte_order() == ByteOrder::LittleEndian {
        Arc::clone(bytes)
    } else {
        let mut swapped = bytes[..needed].to_vec();
        for element in swapped.chunks_exact_mut(size) {
            element.reverse();
        }
        Arc::new(swapped)
    };
    NdArray::from_storage(ma_type, ordered, storage)
}

/// Scala `ChunkReader.readChunkBytesAndShape` default: read the byte range and decompress it with
/// the header's compressor. `VaultError::NotFound` (Scala `Empty`) means "use the fill value".
pub async fn default_read_chunk_bytes_and_shape(
    header: &dyn DatasetHeader,
    path: &VaultPath,
    range: ByteRange,
    user_token: Option<&str>,
) -> VaultResult<ChunkBytesAndShape> {
    let bytes = path.read_bytes(range, user_token).await?;
    let decompressed = header
        .compressor()
        .and_then(|c| c.decompress(&bytes, None))
        .map_err(|e| VaultError::Failure(e.wrap(MSG_DECOMPRESS_FAILED)))?;
    Ok((decompressed, None))
}

/// Format-specific hooks of Scala `DatasetArray` subclasses (`getChunkFilename`,
/// `getShardedChunkPathAndRange`, `chunkReader.readChunkBytesAndShape`). `ZarrArray` uses the
/// defaults.
pub trait ArrayFormat: Send + Sync + std::fmt::Debug {
    /// Optional decoded-chunk adapter for format libraries that own addressing and sharding.
    /// The shared DatasetArray cache and its coordinate assembly still wrap these reads.
    fn source_chunk<'a>(
        &'a self,
        root: &'a VaultPath,
        chunk_index: &'a [i64],
        user_token: Option<&'a str>,
    ) -> Option<BoxFuture<'a, DsResult<ChunkContents>>> {
        let _ = (root, chunk_index, user_token);
        None
    }

    /// Scala `getChunkFilename` override; `default_name` is the `DatasetArray` default
    /// (indices joined by the dimension separator, z dropped for 2-d data).
    fn chunk_filename(&self, chunk_index: &[i64], default_name: String) -> String {
        let _ = chunk_index;
        default_name
    }

    /// Scala `getShardedChunkPathAndRange` (only called when `header.is_sharded()`).
    /// `VaultError::NotFound` means the chunk is absent (fill value).
    fn sharded_chunk_path_and_range<'a>(
        &'a self,
        vault_path: &'a VaultPath,
        chunk_index: &'a [i64],
        user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<(VaultPath, ByteRange)>> {
        let _ = (vault_path, chunk_index, user_token);
        Box::pin(async {
            Err(VaultError::failure(
                "an implementation is missing (getShardedChunkPathAndRange)",
            ))
        })
    }

    /// Scala `ChunkReader.readChunkBytesAndShape`: decompressed bytes and, for formats whose
    /// chunks carry their own shape (N5), that shape.
    fn read_chunk_bytes_and_shape<'a>(
        &'a self,
        header: &'a dyn DatasetHeader,
        path: &'a VaultPath,
        range: ByteRange,
        user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<ChunkBytesAndShape>> {
        Box::pin(default_read_chunk_bytes_and_shape(
            header, path, range, user_token,
        ))
    }
}

/// The default format hooks (Zarr v2).
#[derive(Debug, Default, Clone, Copy)]
pub struct DefaultArrayFormat;

impl ArrayFormat for DefaultArrayFormat {}

/// Scala `ChunkReader.read`: bytes and shape, the fill value for a missing chunk, or a failure
/// annotated with `Reading chunk at <path> failed`.
pub async fn read_chunk(
    format: &dyn ArrayFormat,
    header: &dyn DatasetHeader,
    path: &VaultPath,
    chunk_shape_from_metadata: Vec<i32>,
    range: ByteRange,
    user_token: Option<&str>,
) -> DsResult<ChunkContents> {
    match format
        .read_chunk_bytes_and_shape(header, path, range, user_token)
        .await
    {
        Ok((bytes, shape)) => Ok(ChunkContents::Bytes {
            bytes: Arc::new(bytes),
            shape: shape.unwrap_or(chunk_shape_from_metadata),
        }),
        Err(VaultError::NotFound) => Ok(ChunkContents::Fill {
            shape: chunk_shape_from_metadata,
        }),
        Err(VaultError::Failure(e)) => Err(e.wrap(format!("Reading chunk at {path} failed"))),
    }
}
