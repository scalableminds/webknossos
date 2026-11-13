//! Scala `WKWArray`: Morton-addressed blocks in range-readable WKW shards.

use crate::datareaders::ArraySource;
use std::sync::Arc;

use super::{
    header::{FILENAME_HEADER_WKW, WkwHeader, wkw_file_path},
    morton::morton_encode,
};
use crate::{
    datareaders::{
        ArrayFormat, DatasetArray, DatasetHeader, assert_chunk_size_limit, index_cache::IndexCache,
    },
    datavault::{BoxFuture, ByteRange, VaultError, VaultPath, VaultResult},
    error::{DsError, DsResult},
    models::AxisOrder,
};

/// Per-array shard-index cache, with Scala AlfuCache's 1000-entry, 2h write/1h access limits.
#[derive(Debug)]
pub struct WkwArrayFormat {
    header: Arc<WkwHeader>,
    indices: IndexCache<Vec<i64>>,
}

impl WkwArrayFormat {
    pub fn new(header: Arc<WkwHeader>) -> Self {
        Self {
            header,
            indices: IndexCache::default(),
        }
    }

    async fn shard_index(
        &self,
        path: &VaultPath,
        token: Option<&str>,
    ) -> VaultResult<Arc<Vec<i64>>> {
        self.indices
            .get_or_load(&path.to_string(), || async {
                let entries = if self.header.is_compressed() {
                    self.header.num_chunks_per_shard() as u64 + 1
                } else {
                    1
                };
                let bytes = path
                    .read_bytes(
                        ByteRange::StartEnd {
                            start: 8,
                            end: 8 + entries * 8,
                        },
                        token,
                    )
                    .await?;
                if bytes.len() as u64 != entries * 8 {
                    return Err(VaultError::failure("Truncated WKW shard index"));
                }
                let index: Vec<i64> = bytes
                    .as_chunks::<8>()
                    .0
                    .iter()
                    .map(|b| i64::from_le_bytes(*b))
                    .collect();
                if index.iter().any(|i| *i < 0) || index.windows(2).any(|w| w[1] < w[0]) {
                    return Err(VaultError::failure("Invalid WKW block byte range"));
                }
                Ok(index)
            })
            .await
    }

    fn morton_index(&self, index: &[i64]) -> VaultResult<usize> {
        if index.len() != 4 {
            return Err(VaultError::failure("WKW chunk index must have four axes"));
        }
        let side = i64::from(self.header.num_chunks_per_shard_dimension);
        let mut local = [0i32; 3];
        for (dim, name) in ["X", "Y", "Z"].into_iter().enumerate() {
            let value = index[dim + 1] % side;
            if value < 0 {
                return Err(VaultError::failure(format!(
                    "Error processing WKW file: {name} coordinate is out of range [expected: [0, {side}), actual: {value}]."
                )));
            }
            local[dim] = value as i32;
        }
        Ok(morton_encode(local[0], local[1], local[2]) as usize)
    }
}

impl ArrayFormat for WkwArrayFormat {
    fn chunk_filename(&self, index: &[i64], _default: String) -> String {
        wkw_file_path(index[1] as i32, index[2] as i32, index[3] as i32)
    }

    fn sharded_chunk_path_and_range<'a>(
        &'a self,
        root: &'a VaultPath,
        index: &'a [i64],
        token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<(VaultPath, ByteRange)>> {
        Box::pin(async move {
            let morton = self.morton_index(index)?;
            let side = i64::from(self.header.num_chunks_per_shard_dimension);
            // ChunkUtils clamps negative shard coordinates to zero, using Java division.
            let coordinates: Vec<i64> = index.iter().map(|i| (i / side).max(0)).collect();
            let path = root.join(&self.chunk_filename(&coordinates, String::new()));
            let table = self.shard_index(&path, token).await?;
            let (start, end) = if self.header.is_compressed() {
                (table[morton], table[morton + 1])
            } else {
                let start = table[0]
                    .checked_add(self.header.num_bytes_per_chunk() * morton as i64)
                    .ok_or_else(|| VaultError::failure("WKW block offset overflow"))?;
                (
                    start,
                    start
                        .checked_add(self.header.num_bytes_per_chunk())
                        .ok_or_else(|| VaultError::failure("WKW block offset overflow"))?,
                )
            };
            if start < 0 || end < start {
                return Err(VaultError::failure("Invalid WKW block byte range"));
            }
            Ok((
                path,
                ByteRange::StartEnd {
                    start: start as u64,
                    end: end as u64,
                },
            ))
        })
    }
}

/// Scala `WKWArray.open` (cxyz, no selected channel or additional axes).
pub async fn open_wkw_array(
    source: ArraySource<'_>,
    token: Option<&str>,
) -> DsResult<DatasetArray> {
    let ArraySource {
        path,
        data_source_id: id,
        layer_name: layer,
        cache,
    } = source;
    let bytes = path
        .join(FILENAME_HEADER_WKW)
        .read_bytes(ByteRange::Complete, token)
        .await
        .map_err(|e| {
            DsError::from(e.wrap(format!("Could not read header at {FILENAME_HEADER_WKW}")))
        })?;
    let header = Arc::new(WkwHeader::parse(&bytes, false)?);
    assert_chunk_size_limit(header.bytes_per_chunk())?;
    if header.num_channels <= 0 {
        return Err(DsError::failure(
            "WKW header must contain at least one channel",
        ));
    }
    let format = Arc::new(WkwArrayFormat::new(Arc::clone(&header)));
    Ok(DatasetArray::new(
        path.clone(),
        id,
        layer,
        header,
        AxisOrder::cxyz(),
        None,
        None,
        cache,
        format,
    ))
}
