//! Scala `zarr/ZarrArray.open`.

use std::sync::Arc;

use super::header::{FILENAME_DOT_ZARRAY, ZarrHeader};
use crate::datareaders::cache::ChunkContentsCache;
use crate::datareaders::chunk::DefaultArrayFormat;
use crate::datareaders::dataset_array::{DatasetArray, assert_chunk_size_limit};
use crate::datareaders::header::DatasetHeader;
use crate::datavault::{ByteRange, VaultPath};
use crate::error::{DsError, DsResult};
use crate::models::{AdditionalAxis, AxisOrder, DataSourceId};

/// Scala `ZarrArray.open`: reads and parses `<path>/.zarray`, checks the chunk size limit and
/// builds the `DatasetArray` (default axis order: z,y,x as the last three dimensions).
#[allow(clippy::too_many_arguments)]
pub async fn open_zarr_array(
    path: &VaultPath,
    data_source_id: DataSourceId,
    layer_name: &str,
    axis_order: Option<AxisOrder>,
    channel_index: Option<i32>,
    additional_axes: Option<Vec<AdditionalAxis>>,
    cache: Arc<ChunkContentsCache>,
    user_token: Option<&str>,
) -> DsResult<DatasetArray> {
    let header_bytes = path
        .join(FILENAME_DOT_ZARRAY)
        .read_bytes(ByteRange::Complete, user_token)
        .await
        .map_err(|e| e.wrap(format!("Could not read header at {FILENAME_DOT_ZARRAY}")))
        .map_err(DsError::from)?;
    let header =
        parse_zarr_header(&header_bytes).map_err(|e| e.wrap("Could not parse array header"))?;
    header.check_data_type()?;
    assert_chunk_size_limit(header.bytes_per_chunk())?;
    let rank = header.rank() as i32;
    Ok(DatasetArray::new(
        path.clone(),
        data_source_id,
        layer_name,
        Arc::new(header),
        axis_order.unwrap_or_else(|| AxisOrder::as_zyx_from_rank(rank)),
        channel_index,
        additional_axes,
        cache,
        Arc::new(DefaultArrayFormat),
    ))
}

/// Scala `JsonHelper.parseAs[ZarrHeader](bytes)`.
pub fn parse_zarr_header(bytes: &[u8]) -> DsResult<ZarrHeader> {
    let json: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| {
        DsError {
            exception: Some(format!(
                "com.fasterxml.jackson.core.JsonParseException: {e}"
            )),
            ..DsError::failure(e.to_string())
        }
        .wrap("Failed to parse json")
    })?;
    ZarrHeader::from_json(&json).map_err(|e| e.wrap("Failed to validate json against schema"))
}
