//! Zarr v3 adapter: zarrs handles codec validation, transpose and range-based sharding.
mod codecs;
pub mod ngff;
mod store;

use crate::{
    compression::Compressor,
    datareaders::{
        ArrayDataType, ArrayFormat, ArrayOrder, ByteOrder, ChunkContents, ChunkContentsCache,
        DatasetArray, DatasetHeader, DimensionSeparator, FillValue, assert_chunk_size_limit,
    },
    datavault::{BoxFuture, ByteRange, VaultPath},
    error::{DsError, DsResult},
    models::{AdditionalAxis, AxisOrder, DataSourceId},
};
use serde_json::Value;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use store::{IndexValidation, VaultStore};
use zarrs::{
    array::{
        Array, ArrayBytes, ArrayShardedExt, AsyncArrayShardedReadableExt,
        AsyncArrayShardedReadableExtCache, CodecOptions,
    },
    metadata::ArrayMetadata,
};

pub const FILENAME_ZARR_JSON: &str = "zarr.json";
#[derive(Debug, Clone)]
pub struct Zarr3Header {
    shape: Vec<i64>,
    chunk: Vec<i32>,
    offset: Vec<i32>,
    dtype: ArrayDataType,
    fill: FillValue,
    order: ArrayOrder,
    endian: ByteOrder,
    separator: DimensionSeparator,
    sharded: bool,
}
impl DatasetHeader for Zarr3Header {
    fn dataset_shape(&self) -> Option<&[i64]> {
        Some(&self.shape)
    }
    fn chunk_shape(&self) -> &[i32] {
        &self.chunk
    }
    fn dimension_separator(&self) -> DimensionSeparator {
        self.separator
    }
    fn fill_value(&self) -> &FillValue {
        &self.fill
    }
    fn order(&self) -> ArrayOrder {
        self.order
    }
    fn resolved_data_type(&self) -> ArrayDataType {
        self.dtype
    }
    fn compressor(&self) -> DsResult<&Compressor> {
        Ok(&Compressor::Null)
    }
    fn voxel_offset(&self) -> &[i32] {
        &self.offset
    }
    fn byte_order(&self) -> ByteOrder {
        self.endian
    }
    fn is_sharded(&self) -> bool {
        self.sharded
    }
}
impl Zarr3Header {
    /// Scala `Zarr3ArrayHeader` reads + `assertValid` for exploration: shape and data type only
    /// (no array is opened, so chunk geometry is not needed).
    pub fn for_exploration(json: &Value) -> DsResult<Self> {
        if json["zarr_format"] != 3 {
            return Err(error(format!(
                "Expected zarr_format 3, got {}",
                json["zarr_format"]
            )));
        }
        if json["node_type"] != "array" {
            return Err(error(format!(
                "Expected node_type 'array', got {}",
                json["node_type"]
            )));
        }
        let shape: Vec<i64> = serde_json::from_value(json["shape"].clone()).map_err(error)?;
        let dtype = json["data_type"]
            .as_str()
            .ok_or_else(|| error("Zarr3 data_type must be a string"))
            .and_then(dtype)
            .map_err(|e| e.wrap("Data type is not supported"))?;
        Ok(Self {
            offset: vec![0; shape.len()],
            chunk: vec![1; shape.len()],
            shape,
            dtype,
            fill: FillValue::default(),
            order: ArrayOrder::F,
            endian: ByteOrder::LittleEndian,
            separator: DimensionSeparator::Slash,
            sharded: false,
        })
    }
}

fn error(e: impl std::fmt::Display) -> DsError {
    DsError::failure(e.to_string())
}

