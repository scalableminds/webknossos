//! Play-JSON compatible reading/writing helpers.
//!
//! Reading is done by hand over [`serde_json::Value`] so that the Scala semantics can be mirrored
//! exactly: legacy fallbacks (`wkwResolutions`), `orElse` chains (`VoxelSize`), filtering of empty
//! view configurations, and Play's error paths/messages (`obj.dataLayers[0].boundingBox`,
//! `error.path.missing`, `error.expected.jsnumber`, ...).
//!
//! Two read styles exist in Scala and both are modelled:
//! - derived `Json.format` readers (`JsPath.read`/`readNullable`): every field is read, errors are
//!   accumulated and prefixed with the field name ([`Fields`]).
//! - hand-written readers using `(json \ "key").validate[T]`: they short-circuit at the first
//!   error, a missing key yields `'key' is undefined on object: {...}` and nested errors are NOT
//!   prefixed with the key ([`lookup`], [`lookup_opt`]).
//!
//! Writing follows Play's number rendering: a `Double` is written via `BigDecimal`, trailing zeros
//! stripped, so `28.0` becomes `28` ([`play_f64`], [`PlayValue`]).

use std::fmt;

use serde::{Serialize, Serializer};
use serde_json::{Map, Number, Value};

/// One node of a Play `JsPath`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathNode {
    Key(String),
    Idx(usize),
}

/// Play `JsError`: a list of (path, messages). Paths are stored root-first.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct JsError {
    pub errors: Vec<(Vec<PathNode>, Vec<String>)>,
}

pub type JsResult<T> = Result<T, JsError>;

impl JsError {
    /// Play `JsError(msg)`: one message at the (relative) root path.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            errors: vec![(Vec::new(), vec![message.into()])],
        }
    }

    /// Play `repath`: prefixes every error path with `node`.
    pub fn prefixed(mut self, node: PathNode) -> Self {
        for (path, _) in &mut self.errors {
            path.insert(0, node.clone());
        }
        self
    }

    pub fn at_key(self, key: &str) -> Self {
        self.prefixed(PathNode::Key(key.to_string()))
    }

    /// Play `JsError ++ JsError` (`JsError.merge`): messages of equal paths are combined.
    pub fn merge(&mut self, other: JsError) {
        for (path, messages) in other.errors {
            if let Some((_, existing)) = self.errors.iter_mut().find(|(p, _)| *p == path) {
                existing.extend(messages);
            } else {
                self.errors.push((path, messages));
            }
        }
    }

    pub fn is_empty(&self) -> bool {
        self.errors.is_empty()
    }

    /// Play `JsPath.toJsonString`, e.g. `obj.dataLayers[0].name`.
    pub fn path_string(path: &[PathNode]) -> String {
        let mut result = String::from("obj");
        for node in path {
            match node {
                PathNode::Key(key) => {
                    result.push('.');
                    result.push_str(key);
                }
                PathNode::Idx(idx) => {
                    result.push('[');
                    result.push_str(&idx.to_string());
                    result.push(']');
                }
            }
        }
        result
    }

    /// Play `JsError.toJson(error)`: `{"obj.path":[{"msg":["error.path.missing"],"args":[]}]}`.
    pub fn to_play_json(&self) -> Value {
        let mut object = Map::new();
        for (path, messages) in &self.errors {
            let entries: Vec<Value> = messages
                .iter()
                .map(|m| serde_json::json!({"msg": [m], "args": []}))
                .collect();
            let key = Self::path_string(path);
            match object.get_mut(&key) {
                Some(Value::Array(existing)) => existing.extend(entries),
                _ => {
                    object.insert(key, Value::Array(entries));
                }
            }
        }
        Value::Object(object)
    }

    /// Scala `JsonHelper.as`: `"Validating Json Failed: " + JsError.toJson(errors).toString()`.
    pub fn validation_failure_message(&self) -> String {
        format!("Validating Json Failed: {self}")
    }
}

impl fmt::Display for JsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_play_json())
    }
}

impl std::error::Error for JsError {}

