//! Scala `com.scalableminds.util.geometry` (`Vec3Int`, `Vec3Double`, `BoundingBox`).
//!
//! Integer arithmetic wraps like JVM `Int` arithmetic; float→int conversions truncate toward
//! zero and saturate like JVM `f2i`/`d2i`. Division by zero panics (JVM `ArithmeticException`).

use std::fmt;

use serde::{Serialize, Serializer, ser::SerializeTuple};
use serde_json::Value;

use super::json::{
    Fields, JsError, JsResult, deserialize_via_from_json, play_f64_number, read_i32,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, PartialOrd, Ord)]
pub struct Vec3Int {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

impl Vec3Int {
    pub const fn new(x: i32, y: i32, z: i32) -> Self {
        Self { x, y, z }
    }

    pub const fn full(i: i32) -> Self {
        Self::new(i, i, i)
    }

    pub const fn zeros() -> Self {
        Self::full(0)
    }

    pub const fn ones() -> Self {
        Self::full(1)
    }

    pub fn scale(self, s: i32) -> Self {
        self.mul_scalar(s)
    }

    /// Scala `scale(s: Float)`: `(x * s).toInt` with JVM float semantics.
    pub fn scale_f32(self, s: f32) -> Self {
        Self::new(
            (self.x as f32 * s) as i32,
            (self.y as f32 * s) as i32,
            (self.z as f32 * s) as i32,
        )
    }

    pub fn mul_scalar(self, s: i32) -> Self {
        self * Self::full(s)
    }

    /// Scala `move(dx, dy, dz)`.
    pub fn moved(self, dx: i32, dy: i32, dz: i32) -> Self {
        self + Self::new(dx, dy, dz)
    }

    /// Scala `<=`: all components less or equal.
    pub fn all_le(self, o: Self) -> bool {
        self.x <= o.x && self.y <= o.y && self.z <= o.z
    }

    pub fn is_isotropic(self) -> bool {
        self.x == self.y && self.y == self.z
    }

    pub fn max_dim(self) -> i32 {
        self.x.max(self.y).max(self.z)
    }

    pub fn product(self) -> i32 {
        self.x.wrapping_mul(self.y).wrapping_mul(self.z)
    }

    pub fn to_array(self) -> [i32; 3] {
        [self.x, self.y, self.z]
    }

    pub fn to_vec3_double(self) -> Vec3Double {
        Vec3Double::new(f64::from(self.x), f64::from(self.y), f64::from(self.z))
    }

    pub fn align_with_grid_floor(self, grid_cell_size: Self) -> Self {
        self / grid_cell_size * grid_cell_size
    }

    pub fn sorted(self) -> Self {
        let mut values = self.to_array();
        values.sort_unstable();
        Self::new(values[0], values[1], values[2])
    }

    pub fn has_negative_component(self) -> bool {
        self.x < 0 || self.y < 0 || self.z < 0
    }

    pub fn is_all_powers_of_two(self) -> bool {
        let is_power_of_two = |i: i32| i != 0 && (i & i.wrapping_sub(1)) == 0;
        is_power_of_two(self.x) && is_power_of_two(self.y) && is_power_of_two(self.z)
    }

    /// Scala `toMagLiteral`: `"2"` if isotropic and scalars allowed, else `"2-2-1"`.
    pub fn to_mag_literal(self, allow_scalar: bool) -> String {
        if allow_scalar && self.is_isotropic() {
            self.x.to_string()
        } else {
            format!("{}-{}-{}", self.x, self.y, self.z)
        }
    }

    pub fn to_uri_literal(self) -> String {
        format!("{},{},{}", self.x, self.y, self.z)
    }

    /// Scala `Vec3Int.fromMagLiteral`.
    pub fn from_mag_literal(s: &str, allow_scalar: bool) -> Option<Self> {
        if allow_scalar && let Some(scalar) = parse_java_int(s) {
            return Some(Self::full(scalar));
        }
        parse_three_digit_groups(s, '-')
    }

    /// Scala `Vec3Int.fromUriLiteral` (`\d+,\d+,\d+`).
    pub fn from_uri_literal(s: &str) -> Option<Self> {
        parse_three_digit_groups(s, ',')
    }

