//! Scala `zarr/ZarrHeader` (`.zarray`, Zarr v2) and `ZarrCompressorFactory` (via
//! `crate::compression::Compressor::from_zarr_settings`).

use serde_json::{Map, Value};

use crate::compression::{CompressionSetting, CompressionSettings, Compressor};
use crate::datareaders::data_type::{
    ArrayDataType, ArrayOrder, ByteOrder, DimensionSeparator, FillValue,
};
use crate::datareaders::header::DatasetHeader;
use crate::error::{DsError, DsResult};
use crate::models::json::{Fields, JsError, JsResult, PathNode, read_i32, read_string};
use crate::models::{AdditionalAxis, BUCKET_LENGTH, BoundingBox, ElementClass, Vec3Int};

pub const FILENAME_DOT_ZARRAY: &str = ".zarray";

/// Scala `ZarrHeader`.
#[derive(Debug, Clone, PartialEq)]
pub struct ZarrHeader {
    pub zarr_format: i32,
    pub shape: Vec<i64>,
    pub chunks: Vec<i32>,
    pub compressor: Option<CompressionSettings>,
    pub filters: Option<Vec<Map<String, Value>>>,
    pub dimension_separator: DimensionSeparator,
    pub dtype: String,
    pub fill_value: FillValue,
    pub order: ArrayOrder,
    resolved_data_type: ArrayDataType,
    compressor_impl: Result<Compressor, DsError>,
    voxel_offset: Vec<i32>,
}

fn read_i64(json: &Value) -> JsResult<i64> {
    match json {
        Value::Number(n) => n
            .as_i64()
            .or_else(|| {
                n.as_f64()
                    .filter(|f| f.fract() == 0.0 && f.abs() < 9.2e18)
                    .map(|f| f as i64)
            })
            .ok_or_else(|| JsError::new("error.expected.long")),
        _ => Err(JsError::new("error.expected.jsnumber")),
    }
}

fn read_array<T>(json: &Value, read: impl Fn(&Value) -> JsResult<T>) -> JsResult<Vec<T>> {
    let Value::Array(items) = json else {
        return Err(JsError::new("error.expected.jsarray"));
    };
    let mut errors = JsError::default();
    let mut out = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        match read(item) {
            Ok(v) => out.push(v),
            Err(e) => errors.merge(e.prefixed(PathNode::Idx(i))),
        }
    }
    if errors.is_empty() {
        Ok(out)
    } else {
        Err(errors)
    }
}

fn read_compression_settings(json: &Value) -> JsResult<CompressionSettings> {
    let Value::Object(object) = json else {
        return Err(JsError::new("error.expected.jsobject"));
    };
    let mut errors = JsError::default();
    let mut out = CompressionSettings::new();
    for (key, value) in object {
        match CompressionSetting::from_json(value) {
            Some(setting) => {
                out.insert(key.clone(), setting);
            }
            None => errors.merge(JsError::new("error.expected.jsboolean").at_key(key)),
        }
    }
    if errors.is_empty() {
        Ok(out)
    } else {
        Err(errors)
    }
}

fn read_filters(json: &Value) -> JsResult<Vec<Map<String, Value>>> {
    read_array(json, |item| match item {
        Value::Object(o) => {
            let mut errors = JsError::default();
            for (k, v) in o {
                if !v.is_string() {
                    errors.merge(JsError::new("error.expected.jsstring").at_key(k));
                }
            }
            if errors.is_empty() {
                Ok(o.clone())
            } else {
                Err(errors)
            }
        }
        _ => Err(JsError::new("error.expected.jsobject")),
    })
}

fn read_enum<T>(json: &Value, from_name: impl Fn(&str) -> Option<T>) -> JsResult<T> {
    match json {
        Value::String(s) => {
            from_name(s).ok_or_else(|| JsError::new("error.expected.validenumvalue"))
        }
        _ => Err(JsError::new("error.expected.enumstring")),
    }
}

fn read_fill_value(json: &Value) -> JsResult<FillValue> {
    FillValue::from_json(json).ok_or_else(|| JsError::new("error.expected.jsnumber"))
}

/// Scala `ZarrHeader.resolvedDataType`.
pub fn resolve_zarr2_data_type(dtype: &str) -> DsResult<ArrayDataType> {
    let stripped: String = dtype
        .chars()
        .filter(|c| !matches!(c, '>' | '<' | '|'))
        .collect();
    ArrayDataType::from_name(&stripped).ok_or_else(|| {
        let message = format!("Unsupported zarr 2 dataType: {dtype}");
        DsError {
            exception: Some(format!("java.lang.IllegalArgumentException: {message}")),
            ..DsError::failure(message)
        }
    })
}