fn dtype(name: &str) -> DsResult<ArrayDataType> {
    use ArrayDataType::*;
    Ok(match name {
        "uint8" => U1,
        "uint16" => U2,
        "uint32" => U4,
        "uint64" => U8,
        "int8" => I1,
        "int16" => I2,
        "int32" => I4,
        "int64" => I8,
        "float32" => F4,
        "float64" => F8,
        "bool" => Bool,
        _ => return Err(error(format!("Unsupported Zarr3 data type: {name}"))),
    })
}
/// Normalize the legacy `endian` alias and Scala's C/F transpose strings to Zarr metadata.
fn normalize(codecs: &mut Value, rank: usize) -> DsResult<bool> {
    let list = codecs
        .as_array_mut()
        .ok_or_else(|| error("Zarr3 codecs must be an array"))?;
    let mut fortran = false;
    for codec in list {
        if codec["name"] == "endian" {
            codec["name"] = "bytes".into();
        }
        match codec["name"].as_str().unwrap_or_default() {
            "transpose" => {
                let value = &codec["configuration"]["order"];
                let order = if value == "F" {
                    (0..rank).rev().collect::<Vec<_>>()
                } else if value == "C" {
                    (0..rank).collect()
                } else {
                    serde_json::from_value::<Vec<usize>>(value.clone()).map_err(error)?
                };
                if order != (0..rank).collect::<Vec<_>>()
                    && order != (0..rank).rev().collect::<Vec<_>>()
                {
                    return Err(error(
                        "Only C/F transpose orders are supported by the datastore",
                    ));
                }
                fortran |= order == (0..rank).rev().collect::<Vec<_>>();
                codec["configuration"]["order"] = serde_json::to_value(order).map_err(error)?;
            }
            "sharding_indexed" => {
                fortran |= normalize(&mut codec["configuration"]["codecs"], rank)?;
                normalize(&mut codec["configuration"]["index_codecs"], rank + 1)?;
            }
            "bytes" => {
                if codec["configuration"].is_null() {
                    codec["configuration"] = serde_json::json!({"endian":"little"});
                } else if codec["configuration"]["endian"].is_null() {
                    codec["configuration"]["endian"] = "little".into();
                }
            }
            "blosc" | "gzip" | "zstd" | "crc32c" => {}
            name => return Err(error(format!("Codec {name} is not supported."))),
        }
    }
    Ok(fortran)
}