    pub fn from_slice(values: &[i32]) -> Option<Self> {
        (values.len() >= 3).then(|| Self::new(values[0], values[1], values[2]))
    }

    /// Scala `Vec3IntReads`: an array of exactly three ints.
    pub fn from_json(json: &Value) -> JsResult<Self> {
        match json {
            Value::Array(items) if items.len() == 3 => {
                let values: Vec<i32> = items.iter().filter_map(|v| read_i32(v).ok()).collect();
                if values.len() == 3 {
                    Ok(Self::new(values[0], values[1], values[2]))
                } else {
                    Err(JsError::new("validate.error.array.invalidContent"))
                }
            }
            _ => Err(JsError::new("validate.error.expected.vec3IntArray")),
        }
    }

    /// Scala `MagFormatHelper.magFormat` reads: a scalar `n` means `(n, n, n)`.
    pub fn mag_from_json(json: &Value) -> JsResult<Self> {
        match read_i32(json) {
            Ok(scalar) => Ok(Self::full(scalar)),
            Err(_) => Self::from_json(json),
        }
    }
}

impl std::ops::Add for Vec3Int {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(
            self.x.wrapping_add(o.x),
            self.y.wrapping_add(o.y),
            self.z.wrapping_add(o.z),
        )
    }
}

impl std::ops::Sub for Vec3Int {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(
            self.x.wrapping_sub(o.x),
            self.y.wrapping_sub(o.y),
            self.z.wrapping_sub(o.z),
        )
    }
}

/// Element-wise multiplication (Scala `*(Vec3Int)`).
impl std::ops::Mul for Vec3Int {
    type Output = Self;
    fn mul(self, o: Self) -> Self {
        Self::new(
            self.x.wrapping_mul(o.x),
            self.y.wrapping_mul(o.y),
            self.z.wrapping_mul(o.z),
        )
    }
}

/// Element-wise JVM integer division (truncates toward zero; panics on a zero divisor).
impl std::ops::Div for Vec3Int {
    type Output = Self;
    fn div(self, o: Self) -> Self {
        Self::new(
            self.x.wrapping_div(o.x),
            self.y.wrapping_div(o.y),
            self.z.wrapping_div(o.z),
        )
    }
}

impl std::ops::Neg for Vec3Int {
    type Output = Self;
    fn neg(self) -> Self {
        Self::zeros() - self
    }
}

impl fmt::Display for Vec3Int {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {}, {})", self.x, self.y, self.z)
    }
}

impl Serialize for Vec3Int {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut tuple = serializer.serialize_tuple(3)?;
        tuple.serialize_element(&self.x)?;
        tuple.serialize_element(&self.y)?;
        tuple.serialize_element(&self.z)?;
        tuple.end()
    }
}

deserialize_via_from_json!(Vec3Int);

/// Java `Integer.parseInt` (optional sign, ASCII digits, i32 range).
pub(crate) fn parse_java_int(s: &str) -> Option<i32> {
    let digits = s.strip_prefix(['+', '-']).unwrap_or(s);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse::<i32>().ok()
}

