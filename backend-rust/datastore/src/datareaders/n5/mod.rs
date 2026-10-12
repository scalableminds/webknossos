//! Scala-compatible N5 metadata and block reads, including variable-length edge blocks.
use crate::{
    compression::{CompressionSetting, Compressor},
    datareaders::{
        ArrayDataType, ArrayFormat, ArrayOrder, ByteOrder, ChunkBytesAndShape, ChunkContentsCache,
        DatasetArray, DatasetHeader, DimensionSeparator, FillValue, JavaNumber,
        assert_chunk_size_limit,
    },
    datavault::{BoxFuture, ByteRange, VaultError, VaultPath, VaultResult},
    error::{DsError, DsResult},
    models::{AdditionalAxis, AxisOrder, DataSourceId},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

pub const FILENAME_ATTRIBUTES_JSON: &str = "attributes.json";
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct N5Metadata {
    pub dimensions: Vec<i64>,
    pub block_size: Vec<i32>,
    pub data_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compression: Option<serde_json::Map<String, Value>>,
    #[serde(default = "slash", rename = "dimension_separator")]
    pub dimension_separator: String,
}
fn slash() -> String {
    "/".into()
}
#[derive(Debug, Clone)]
pub struct N5Header {
    pub metadata: N5Metadata,
    dtype: ArrayDataType,
    compressor: DsResult<Compressor>,
    offset: Vec<i32>,
    fill: FillValue,
}
impl N5Header {
    pub fn parse(bytes: &[u8]) -> DsResult<Self> {
        let metadata: N5Metadata =
            serde_json::from_slice(bytes).map_err(|e| DsError::failure(e.to_string()))?;
        if metadata.dimensions.len() != metadata.block_size.len()
            || metadata.block_size.is_empty()
            || metadata.block_size.iter().any(|d| *d <= 0)
            || metadata.dimensions.iter().any(|d| *d < 0)
        {
            return Err(DsError::failure("Invalid N5 dimensions/blockSize"));
        }
        use ArrayDataType::*;
        let dtype = match metadata.data_type.as_str() {
            "float64" => F8,
            "float32" => F4,
            "int64" => I8,
            "uint64" => U8,
            "int32" => I4,
            "uint32" => U4,
            "int16" => I2,
            "uint16" => U2,
            "int8" => I1,
            "uint8" => U1,
            name => return Err(DsError::failure(format!("Unsupported N5 dataType: {name}"))),
        };
        let compressor = metadata
            .compression
            .as_ref()
            .map_or(Ok(Compressor::Null), |conf| {
                let settings = conf
                    .iter()
                    .map(|(k, v)| {
                        CompressionSetting::from_json(v)
                            .map(|v| (k.clone(), v))
                            .ok_or_else(|| {
                                DsError::failure(format!("Invalid N5 compression setting: {k}"))
                            })
                    })
                    .collect::<DsResult<_>>()?;
                Compressor::from_n5_settings(&settings)
            });
        let header = Self {
            offset: vec![0; metadata.dimensions.len()],
            metadata,
            dtype,
            compressor,
            fill: FillValue::Number(JavaNumber::Long(0)),
        };
        assert_chunk_size_limit(header.bytes_per_chunk())?;
        Ok(header)
    }
}
impl DatasetHeader for N5Header {
    fn dataset_shape(&self) -> Option<&[i64]> {
        Some(&self.metadata.dimensions)
    }
    fn chunk_shape(&self) -> &[i32] {
        &self.metadata.block_size
    }
    fn dimension_separator(&self) -> DimensionSeparator {
        if self.metadata.dimension_separator == "." {
            DimensionSeparator::Dot
        } else {
            DimensionSeparator::Slash
        }
    }
    fn fill_value(&self) -> &FillValue {
        &self.fill
    }
    fn order(&self) -> ArrayOrder {
        ArrayOrder::F
    }
    fn resolved_data_type(&self) -> ArrayDataType {
        self.dtype
    }
    fn compressor(&self) -> DsResult<&Compressor> {
        self.compressor.as_ref().map_err(Clone::clone)
    }
    fn voxel_offset(&self) -> &[i32] {
        &self.offset
    }
    fn byte_order(&self) -> ByteOrder {
        ByteOrder::BigEndian
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct N5BlockHeader {
    pub block_size: Vec<i32>,
    pub num_elements: i32,
    pub mode: i16,
}
/// Scala N5DataExtractor: all block-header fields are big endian. Mode 2 has no shape.
pub fn extract_block(bytes: &[u8]) -> DsResult<(N5BlockHeader, &[u8])> {
    let eof = || DsError::from_exception("java.io.EOFException");
    let short = |pos| -> DsResult<i16> {
        Ok(i16::from_be_bytes(
            bytes
                .get(pos..pos + 2)
                .ok_or_else(eof)?
                .try_into()
                .expect("2 bytes"),
        ))
    };
    let int = |pos| -> DsResult<i32> {
        Ok(i32::from_be_bytes(
            bytes
                .get(pos..pos + 4)
                .ok_or_else(eof)?
                .try_into()
                .expect("4 bytes"),
        ))
    };
    let mode = short(0)?;
    if mode == 2 {
        return Ok((
            N5BlockHeader {
                mode,
                block_size: Vec::new(),
                num_elements: int(2)?,
            },
            bytes.get(6..).ok_or_else(eof)?,
        ));
    }
    let rank =
        usize::try_from(short(2)?).map_err(|_| DsError::failure("Negative N5 dimension count"))?;
    let mut shape = Vec::with_capacity(rank);
    for d in 0..rank {
        shape.push(int(4 + d * 4)?);
    }
    let mut pos = 4 + rank * 4;
    let count = if mode == 0 {
        shape.iter().fold(1i32, |p, d| p.wrapping_mul(*d))
    } else {
        let n = int(pos)?;
        pos += 4;
        n
    };
    Ok((
        N5BlockHeader {
            block_size: shape,
            num_elements: count,
            mode,
        },
        bytes.get(pos..).ok_or_else(eof)?,
    ))
}
#[derive(Debug)]
struct N5Format;
impl ArrayFormat for N5Format {
    fn read_chunk_bytes_and_shape<'a>(
        &'a self,
        header: &'a dyn DatasetHeader,
        path: &'a VaultPath,
        range: ByteRange,
        token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<ChunkBytesAndShape>> {
        Box::pin(async move {
            let bytes = path.read_bytes(range, token).await?;
            let (block, data) = extract_block(&bytes).map_err(VaultError::from)?;
            let count = block
                .block_size
                .iter()
                .try_fold(1usize, |p, d| {
                    usize::try_from(*d).ok().and_then(|d| p.checked_mul(d))
                })
                .and_then(|p| p.checked_mul(header.bytes_per_element()))
                .ok_or_else(|| VaultError::failure("Invalid N5 block size"))?;
            assert_chunk_size_limit(i64::try_from(count).unwrap_or(i64::MAX))
                .map_err(VaultError::from)?;
            if !block.block_size.is_empty() && block.block_size.len() != header.rank() {
                return Err(VaultError::failure("N5 block rank does not match metadata"));
            }
            let mut decoded = header
                .compressor()
                .and_then(|c| c.decompress(data, Some(count)))
                .map_err(|e| VaultError::from(e.wrap("Could not decompress data chunk.")))?;
            // Scala ignores numElements and pads to the block's own shape.
            if decoded.len() < count {
                decoded.resize(count, 0);
            }
            Ok((decoded, Some(block.block_size)))
        })
    }
}
#[allow(clippy::too_many_arguments)]
pub async fn open_n5_array(
    path: &VaultPath,
    id: DataSourceId,
    layer: &str,
    axis: Option<AxisOrder>,
    channel: Option<i32>,
    additional: Option<Vec<AdditionalAxis>>,
    cache: Arc<ChunkContentsCache>,
    token: Option<&str>,
) -> DsResult<DatasetArray> {
    let bytes = path
        .join(FILENAME_ATTRIBUTES_JSON)
        .read_bytes(ByteRange::Complete, token)
        .await
        .map_err(|e| DsError::from(e.wrap("Could not read header at attributes.json")))?;
    let header = N5Header::parse(&bytes).map_err(|e| e.wrap("Could not parse array header"))?;
    let rank = header.rank() as i32;
    Ok(DatasetArray::new(
        path.clone(),
        id,
        layer,
        Arc::new(header),
        axis.unwrap_or_else(|| AxisOrder::as_zyx_from_rank(rank)),
        channel,
        additional,
        cache,
        Arc::new(N5Format),
    ))
}
