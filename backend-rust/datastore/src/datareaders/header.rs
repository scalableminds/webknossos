//! Scala `DatasetHeader`: format-independent array metadata.

use std::fmt::Debug;

use super::axis_order::FullAxisOrder;
use super::data_type::{
    ArrayDataType, ArrayOrder, ByteOrder, DimensionSeparator, FillValue, JavaNumber,
};
use crate::compression::Compressor;
use crate::error::DsResult;
use crate::models::{AxisOrder, BoundingBox, ElementClass, Vec3Int};

/// Scala `DatasetHeader`. Format headers (zarr, zarr3, n5, precomputed, wkw) implement the
/// required methods; the provided methods mirror the Scala lazy vals.
///
/// `dataset_shape`/`chunk_shape` are in physical order; `DatasetArray` appends the 2-d adapter
/// dimension itself.
pub trait DatasetHeader: Send + Sync + Debug {
    /// Shape of the entire array (`None` if unknown).
    fn dataset_shape(&self) -> Option<&[i64]>;
    /// Shape of each chunk.
    fn chunk_shape(&self) -> &[i32];
    fn dimension_separator(&self) -> DimensionSeparator;
    fn fill_value(&self) -> &FillValue;
    fn order(&self) -> ArrayOrder;
    fn resolved_data_type(&self) -> ArrayDataType;
    /// Scala `compressorImpl`. A `Result` because Scala builds it lazily and only fails when a
    /// chunk is decompressed.
    fn compressor(&self) -> DsResult<&Compressor>;
    fn voxel_offset(&self) -> &[i32];

    /// Scala `byteOrder` (default big endian).
    fn byte_order(&self) -> ByteOrder {
        ByteOrder::BigEndian
    }

    /// Scala `chunkShapeAtIndex` (irregular chunk grids override this).
    fn chunk_shape_at_index(&self, _chunk_index: &[i64]) -> Vec<i32> {
        self.chunk_shape().to_vec()
    }

    fn is_sharded(&self) -> bool {
        false
    }

    /// Scala `elementClass`.
    fn element_class(&self) -> Option<ElementClass> {
        self.resolved_data_type().element_class()
    }

    fn bytes_per_element(&self) -> usize {
        self.resolved_data_type().bytes_per_element()
    }

    /// Scala `bytesPerChunk` (computed in 64 bit; Scala's `Int` product can wrap).
    fn bytes_per_chunk(&self) -> i64 {
        self.chunk_shape()
            .iter()
            .fold(1i64, |acc, &d| acc.saturating_mul(i64::from(d)))
            .saturating_mul(self.bytes_per_element() as i64)
    }

    /// Scala `rank` (before the 2-d adapter).
    fn rank(&self) -> usize {
        self.chunk_shape().len()
    }

    /// Scala `fillValueNumber`.
    fn fill_value_number(&self) -> JavaNumber {
        match self.fill_value() {
            FillValue::Number(n) => *n,
            FillValue::String(s) => parse_fill_value_from_string(s, self.resolved_data_type()),
        }
    }

    /// Scala `fillValueBoolean`.
    fn fill_value_boolean(&self) -> bool {
        matches!(self.fill_value(), FillValue::String(s) if s == "true")
    }

    /// Scala `boundingBox(axisOrder)`. Shape entries are narrowed with Java `toInt`.
    fn bounding_box(&self, axis_order: &AxisOrder) -> Option<BoundingBox> {
        let shape = self.dataset_shape()?;
        let rank = self.rank() as i32;
        let get = |i: i32| -> Option<i32> {
            usize::try_from(i)
                .ok()
                .and_then(|i| shape.get(i))
                .map(|&v| v as i32)
        };
        if axis_order
            .x
            .max(axis_order.y)
            .max(axis_order.z_with_fallback())
            >= rank
            && axis_order.has_z_axis()
        {
            None
        } else if axis_order.has_z_axis() {
            Some(BoundingBox::new(
                Vec3Int::new(0, 0, 0),
                get(axis_order.x)?,
                get(axis_order.y)?,
                get(axis_order.z_with_fallback())?,
            ))
        } else {
            Some(BoundingBox::new(
                Vec3Int::new(0, 0, 0),
                get(axis_order.x)?,
                get(axis_order.y)?,
                1,
            ))
        }
    }
}

/// Scala `parseFillValueFromString`: unsupported strings are 0 (no exception).
pub fn parse_fill_value_from_string(s: &str, data_type: ArrayDataType) -> JavaNumber {
    match s {
        "Infinity" => data_type.max_value(),
        "-Infinity" => data_type.min_value(),
        _ => JavaNumber::Long(0),
    }
}

/// Scala `NDBoundingBox.toWkLibsDict`.
pub fn nd_bounding_box_wk_libs_dict(
    bounding_box: &BoundingBox,
    additional_axes: &[crate::models::AdditionalAxis],
    full_axis_order: &FullAxisOrder,
) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    object.insert(
        "topLeft".into(),
        serde_json::json!([
            bounding_box.top_left.x,
            bounding_box.top_left.y,
            bounding_box.top_left.z
        ]),
    );
    object.insert("width".into(), bounding_box.width.into());
    object.insert("height".into(), bounding_box.height.into());
    object.insert("depth".into(), bounding_box.depth.into());
    object.insert(
        "additionalAxes".into(),
        serde_json::to_value(additional_axes).unwrap_or_default(),
    );
    object.insert("axisOrder".into(), full_axis_order.to_wk_libs_json());
    serde_json::Value::Object(object)
}
