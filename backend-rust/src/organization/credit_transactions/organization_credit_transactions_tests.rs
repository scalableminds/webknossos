use super::*;

#[test]
fn java_decimal_formatting() {
    let cases = [
        ("12.50", "12.50"),
        ("+5", "5"),
        ("007", "7"),
        ("-0", "0"),
        ("0.0000001", "1E-7"),
        ("1e3", "1E+3"),
        ("1.5E1", "15"),
        (".5", "0.5"),
        ("5.", "5"),
    ];
    for (input, expected) in cases {
        assert_eq!(
            JavaDecimal::parse(input).unwrap().to_java_string(),
            expected,
            "{input}"
        );
    }
    for invalid in ["", "abc", "1.2.3", "--1", ".", "1e", "1 "] {
        assert!(JavaDecimal::parse(invalid).is_none(), "{invalid}");
    }
    assert!(JavaDecimal::parse("-0.01").unwrap().is_negative());
    assert!(!JavaDecimal::parse("-0.00").unwrap().is_negative());
}

#[test]
fn java_double_formatting() {
    assert_eq!(java_double(2.0), "2.0");
    assert_eq!(java_double(1.5), "1.5");
    assert_eq!(java_double(0.001), "0.001");
}
