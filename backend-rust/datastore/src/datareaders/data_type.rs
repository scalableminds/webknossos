//! Scala `ArrayDataType`, `ArrayOrder`, `DimensionSeparator` and the `java.lang.Number` values
//! used for fill values (`DatasetHeader.fill_value: Either[String, Number]`).

use std::fmt;

use serde_json::Value;

use crate::models::ElementClass;

/// Scala `ArrayDataType` (enumeration value names are the wire names, e.g. `u2`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ArrayDataType {
    F8,
    F4,
    I8,
    U8,
    I4,
    U4,
    I2,
    U2,
    I1,
    U1,
    Bool,
}

impl ArrayDataType {
    pub const ALL: [ArrayDataType; 11] = [
        Self::F8,
        Self::F4,
        Self::I8,
        Self::U8,
        Self::I4,
        Self::U4,
        Self::I2,
        Self::U2,
        Self::I1,
        Self::U1,
        Self::Bool,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::F8 => "f8",
            Self::F4 => "f4",
            Self::I8 => "i8",
            Self::U8 => "u8",
            Self::I4 => "i4",
            Self::U4 => "u4",
            Self::I2 => "i2",
            Self::U2 => "u2",
            Self::I1 => "i1",
            Self::U1 => "u1",
            Self::Bool => "bool",
        }
    }

    /// Scala `ArrayDataType.fromString` (exact value name).
    pub fn from_name(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.as_str() == s)
    }

    /// Scala `bytesPerElement`.
    pub fn bytes_per_element(self) -> usize {
        match self {
            Self::F8 | Self::I8 | Self::U8 => 8,
            Self::F4 | Self::I4 | Self::U4 => 4,
            Self::I2 | Self::U2 => 2,
            Self::I1 | Self::U1 | Self::Bool => 1,
        }
    }

    /// Scala `maxValue` (note the Scala quirks: `u8` is `Long.MaxValue`, `i2` is `Char.MaxValue`).
    pub fn max_value(self) -> JavaNumber {
        match self {
            Self::F8 => JavaNumber::Double(f64::MAX),
            Self::F4 => JavaNumber::Float(f32::MAX),
            Self::I8 | Self::U8 => JavaNumber::Long(i64::MAX),
            Self::I4 => JavaNumber::Long(i64::from(i32::MAX)),
            Self::U4 => JavaNumber::Long((1i64 << 32) - 1),
            Self::I2 | Self::U2 => JavaNumber::Long(65535),
            Self::I1 => JavaNumber::Long(127),
            Self::U1 => JavaNumber::Long(255),
            Self::Bool => JavaNumber::Long(1),
        }
    }

    /// Scala `minValue` (`i2` is `Char.MinValue` = 0).
    pub fn min_value(self) -> JavaNumber {
        match self {
            Self::F8 => JavaNumber::Double(f64::MIN),
            Self::F4 => JavaNumber::Float(f32::MIN),
            Self::I8 => JavaNumber::Long(i64::MIN),
            Self::I4 => JavaNumber::Long(i64::from(i32::MIN)),
            Self::I1 => JavaNumber::Long(-128),
            Self::U8 | Self::U4 | Self::I2 | Self::U2 | Self::U1 | Self::Bool => {
                JavaNumber::Long(0)
            }
        }
    }

    /// Scala `toWKWId` (`bool` is `???` in Scala).
    pub fn to_wkw_id(self) -> Option<u8> {
        Some(match self {
            Self::U1 => 1,
            Self::U2 => 2,
            Self::U4 => 3,
            Self::U8 => 4,
            Self::F4 => 5,
            Self::F8 => 6,
            Self::I1 => 7,
            Self::I2 => 8,
            Self::I4 => 9,
            Self::I8 => 10,
            Self::Bool => return None,
        })
    }

    /// Scala `fromWKWTypeId` (other ids are a `MatchError` in Scala).
    pub fn from_wkw_type_id(id: u8) -> Option<Self> {
        Some(match id {
            1 => Self::U1,
            2 => Self::U2,
            3 => Self::U4,
            4 => Self::U8,
            5 => Self::F4,
            6 => Self::F8,
            7 => Self::I1,
            8 => Self::I2,
            9 => Self::I4,
            10 => Self::I8,
            _ => return None,
        })
    }

    /// Scala `ElementClass.fromArrayDataType`.
    pub fn element_class(self) -> Option<ElementClass> {
        Some(match self {
            Self::U1 => ElementClass::Uint8,
            Self::U2 => ElementClass::Uint16,
            Self::U4 => ElementClass::Uint32,
            Self::U8 => ElementClass::Uint64,
            Self::F4 => ElementClass::Float,
            Self::F8 => ElementClass::Double,
            Self::I1 => ElementClass::Int8,
            Self::I2 => ElementClass::Int16,
            Self::I4 => ElementClass::Int32,
            Self::I8 => ElementClass::Int64,
            Self::Bool => return None,
        })
    }

    /// Scala `ElementClass.toArrayDataTypeAndChannel`.
    pub fn from_element_class(element_class: ElementClass) -> (Self, u32) {
        match element_class {
            ElementClass::Uint8 => (Self::U1, 1),
            ElementClass::Uint16 => (Self::U2, 1),
            ElementClass::Uint24 => (Self::U1, 3),
            ElementClass::Uint32 => (Self::U4, 1),
            ElementClass::Uint64 => (Self::U8, 1),
            ElementClass::Float => (Self::F4, 1),
            ElementClass::Double => (Self::F8, 1),
            ElementClass::Int8 => (Self::I1, 1),
            ElementClass::Int16 => (Self::I2, 1),
            ElementClass::Int32 => (Self::I4, 1),
            ElementClass::Int64 => (Self::I8, 1),
        }
    }
}

