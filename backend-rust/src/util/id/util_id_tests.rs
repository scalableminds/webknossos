use super::*;
#[test]
fn object_ids_roundtrip_and_are_unique() {
    let ids: std::collections::HashSet<_> = (0..1000).map(|_| ObjectId::new()).collect();
    assert_eq!(ids.len(), 1000);
    for id in ids {
        assert_eq!(
            serde_json::from_str::<ObjectId>(&serde_json::to_string(&id).unwrap()).unwrap(),
            id
        );
    }
}
#[test]
fn malformed_ids_are_rejected() {
    for value in [
        "",
        "prefix-abcdefabcdefabcdefabcdef",
        "00000000000000000000000g",
        "' OR true --",
    ] {
        assert!(ObjectId::parse(value).is_err());
    }
}
#[test]
fn input_ids_normalize_case_and_only_paths_accept_prefixes() {
    let uppercase = "ABCDEF012345ABCDEF012345";
    let canonical = "abcdef012345abcdef012345";
    assert_eq!(ObjectId::parse(uppercase).unwrap().as_str(), canonical);
    for path in [uppercase.to_owned(), format!("readable-prefix-{uppercase}")] {
        assert_eq!(ObjectId::parse_path(&path).unwrap().as_str(), canonical);
    }
    assert!(ObjectId::parse_path(&format!("{canonical}-")).is_err());
    assert!(
        serde_json::from_value::<ObjectId>(serde_json::json!(format!("prefix-{canonical}")))
            .is_err()
    );
    assert_eq!(
        serde_json::to_value(ObjectId::parse(uppercase).unwrap()).unwrap(),
        canonical
    );
}