/// Compact rendering like Play `JsValue.toString` (numbers in Play form).
pub fn compact(value: &Value) -> String {
    serde_json::to_string(&PlayValue(value)).unwrap_or_default()
}

/// Play `json \ key` followed by `.validate[T]`: no repath, missing key gives the
/// `'key' is undefined on object: …` message.
pub fn lookup<T>(json: &Value, key: &str, read: impl FnOnce(&Value) -> JsResult<T>) -> JsResult<T> {
    match json {
        Value::Object(object) => match object.get(key) {
            Some(value) => read(value),
            None => Err(JsError::new(format!(
                "'{key}' is undefined on object: {}",
                compact(json)
            ))),
        },
        other => Err(JsError::new(format!("{} is not an object", compact(other)))),
    }
}

/// Play `(json \ key).validateOpt[T]`: missing or `null` is `None`, no repath.
pub fn lookup_opt<T>(
    json: &Value,
    key: &str,
    read: impl FnOnce(&Value) -> JsResult<T>,
) -> JsResult<Option<T>> {
    match json.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => read(value).map(Some),
    }
}

/// Accumulating reader for Play-derived formats (`Json.format`, `Json.reads`).
pub struct Fields<'a> {
    json: &'a Value,
    errors: JsError,
}

impl<'a> Fields<'a> {
    pub fn new(json: &'a Value) -> Self {
        Self {
            json,
            errors: JsError::default(),
        }
    }

    fn record<T>(&mut self, result: JsResult<T>) -> JsResult<T> {
        if let Err(error) = &result {
            self.errors.merge(error.clone());
        }
        result
    }

    /// `(__ \ key).read[T]`: missing (or non-object parent) is `error.path.missing`.
    pub fn req<T>(&mut self, key: &str, read: impl FnOnce(&Value) -> JsResult<T>) -> JsResult<T> {
        let result = match self.json.get(key) {
            Some(value) => read(value).map_err(|e| e.at_key(key)),
            None => Err(JsError::new("error.path.missing").at_key(key)),
        };
        self.record(result)
    }

    /// `(__ \ key).readNullable[T]`: missing or `null` is `None`.
    pub fn opt<T>(
        &mut self,
        key: &str,
        read: impl FnOnce(&Value) -> JsResult<T>,
    ) -> JsResult<Option<T>> {
        let result = match self.json.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => read(value).map(Some).map_err(|e| e.at_key(key)),
        };
        self.record(result)
    }

    /// `Json.using[WithDefaultValues]`: missing or `null` is the default.
    pub fn with_default<T>(
        &mut self,
        key: &str,
        default: T,
        read: impl FnOnce(&Value) -> JsResult<T>,
    ) -> JsResult<T> {
        self.opt(key, read).map(|v| v.unwrap_or(default))
    }

    /// Returns the accumulated errors, if any.
    pub fn finish(self) -> JsResult<()> {
        if self.errors.is_empty() {
            Ok(())
        } else {
            Err(self.errors)
        }
    }
}

/// Play `Reads[String]`.
pub fn read_string(json: &Value) -> JsResult<String> {
    match json {
        Value::String(s) => Ok(s.clone()),
        _ => Err(JsError::new("error.expected.jsstring")),
    }
}

/// Integral value of a JSON number if it is whole (`BigDecimal.isWhole`), as i128.
fn whole_number(number: &Number) -> Option<i128> {
    if let Some(v) = number.as_i64() {
        return Some(i128::from(v));
    }
    if let Some(v) = number.as_u64() {
        return Some(i128::from(v));
    }
    let v = number.as_f64()?;
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 1e38 {
        Some(v as i128)
    } else {
        None
    }
}

/// Play `Reads[Int]` (`isValidInt`, else `error.expected.int`).
pub fn read_i32(json: &Value) -> JsResult<i32> {
    match json {
        Value::Number(n) => whole_number(n)
            .and_then(|v| i32::try_from(v).ok())
            .ok_or_else(|| JsError::new("error.expected.int")),
        _ => Err(JsError::new("error.expected.jsnumber")),
    }
}