impl fmt::Display for ArrayDataType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Scala `ArrayOrder` (memory layout of a chunk: row-major `C` or column-major `F`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ArrayOrder {
    F,
    C,
}

impl ArrayOrder {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::F => "F",
            Self::C => "C",
        }
    }

    pub fn from_name(s: &str) -> Option<Self> {
        match s {
            "F" => Some(Self::F),
            "C" => Some(Self::C),
            _ => None,
        }
    }
}

/// Scala `DimensionSeparator`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DimensionSeparator {
    Slash,
    Dot,
    Underscore,
}

impl DimensionSeparator {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Slash => "/",
            Self::Dot => ".",
            Self::Underscore => "_",
        }
    }

    pub fn from_name(s: &str) -> Option<Self> {
        match s {
            "/" => Some(Self::Slash),
            "." => Some(Self::Dot),
            "_" => Some(Self::Underscore),
            _ => None,
        }
    }
}

impl fmt::Display for DimensionSeparator {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Byte order of multi-byte chunk elements (`java.nio.ByteOrder`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ByteOrder {
    BigEndian,
    LittleEndian,
}

impl ByteOrder {
    /// `ByteOrder.nativeOrder` on every platform the datastore runs on.
    pub const NATIVE: ByteOrder = ByteOrder::LittleEndian;
}

impl fmt::Display for ByteOrder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::BigEndian => "BIG_ENDIAN",
            Self::LittleEndian => "LITTLE_ENDIAN",
        })
    }
}

/// A boxed `java.lang.Number` as produced by the Scala readers. Narrowing conversions follow the
/// JLS (`Number.byteValue` etc.): integers truncate, floating point saturates via `int`/`long`
/// with NaN → 0. `Int`/`Short`/`Byte`/`Char` values are represented as `Long` (identical
/// narrowing results).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum JavaNumber {
    Long(i64),
    Float(f32),
    Double(f64),
}

impl JavaNumber {
    pub fn byte_value(self) -> i8 {
        match self {
            Self::Long(v) => v as i8,
            Self::Float(v) => (v as i32) as i8,
            Self::Double(v) => (v as i32) as i8,
        }
    }

    pub fn short_value(self) -> i16 {
        match self {
            Self::Long(v) => v as i16,
            Self::Float(v) => (v as i32) as i16,
            Self::Double(v) => (v as i32) as i16,
        }
    }

    pub fn int_value(self) -> i32 {
        match self {
            Self::Long(v) => v as i32,
            Self::Float(v) => v as i32,
            Self::Double(v) => v as i32,
        }
    }

    pub fn long_value(self) -> i64 {
        match self {
            Self::Long(v) => v,
            Self::Float(v) => v as i64,
            Self::Double(v) => v as i64,
        }
    }

    pub fn float_value(self) -> f32 {
        match self {
            Self::Long(v) => v as f32,
            Self::Float(v) => v,
            Self::Double(v) => v as f32,
        }
    }

    pub fn double_value(self) -> f64 {
        match self {
            Self::Long(v) => v as f64,
            Self::Float(v) => f64::from(v),
            Self::Double(v) => v,
        }
    }