struct DecoderSession {
    token: Option<String>,
    created: Instant,
    accessed: Instant,
    cache: Arc<AsyncArrayShardedReadableExtCache>,
}
struct Zarr3Format {
    array: Array<VaultStore>,
    header: Zarr3Header,
    sessions: Mutex<Vec<DecoderSession>>,
}
impl std::fmt::Debug for Zarr3Format {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Zarr3Format")
            .field("header", &self.header)
            .finish()
    }
}
impl Zarr3Format {
    async fn session(
        &self,
        array: &Array<VaultStore>,
        token: Option<&str>,
    ) -> Arc<AsyncArrayShardedReadableExtCache> {
        let cache = {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            let now = Instant::now();
            sessions.retain(|s| {
                now.duration_since(s.created) < Duration::from_secs(7200)
                    && now.duration_since(s.accessed) < Duration::from_secs(3600)
            });
            if let Some(s) = sessions.iter_mut().find(|s| s.token.as_deref() == token) {
                s.accessed = now;
                Arc::clone(&s.cache)
            } else {
                if sessions.len() >= 8 {
                    let oldest = sessions
                        .iter()
                        .enumerate()
                        .min_by_key(|(_, s)| s.accessed)
                        .map(|(i, _)| i)
                        .unwrap();
                    sessions.swap_remove(oldest);
                }
                let cache = Arc::new(AsyncArrayShardedReadableExtCache::new(array));
                sessions.push(DecoderSession {
                    token: token.map(str::to_owned),
                    created: now,
                    accessed: now,
                    cache: Arc::clone(&cache),
                });
                cache
            }
        };
        if cache.len().await >= 1000 {
            cache.clear().await;
        }
        cache
    }
}
impl ArrayFormat for Zarr3Format {
    fn source_chunk<'a>(
        &'a self,
        root: &'a VaultPath,
        index: &'a [i64],
        token: Option<&'a str>,
    ) -> Option<BoxFuture<'a, DsResult<ChunkContents>>> {
        Some(Box::pin(async move {
            let has_adapter_z = index.len() > self.header.rank();
            let physical = index
                .get(..self.header.rank())
                .ok_or_else(|| error("Zarr3 chunk index rank mismatch"))?;
            let index: Vec<u64> = physical
                .iter()
                .map(|i| u64::try_from(*i).map_err(error))
                .collect::<DsResult<_>>()?;
            let array = self.array.with_storage(Arc::new(VaultStore {
                root: root.clone(),
                token: token.map(str::to_owned),
                index: self.array.storage().index.clone(),
            }));
            let cache = self.session(&array, token).await;
            let mut chunk_shape = self.header.chunk.clone();
            if has_adapter_z {
                chunk_shape.push(1);
            }
            let bytes: ArrayBytes = if self.header.sharded {
                array
                    .async_retrieve_subchunk_opt(&cache, &index, &CodecOptions::default())
                    .await
                    .map_err(|e| error(e).wrap("Could not decode Zarr3 data chunk"))?
            } else {
                let Some(bytes) = array
                    .async_retrieve_chunk_if_exists::<ArrayBytes>(&index)
                    .await
                    .map_err(|e| error(e).wrap("Could not decode Zarr3 data chunk"))?
                else {
                    return Ok(ChunkContents::Fill { shape: chunk_shape });
                };
                bytes
            };
            let bytes = bytes.into_fixed().map_err(error)?;
            // zarrs returns native-endian C layout. Restore Scala's header layout for DatasetArray,
            // including its whole-chunk shortcut. This is a permutation, not numeric conversion.
            let size = self.header.bytes_per_element();
            let shape = &self.header.chunk;
            let count = shape.iter().map(|d| *d as usize).product::<usize>();
            if bytes.len() != count * size {
                return Err(error("Unexpected decoded Zarr3 chunk size"));
            }
            let mut output = vec![0u8; bytes.len()];
            for source in 0..count {
                let destination = if self.header.order == ArrayOrder::F {
                    let mut rem = source;
                    let mut stride = count;
                    let mut dest = 0;
                    let mut fstride = 1;
                    for &d in shape {
                        stride /= d as usize;
                        let c = rem / stride;
                        rem %= stride;
                        dest += c * fstride;
                        fstride *= d as usize;
                    }
                    dest
                } else {
                    source
                };
                output[destination * size..(destination + 1) * size]
                    .copy_from_slice(&bytes[source * size..(source + 1) * size]);
                if size > 1
                    && (self.header.endian == ByteOrder::LittleEndian)
                        != cfg!(target_endian = "little")
                {
                    output[destination * size..(destination + 1) * size].reverse();
                }
            }
            Ok(ChunkContents::Bytes {
                bytes: Arc::new(output),
                shape: chunk_shape,
            })
        }))
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn open_zarr3_array(
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
        .join(FILENAME_ZARR_JSON)
        .read_bytes(ByteRange::Complete, token)
        .await
        .map_err(|e| DsError::from(e.wrap("Could not read header at zarr.json")))?;
    let mut json: Value = serde_json::from_slice(&bytes)
        .map_err(|e| error(e).wrap("Could not parse array header"))?;
    if json["zarr_format"] != 3 {
        return Err(error(format!(
            "Expected zarr_format 3, got {}",
            json["zarr_format"]
        )));
    }
    if json["node_type"] != "array" {
        return Err(error(format!(
            "Expected node_type 'array', got {}",
            json["node_type"]
        )));
    }
    let shape: Vec<i64> = serde_json::from_value(json["shape"].clone()).map_err(error)?;
    let dtype = dtype(
        json["data_type"]
            .as_str()
            .ok_or_else(|| error("Zarr3 data_type must be a string"))?,
    )?;
    let fill = if json["fill_value"].is_boolean() {
        FillValue::String(json["fill_value"].to_string())
    } else {
        FillValue::from_json(&json["fill_value"])
            .ok_or_else(|| error("Invalid Zarr3 fill value"))?
    };
    let endian = if json["codecs"].as_array().is_some_and(|c| {
        c.iter().any(|c| {
            (c["name"] == "bytes" || c["name"] == "endian") && c["configuration"]["endian"] == "big"
        })
    }) {
        ByteOrder::BigEndian
    } else {
        ByteOrder::LittleEndian
    };
    let f = normalize(&mut json["codecs"], shape.len())?;
    let key = &mut json["chunk_key_encoding"];
    if key["configuration"].is_null() {
        key["configuration"] = serde_json::json!({});
    }
    if key["configuration"]["separator"].is_null() {
        key["configuration"]["separator"] = if key["name"] == "v2" {
            ".".into()
        } else {
            "/".into()
        };
    }
    let separator = if key["configuration"]["separator"] == "." {
        DimensionSeparator::Dot
    } else {
        DimensionSeparator::Slash
    };
    let index_validation = if let Some(shard) = json["codecs"]
        .as_array()
        .and_then(|c| c.iter().find(|c| c["name"] == "sharding_indexed"))
    {
        // Scala supports bytes plus optional CRC32C for the index. Validate offsets before
        // zarrs performs unchecked offset+length arithmetic on an untrusted index.
        let conf = &shard["configuration"];
        let index_codecs = conf["index_codecs"]
            .as_array()
            .ok_or_else(|| error("Missing Zarr3 index codecs"))?;
        if index_codecs.iter().filter(|c| c["name"] == "bytes").count() != 1
            || index_codecs
                .iter()
                .filter(|c| c["name"] == "crc32c")
                .count()
                > 1
            || index_codecs.len() > 2
        {
            return Err(error("Unsupported Zarr3 index codec configuration"));
        }
        let outer: Vec<u64> =
            serde_json::from_value(json["chunk_grid"]["configuration"]["chunk_shape"].clone())
                .map_err(error)?;
        let inner: Vec<u64> = serde_json::from_value(conf["chunk_shape"].clone()).map_err(error)?;
        if outer.len() != inner.len() || outer.len() != shape.len() {
            return Err(error("Invalid Zarr3 shard shape"));
        }
        let mut entries = 1u64;
        for (o, i) in outer.iter().zip(&inner) {
            if *i == 0 || *o == 0 || o % i != 0 {
                return Err(error("Invalid Zarr3 shard shape"));
            }
            entries = entries
                .checked_mul(o / i)
                .ok_or_else(|| error("Zarr3 index size overflow"))?;
        }
        let checksum = index_codecs.iter().any(|c| c["name"] == "crc32c");
        let length = entries
            .checked_mul(16)
            .and_then(|n| n.checked_add(if checksum { 4 } else { 0 }))
            .ok_or_else(|| error("Zarr3 index size overflow"))?;
        assert_chunk_size_limit(i64::try_from(length).unwrap_or(i64::MAX))?;
        let range = if conf["index_location"] == "start" {
            ByteRange::StartEnd {
                start: 0,
                end: length,
            }
        } else {
            ByteRange::Suffix { length }
        };
        let big_endian = index_codecs
            .iter()
            .any(|c| c["name"] == "bytes" && c["configuration"]["endian"] == "big");
        Some(IndexValidation {
            range,
            big_endian,
            checksum,
        })
    } else {
        None
    };
    let metadata: ArrayMetadata =
        serde_json::from_value(json).map_err(|e| error(e).wrap("Could not parse array header"))?;
    let store = Arc::new(VaultStore {
        root: path.clone(),
        token: None,
        index: index_validation,
    });
    let array = Array::new_with_metadata(store, "/", metadata)
        .map_err(|e| error(e).wrap("Could not open zarr3 array"))?;
    let chunk = array
        .effective_subchunk_shape()
        .unwrap_or(array.chunk_shape(&vec![0; shape.len()]).map_err(error)?);
    let chunk: Vec<i32> = chunk
        .iter()
        .map(|d| i32::try_from(d.get()).map_err(error))
        .collect::<DsResult<_>>()?;
    let header = Zarr3Header {
        offset: vec![0; shape.len()],
        shape,
        chunk,
        dtype,
        fill,
        order: if f { ArrayOrder::F } else { ArrayOrder::C },
        endian,
        separator,
        sharded: array.is_sharded(),
    };
    assert_chunk_size_limit(header.bytes_per_chunk())?;
    let rank = header.rank() as i32;
    let format = Arc::new(Zarr3Format {
        array,
        header: header.clone(),
        sessions: Mutex::new(Vec::new()),
    });
    Ok(DatasetArray::new(
        path.clone(),
        id,
        layer,
        Arc::new(header),
        axis.unwrap_or_else(|| AxisOrder::as_cxyz_from_rank(rank)),
        channel,
        additional,
        cache,
        format,
    ))
}
