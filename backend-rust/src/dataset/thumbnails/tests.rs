use super::*;

#[test]
fn java_double_formatting_matches_double_to_string() {
    for (value, expected) in [
        (0.0, "0.0"),
        (-0.0, "-0.0"),
        (1.0, "1.0"),
        (255.0, "255.0"),
        (0.5, "0.5"),
        (0.001, "0.001"),
        (0.0001, "1.0E-4"),
        (1234567.0, "1234567.0"),
        (1e7, "1.0E7"),
        (12345678.9, "1.23456789E7"),
        (-3.25, "-3.25"),
        (100.125, "100.125"),
    ] {
        assert_eq!(java_double_string(value), expected, "{value}");
    }
}

#[test]
fn rounding_follows_java_math_round() {
    assert_eq!(java_round_to_int(2.5), 3);
    assert_eq!(java_round_to_int(-2.5), -2);
    assert_eq!(java_round_to_int(f64::NAN), 0);
}