fn parse_three_digit_groups(s: &str, separator: char) -> Option<Vec3Int> {
    let parts: Vec<&str> = s.split(separator).collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    Some(Vec3Int::new(
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Vec3Double {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3Double {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub const fn ones() -> Self {
        Self::new(1.0, 1.0, 1.0)
    }

    pub const fn zeros() -> Self {
        Self::new(0.0, 0.0, 0.0)
    }

    pub fn mul_scalar(self, s: f64) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }

    pub fn dot(self, o: Self) -> f64 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    pub fn cross(self, o: Self) -> Self {
        Self::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }

    pub fn normalize(self) -> Self {
        let length = (self.x * self.x + self.y * self.y + self.z * self.z).sqrt();
        if length != 0.0 {
            Self::new(self.x / length, self.y / length, self.z / length)
        } else {
            self
        }
    }

    pub fn max_dim(self) -> f64 {
        self.x.max(self.y).max(self.z)
    }

    pub fn is_strictly_positive(self) -> bool {
        self.x > 0.0 && self.y > 0.0 && self.z > 0.0
    }

    /// Scala `toVec3Int` (`d2i`: truncation, saturation, NaN → 0).
    pub fn to_vec3_int(self) -> Vec3Int {
        Vec3Int::new(self.x as i32, self.y as i32, self.z as i32)
    }

    /// Scala `round` (`Math.round`: half up).
    pub fn round(self) -> Self {
        let r = |v: f64| (v + 0.5).floor();
        Self::new(r(self.x), r(self.y), r(self.z))
    }

    pub fn to_array(self) -> [f64; 3] {
        [self.x, self.y, self.z]
    }

    /// Scala `Vec3DoubleReads`.
    pub fn from_json(json: &Value) -> JsResult<Self> {
        match json {
            Value::Array(items) if items.len() == 3 => {
                let values: Vec<Option<f64>> = items.iter().map(Value::as_f64).collect();
                match values[..] {
                    [Some(x), Some(y), Some(z)] => Ok(Self::new(x, y, z)),
                    _ => Err(JsError::new(format!(
                        "Invalid array content: {}",
                        super::json::compact(json)
                    ))),
                }
            }
            _ => Err(JsError::new("validate.error.listExpected")),
        }
    }
}

impl std::ops::Add for Vec3Double {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}

impl std::ops::Sub for Vec3Double {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}

/// Element-wise multiplication.
impl std::ops::Mul for Vec3Double {
    type Output = Self;
    fn mul(self, o: Self) -> Self {
        Self::new(self.x * o.x, self.y * o.y, self.z * o.z)
    }
}

/// Element-wise division.
impl std::ops::Div for Vec3Double {
    type Output = Self;
    fn div(self, o: Self) -> Self {
        Self::new(self.x / o.x, self.y / o.y, self.z / o.z)
    }
}

impl Serialize for Vec3Double {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut tuple = serializer.serialize_tuple(3)?;
        for v in self.to_array() {
            match play_f64_number(v) {
                Some(number) => tuple.serialize_element(&number)?,
                None => tuple.serialize_element(&())?,
            }
        }
        tuple.end()
    }
}

deserialize_via_from_json!(Vec3Double);

/// Scala `BoundingBox(topLeft, width, height, depth)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundingBox {
    pub top_left: Vec3Int,
    pub width: i32,
    pub height: i32,
    pub depth: i32,
}

/// Scala `MathUtils.ceilDiv(Int, Int)`.
pub fn ceil_div(num: i32, divisor: i32) -> i32 {
    let sign = num.signum() * divisor.signum();
    sign.wrapping_mul(
        num.wrapping_abs()
            .wrapping_add(divisor.wrapping_abs())
            .wrapping_sub(1),
    ) / divisor.wrapping_abs()
}

impl BoundingBox {
    pub const fn new(top_left: Vec3Int, width: i32, height: i32, depth: i32) -> Self {
        Self {
            top_left,
            width,
            height,
            depth,
        }
    }

    pub const fn empty() -> Self {
        Self::new(Vec3Int::zeros(), 0, 0, 0)
    }

    pub fn bottom_right(&self) -> Vec3Int {
        self.top_left.moved(self.width, self.height, self.depth)
    }

    pub fn intersects(&self, other: &Self) -> bool {
        let (a, b) = (self.bottom_right(), other.bottom_right());
        self.top_left.x.max(other.top_left.x) < a.x.min(b.x)
            && self.top_left.y.max(other.top_left.y) < a.y.min(b.y)
            && self.top_left.z.max(other.top_left.z) < a.z.min(b.z)
    }

    pub fn intersection(&self, other: &Self) -> Option<Self> {
        let (a, b) = (self.bottom_right(), other.bottom_right());
        let top_left = Vec3Int::new(
            self.top_left.x.max(other.top_left.x),
            self.top_left.y.max(other.top_left.y),
            self.top_left.z.max(other.top_left.z),
        );
        let bottom_right = Vec3Int::new(a.x.min(b.x), a.y.min(b.y), a.z.min(b.z));
        (top_left.x < bottom_right.x && top_left.y < bottom_right.y && top_left.z < bottom_right.z)
            .then(|| {
                let size = bottom_right - top_left;
                Self::new(top_left, size.x, size.y, size.z)
            })
    }

    pub fn union(&self, other: &Self) -> Self {
        let (a, b) = (self.bottom_right(), other.bottom_right());
        let x = other.top_left.x.min(self.top_left.x);
        let y = other.top_left.y.min(self.top_left.y);
        let z = other.top_left.z.min(self.top_left.z);
        Self::new(
            Vec3Int::new(x, y, z),
            b.x.max(a.x).wrapping_sub(x),
            b.y.max(a.y).wrapping_sub(y),
            b.z.max(a.z).wrapping_sub(z),
        )
    }

    /// Scala `BoundingBox.union(list)`: empty list gives [`BoundingBox::empty`].
    pub fn union_all<'a>(boxes: impl IntoIterator<Item = &'a BoundingBox>) -> Self {
        let mut iter = boxes.into_iter();
        match iter.next() {
            Some(first) => iter.fold(*first, |acc, b| acc.union(b)),
            None => Self::empty(),
        }
    }

    /// Scala `BoundingBox.intersection(list)`: empty list gives `None`.
    pub fn intersection_all<'a>(boxes: impl IntoIterator<Item = &'a BoundingBox>) -> Option<Self> {
        let mut iter = boxes.into_iter();
        let first = *iter.next()?;
        iter.try_fold(first, |acc, b| acc.intersection(b))
    }

    pub fn is_fully_contained_in(&self, other: &Self) -> bool {
        self.intersection(other) == Some(*self)
    }

    pub fn is_empty(&self) -> bool {
        self.width <= 0 || self.height <= 0 || self.depth <= 0
    }

    /// Scala `center`: `topLeft.move(bottomRight).scale(0.5f)`.
    pub fn center(&self) -> Vec3Int {
        (self.top_left + self.bottom_right()).scale_f32(0.5)
    }

    /// Scala `scale(s: Float)`.
    pub fn scale(&self, s: f32) -> Self {
        Self::new(
            self.top_left.scale_f32(s),
            (self.width as f32 * s) as i32,
            (self.height as f32 * s) as i32,
            (self.depth as f32 * s) as i32,
        )
    }

    /// Scala `* (mag: Vec3Int)`: from mag coordinates to mag1.
    pub fn mul_mag(&self, mag: Vec3Int) -> Self {
        Self::new(
            self.top_left * mag,
            self.width.wrapping_mul(mag.x),
            self.height.wrapping_mul(mag.y),
            self.depth.wrapping_mul(mag.z),
        )
    }

    /// Scala `/ (mag: Vec3Int)`: topLeft truncating division, size with `ceilDiv`.
    pub fn div_mag(&self, mag: Vec3Int) -> Self {
        Self::new(
            self.top_left / mag,
            ceil_div(self.width, mag.x),
            ceil_div(self.height, mag.y),
            ceil_div(self.depth, mag.z),
        )
    }

    pub fn moved(&self, delta: Vec3Int) -> Self {
        Self {
            top_left: self.top_left + delta,
            ..*self
        }
    }

    pub fn volume(&self) -> i64 {
        i64::from(self.width)
            .wrapping_mul(i64::from(self.height))
            .wrapping_mul(i64::from(self.depth))
    }

    pub fn size(&self) -> Vec3Int {
        Vec3Int::new(self.width, self.height, self.depth)
    }

    pub fn to_sql(&self) -> [i32; 6] {
        let t = self.top_left;
        [t.x, t.y, t.z, self.width, self.height, self.depth]
    }

    pub fn from_sql(values: &[i32]) -> Option<Self> {
        (values.len() == 6).then(|| {
            Self::new(
                Vec3Int::new(values[0], values[1], values[2]),
                values[3],
                values[4],
                values[5],
            )
        })
    }

    /// Scala `toLiteral`: `x,y,z,width,height,depth`.
    pub fn to_literal(&self) -> String {
        let t = self.top_left;
        format!(
            "{},{},{},{},{},{}",
            t.x, t.y, t.z, self.width, self.height, self.depth
        )
    }

    /// Scala `BoundingBox.fromLiteral` (regex
    /// `\s*(-?[0-9]+),\s*(-?[0-9]+),\s*(-?[0-9]+)\s*,\s*([0-9]+),\s*([0-9]+),\s*([0-9]+)\s*`).
    pub fn from_literal(s: &str) -> Option<Self> {
        let parts: Vec<&str> = s.split(',').collect();
        if parts.len() != 6 {
            return None;
        }
        let is_java_ws = |c: char| matches!(c, ' ' | '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r');
        let number = |part: &str, signed: bool, trailing_ws: bool| -> Option<i32> {
            let part = part.trim_start_matches(is_java_ws);
            let part = if trailing_ws {
                part.trim_end_matches(is_java_ws)
            } else {
                part
            };
            let digits = if signed {
                part.strip_prefix('-').unwrap_or(part)
            } else {
                part
            };
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            part.parse().ok()
        };
        Some(Self::new(
            Vec3Int::new(
                number(parts[0], true, false)?,
                number(parts[1], true, false)?,
                number(parts[2], true, true)?,
            ),
            number(parts[3], false, false)?,
            number(parts[4], false, false)?,
            number(parts[5], false, true)?,
        ))
    }

    /// Scala `BoundingBox.fromLiteralWithMagOpt`: mag defaults to `1-1-1`, scalar allowed.
    pub fn from_literal_with_mag_opt(bounding_box: &str, mag: Option<&str>) -> Option<Self> {
        let parsed = Self::from_literal(bounding_box)?;
        let mag = Vec3Int::from_mag_literal(mag.unwrap_or("1-1-1"), true)?;
        Some(parsed.div_mag(mag))
    }

    /// Scala derived `BoundingBox` format reads.
    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let top_left = fields.req("topLeft", Vec3Int::from_json);
        let width = fields.req("width", read_i32);
        let height = fields.req("height", read_i32);
        let depth = fields.req("depth", read_i32);
        fields.finish()?;
        Ok(Self::new(top_left?, width?, height?, depth?))
    }
}