/// Play `Reads[Long]`.
pub fn read_i64(json: &Value) -> JsResult<i64> {
    match json {
        Value::Number(n) => whole_number(n)
            .and_then(|v| i64::try_from(v).ok())
            .ok_or_else(|| JsError::new("error.expected.long")),
        _ => Err(JsError::new("error.expected.jsnumber")),
    }
}
/// Play `Reads[Boolean]`.
pub fn read_bool(json: &Value) -> JsResult<bool> {
    json.as_bool()
        .ok_or_else(|| JsError::new("error.expected.jsboolean"))
}

/// Play `Reads[Double]`.
pub fn read_f64(json: &Value) -> JsResult<f64> {
    match json {
        Value::Number(n) => n
            .as_f64()
            .ok_or_else(|| JsError::new("error.expected.jsnumber")),
        _ => Err(JsError::new("error.expected.jsnumber")),
    }
}

/// Play `Reads[List[T]]`/`Reads[Seq[T]]`: element errors are accumulated with `[i]` paths.
pub fn read_list<T>(json: &Value, read: impl Fn(&Value) -> JsResult<T>) -> JsResult<Vec<T>> {
    let Value::Array(items) = json else {
        return Err(JsError::new("error.expected.jsarray"));
    };
    let mut errors = JsError::default();
    let mut result = Vec::with_capacity(items.len());
    for (idx, item) in items.iter().enumerate() {
        match read(item) {
            Ok(value) => result.push(value),
            Err(error) => errors.merge(error.prefixed(PathNode::Idx(idx))),
        }
    }
    if errors.is_empty() {
        Ok(result)
    } else {
        Err(errors)
    }
}

/// Play `Reads[Set[String]]`: like a list, duplicates removed (first occurrence kept).
pub fn read_string_set(json: &Value) -> JsResult<Vec<String>> {
    let mut list = read_list(json, read_string)?;
    let mut seen = std::collections::HashSet::new();
    list.retain(|s| seen.insert(s.clone()));
    Ok(list)
}

/// Play `Reads.mapReads[JsValue]` (`Map[String, JsValue]`).
pub fn read_object(json: &Value) -> JsResult<Map<String, Value>> {
    match json {
        Value::Object(object) => Ok(object.clone()),
        _ => Err(JsError::new("error.expected.jsobject")),
    }
}

/// Play `Reads[JsValue]` (any value).
pub fn read_any(json: &Value) -> JsResult<Value> {
    Ok(json.clone())
}

/// Play `Writes[Double]` → `JsNumber(BigDecimal(d))` → Jackson output with trailing zeros
/// stripped: whole numbers below 1e20 are written as integers (`28.0` → `28`), everything else
/// as the shortest round-tripping decimal.
pub fn play_f64_number(value: f64) -> Option<Number> {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 1e20 {
        if value >= i64::MIN as f64 && value < i64::MAX as f64 {
            return Some(Number::from(value as i64));
        }
        if value >= 0.0 && value < u64::MAX as f64 {
            return Some(Number::from(value as u64));
        }
    }
    Number::from_f64(value)
}

/// serde `serialize_with` helper for Play-formatted doubles.
pub fn play_f64<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    match play_f64_number(*value) {
        Some(number) => number.serialize(serializer),
        None => serializer.serialize_unit(),
    }
}

/// Serializes a [`Value`] the way Play would re-render it after parsing: whole floats lose their
/// `.0` (`150.0` → `150`). Used for pass-through JSON (view configurations, existing properties).
pub struct PlayValue<'a>(pub &'a Value);

impl Serialize for PlayValue<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::{SerializeMap, SerializeSeq};
        match self.0 {
            Value::Number(n) if n.is_f64() => match n.as_f64() {
                Some(v) => play_f64(&v, serializer),
                None => n.serialize(serializer),
            },
            Value::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(&PlayValue(item))?;
                }
                seq.end()
            }
            Value::Object(object) => {
                let mut map = serializer.serialize_map(Some(object.len()))?;
                for (key, value) in object {
                    map.serialize_entry(key, &PlayValue(value))?;
                }
                map.end()
            }
            other => other.serialize(serializer),
        }
    }
}