impl ZarrHeader {
    /// Play `ZarrHeaderFormat.reads` (`Json.using[WithDefaultValues]`: missing or `null`
    /// optional fields take their defaults) followed by the dtype resolution that Scala performs
    /// lazily when opening the array. JSON errors are `Validating Json Failed: {...}`.
    pub fn from_json(json: &Value) -> DsResult<Self> {
        let parsed =
            Self::read(json).map_err(|e| DsError::failure(e.validation_failure_message()))?;
        Ok(parsed)
    }

    fn read(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let zarr_format = fields.req("zarr_format", read_i32);
        let shape = fields.req("shape", |v| read_array(v, read_i64));
        let chunks = fields.req("chunks", |v| read_array(v, read_i32));
        let compressor = fields.opt("compressor", read_compression_settings);
        let filters = fields.opt("filters", read_filters);
        let dimension_separator =
            fields.with_default("dimension_separator", DimensionSeparator::Dot, |v| {
                read_enum(v, DimensionSeparator::from_name)
            });
        let dtype = fields.req("dtype", read_string);
        let fill_value = fields.with_default("fill_value", FillValue::default(), read_fill_value);
        let order = fields.req("order", |v| read_enum(v, ArrayOrder::from_name));
        fields.finish()?;
        let chunks = chunks?;
        let dtype = dtype?;
        let compressor = compressor?;
        let compressor_impl = match &compressor {
            Some(settings) => Compressor::from_zarr_settings(settings),
            None => Ok(Compressor::Null),
        };
        // Resolution failures surface when the array is opened (see `ZarrArray::open`).
        let resolved_data_type = resolve_zarr2_data_type(&dtype).unwrap_or(ArrayDataType::U1);
        Ok(Self {
            zarr_format: zarr_format?,
            shape: shape?,
            voxel_offset: vec![0; chunks.len()],
            chunks,
            compressor,
            filters: filters?,
            dimension_separator: dimension_separator?,
            dtype,
            fill_value: fill_value?,
            order: order?,
            resolved_data_type,
            compressor_impl,
        })
    }

    /// Scala `ZarrHeader.fromLayer`: the header under which a wk layer is exposed as zarr v2.
    pub fn from_layer(
        element_class: ElementClass,
        additional_axes: Option<&[AdditionalAxis]>,
        bounding_box: &BoundingBox,
        mag: Vec3Int,
    ) -> Self {
        let (channels, dtype) = element_class.to_channel_and_zarr_string();
        let axes = additional_axes.unwrap_or_default();
        let mut shape: Vec<i64> = vec![i64::from(channels)];
        shape.extend(axes.iter().map(|a| i64::from(a.upper_bound().unwrap_or(0))));
        shape.push(i64::from(
            (bounding_box.width + bounding_box.top_left.x) / mag.x,
        ));
        shape.push(i64::from(
            (bounding_box.height + bounding_box.top_left.y) / mag.y,
        ));
        shape.push(i64::from(
            (bounding_box.depth + bounding_box.top_left.z) / mag.z,
        ));
        let mut chunks: Vec<i32> = vec![channels as i32];
        chunks.extend(axes.iter().map(|_| 1));
        chunks.extend([BUCKET_LENGTH, BUCKET_LENGTH, BUCKET_LENGTH]);
        let resolved_data_type = resolve_zarr2_data_type(dtype).unwrap_or(ArrayDataType::U1);
        Self {
            zarr_format: 2,
            shape,
            voxel_offset: vec![0; chunks.len()],
            chunks,
            compressor: None,
            filters: None,
            dimension_separator: DimensionSeparator::Dot,
            dtype: dtype.to_string(),
            fill_value: FillValue::default(),
            order: ArrayOrder::F,
            resolved_data_type,
            compressor_impl: Ok(Compressor::Null),
        }
    }

    /// Scala `ZarrHeaderFormat.writes` (fixed key order, `fill_value` always 0).
    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("dtype".into(), Value::from(self.dtype.clone()));
        object.insert("fill_value".into(), Value::from(0));
        object.insert("zarr_format".into(), Value::from(self.zarr_format));
        object.insert("order".into(), Value::from(self.order.as_str()));
        object.insert("chunks".into(), Value::from(self.chunks.clone()));
        object.insert(
            "compressor".into(),
            match &self.compressor {
                Some(settings) => Value::Object(
                    settings
                        .iter()
                        .map(|(k, v)| (k.clone(), v.to_json()))
                        .collect(),
                ),
                None => Value::Null,
            },
        );
        object.insert("filters".into(), Value::Null);
        object.insert("shape".into(), Value::from(self.shape.clone()));
        object.insert(
            "dimension_separator".into(),
            Value::from(self.dimension_separator.as_str()),
        );
        Value::Object(object)
    }

    /// Whether `dtype` names a supported data type (Scala fails lazily otherwise).
    pub fn check_data_type(&self) -> DsResult<ArrayDataType> {
        resolve_zarr2_data_type(&self.dtype)
    }
}

