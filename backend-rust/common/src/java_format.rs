//! Java number formatting (JDK 19+ `Double.toString` / `Float.toString`).
//! Verified byte-for-byte against the JDK on 250k random values (see
//! checkpoints/nml-writer.md); use it wherever Scala renders a Double/Float.

/// Java `Double.toString`.
pub fn java_double(value: f64) -> String {
    if let Some(special) = java_special(
        value.is_nan(),
        value.is_infinite(),
        value == 0.0,
        value.is_sign_negative(),
    ) {
        return special;
    }
    let magnitude = value.abs();
    let shortest = format!("{magnitude:e}");
    // Java picks, among the decimals of the shortest length n (n >= 2), the
    // one closest to the value, ties to an even last digit. Rust's shortest
    // form agrees on the length but resolves exact ties upwards, so re-round
    // to n digits (exact, ties-to-even). For n == 1 Java also considers the
    // length-2 decimals, which the `max(2)` covers.
    let precision = significant_digits(&shortest).max(2) - 1;
    let closest = format!("{magnitude:.precision$e}");
    let repr = if closest.parse::<f64>() == Ok(magnitude) {
        closest
    } else {
        shortest
    };
    java_layout(value.is_sign_negative(), &repr)
}

/// Java `Float.toString`.
pub fn java_float(value: f32) -> String {
    if let Some(special) = java_special(
        value.is_nan(),
        value.is_infinite(),
        value == 0.0,
        value.is_sign_negative(),
    ) {
        return special;
    }
    let magnitude = value.abs();
    let shortest = format!("{magnitude:e}");
    let precision = significant_digits(&shortest).max(2) - 1;
    let closest = format!("{magnitude:.precision$e}");
    let repr = if closest.parse::<f32>() == Ok(magnitude) {
        closest
    } else {
        shortest
    };
    java_layout(value.is_sign_negative(), &repr)
}

fn java_special(nan: bool, infinite: bool, zero: bool, negative: bool) -> Option<String> {
    let sign = if negative { "-" } else { "" };
    if nan {
        Some("NaN".to_owned())
    } else if infinite {
        Some(format!("{sign}Infinity"))
    } else if zero {
        Some(format!("{sign}0.0"))
    } else {
        None
    }
}

fn significant_digits(scientific: &str) -> usize {
    let mantissa = scientific.split('e').next().unwrap_or_default();
    mantissa.chars().filter(char::is_ascii_digit).count()
}

/// Lays out Rust scientific notation (`d.ddde±x`) the way Java does: plain
/// decimal for 1e-3 <= |d| < 1e7, otherwise `d.dddE±x`; always at least one
/// fractional digit, trailing zeros removed otherwise.
fn java_layout(negative: bool, scientific: &str) -> String {
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((scientific, "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let mut digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    while digits.len() > 1 && digits.ends_with('0') {
        digits.pop();
    }
    let sign = if negative { "-" } else { "" };
    if (-3..7).contains(&exponent) {
        if exponent >= 0 {
            let integer_len = exponent as usize + 1;
            let padded = format!("{digits:0<integer_len$}");
            let (integer, fraction) = padded.split_at(integer_len);
            let fraction = if fraction.is_empty() { "0" } else { fraction };
            format!("{sign}{integer}.{fraction}")
        } else {
            let zeros = "0".repeat((-exponent - 1) as usize);
            format!("{sign}0.{zeros}{digits}")
        }
    } else {
        let (first, rest) = digits.split_at(1);
        let rest = if rest.is_empty() { "0" } else { rest };
        format!("{sign}{first}.{rest}E{exponent}")
    }
}
