//! Scala `DatasetArray`: reads arbitrary boxes from a chunked n-d array through a data vault.
//!
//! `read_bytes_with_additional_coordinates` returns the bytes Scala returns: wk axis order
//! (additional axes + (c)xyz) in Fortran order with little-endian values, except for the Scala
//! "skip typing" shortcut (one whole F-order chunk in cxyz order), which returns the decompressed
//! chunk bytes unchanged (including their on-disk byte order).

use std::{
    fmt,
    future::{Future, poll_fn},
    pin::Pin,
    sync::Arc,
    task::Poll,
};

use super::axis_order::FullAxisOrder;
use super::cache::ChunkContentsCache;
use super::chunk::{ArrayFormat, ChunkContents, read_chunk};
use super::chunk_utils::compute_chunk_indices;
use super::data_type::ArrayOrder;
use super::header::DatasetHeader;
use super::nd_array::{
    MaDataType, NdArray, axis_order_xyz_view_f, copy_range, create_empty, to_byte_array,
};
use crate::datavault::{ByteRange, VaultError, VaultPath};
use crate::error::{DsError, DsResult};
use crate::models::{
    AdditionalAxis, AdditionalCoordinate, AxisOrder, BUCKET_LENGTH, DataSourceId, Vec3Int,
};

/// Scala `DatasetArray.chunkSizeLimitBytes` (300 MiB).
pub const CHUNK_SIZE_LIMIT_BYTES: i64 = 300 * 1024 * 1024;

/// Scala `DatasetArray.assertChunkSizeLimit`.
pub fn assert_chunk_size_limit(bytes_per_chunk: i64) -> DsResult<()> {
    if bytes_per_chunk <= CHUNK_SIZE_LIMIT_BYTES {
        Ok(())
    } else {
        Err(DsError::failure(format!(
            "Array chunk size exceeds limit of {CHUNK_SIZE_LIMIT_BYTES}, got {bytes_per_chunk}"
        )))
    }
}

/// Scala `AdditionalCoordinate` as used in data requests, including the request-only `length`
/// (batched reads along one additional axis: absent/1 or exactly 32).
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize)]
pub struct RequestedAdditionalCoordinate {
    pub name: String,
    pub value: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<i32>,
}

impl RequestedAdditionalCoordinate {
    pub fn from_json(value: &serde_json::Value) -> crate::models::JsResult<Self> {
        use crate::models::json::{Fields, read_i32, read_string};
        let mut f = Fields::new(value);
        let name = f.req("name", read_string);
        let value = f.req("value", read_i32);
        let length = f.opt("length", read_i32);
        f.finish()?;
        Ok(Self {
            name: name?,
            value: value?,
            length: length?,
        })
    }
}
crate::models::json::deserialize_via_from_json!(RequestedAdditionalCoordinate);

impl From<&AdditionalCoordinate> for RequestedAdditionalCoordinate {
    fn from(c: &AdditionalCoordinate) -> Self {
        Self {
            name: c.name.clone(),
            value: c.value,
            length: None,
        }
    }
}

/// Polls all futures concurrently (Scala `Fox.combined` over already-running futures) and
/// returns their outputs in order.
async fn join_all<F: Future>(futures: Vec<F>) -> Vec<F::Output> {
    let mut futures: Vec<Pin<Box<F>>> = futures.into_iter().map(Box::pin).collect();
    let mut outputs: Vec<Option<F::Output>> = futures.iter().map(|_| None).collect();
    poll_fn(|cx| {
        let mut pending = false;
        for (future, output) in futures.iter_mut().zip(outputs.iter_mut()) {
            if output.is_none() {
                match future.as_mut().poll(cx) {
                    Poll::Ready(value) => *output = Some(value),
                    Poll::Pending => pending = true,
                }
            }
        }
        if pending {
            Poll::Pending
        } else {
            Poll::Ready(())
        }
    })
    .await;
    outputs
        .into_iter()
        .map(|o| o.expect("all futures completed"))
        .collect()
}

fn exception(class: &str, message: impl Into<String>) -> DsError {
    let message = message.into();
    DsError {
        exception: Some(format!("{class}: {message}")),
        ..DsError::failure(message)
    }
}

fn requirement_failed(message: impl fmt::Display) -> DsError {
    exception(
        "java.lang.IllegalArgumentException",
        format!("requirement failed: {message}"),
    )
}