impl DatasetHeader for ZarrHeader {
    fn dataset_shape(&self) -> Option<&[i64]> {
        Some(&self.shape)
    }

    fn chunk_shape(&self) -> &[i32] {
        &self.chunks
    }

    fn dimension_separator(&self) -> DimensionSeparator {
        self.dimension_separator
    }

    fn fill_value(&self) -> &FillValue {
        &self.fill_value
    }

    fn order(&self) -> ArrayOrder {
        self.order
    }

    fn resolved_data_type(&self) -> ArrayDataType {
        self.resolved_data_type
    }

    fn compressor(&self) -> DsResult<&Compressor> {
        self.compressor_impl.as_ref().map_err(Clone::clone)
    }

    fn voxel_offset(&self) -> &[i32] {
        &self.voxel_offset
    }

    /// Scala: `>` big, `<` little, `|` native, otherwise big endian.
    fn byte_order(&self) -> ByteOrder {
        if self.dtype.starts_with('<') || self.dtype.starts_with('|') {
            ByteOrder::LittleEndian
        } else {
            ByteOrder::BigEndian
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::datareaders::data_type::JavaNumber;
    use serde_json::json;

    #[test]
    fn parses_typical_zarray_with_defaults() {
        let header = ZarrHeader::from_json(&json!({
            "zarr_format": 2, "shape": [1, 100, 200, 50], "chunks": [1, 32, 32, 32],
            "compressor": {"id": "blosc", "cname": "lz4", "clevel": 5, "shuffle": 1, "blocksize": 0},
            "dtype": "<u2", "fill_value": null, "filters": null, "order": "C"
        }))
        .unwrap();
        assert_eq!(header.resolved_data_type(), ArrayDataType::U2);
        assert_eq!(header.byte_order(), ByteOrder::LittleEndian);
        assert_eq!(header.dimension_separator(), DimensionSeparator::Dot);
        assert_eq!(header.fill_value_number(), JavaNumber::Long(0));
        assert_eq!(header.order(), ArrayOrder::C);
        assert_eq!(header.compressor().unwrap().id(), "blosc");
        assert_eq!(header.bytes_per_chunk(), 32 * 32 * 32 * 2);
        assert_eq!(header.voxel_offset(), &[0, 0, 0, 0]);
    }

    #[test]
    fn dtype_byte_orders_and_fill_values() {
        let base = |dtype: &str, fill: Value| {
            ZarrHeader::from_json(&json!({
                "zarr_format": 2, "shape": [4], "chunks": [2], "dtype": dtype,
                "fill_value": fill, "order": "F", "dimension_separator": "/"
            }))
            .unwrap()
        };
        let h = base(">i2", json!("Infinity"));
        assert_eq!(h.byte_order(), ByteOrder::BigEndian);
        assert_eq!(h.fill_value_number(), JavaNumber::Long(65535));
        assert_eq!(h.dimension_separator(), DimensionSeparator::Slash);
        assert_eq!(
            base("f4", json!("NaN")).fill_value_number(),
            JavaNumber::Long(0)
        );
        assert_eq!(base("f4", json!("NaN")).byte_order(), ByteOrder::BigEndian);
        assert_eq!(base("|u1", json!(3)).byte_order(), ByteOrder::LittleEndian);
        assert_eq!(
            base("<f8", json!("-Infinity")).fill_value_number(),
            JavaNumber::Double(f64::MIN)
        );
        assert_eq!(
            base("<f8", json!(0.5)).fill_value_number(),
            JavaNumber::Float(0.5)
        );
        assert!(base("bool", json!("true")).fill_value_boolean());
        assert!(base("<c16", json!(0)).check_data_type().is_err());
    }

    #[test]
    fn json_errors_and_lazy_compressor_errors() {
        let error = ZarrHeader::from_json(
            &json!({"zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "u1"}),
        )
        .unwrap_err();
        assert_eq!(
            error.message,
            r#"Validating Json Failed: {"obj.order":[{"msg":["error.path.missing"],"args":[]}]}"#
        );
        let header = ZarrHeader::from_json(&json!({
            "zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "u1", "order": "C",
            "compressor": {"id": "lzma"}
        }))
        .unwrap();
        assert_eq!(
            header.compressor().unwrap_err().message,
            "Compressor id:'lzma' not supported."
        );
    }

    #[test]
    fn writes_like_scala() {
        let header = ZarrHeader::from_layer(
            ElementClass::Uint24,
            None,
            &BoundingBox::new(Vec3Int::new(10, 0, 0), 100, 64, 32),
            Vec3Int::new(2, 2, 1),
        );
        assert_eq!(
            serde_json::to_string(&header.to_json()).unwrap(),
            r#"{"dtype":"|u1","fill_value":0,"zarr_format":2,"order":"F","chunks":[3,32,32,32],"compressor":null,"filters":null,"shape":[3,55,32,32],"dimension_separator":"."}"#
        );
    }
}
