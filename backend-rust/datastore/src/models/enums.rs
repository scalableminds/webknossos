//! Scala `ExtendedEnumeration`s of the data source model: `ElementClass`, `DataFormat`,
//! `LayerCategory`, `LengthUnit`, `CoordinateTransformationType`, `LayerAttachmentType`,
//! `LayerAttachmentDataformat`.

use serde_json::Value;

use super::json::{JsError, JsResult, deserialize_via_from_json, string_enum};

string_enum!(
    /// Scala `ElementClass`.
    ElementClass {
        Uint8 => "uint8",
        Uint16 => "uint16",
        Uint24 => "uint24",
        Uint32 => "uint32",
        Uint64 => "uint64",
        Float => "float",
        Double => "double",
        Int8 => "int8",
        Int16 => "int16",
        Int32 => "int32",
        Int64 => "int64",
    }
);

impl ElementClass {
    /// Scala `segmentationElementClasses`.
    pub const SEGMENTATION: &'static [ElementClass] = &[
        Self::Uint8,
        Self::Uint16,
        Self::Uint32,
        Self::Uint64,
        Self::Int8,
        Self::Int16,
        Self::Int32,
        Self::Int64,
    ];

    pub fn is_segmentation_element_class(self) -> bool {
        Self::SEGMENTATION.contains(&self)
    }

    pub fn bytes_per_element(self) -> usize {
        match self {
            Self::Uint8 | Self::Int8 => 1,
            Self::Uint16 | Self::Int16 => 2,
            Self::Uint24 => 3,
            Self::Uint32 | Self::Int32 | Self::Float => 4,
            Self::Uint64 | Self::Int64 | Self::Double => 8,
        }
    }

    /// Scala `StaticLayer.numChannels`.
    pub fn num_channels(self) -> u32 {
        if self == Self::Uint24 { 3 } else { 1 }
    }

    pub fn is_signed(self) -> bool {
        matches!(
            self,
            Self::Float | Self::Double | Self::Int8 | Self::Int16 | Self::Int32 | Self::Int64
        )
    }

    /// Scala `encodeAsByte` (declaration index).
    pub fn encode_as_byte(self) -> u8 {
        self as u8
    }

    /// Scala `defaultIntensityRange`.
    pub fn default_intensity_range(self) -> (f64, f64) {
        match self {
            Self::Uint8 | Self::Uint24 | Self::Uint64 | Self::Int64 => (0.0, 255.0),
            Self::Uint16 => (0.0, 65535.0),
            Self::Uint32 => (0.0, 4294967295.0),
            Self::Float => (-3.40282347e+38, 3.40282347e+38),
            Self::Double => (-1.7976931348623157e+308, 1.7976931348623157e+308),
            Self::Int8 => (-128.0, 127.0),
            Self::Int16 => (-32768.0, 32767.0),
            Self::Int32 => (-2147483648.0, 2147483647.0),
        }
    }

    /// Scala `maxSegmentIdValue` (inclusive, `None` for uint64 and non-segmentation classes).
    fn max_segment_id_value(self) -> Option<i64> {
        match self {
            Self::Uint8 => Some(255),
            Self::Int8 => Some(i64::from(i8::MAX)),
            Self::Uint16 => Some(65535),
            Self::Int16 => Some(i64::from(i16::MAX)),
            Self::Uint32 => Some(4294967295),
            Self::Int32 => Some(i64::from(i32::MAX)),
            Self::Int64 => Some(i64::MAX),
            _ => None,
        }
    }

    /// Scala `largestSegmentIdIsInRange`. The id is the uint64 bit pattern Scala keeps in a
    /// `Long` (`UnsignedLong`): negative `Long`s are only valid for uint64.
    pub fn largest_segment_id_is_in_range(self, largest_segment_id: Option<u64>) -> bool {
        self.is_segmentation_element_class()
            && largest_segment_id.is_none_or(|id| {
                let as_long = id as i64;
                self == Self::Uint64
                    || (as_long >= 0
                        && self.max_segment_id_value().is_none_or(|max| as_long <= max))
            })
    }

    /// Scala `toChannelAndZarrString`.
    pub fn to_channel_and_zarr_string(self) -> (u32, &'static str) {
        match self {
            Self::Uint8 => (1, "|u1"),
            Self::Uint16 => (1, "<u2"),
            Self::Uint24 => (3, "|u1"),
            Self::Uint32 => (1, "<u4"),
            Self::Uint64 => (1, "<u8"),
            Self::Float => (1, "<f4"),
            Self::Double => (1, "<f8"),
            Self::Int8 => (1, "|i1"),
            Self::Int16 => (1, "<i2"),
            Self::Int32 => (1, "<i4"),
            Self::Int64 => (1, "<i8"),
        }
    }

    /// Scala `toChannelAndZarr3String`.
    pub fn to_channel_and_zarr3_string(self) -> (u32, &'static str) {
        match self {
            Self::Uint8 => (1, "uint8"),
            Self::Uint16 => (1, "uint16"),
            Self::Uint24 => (3, "uint8"),
            Self::Uint32 => (1, "uint32"),
            Self::Uint64 => (1, "uint64"),
            Self::Float => (1, "float32"),
            Self::Double => (1, "float64"),
            Self::Int8 => (1, "int8"),
            Self::Int16 => (1, "int16"),
            Self::Int32 => (1, "int32"),
            Self::Int64 => (1, "int64"),
        }
    }
}

