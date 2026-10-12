//! Scala Positions/Cuboid/DataServiceRequests. Positions are mag1; dimensions are in the mag.
use crate::{
    datareaders::RequestedAdditionalCoordinate,
    error::{DsError, DsResult},
    models::{BUCKET_LENGTH, BoundingBox, DataSourceId, StaticLayer, Vec3Int},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct VoxelPosition {
    pub mag1: Vec3Int,
    mag: Vec3Int,
}
impl VoxelPosition {
    pub fn new(mag1: Vec3Int, mag: Vec3Int) -> DsResult<Self> {
        if [mag.x, mag.y, mag.z]
            .iter()
            .any(|m| *m <= 0 || m.checked_mul(BUCKET_LENGTH).is_none())
        {
            return Err(DsError::failure("Invalid magnification"));
        }
        Ok(Self { mag1, mag })
    }
    pub fn mag(&self) -> Vec3Int {
        self.mag
    }
    pub fn in_mag(&self) -> Vec3Int {
        self.mag1 / self.mag
    }
    pub fn to_bucket(&self) -> BucketPosition {
        BucketPosition {
            voxel_mag1: self.mag1,
            mag: self.mag,
            additional_coordinates: None,
        }
    }
    pub fn to_mag1(&self) -> Self {
        Self {
            mag1: self.mag1,
            mag: Vec3Int::ones(),
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BucketPosition {
    pub voxel_mag1: Vec3Int,
    mag: Vec3Int,
    pub additional_coordinates: Option<Vec<RequestedAdditionalCoordinate>>,
}
impl BucketPosition {
    pub fn mag(&self) -> Vec3Int {
        self.mag
    }
    pub fn bucket_index(&self) -> Vec3Int {
        (self.voxel_mag1 / Vec3Int::full(BUCKET_LENGTH)) / self.mag
    }
    pub fn top_left(&self) -> DsResult<VoxelPosition> {
        let align = |p: i32, m: i32| {
            p.checked_sub(p.rem_euclid(BUCKET_LENGTH * m))
                .ok_or_else(|| DsError::failure("Bucket coordinate overflow"))
        };
        VoxelPosition::new(
            Vec3Int::new(
                align(self.voxel_mag1.x, self.mag.x)?,
                align(self.voxel_mag1.y, self.mag.y)?,
                align(self.voxel_mag1.z, self.mag.z)?,
            ),
            self.mag,
        )
    }
    pub fn has_negative_component(&self) -> bool {
        [self.voxel_mag1.x, self.voxel_mag1.y, self.voxel_mag1.z]
            .iter()
            .any(|i| *i < 0)
            || self
                .additional_coordinates
                .as_ref()
                .is_some_and(|c| c.iter().any(|c| c.value < 0))
    }
    pub fn to_mag1_bounding_box(&self) -> DsResult<BoundingBox> {
        let p = self.top_left()?;
        Ok(BoundingBox::new(
            p.mag1,
            BUCKET_LENGTH * self.mag.x,
            BUCKET_LENGTH * self.mag.y,
            BUCKET_LENGTH * self.mag.z,
        ))
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cuboid {
    pub top_left: VoxelPosition,
    pub width: i32,
    pub height: i32,
    pub depth: i32,
}
impl Cuboid {
    pub const MAX_VOLUME: i64 = 512 * 512 * 512;
    pub fn new(top_left: VoxelPosition, shape: Vec3Int) -> Self {
        Self {
            top_left,
            width: shape.x,
            height: shape.y,
            depth: shape.z,
        }
    }
    pub fn mag(&self) -> Vec3Int {
        self.top_left.mag()
    }
    pub fn volume(&self) -> DsResult<usize> {
        let v = i64::from(self.width)
            .checked_mul(i64::from(self.height))
            .and_then(|v| v.checked_mul(i64::from(self.depth)));
        if self.width <= 0
            || self.height <= 0
            || self.depth <= 0
            || v.is_none_or(|v| v > Self::MAX_VOLUME)
        {
            return Err(DsError::failure(
                "Invalid cuboid dimensions (must be > 0 and <= 512).",
            ));
        }
        Ok(v.expect("validated volume") as usize)
    }
    pub fn bottom_right(&self) -> DsResult<VoxelPosition> {
        let m = self.mag();
        let end = |p: i32, s: i32, m: i32| {
            s.checked_mul(m)
                .and_then(|v| p.checked_add(v))
                .ok_or_else(|| DsError::failure("Cuboid coordinate overflow"))
        };
        VoxelPosition::new(
            Vec3Int::new(
                end(self.top_left.mag1.x, self.width, m.x)?,
                end(self.top_left.mag1.y, self.height, m.y)?,
                end(self.top_left.mag1.z, self.depth, m.z)?,
            ),
            m,
        )
    }
    pub fn is_single_bucket(&self) -> bool {
        self.width == BUCKET_LENGTH
            && self.height == BUCKET_LENGTH
            && self.depth == BUCKET_LENGTH
            && self
                .top_left
                .to_bucket()
                .top_left()
                .is_ok_and(|p| p == self.top_left)
    }
    pub fn bounding_box_in_mag(&self) -> BoundingBox {
        BoundingBox::new(self.top_left.in_mag(), self.width, self.height, self.depth)
    }
    pub fn mag1_bounding_box(&self) -> DsResult<BoundingBox> {
        self.bottom_right()?;
        Ok(BoundingBox::new(
            self.top_left.mag1,
            self.width * self.mag().x,
            self.height * self.mag().y,
            self.depth * self.mag().z,
        ))
    }
    pub fn buckets(&self) -> DsResult<BucketIterator> {
        self.volume()?;
        let origin = self.top_left.to_bucket();
        let aligned = origin.top_left()?;
        let start = aligned.in_mag();
        let end = self.bottom_right()?.in_mag();
        let count = |a: i32, b: i32| {
            (((i64::from(b) - i64::from(a)).max(0) + i64::from(BUCKET_LENGTH) - 1)
                / i64::from(BUCKET_LENGTH)) as usize
        };
        let grid = [
            count(start.x, end.x),
            count(start.y, end.y),
            count(start.z, end.z),
        ];
        let total = grid
            .iter()
            .try_fold(1usize, |p, d| p.checked_mul(*d))
            .ok_or_else(|| DsError::failure("Bucket count overflow"))?;
        Ok(BucketIterator {
            origin,
            aligned: aligned.mag1,
            grid,
            total,
            cursor: 0,
        })
    }
    pub fn all_buckets(&self) -> DsResult<Vec<BucketPosition>> {
        let mut out = self.buckets()?.collect::<DsResult<Vec<_>>>()?;
        out.reverse();
        Ok(out)
    }
}
/// Lazy x/y/z bucket enumeration; large valid skinny cuboids do not allocate a bucket list.
pub struct BucketIterator {
    origin: BucketPosition,
    aligned: Vec3Int,
    grid: [usize; 3],
    total: usize,
    cursor: usize,
}
impl Iterator for BucketIterator {
    type Item = DsResult<BucketPosition>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.cursor >= self.total {
            return None;
        }
        let z = self.cursor % self.grid[2];
        let y = (self.cursor / self.grid[2]) % self.grid[1];
        let x = self.cursor / (self.grid[1] * self.grid[2]);
        self.cursor += 1;
        let point = |p: i32, aligned: i32, n: usize, m: i32| {
            let delta = n as i64 * i64::from(BUCKET_LENGTH) * i64::from(m);
            // Near Int.MaxValue, a raw unaligned origin can overflow while its aligned bucket
            // remains valid. The aligned fallback addresses exactly the same bucket.
            i32::try_from(i64::from(p) + delta)
                .or_else(|_| i32::try_from(i64::from(aligned) + delta))
                .map_err(|_| DsError::failure("Bucket coordinate overflow"))
        };
        Some((|| {
            Ok(BucketPosition {
                voxel_mag1: Vec3Int::new(
                    point(
                        self.origin.voxel_mag1.x,
                        self.aligned.x,
                        x,
                        self.origin.mag.x,
                    )?,
                    point(
                        self.origin.voxel_mag1.y,
                        self.aligned.y,
                        y,
                        self.origin.mag.y,
                    )?,
                    point(
                        self.origin.voxel_mag1.z,
                        self.aligned.z,
                        z,
                        self.origin.mag.z,
                    )?,
                ),
                ..self.origin.clone()
            })
        })())
    }
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataServiceRequestSettings {
    #[serde(default)]
    pub half_byte: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applied_agglomerate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additional_coordinates: Option<Vec<RequestedAdditionalCoordinate>>,
}
#[derive(Clone)]
pub struct DataServiceDataRequest {
    pub dataset_id: Option<String>,
    pub data_source_id: Option<DataSourceId>,
    pub data_layer: Arc<StaticLayer>,
    pub cuboid: Cuboid,
    pub settings: DataServiceRequestSettings,
}
impl std::fmt::Debug for DataServiceDataRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DataServiceDataRequest")
            .field("dataset_id", &self.dataset_id)
            .field("source", &self.data_source_id)
            .field("layer", &self.data_layer.name)
            .field("cuboid", &self.cuboid)
            .field("settings", &self.settings)
            .finish()
    }
}
impl DataServiceDataRequest {
    pub fn data_source_id_or_volume_dummy(&self) -> DataSourceId {
        self.data_source_id
            .clone()
            .unwrap_or_else(|| DataSourceId::new("VolumeTracing", &self.data_layer.name))
    }
    pub fn is_batched_additional_coordinate_request(&self) -> bool {
        self.settings
            .additional_coordinates
            .as_ref()
            .is_some_and(|c| c.iter().any(|c| c.length.is_some_and(|l| l > 1)))
    }
}
#[derive(Clone)]
pub struct DataReadInstruction {
    pub data_source_id: DataSourceId,
    pub data_layer: Arc<StaticLayer>,
    pub bucket: BucketPosition,
    pub version: Option<i64>,
}

/// Scala frontend binary-data JSON request. Geometry validation happens when constructing cuboids.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebknossosDataRequest {
    pub position: Vec3Int,
    pub mag: Vec3Int,
    pub cube_size: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub four_bit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_agglomerate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_coordinates: Option<Vec<RequestedAdditionalCoordinate>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
}
fn read_coordinates(
    value: &serde_json::Value,
) -> super::JsResult<Vec<RequestedAdditionalCoordinate>> {
    super::json::read_list(value, RequestedAdditionalCoordinate::from_json)
}
impl WebknossosDataRequest {
    pub fn from_json(value: &serde_json::Value) -> super::JsResult<Self> {
        use super::json::{Fields, read_bool, read_i32, read_i64, read_string};
        let mut f = Fields::new(value);
        let position = f.req("position", Vec3Int::from_json);
        let mag = f.req("mag", Vec3Int::from_json);
        let cube_size = f.req("cubeSize", read_i32);
        let four_bit = f.opt("fourBit", read_bool);
        let apply_agglomerate = f.opt("applyAgglomerate", read_string);
        let additional_coordinates = f.opt("additionalCoordinates", read_coordinates);
        let version = f.opt("version", read_i64);
        f.finish()?;
        Ok(Self {
            position: position?,
            mag: mag?,
            cube_size: cube_size?,
            four_bit: four_bit?,
            apply_agglomerate: apply_agglomerate?,
            additional_coordinates: additional_coordinates?,
            version: version?,
        })
    }
    pub fn cuboid(&self) -> DsResult<Cuboid> {
        Ok(Cuboid::new(
            VoxelPosition::new(self.position, self.mag)?,
            Vec3Int::full(self.cube_size),
        ))
    }
    pub fn settings(&self) -> DataServiceRequestSettings {
        DataServiceRequestSettings {
            half_byte: self.four_bit.unwrap_or(false),
            applied_agglomerate: self.apply_agglomerate.clone(),
            version: self.version,
            additional_coordinates: self.additional_coordinates.clone(),
        }
    }
}
super::json::deserialize_via_from_json!(WebknossosDataRequest);
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCuboidRequest {
    pub position: Vec3Int,
    pub cube_size: Vec3Int,
    pub mag: Vec3Int,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_coordinates: Option<Vec<RequestedAdditionalCoordinate>>,
}
impl RawCuboidRequest {
    pub fn from_json(value: &serde_json::Value) -> super::JsResult<Self> {
        use super::json::Fields;
        let mut f = Fields::new(value);
        let position = f.req("position", Vec3Int::from_json);
        let cube_size = f.req("cubeSize", Vec3Int::from_json);
        let mag = f.req("mag", Vec3Int::from_json);
        let additional_coordinates = f.opt("additionalCoordinates", read_coordinates);
        f.finish()?;
        Ok(Self {
            position: position?,
            cube_size: cube_size?,
            mag: mag?,
            additional_coordinates: additional_coordinates?,
        })
    }
    pub fn cuboid(&self) -> DsResult<Cuboid> {
        Ok(Cuboid::new(
            VoxelPosition::new(self.position, self.mag)?,
            self.cube_size,
        ))
    }
    pub fn settings(&self) -> DataServiceRequestSettings {
        DataServiceRequestSettings {
            additional_coordinates: self.additional_coordinates.clone(),
            ..Default::default()
        }
    }
}
super::json::deserialize_via_from_json!(RawCuboidRequest);