fn join_ints<T: fmt::Display>(values: &[T]) -> String {
    values
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn to_usize_shape(shape: &[i32]) -> DsResult<Vec<usize>> {
    shape
        .iter()
        .map(|&d| {
            usize::try_from(d)
                .map_err(|_| exception("java.lang.NegativeArraySizeException", d.to_string()))
        })
        .collect()
}

/// Scala `DatasetArray` (format-independent read path). Format specifics come in via the
/// [`DatasetHeader`] and [`ArrayFormat`] implementations.
pub struct DatasetArray {
    vault_path: VaultPath,
    data_source_id: DataSourceId,
    layer_name: String,
    header: Arc<dyn DatasetHeader>,
    axis_order: AxisOrder,
    channel_index: Option<i32>,
    additional_axes: Option<Vec<AdditionalAxis>>,
    cache: Arc<ChunkContentsCache>,
    format: Arc<dyn ArrayFormat>,
    rank: usize,
    dataset_shape: Option<Vec<i64>>,
    chunk_shape: Vec<i32>,
    /// Scala `lazy val fullAxisOrder` (construction errors surface on first use).
    full_axis_order: DsResult<FullAxisOrder>,
    chunk_contents_cache_key_prefix: String,
}

impl fmt::Debug for DatasetArray {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_string())
    }
}