/// serde `serialize_with` helper for `Option<Map<String, Value>>` / `Map` pass-through JSON.
pub fn play_object<S: Serializer>(
    value: &Map<String, Value>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let mut map = serializer.serialize_map(Some(value.len()))?;
    for (key, item) in value {
        map.serialize_entry(key, &PlayValue(item))?;
    }
    map.end()
}

/// Jackson `DefaultPrettyPrinter` output as produced by Play `Json.prettyPrint`
/// (`"key" : value`, two-space object indentation, arrays inline as `[ 1, 2 ]`, `[ ]`, `{ }`).
pub fn pretty_print(value: &Value) -> String {
    pretty_print_serialize(&PlayValue(value))
}

/// [`pretty_print`] for any [`Serialize`] value, keeping the serializer's key order (unlike a
/// detour through [`Value`], whose map is key-sorted without serde_json's `preserve_order`).
pub fn pretty_print_serialize<T: Serialize + ?Sized>(value: &T) -> String {
    let mut out = Vec::new();
    let mut serializer =
        serde_json::Serializer::with_formatter(&mut out, JacksonPrettyFormatter::default());
    // Serializing into a Vec only fails for non-string map keys, which the models never produce.
    if value.serialize(&mut serializer).is_err() {
        return String::new();
    }
    String::from_utf8(out).unwrap_or_default()
}

/// serde_json [`Formatter`](serde_json::ser::Formatter) for Jackson's `DefaultPrettyPrinter`:
/// only objects indent (arrays use Jackson's inline `FixedSpaceIndenter`).
#[derive(Default)]
struct JacksonPrettyFormatter {
    indent: usize,
    has_value: bool,
}

impl JacksonPrettyFormatter {
    fn newline_indent<W: ?Sized + std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        writer.write_all(b"\n")?;
        for _ in 0..self.indent {
            writer.write_all(b"  ")?;
        }
        Ok(())
    }
}

impl serde_json::ser::Formatter for JacksonPrettyFormatter {
    fn begin_array<W: ?Sized + std::io::Write>(&mut self, writer: &mut W) -> std::io::Result<()> {
        writer.write_all(b"[")
    }

    fn end_array<W: ?Sized + std::io::Write>(&mut self, writer: &mut W) -> std::io::Result<()> {
        writer.write_all(b" ]")
    }

    fn begin_array_value<W: ?Sized + std::io::Write>(
        &mut self,
        writer: &mut W,
        first: bool,
    ) -> std::io::Result<()> {
        writer.write_all(if first { b" " } else { b", " })
    }

    fn end_array_value<W: ?Sized + std::io::Write>(
        &mut self,
        _writer: &mut W,
    ) -> std::io::Result<()> {
        self.has_value = true;
        Ok(())
    }

    fn begin_object<W: ?Sized + std::io::Write>(&mut self, writer: &mut W) -> std::io::Result<()> {
        self.indent += 1;
        self.has_value = false;
        writer.write_all(b"{")
    }

    fn end_object<W: ?Sized + std::io::Write>(&mut self, writer: &mut W) -> std::io::Result<()> {
        self.indent -= 1;
        if self.has_value {
            self.newline_indent(writer)?;
            writer.write_all(b"}")
        } else {
            writer.write_all(b" }")
        }
    }

    fn begin_object_key<W: ?Sized + std::io::Write>(
        &mut self,
        writer: &mut W,
        first: bool,
    ) -> std::io::Result<()> {
        if !first {
            writer.write_all(b",")?;
        }
        self.newline_indent(writer)
    }

    fn begin_object_value<W: ?Sized + std::io::Write>(
        &mut self,
        writer: &mut W,
    ) -> std::io::Result<()> {
        writer.write_all(b" : ")
    }

    fn end_object_value<W: ?Sized + std::io::Write>(
        &mut self,
        _writer: &mut W,
    ) -> std::io::Result<()> {
        self.has_value = true;
        Ok(())
    }
}