string_enum!(
    /// Scala `DataFormat`.
    DataFormat {
        Wkw => "wkw",
        Zarr => "zarr",
        Zarr3 => "zarr3",
        N5 => "n5",
        NeuroglancerPrecomputed => "neuroglancerPrecomputed",
        Tracing => "tracing",
    }
);

string_enum!(
    /// Scala `LayerCategory`.
    LayerCategory {
        Color => "color",
        Segmentation => "segmentation",
    }
);

string_enum!(
    /// Scala `CoordinateTransformationType`.
    CoordinateTransformationType {
        Affine => "affine",
        ThinPlateSpline => "thin_plate_spline",
    }
);

string_enum!(
    /// Scala `LayerAttachmentType`.
    LayerAttachmentType {
        Mesh => "mesh",
        Agglomerate => "agglomerate",
        SegmentIndex => "segmentIndex",
        Connectome => "connectome",
        Cumsum => "cumsum",
        SegmentStatistics => "segmentStatistics",
    }
);

impl LayerAttachmentType {
    /// Scala `defaultDirectoryNameFor`.
    pub fn default_directory_name(self) -> &'static str {
        match self {
            Self::Mesh => "meshes",
            Self::Agglomerate | Self::Cumsum => "agglomerates",
            Self::SegmentIndex => "segmentIndex",
            Self::Connectome => "connectomes",
            Self::SegmentStatistics => "segmentStatistics",
        }
    }

    /// Scala `isSingletonAttachment`.
    pub fn is_singleton(self) -> bool {
        matches!(
            self,
            Self::SegmentIndex | Self::Cumsum | Self::SegmentStatistics
        )
    }
}

string_enum!(
    /// Scala `LayerAttachmentDataformat`.
    LayerAttachmentDataformat {
        Hdf5 => "hdf5",
        Json => "json",
        Zarr3 => "zarr3",
        NeuroglancerPrecomputed => "neuroglancerPrecomputed",
    }
);

impl LayerAttachmentDataformat {
    /// Scala `suffixFor`.
    pub fn suffix(self) -> &'static str {
        match self {
            Self::Hdf5 => ".hdf5",
            Self::Json => ".json",
            Self::Zarr3 | Self::NeuroglancerPrecomputed => "",
        }
    }
}

/// Scala `LengthUnit`: written with the full name, read with the full name or abbreviation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LengthUnit {
    Yoctometer,
    Zeptometer,
    Attometer,
    Femtometer,
    Picometer,
    Nanometer,
    Micrometer,
    Millimeter,
    Centimeter,
    Decimeter,
    Meter,
    Hectometer,
    Kilometer,
    Megameter,
    Gigameter,
    Terameter,
    Petameter,
    Exameter,
    Zettameter,
    Yottameter,
    Angstrom,
    Inch,
    Foot,
    Yard,
    Mile,
    Parsec,
}

/// (unit, full name, abbreviation, nanometers per unit)
const LENGTH_UNITS: &[(LengthUnit, &str, &str, f64)] = &[
    (LengthUnit::Yoctometer, "yoctometer", "ym", 1e-15),
    (LengthUnit::Zeptometer, "zeptometer", "zm", 1e-12),
    (LengthUnit::Attometer, "attometer", "am", 1e-9),
    (LengthUnit::Femtometer, "femtometer", "fm", 1e-6),
    (LengthUnit::Picometer, "picometer", "pm", 1e-3),
    (LengthUnit::Nanometer, "nanometer", "nm", 1.0),
    (LengthUnit::Micrometer, "micrometer", "µm", 1e3),
    (LengthUnit::Millimeter, "millimeter", "mm", 1e6),
    (LengthUnit::Centimeter, "centimeter", "cm", 1e7),
    (LengthUnit::Decimeter, "decimeter", "dm", 1e8),
    (LengthUnit::Meter, "meter", "m", 1e9),
    (LengthUnit::Hectometer, "hectometer", "hm", 1e11),
    (LengthUnit::Kilometer, "kilometer", "km", 1e12),
    (LengthUnit::Megameter, "megameter", "Mm", 1e15),
    (LengthUnit::Gigameter, "gigameter", "Gm", 1e18),
    (LengthUnit::Terameter, "terameter", "Tm", 1e21),
    (LengthUnit::Petameter, "petameter", "Pm", 1e24),
    (LengthUnit::Exameter, "exameter", "Em", 1e27),
    (LengthUnit::Zettameter, "zettameter", "Zm", 1e30),
    (LengthUnit::Yottameter, "yottameter", "Ym", 1e33),
    (LengthUnit::Angstrom, "angstrom", "Å", 0.1),
    (LengthUnit::Inch, "inch", "in", 25400000.0),
    (LengthUnit::Foot, "foot", "ft", 304800000.0),
    (LengthUnit::Yard, "yard", "yd", 914400000.0),
    (LengthUnit::Mile, "mile", "mi", 1609344000000.0),
    (LengthUnit::Parsec, "parsec", "pc", 3.085677581e25),
];