impl DatasetArray {
    /// `axis_order` and `additional_axes` are the wk-facing (data source) ones; transposes and
    /// C/F order of the chunk contents come from the header.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        vault_path: VaultPath,
        data_source_id: DataSourceId,
        layer_name: impl Into<String>,
        header: Arc<dyn DatasetHeader>,
        axis_order: AxisOrder,
        channel_index: Option<i32>,
        additional_axes: Option<Vec<AdditionalAxis>>,
        cache: Arc<ChunkContentsCache>,
        format: Arc<dyn ArrayFormat>,
    ) -> Self {
        let layer_name = layer_name.into();
        let has_z = axis_order.has_z_axis();
        let rank = header.rank() + usize::from(!has_z);
        let dataset_shape = header.dataset_shape().map(|s| {
            let mut s = s.to_vec();
            if !has_z {
                s.push(1);
            }
            s
        });
        let mut chunk_shape = header.chunk_shape().to_vec();
        if !has_z {
            chunk_shape.push(1);
        }
        let full_axis_order = FullAxisOrder::from_axis_order_and_additional_axes(
            rank,
            &axis_order,
            additional_axes.as_deref(),
        );
        let chunk_contents_cache_key_prefix = format!(
            "{}__{vault_path}__chunk_",
            super::cache::source_layer_cache_key(&data_source_id, &layer_name)
        );
        Self {
            vault_path,
            data_source_id,
            layer_name,
            header,
            axis_order,
            channel_index,
            additional_axes,
            cache,
            format,
            rank,
            dataset_shape,
            chunk_shape,
            full_axis_order,
            chunk_contents_cache_key_prefix,
        }
    }

    pub fn header(&self) -> &Arc<dyn DatasetHeader> {
        &self.header
    }

    pub fn vault_path(&self) -> &VaultPath {
        &self.vault_path
    }

    pub fn data_source_id(&self) -> &DataSourceId {
        &self.data_source_id
    }

    pub fn layer_name(&self) -> &str {
        &self.layer_name
    }

    pub fn axis_order(&self) -> &AxisOrder {
        &self.axis_order
    }

    pub fn additional_axes(&self) -> Option<&[AdditionalAxis]> {
        self.additional_axes.as_deref()
    }

    /// Rank including the 2-d adapter dimension.
    pub fn rank(&self) -> usize {
        self.rank
    }

    /// Physical dataset shape including the 2-d adapter dimension.
    pub fn dataset_shape(&self) -> Option<&[i64]> {
        self.dataset_shape.as_deref()
    }

    /// Physical chunk shape including the 2-d adapter dimension.
    pub fn chunk_shape(&self) -> &[i32] {
        &self.chunk_shape
    }

    pub fn full_axis_order(&self) -> DsResult<&FullAxisOrder> {
        self.full_axis_order.as_ref().map_err(Clone::clone)
    }

    fn chunk_shape_at_index(&self, index: &[i64]) -> Vec<i32> {
        if self.axis_order.has_z_axis() {
            self.header.chunk_shape_at_index(index)
        } else {
            // irregular shaped chunk indexes are currently not supported for 2d datasets
            self.chunk_shape.clone()
        }
    }

    /// Scala `readBytesWithAdditionalCoordinates`.
    pub async fn read_bytes_with_additional_coordinates(
        &self,
        offset_xyz: Vec3Int,
        shape_xyz: Vec3Int,
        additional_coordinates: Option<&[RequestedAdditionalCoordinate]>,
        should_read_uint24: bool,
        user_token: Option<&str>,
    ) -> DsResult<Vec<u8>> {
        let (offset, shape) = self
            .construct_offset_and_shape_arrays(
                offset_xyz,
                shape_xyz,
                additional_coordinates,
                should_read_uint24,
            )
            .map_err(|e| {
                e.wrap("failed to construct shape and offset array for requested coordinates")
            })?;
        let batched = Self::batched_axis_of(additional_coordinates);
        let typed = self
            .read_as_fortran_order(&offset, &shape, batched.is_some(), user_token)
            .await?;
        let repacked = self.repack_batched_axis_into_z_slot(typed, batched)?;
        let bytes = to_byte_array(&repacked)?;
        Ok(Arc::try_unwrap(bytes).unwrap_or_else(|shared| shared.as_ref().clone()))
    }

    fn batched_axis_of(
        additional_coordinates: Option<&[RequestedAdditionalCoordinate]>,
    ) -> Option<&RequestedAdditionalCoordinate> {
        additional_coordinates?
            .iter()
            .find(|c| c.length.is_some_and(|l| l > 1))
    }

    fn additional_axis_index(&self, name: &str) -> DsResult<usize> {
        let axis = self
            .additional_axes
            .as_deref()
            .unwrap_or_default()
            .iter()
            .rev() // Scala `.toMap`: the last axis with a name wins
            .find(|a| a.name == name)
            .ok_or_else(|| {
                exception(
                    "java.util.NoSuchElementException",
                    format!("key not found: {name}"),
                )
            })?;
        usize::try_from(axis.index)
            .ok()
            .filter(|i| *i < self.rank)
            .ok_or_else(|| {
                exception(
                    "java.lang.ArrayIndexOutOfBoundsException",
                    format!(
                        "Index {} out of bounds for length {}",
                        axis.index, self.rank
                    ),
                )
            })
    }

    fn construct_offset_and_shape_arrays(
        &self,
        offset_xyz: Vec3Int,
        shape_xyz: Vec3Int,
        additional_coordinates: Option<&[RequestedAdditionalCoordinate]>,
        should_read_uint24: bool,
    ) -> DsResult<(Vec<i32>, Vec<i32>)> {
        let batched_count = additional_coordinates
            .unwrap_or_default()
            .iter()
            .filter(|c| c.length.is_some_and(|l| l > 1))
            .count();
        if batched_count > 1 {
            return Err(requirement_failed(
                "Reading more than one batched additional axis at once is not supported",
            ));
        }
        let rank = self.rank;
        if rank < 3 {
            return Err(exception(
                "java.lang.ArrayIndexOutOfBoundsException",
                format!("Index {} out of bounds for length {rank}", rank as i64 - 3),
            ));
        }
        let mut offset = vec![0i32; rank];
        offset[rank - 3] = offset_xyz.x;
        offset[rank - 2] = offset_xyz.y;
        offset[rank - 1] = offset_xyz.z;
        let mut shape = vec![1i32; rank];
        shape[rank - 3] = shape_xyz.x;
        shape[rank - 2] = shape_xyz.y;
        shape[rank - 1] = shape_xyz.z;

        if let Some(channel_axis_physical) = self.axis_order.c {
            let full = self.full_axis_order()?;
            let slot = usize::try_from(channel_axis_physical)
                .ok()
                .filter(|i| *i < rank)
                .map(|i| full.wk_slot_of_physical_index(i))
                .ok_or_else(|| {
                    exception(
                        "java.lang.ArrayIndexOutOfBoundsException",
                        format!("Index {channel_axis_physical} out of bounds for length {rank}"),
                    )
                })?;
            if let Some(requested_channel_offset) = self.channel_index {
                offset[slot] = requested_channel_offset;
            }
            if should_read_uint24 {
                shape[slot] = 3;
            }
        }

        if let Some(coordinates) = additional_coordinates {
            for coordinate in coordinates {
                let physical = self.additional_axis_index(&coordinate.name)?;
                let slot = self.full_axis_order()?.wk_slot_of_physical_index(physical);
                offset[slot] = coordinate.value;
                let requested_length = coordinate.length.unwrap_or(1);
                if requested_length != 1 && requested_length != BUCKET_LENGTH {
                    return Err(requirement_failed(format!(
                        "Additional-coordinate batch length for “{}” must be 1 or {BUCKET_LENGTH}, got {requested_length}.",
                        coordinate.name
                    )));
                }
                shape[slot] = requested_length;
            }
        }

        if batched_count > 0 {
            // z must have shape 1 to preserve the total 32³ shape
            shape[rank - 1] = 1;
        }
        Ok((offset, shape))
    }

    fn repack_batched_axis_into_z_slot(
        &self,
        array: NdArray,
        batched: Option<&RequestedAdditionalCoordinate>,
    ) -> DsResult<NdArray> {
        let Some(batched) = batched else {
            return Ok(array);
        };
        let physical = self.additional_axis_index(&batched.name)?;
        let wk_slot = self.full_axis_order()?.wk_slot_of_physical_index(physical);
        // the F-order target has shape.reverse, so wk slot `s` is dimension `rank - 1 - s`
        let dimension = self.rank - 1 - wk_slot;
        array.transpose(dimension, 0)?.copy()
    }

    fn chunk_contents_cache_key(&self, chunk_index: &[i64]) -> String {
        format!(
            "{}{}",
            self.chunk_contents_cache_key_prefix,
            join_ints(chunk_index)
        )
    }

    /// Scala `getChunkFilename` default (with the format override applied).
    fn chunk_filename(&self, chunk_index: &[i64]) -> String {
        let separator = self.header.dimension_separator().as_str();
        let parts: &[i64] = if self.axis_order.has_z_axis() {
            chunk_index
        } else {
            // Scala `chunkIndex.drop(1)` ("(c),x,y,z -> z is dropped in 2d case"). Note that it
            // drops the FIRST physical index although the 2-d adapter appends z LAST; kept for
            // parity (see checkpoints/datastore-ds2-core.md).
            chunk_index.get(1..).unwrap_or_default()
        };
        let default_name = parts
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(separator);
        self.format.chunk_filename(chunk_index, default_name)
    }

    /// Scala `readSourceChunkData` (physical chunk index).
    async fn read_source_chunk_data(
        &self,
        chunk_index: &[i64],
        user_token: Option<&str>,
    ) -> DsResult<ChunkContents> {
        if let Some(read) = self
            .format
            .source_chunk(&self.vault_path, chunk_index, user_token)
        {
            return read.await;
        }
        let chunk_shape = self.chunk_shape_at_index(chunk_index);
        if self.header.is_sharded() {
            match self
                .format
                .sharded_chunk_path_and_range(&self.vault_path, chunk_index, user_token)
                .await
            {
                Ok((shard_path, range)) => {
                    read_chunk(
                        self.format.as_ref(),
                        self.header.as_ref(),
                        &shard_path,
                        chunk_shape,
                        range,
                        user_token,
                    )
                    .await
                }
                Err(VaultError::NotFound) => Ok(ChunkContents::Fill { shape: chunk_shape }),
                Err(VaultError::Failure(e)) => Err(e),
            }
        } else {
            let chunk_path = self.vault_path.join(&self.chunk_filename(chunk_index));
            read_chunk(
                self.format.as_ref(),
                self.header.as_ref(),
                &chunk_path,
                chunk_shape,
                ByteRange::Complete,
                user_token,
            )
            .await
        }
    }

    /// Scala `getSourceChunkDataWithCache` (the token is not part of the key, like in Scala).
    pub async fn source_chunk_with_cache(
        &self,
        chunk_index: &[i64],
        user_token: Option<&str>,
    ) -> DsResult<Arc<ChunkContents>> {
        let key = self.chunk_contents_cache_key(chunk_index);
        let header = Arc::clone(&self.header);
        self.cache
            .get_or_load(
                &key,
                || self.read_source_chunk_data(chunk_index, user_token),
                |c| c.size_bytes(header.as_ref()),
            )
            .await
    }

    fn offset_in_chunk(
        &self,
        chunk_index: &[i64],
        global_offset: &[i64],
        chunk_shape: &[i32],
    ) -> Vec<i64> {
        chunk_index
            .iter()
            .enumerate()
            .map(|(dim, &index)| {
                // Scala `(... ).toInt`
                i64::from((global_offset[dim] - index * i64::from(chunk_shape[dim])) as i32)
            })
            .collect()
    }

    /// Scala `readAsFortranOrder`: `offset`/`shape` in wk order; result is wk order, F layout.
    async fn read_as_fortran_order(
        &self,
        offset: &[i32],
        shape: &[i32],
        is_batched_read: bool,
        user_token: Option<&str>,
    ) -> DsResult<NdArray> {
        let full = self.full_axis_order()?;
        // Scala: offset.zip(voxelOffset).map(o - v).padTo(offset.length, 0)
        let voxel_offset = self.header.voxel_offset();
        let total_offset: Vec<i64> = (0..offset.len())
            .map(|i| {
                voxel_offset
                    .get(i)
                    .map_or(0, |v| i64::from(offset[i].wrapping_sub(*v)))
            })
            .collect();
        let wk_chunk_shape = full.permute_indices_physical_to_wk(&self.chunk_shape);
        let wk_dataset_shape = self
            .dataset_shape
            .as_ref()
            .map(|s| full.permute_indices_physical_to_wk(s));
        let chunk_indices = compute_chunk_indices(
            wk_dataset_shape.as_deref(),
            &wk_chunk_shape,
            shape,
            &total_offset,
        )?;
        let is_f = self.header.order() == ArrayOrder::F;
        if !is_batched_read && let Some(first) = chunk_indices.first() {
            let offset_in_chunk = self.offset_in_chunk(first, &total_offset, &wk_chunk_shape);
            let shortcut = is_f
                && offset_in_chunk.iter().all(|&o| o == 0)
                && shape == self.chunk_shape.as_slice()
                && self.axis_order == AxisOrder::as_cxyz_from_rank(self.rank as i32);
            if shortcut {
                let physical = full.permute_indices_wk_to_physical(first);
                let chunk = self.source_chunk_with_cache(&physical, user_token).await?;
                let actual_shape = match chunk.as_ref() {
                    ChunkContents::Bytes { shape, .. } | ChunkContents::Fill { shape } => shape,
                };
                if actual_shape == &self.chunk_shape {
                    return chunk.shortcut_view(self.header.as_ref());
                }
                // N5/precomputed boundary chunks can be smaller than the nominal grid cell.
                // Assemble those into a full requested bucket instead of returning a short buffer.
            }
        }
        let target_shape: Vec<usize> = to_usize_shape(shape)?.into_iter().rev().collect();
        let mut target = NdArray::zeros(
            MaDataType::for_array_data_type(self.header.resolved_data_type()),
            target_shape,
        )?;
        let loads = chunk_indices
            .iter()
            .map(|chunk_index| {
                let physical = full.permute_indices_wk_to_physical(chunk_index);
                async move { self.source_chunk_with_cache(&physical, user_token).await }
            })
            .collect();
        let chunks = join_all(loads).await;
        let mut first_error = None;
        for (chunk_index, chunk) in chunk_indices.iter().zip(chunks) {
            let result = chunk.and_then(|chunk| {
                let source = chunk.typed_view(self.header.as_ref())?;
                let view = axis_order_xyz_view_f(&source, full, is_f)?;
                let mut offset_in_chunk_f =
                    self.offset_in_chunk(chunk_index, &total_offset, &wk_chunk_shape);
                offset_in_chunk_f.reverse();
                copy_range(&offset_in_chunk_f, &view, &mut target).map_err(|e| {
                    e.wrap(self.format_copy_range_error(&offset_in_chunk_f, &view, &target, full))
                })
            });
            if let Err(e) = result
                && first_error.is_none()
            {
                first_error = Some(e);
            }
        }
        match first_error {
            Some(e) => Err(e),
            None => Ok(target),
        }
    }

    /// Scala `readAsMultiArray(offset, shape)`: physical order, C layout, typed values. Scala's
    /// single-chunk shortcut pattern (`chunkIndex :: Nil`) never matches an `ArraySeq`, so there
    /// is no shortcut here either.
    pub async fn read_as_multi_array(
        &self,
        offset: &[i64],
        shape: &[i32],
        user_token: Option<&str>,
    ) -> DsResult<NdArray> {
        if shape.contains(&0) {
            return create_empty(self.header.resolved_data_type(), self.rank);
        }
        if shape.iter().any(|&s| s < 0) {
            return Err(DsError::failure(format!(
                "Trying to read negative shape from DatasetArray: {}",
                join_ints(shape)
            )));
        }
        let voxel_offset = self.header.voxel_offset();
        let total_offset: Vec<i64> = (0..offset.len())
            .map(|i| voxel_offset.get(i).map_or(0, |v| offset[i] - i64::from(*v)))
            .collect();
        let chunk_indices = compute_chunk_indices(
            self.dataset_shape.as_deref(),
            &self.chunk_shape,
            shape,
            &total_offset,
        )?;
        let mut target = NdArray::zeros(
            MaDataType::for_array_data_type(self.header.resolved_data_type()),
            to_usize_shape(shape)?,
        )?;
        let loads = chunk_indices
            .iter()
            .map(|chunk_index| self.source_chunk_with_cache(chunk_index, user_token))
            .collect();
        let chunks = join_all(loads).await;
        let mut first_error = None;
        for (chunk_index, chunk) in chunk_indices.iter().zip(chunks) {
            let result = chunk.and_then(|chunk| {
                let source = chunk.typed_view(self.header.as_ref())?;
                let offset_in_chunk =
                    self.offset_in_chunk(chunk_index, &total_offset, &self.chunk_shape);
                copy_range(&offset_in_chunk, &source, &mut target).map_err(|e| {
                    e.wrap(format!(
                        "Copying data from dataset chunk failed. Chunk shape {}, target shape {}, offsetInChunk: {}",
                        join_ints(source.shape()),
                        join_ints(target.shape()),
                        join_ints(&offset_in_chunk)
                    ))
                })
            });
            if let Err(e) = result
                && first_error.is_none()
            {
                first_error = Some(e);
            }
        }
        match first_error {
            Some(e) => Err(e),
            None => Ok(target),
        }
    }

    /// Scala `readAsMultiArray(offset: Long, shape: Int)`.
    pub async fn read_as_multi_array_1d(
        &self,
        offset: i64,
        shape: i32,
        user_token: Option<&str>,
    ) -> DsResult<NdArray> {
        self.read_as_multi_array(&[offset], &[shape], user_token)
            .await
    }

    fn print_as_wk_f<T: fmt::Display>(full: &FullAxisOrder, values: &[T]) -> String {
        let names: Vec<&str> = full.axes_wk().into_iter().rev().collect();
        let raw = names
            .iter()
            .zip(values)
            .map(|(n, v)| format!("{n}={v}"))
            .collect::<Vec<_>>()
            .join(",");
        format!("wk({raw})")
    }

    fn print_as_physical<T: fmt::Display>(&self, values: &[T]) -> String {
        let raw = match &self.full_axis_order {
            Ok(full) => full
                .axes()
                .iter()
                .zip(values)
                .map(|(n, v)| format!("{n}={v}"))
                .collect::<Vec<_>>()
                .join(","),
            Err(_) => join_ints(values),
        };
        format!("physical({raw})")
    }

    fn format_copy_range_error(
        &self,
        offset_in_chunk: &[i64],
        source: &NdArray,
        target: &NdArray,
        full: &FullAxisOrder,
    ) -> String {
        format!(
            "Copying data from dataset chunk failed. Chunk shape (F): {}, target shape (F): {}, offsetInChunk: {}. Axis order (C): {full} (wk: {})",
            Self::print_as_wk_f(full, source.shape()),
            Self::print_as_wk_f(full, target.shape()),
            Self::print_as_wk_f(full, offset_in_chunk),
            full.to_string_wk()
        )
    }
}

impl fmt::Display for DatasetArray {
    /// Scala `DatasetArray.toString` (class name approximated by `DatasetArray`).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let full = match &self.full_axis_order {
            Ok(full) => full.to_string(),
            Err(e) => e.message.clone(),
        };
        let shape = match self.header.dataset_shape() {
            Some(s) => format!("Some({})", self.print_as_physical(s)),
            None => "None".to_string(),
        };
        let compressor = match self.header.compressor() {
            Ok(c) => c.to_string(),
            Err(e) => e.message,
        };
        write!(
            f,
            "DatasetArray fullAxisOrder={full} shape={shape} chunkShape={} dtype={} fillValue={}, {compressor}, byteOrder={}, vault={}}}",
            self.print_as_physical(self.header.chunk_shape()),
            self.header.resolved_data_type(),
            self.header.fill_value_number(),
            self.header.byte_order(),
            self.vault_path.summary()
        )
    }
}
