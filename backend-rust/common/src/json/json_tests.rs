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
    // Above 2^53 Play pads Java's shortest digits with zeros (uint64 histogram max, differential
    // 2026-10-17), it does not spell out the binary value.
    assert_eq!(render(2f64.powi(64)), "18446744073709552000");
    assert_eq!(render(2f64.powi(63)), "9223372036854776000");
    assert_eq!(render(-(2f64.powi(63))), "-9223372036854776000");
    assert_eq!(render(9_007_199_254_740_994.0), "9007199254740994");
    assert_eq!(
        play_f64_number(2f64.powi(63)),
        Some(Number::from(9_223_372_036_854_776_000u64))
    );
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
