use super::*;
use serde_json::json;

#[test]
fn legacy_segment_ids_preserve_unsafe_uint64_and_other_envelopes() {
    let envelope = |value: &str| json!({"customJsonEncoding":"bigint","value":value});
    let mut value = json!({"dataSource":{"dataLayers":[
        {"largestSegmentId":envelope("9007199254740991")},
        {"largestSegmentId":envelope("9007199254740992")},
        {"largestSegmentId":envelope("18446744073709551615")},
        {"largestSegmentId":envelope("-1")},
        {"largestSegmentId":envelope("18446744073709551616")},
        {"largestSegmentId":12},
        {"other":envelope("42")}
    ]}});
    downgrade_segment_ids(&mut value);
    assert_eq!(
        value["dataSource"]["dataLayers"][0]["largestSegmentId"],
        json!(9_007_199_254_740_991_u64)
    );
    for (index, number) in [
        (1, "9007199254740992"),
        (2, "18446744073709551615"),
        (3, "-1"),
        (4, "18446744073709551616"),
    ] {
        assert_eq!(
            value["dataSource"]["dataLayers"][index]["largestSegmentId"],
            envelope(number)
        );
    }
    assert_eq!(value["dataSource"]["dataLayers"][5]["largestSegmentId"], 12);
    assert_eq!(
        value["dataSource"]["dataLayers"][6]["other"],
        envelope("42")
    );
}