deserialize_via_from_json!(BoundingBox);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bb(x: i32, y: i32, z: i32, w: i32, h: i32, d: i32) -> BoundingBox {
        BoundingBox::new(Vec3Int::new(x, y, z), w, h, d)
    }

    #[test]
    fn bounding_box_set_operations() {
        let a = bb(0, 0, 0, 10, 10, 10);
        let b = bb(5, 5, 5, 10, 10, 10);
        assert!(a.intersects(&b));
        assert_eq!(a.intersection(&b), Some(bb(5, 5, 5, 5, 5, 5)));
        assert_eq!(a.union(&b), bb(0, 0, 0, 15, 15, 15));
        // touching boxes do not intersect
        let c = bb(10, 0, 0, 5, 5, 5);
        assert!(!a.intersects(&c));
        assert_eq!(a.intersection(&c), None);
        assert_eq!(
            BoundingBox::union_all([] as [&BoundingBox; 0]),
            BoundingBox::empty()
        );
        assert_eq!(
            BoundingBox::union_all([&a, &b, &c]),
            bb(0, 0, 0, 15, 15, 15)
        );
        assert_eq!(
            BoundingBox::intersection_all([&a, &b]),
            Some(bb(5, 5, 5, 5, 5, 5))
        );
        assert_eq!(BoundingBox::intersection_all([&a, &b, &c]), None);
        assert!(bb(1, 1, 1, 2, 2, 2).is_fully_contained_in(&a));
        assert!(!b.is_fully_contained_in(&a));
        assert!(bb(0, 0, 0, 0, 1, 1).is_empty());
    }

    #[test]
    fn bounding_box_center_and_mag_scaling() {
        assert_eq!(bb(0, 0, 0, 5, 7, 9).center(), Vec3Int::new(2, 3, 4));
        assert_eq!(bb(-3, 0, 0, 0, 0, 0).center(), Vec3Int::new(-3, 0, 0));
        assert_eq!(bb(-3, 0, 0, 1, 0, 0).center(), Vec3Int::new(-2, 0, 0));
        let mag = Vec3Int::new(2, 2, 1);
        assert_eq!(bb(5, 5, 5, 11, 10, 3).div_mag(mag), bb(2, 2, 5, 6, 5, 3));
        // topLeft uses truncating JVM division, not floor division
        assert_eq!(
            bb(-5, 0, 0, 1, 1, 1).div_mag(mag).top_left,
            Vec3Int::new(-2, 0, 0)
        );
        assert_eq!(bb(1, 2, 3, 4, 5, 6).mul_mag(mag), bb(2, 4, 3, 8, 10, 6));
        assert_eq!(bb(0, 0, 0, 1000, 1000, 1000).volume(), 1_000_000_000);
        assert_eq!(ceil_div(-5, 2), -3);
        assert_eq!(ceil_div(5, 2), 3);
    }

    #[test]
    fn literals() {
        assert_eq!(
            BoundingBox::from_literal(" -1, 2,3 ,4, 5,6 "),
            Some(bb(-1, 2, 3, 4, 5, 6))
        );
        assert_eq!(BoundingBox::from_literal("1,2,3,-4,5,6"), None);
        assert_eq!(BoundingBox::from_literal("1 ,2,3,4,5,6"), None);
        assert_eq!(BoundingBox::from_literal("1,2,3,4,5"), None);
        assert_eq!(BoundingBox::from_literal("1,2,3,4,5,99999999999"), None);
        assert_eq!(bb(1, 2, 3, 4, 5, 6).to_literal(), "1,2,3,4,5,6");
        assert_eq!(
            BoundingBox::from_literal_with_mag_opt("0,0,0,10,10,10", Some("4")),
            Some(bb(0, 0, 0, 3, 3, 3))
        );
        assert_eq!(
            Vec3Int::from_mag_literal("2-2-1", false),
            Some(Vec3Int::new(2, 2, 1))
        );
        assert_eq!(Vec3Int::from_mag_literal("2", false), None);
        assert_eq!(Vec3Int::from_mag_literal("2", true), Some(Vec3Int::full(2)));
        assert_eq!(Vec3Int::from_mag_literal("-2-2-1", true), None);
        assert_eq!(Vec3Int::new(2, 2, 1).to_mag_literal(true), "2-2-1");
        assert_eq!(Vec3Int::full(4).to_mag_literal(true), "4");
        assert_eq!(
            Vec3Int::from_uri_literal("1,2,3"),
            Some(Vec3Int::new(1, 2, 3))
        );
    }

    #[test]
    fn vec_json() {
        assert_eq!(
            Vec3Int::from_json(&json!([1, 2, 3])),
            Ok(Vec3Int::new(1, 2, 3))
        );
        assert_eq!(
            Vec3Int::from_json(&json!([1, 2])),
            Err(JsError::new("validate.error.expected.vec3IntArray"))
        );
        assert_eq!(
            Vec3Int::from_json(&json!([1, 2, "a"])),
            Err(JsError::new("validate.error.array.invalidContent"))
        );
        assert_eq!(Vec3Int::mag_from_json(&json!(4)), Ok(Vec3Int::full(4)));
        assert_eq!(
            serde_json::to_string(&Vec3Double::new(11.24, 11.24, 28.0)).unwrap(),
            "[11.24,11.24,28]"
        );
        assert_eq!(
            serde_json::to_string(&bb(1, 2, 3, 4, 5, 6)).unwrap(),
            r#"{"topLeft":[1,2,3],"width":4,"height":5,"depth":6}"#
        );
        let error = BoundingBox::from_json(&json!({"topLeft": [0, 0], "width": 1})).unwrap_err();
        assert_eq!(
            error.to_play_json(),
            json!({
                "obj.topLeft": [{"msg": ["validate.error.expected.vec3IntArray"], "args": []}],
                "obj.height": [{"msg": ["error.path.missing"], "args": []}],
                "obj.depth": [{"msg": ["error.path.missing"], "args": []}],
            })
        );
        assert!(Vec3Int::new(1, 2, 4).is_all_powers_of_two());
        assert!(!Vec3Int::new(1, 3, 4).is_all_powers_of_two());
        assert_eq!(Vec3Int::new(3, 1, 2).sorted(), Vec3Int::new(1, 2, 3));
    }
}