impl LengthUnit {
    fn entry(self) -> &'static (LengthUnit, &'static str, &'static str, f64) {
        &LENGTH_UNITS[self as usize]
    }

    pub fn as_str(self) -> &'static str {
        self.entry().1
    }

    /// Scala `LengthUnit.fromString` (full name or abbreviation).
    pub fn from_name(s: &str) -> Option<Self> {
        LENGTH_UNITS
            .iter()
            .find(|(_, name, abbreviation, _)| *name == s || *abbreviation == s)
            .map(|entry| entry.0)
    }

    pub fn to_nanometer(self) -> f64 {
        self.entry().3
    }

    pub fn from_json(json: &Value) -> JsResult<Self> {
        match json {
            Value::String(s) => {
                Self::from_name(s).ok_or_else(|| JsError::new("error.expected.validenumvalue"))
            }
            _ => Err(JsError::new("error.expected.jsstring")),
        }
    }
}

impl std::fmt::Display for LengthUnit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl serde::Serialize for LengthUnit {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

deserialize_via_from_json!(LengthUnit);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn element_class_helpers() {
        assert_eq!(ElementClass::Uint24.bytes_per_element(), 3);
        assert_eq!(ElementClass::Uint24.num_channels(), 3);
        assert_eq!(ElementClass::Double.bytes_per_element(), 8);
        assert_eq!(ElementClass::Int64.encode_as_byte(), 10);
        assert_eq!(
            ElementClass::Uint24.to_channel_and_zarr_string(),
            (3, "|u1")
        );
        let in_range = ElementClass::largest_segment_id_is_in_range;
        assert!(in_range(ElementClass::Uint8, Some(255)));
        assert!(!in_range(ElementClass::Uint8, Some(256)));
        assert!(in_range(ElementClass::Int8, Some(127)));
        assert!(!in_range(ElementClass::Int8, Some(128)));
        assert!(in_range(ElementClass::Uint32, Some(4294967295)));
        assert!(!in_range(ElementClass::Int32, Some(1 << 31)));
        assert!(in_range(ElementClass::Uint64, Some(u64::MAX)));
        assert!(!in_range(ElementClass::Int64, Some(u64::MAX)));
        assert!(in_range(ElementClass::Int64, Some(i64::MAX as u64)));
        assert!(!in_range(ElementClass::Uint32, Some(u64::MAX)));
        assert!(!in_range(ElementClass::Float, None));
        assert!(!in_range(ElementClass::Uint24, Some(1)));
        assert!(in_range(ElementClass::Uint16, None));
    }

    #[test]
    fn enum_json() {
        assert_eq!(
            ElementClass::from_json(&json!("uint24")),
            Ok(ElementClass::Uint24)
        );
        assert_eq!(
            ElementClass::from_json(&json!("uint128")),
            Err(JsError::new("error.expected.validenumvalue"))
        );
        assert_eq!(
            ElementClass::from_json(&json!(3)),
            Err(JsError::new("error.expected.enumstring"))
        );
        assert_eq!(
            DataFormat::from_json(&json!("neuroglancerPrecomputed")),
            Ok(DataFormat::NeuroglancerPrecomputed)
        );
        assert_eq!(
            LengthUnit::from_json(&json!("µm")),
            Ok(LengthUnit::Micrometer)
        );
        assert_eq!(LengthUnit::from_json(&json!("Å")), Ok(LengthUnit::Angstrom));
        assert_eq!(
            serde_json::to_string(&LengthUnit::Micrometer).unwrap(),
            "\"micrometer\""
        );
        for (index, (unit, ..)) in LENGTH_UNITS.iter().enumerate() {
            assert_eq!(*unit as usize, index);
        }
        assert_eq!(
            serde_json::from_value::<CoordinateTransformationType>(json!("thin_plate_spline"))
                .unwrap(),
            CoordinateTransformationType::ThinPlateSpline
        );
    }
}
