//! Scala PrecomputedHeader/ScaleHeader metadata and boundary chunk geometry.
use super::sharding::ShardingSpecification;
use crate::{
    compression::Compressor,
    datareaders::{
        ArrayDataType, ArrayOrder, ByteOrder, DatasetHeader, DimensionSeparator, FillValue,
        JavaNumber, assert_chunk_size_limit,
    },
    error::{DsError, DsResult},
    models::Vec3Int,
};
use serde::{Deserialize, Serialize};
pub const FILENAME_INFO: &str = "info";
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrecomputedHeader {
    #[serde(rename = "type")]
    pub kind: String,
    pub data_type: String,
    pub num_channels: i32,
    pub scales: Vec<PrecomputedScale>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh: Option<String>,
}
impl PrecomputedHeader {
    pub fn parse(bytes: &[u8]) -> DsResult<Self> {
        serde_json::from_slice(bytes).map_err(|e| DsError::failure(e.to_string()))
    }
    pub fn get_scale(&self, key: &str) -> Option<&PrecomputedScale> {
        self.scales.iter().find(|s| s.key == key)
    }
    pub fn describes_segmentation_layer(&self) -> bool {
        self.kind == "segmentation"
    }
    pub fn mesh_path(&self) -> &str {
        self.mesh.as_deref().unwrap_or("mesh")
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrecomputedScale {
    pub key: String,
    pub size: Vec<i64>,
    pub resolution: Vec<f64>,
    pub chunk_sizes: Vec<Vec<i32>>,
    pub encoding: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voxel_offset: Option<Vec<i32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compressed_segmentation_block_size: Option<Vec3Int>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sharding: Option<ShardingSpecification>,
}
#[derive(Debug, Clone)]
pub struct PrecomputedScaleHeader {
    pub scale: PrecomputedScale,
    pub root: PrecomputedHeader,
    dtype: ArrayDataType,
    fill: FillValue,
    offset: Vec<i32>,
    shape: Vec<i64>,
    chunk: Vec<i32>,
}
impl PrecomputedScaleHeader {
    pub fn new(scale: PrecomputedScale, root: PrecomputedHeader) -> DsResult<Self> {
        use ArrayDataType::*;
        let dtype = match root.data_type.to_ascii_lowercase().as_str() {
            "uint8" => U1,
            "uint16" => U2,
            "uint32" => U4,
            "uint64" => U8,
            "float32" => F4,
            _ => {
                return Err(DsError::failure(format!(
                    "Unsupported NeuroglancerPrecomputed dataType: {}",
                    root.data_type
                )));
            }
        };
        if root.num_channels <= 0
            || scale.size.len() != 3
            || scale.size.iter().any(|d| *d <= 0)
            || scale
                .chunk_sizes
                .first()
                .is_none_or(|s| s.len() != 3 || s.iter().any(|d| *d <= 0))
            || scale.voxel_offset.as_ref().is_some_and(|s| s.len() != 3)
        {
            return Err(DsError::failure("Invalid NeuroglancerPrecomputed shape"));
        }
        if let Some(s) = &scale.sharding {
            s.validate()?;
        }
        let mut offset = scale.voxel_offset.clone().unwrap_or(vec![0; 3]);
        let mut shape = scale.size.clone();
        let mut chunk = scale.chunk_sizes[0].clone();
        if root.num_channels > 1 {
            offset.insert(0, 0);
            shape.insert(0, i64::from(root.num_channels));
            chunk.insert(0, root.num_channels);
        }
        let h = Self {
            offset,
            shape,
            chunk,
            scale,
            root,
            dtype,
            fill: FillValue::Number(JavaNumber::Long(0)),
        };
        assert_chunk_size_limit(h.bytes_per_chunk())?;
        Ok(h)
    }
    pub fn bounding_box_at(&self, index: &[i64]) -> DsResult<Vec<(i32, i32)>> {
        let index = self.spatial_chunk_index(index)?;
        index
            .iter()
            .enumerate()
            .map(|(d, i)| {
                let side = i64::from(self.scale.chunk_sizes[0][d]);
                let offset = i64::from(self.scale.voxel_offset.as_ref().map_or(0, |o| o[d]));
                let local = i
                    .checked_mul(side)
                    .ok_or_else(|| DsError::failure("Precomputed chunk offset overflow"))?;
                if local >= self.scale.size[d] {
                    return Err(DsError::failure(
                        "Precomputed chunk coordinate exceeds dataset shape",
                    ));
                }
                let begin = offset
                    .checked_add(local)
                    .ok_or_else(|| DsError::failure("Precomputed chunk offset overflow"))?;
                let local_end = local
                    .checked_add(side)
                    .unwrap_or(i64::MAX)
                    .min(self.scale.size[d]);
                let end = offset
                    .checked_add(local_end)
                    .ok_or_else(|| DsError::failure("Precomputed chunk offset overflow"))?;
                Ok((
                    i32::try_from(begin).map_err(|_| {
                        DsError::failure("Precomputed spatial offset exceeds Int range")
                    })?,
                    i32::try_from(end).map_err(|_| {
                        DsError::failure("Precomputed spatial offset exceeds Int range")
                    })?,
                ))
            })
            .collect()
    }
    pub fn spatial_chunk_index<'a>(&self, index: &'a [i64]) -> DsResult<&'a [i64]> {
        let spatial = if self.root.num_channels > 1 {
            if index.len() != 4 || index[0] != 0 {
                return Err(DsError::failure("Invalid precomputed channel chunk index"));
            }
            &index[1..]
        } else {
            index
        };
        if spatial.len() != 3 || spatial.iter().any(|i| *i < 0) {
            return Err(DsError::failure(
                "Precomputed chunk index must have three nonnegative spatial axes",
            ));
        }
        Ok(spatial)
    }
    pub fn grid_size(&self) -> DsResult<[u32; 3]> {
        let mut grid = [0; 3];
        for (d, g) in grid.iter_mut().enumerate() {
            *g = u32::try_from(
                (self.scale.size[d] - 1) / i64::from(self.scale.chunk_sizes[0][d]) + 1,
            )
            .map_err(|_| DsError::failure("Precomputed grid size overflow"))?;
        }
        Ok(grid)
    }
}
impl DatasetHeader for PrecomputedScaleHeader {
    fn dataset_shape(&self) -> Option<&[i64]> {
        Some(&self.shape)
    }
    fn chunk_shape(&self) -> &[i32] {
        &self.chunk
    }
    fn dimension_separator(&self) -> DimensionSeparator {
        DimensionSeparator::Underscore
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
        Ok(&Compressor::Null)
    }
    fn voxel_offset(&self) -> &[i32] {
        &self.offset
    }
    fn byte_order(&self) -> ByteOrder {
        ByteOrder::LittleEndian
    }
    fn is_sharded(&self) -> bool {
        self.scale.sharding.is_some()
    }
    fn chunk_shape_at_index(&self, index: &[i64]) -> Vec<i32> {
        let multi = self.root.num_channels > 1;
        let mut shape = if multi {
            vec![self.root.num_channels]
        } else {
            Vec::new()
        };
        for (d, i) in index.iter().skip(usize::from(multi)).enumerate().take(3) {
            let side = i64::from(self.scale.chunk_sizes[0][d]);
            shape.push(
                (i.wrapping_add(1)
                    .wrapping_mul(side)
                    .min(self.scale.size[d])
                    .wrapping_sub(i.wrapping_mul(side))) as i32,
            );
        }
        shape
    }
}
