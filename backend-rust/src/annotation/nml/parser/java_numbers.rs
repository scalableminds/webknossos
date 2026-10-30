//! Java/Scala number and boolean conversions.
use std::borrow::Cow;

use super::{Fail, PResult};

/// `String.toIntOpt` (`Integer.parseInt`, ASCII digits only).
pub(super) fn to_int(s: &str) -> Option<i32> {
    java_integer_literal(s)?.parse().ok()
}

/// `String.toLongOpt` (`Long.parseLong`).
pub(super) fn to_long(s: &str) -> Option<i64> {
    java_integer_literal(s)?.parse().ok()
}

fn java_integer_literal(s: &str) -> Option<&str> {
    let digits = s.strip_prefix(['+', '-']).unwrap_or(s);
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())).then_some(s)
}

/// Java's `NumberFormatException.toString` for radix 10.
fn number_format_exception(s: &str) -> Fail {
    Fail::Exception(format!(
        "java.lang.NumberFormatException: For input string: \"{s}\""
    ))
}

/// `String.toInt` (throws).
pub(super) fn to_int_or_throw(s: &str) -> PResult<i32> {
    to_int(s).ok_or_else(|| number_format_exception(s))
}

/// `String.toLong` (throws).
pub(super) fn to_long_or_throw(s: &str) -> PResult<i64> {
    to_long(s).ok_or_else(|| number_format_exception(s))
}

/// Normalises a Java `Double.parseDouble`/`Float.parseFloat` literal into one
/// Rust accepts: trims chars <= ' ', drops an `f`/`d` suffix, and rejects Rust
/// spellings Java does not accept (`inf`, `nan`, ...). Hex floats are rejected.
fn java_float_literal(s: &str) -> Option<Cow<'_, str>> {
    let trimmed = s.trim_matches(|c: char| c <= ' ');
    let unsigned = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    if unsigned == "NaN" {
        return Some(Cow::Borrowed("NaN"));
    }
    if unsigned == "Infinity" {
        return Some(Cow::Owned(trimmed.replace("Infinity", "inf")));
    }
    let body = trimmed
        .strip_suffix(['f', 'F', 'd', 'D'])
        .unwrap_or(trimmed);
    let body_unsigned = body.strip_prefix(['+', '-']).unwrap_or(body);
    if body_unsigned.is_empty()
        || !body_unsigned
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-'))
        || !body_unsigned
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_digit() || b == b'.')
    {
        return None;
    }
    Some(Cow::Borrowed(body))
}

/// `String.toDoubleOpt`.
pub(super) fn to_double(s: &str) -> Option<f64> {
    java_float_literal(s)?.parse().ok()
}

/// `String.toFloatOpt`.
pub(super) fn to_float(s: &str) -> Option<f32> {
    java_float_literal(s)?.parse().ok()
}

/// `String.toBooleanOpt` (case-insensitive `true`/`false`).
pub(super) fn to_bool(s: &str) -> Option<bool> {
    if s.eq_ignore_ascii_case("true") {
        Some(true)
    } else if s.eq_ignore_ascii_case("false") {
        Some(false)
    } else {
        None
    }
}

/// `math.round(Float): Int` (ties towards positive infinity, NaN → 0, saturating).
pub(super) fn java_round_float(value: f32) -> i32 {
    let value = f64::from(value);
    if value.is_nan() {
        return 0;
    }
    (value + 0.5).floor() as i32
}