    /// Play `NumberFormat.reads` from `helpers/JsonImplicits`: `validate[Long]` (any whole JSON
    /// number in the `Long` range, also `5.0`), otherwise `validate[Float]`, which in play-json
    /// 3.0 accepts every JSON number (`BigDecimal.toFloat`). `None` for non-numbers.
    pub fn from_json(value: &Value) -> Option<Self> {
        let Value::Number(n) = value else {
            return None;
        };
        if let Some(v) = n.as_i64() {
            return Some(Self::Long(v));
        }
        let f = n.as_f64()?;
        if f.is_finite()
            && f.fract() == 0.0
            && (-9.223_372_036_854_776e18..9.223_372_036_854_776e18).contains(&f)
        {
            return Some(Self::Long(f as i64));
        }
        Some(Self::Float(f as f32))
    }

    /// Play `NumberFormat.writes`: whole values as integers, others as decimals.
    pub fn to_json(self) -> Value {
        let long = self.long_value();
        if (self.double_value() - long as f64).abs() < 1e-9 {
            Value::from(long)
        } else {
            serde_json::Number::from_f64(self.double_value())
                .map(Value::Number)
                .unwrap_or(Value::Null)
        }
    }
}

impl fmt::Display for JavaNumber {
    /// Java `toString` for integers; floats use Rust's shortest representation (close to Java's).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Long(v) => write!(f, "{v}"),
            Self::Float(v) => write!(f, "{v:?}"),
            Self::Double(v) => write!(f, "{v:?}"),
        }
    }
}

/// Scala `Either[String, Number]` fill value of a header.
#[derive(Debug, Clone, PartialEq)]
pub enum FillValue {
    String(String),
    Number(JavaNumber),
}

impl FillValue {
    /// Play `StringOrNumberFormat.reads`: a string first, then a number.
    pub fn from_json(value: &Value) -> Option<Self> {
        match value {
            Value::String(s) => Some(Self::String(s.clone())),
            other => JavaNumber::from_json(other).map(Self::Number),
        }
    }
}

impl Default for FillValue {
    fn default() -> Self {
        Self::Number(JavaNumber::Long(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_roundtrip_and_sizes() {
        for t in ArrayDataType::ALL {
            assert_eq!(ArrayDataType::from_name(t.as_str()), Some(t));
        }
        assert_eq!(ArrayDataType::from_name("uint8"), None);
        assert_eq!(ArrayDataType::U2.bytes_per_element(), 2);
        assert_eq!(ArrayDataType::Bool.bytes_per_element(), 1);
        assert_eq!(ArrayDataType::from_wkw_type_id(3), Some(ArrayDataType::U4));
        assert_eq!(ArrayDataType::Bool.to_wkw_id(), None);
        assert_eq!(
            ArrayDataType::from_element_class(ElementClass::Uint24),
            (ArrayDataType::U1, 3)
        );
    }

    #[test]
    fn java_number_narrowing() {
        assert_eq!(JavaNumber::Long(255).byte_value(), -1);
        assert_eq!(JavaNumber::Long(65535).short_value(), -1);
        assert_eq!(JavaNumber::Long((1 << 32) - 1).int_value(), -1);
        assert_eq!(JavaNumber::Float(f32::MAX).long_value(), i64::MAX);
        assert_eq!(JavaNumber::Float(f32::NAN).int_value(), 0);
        assert_eq!(JavaNumber::Double(300.7).byte_value(), 44);
        assert_eq!(JavaNumber::Double(-1e20).short_value(), 0); // int saturates to MIN, low 16 bits 0
        assert_eq!(JavaNumber::Float(0.1).double_value(), f64::from(0.1f32));
    }

    #[test]
    fn number_json_reads() {
        use serde_json::json;
        assert_eq!(JavaNumber::from_json(&json!(5)), Some(JavaNumber::Long(5)));
        assert_eq!(
            JavaNumber::from_json(&json!(5.0)),
            Some(JavaNumber::Long(5))
        );
        assert_eq!(
            JavaNumber::from_json(&json!(0.1)),
            Some(JavaNumber::Float(0.1))
        );
        assert_eq!(
            JavaNumber::from_json(&json!(18446744073709551615u64)),
            Some(JavaNumber::Float(1.8446744e19))
        );
        assert_eq!(JavaNumber::from_json(&json!("x")), None);
        assert_eq!(
            FillValue::from_json(&json!("NaN")),
            Some(FillValue::String("NaN".into()))
        );
        assert_eq!(FillValue::from_json(&json!(null)), None);
    }
}