/// Implements [`serde::Deserialize`] through the type's Play-compatible `from_json` reader.
macro_rules! deserialize_via_from_json {
    ($($ty:ty),* $(,)?) => {
        $(
            impl<'de> serde::Deserialize<'de> for $ty {
                fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                    let value = serde_json::Value::deserialize(deserializer)?;
                    <$ty>::from_json(&value).map_err(serde::de::Error::custom)
                }
            }
        )*
    };
}
pub(crate) use deserialize_via_from_json;

/// Defines a Scala `Enumeration`-like string enum with Play `Json.formatEnum` semantics.
macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $text:literal),* $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum $name {
            $($variant),*
        }

        impl $name {
            /// All values in Scala declaration order.
            pub const ALL: &'static [$name] = &[$($name::$variant),*];

            pub fn as_str(self) -> &'static str {
                match self {
                    $($name::$variant => $text),*
                }
            }

            /// Scala `fromString`.
            pub fn from_name(s: &str) -> Option<Self> {
                match s {
                    $($text => Some($name::$variant),)*
                    _ => None,
                }
            }

            /// Play `Json.formatEnum` reads.
            pub fn from_json(json: &serde_json::Value) -> $crate::models::json::JsResult<Self> {
                match json {
                    serde_json::Value::String(s) => Self::from_name(s).ok_or_else(|| {
                        $crate::models::json::JsError::new("error.expected.validenumvalue")
                    }),
                    _ => Err($crate::models::json::JsError::new("error.expected.enumstring")),
                }
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl serde::Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(self.as_str())
            }
        }

        $crate::models::json::deserialize_via_from_json!($name);
    };
}
pub(crate) use string_enum;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn play_double_rendering() {
        let render = |v: f64| serde_json::to_string(&PlayValue(&json!(v))).unwrap();
        assert_eq!(render(28.0), "28");
        assert_eq!(render(11.24), "11.24");
        assert_eq!(render(-3.0), "-3");
        assert_eq!(render(25.92000000000001), "25.92000000000001");
        assert_eq!(render(1e19), "10000000000000000000");
        assert_eq!(render(0.0), "0");
    }

    #[test]
    fn int_reads_follow_play() {
        assert_eq!(read_i32(&json!(5)), Ok(5));
        assert_eq!(read_i32(&json!(5.0)), Ok(5));
        assert_eq!(
            read_i32(&json!(5.5)),
            Err(JsError::new("error.expected.int"))
        );
        assert_eq!(
            read_i32(&json!(4_000_000_000u64)),
            Err(JsError::new("error.expected.int"))
        );
        assert_eq!(
            read_i32(&json!("5")),
            Err(JsError::new("error.expected.jsnumber"))
        );
    }

    #[test]
    fn error_paths_and_rendering() {
        let fields_json = json!({"a": [1, "x", 3]});
        let mut fields = Fields::new(&fields_json);
        let _ = fields.req("a", |v| read_list(v, read_i32));
        let _ = fields.req("b", read_string);
        let error = fields.finish().unwrap_err();
        assert_eq!(
            error.to_play_json(),
            json!({
                "obj.a[1]": [{"msg": ["error.expected.jsnumber"], "args": []}],
                "obj.b": [{"msg": ["error.path.missing"], "args": []}],
            })
        );
        let error = lookup(&json!({"x": 1}), "name", read_string).unwrap_err();
        assert_eq!(
            error.errors[0].1[0],
            "'name' is undefined on object: {\"x\":1}"
        );
    }

    #[test]
    fn jackson_pretty_printer() {
        let value = json!({"a": [1, 2], "b": {}, "c": [], "d": {"e": [{"f": 1.0}]}});
        assert_eq!(
            pretty_print(&value),
            "{\n  \"a\" : [ 1, 2 ],\n  \"b\" : { },\n  \"c\" : [ ],\n  \"d\" : {\n    \"e\" : [ {\n      \"f\" : 1\n    } ]\n  }\n}"
        );
    }
}
