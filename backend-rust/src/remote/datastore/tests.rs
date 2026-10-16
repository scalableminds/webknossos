use super::*;

#[test]
fn reported_sources_follow_play_reads() {
    let usable = json!({
        "id": {"name": "ds", "team": "org"},
        "scale": {"factor": [1, 1, 1], "unit": "nanometer"},
        "dataLayers": []
    });
    let unusable =
        json!({"id": {"name": "ds", "team": "org"}, "status": "broken", "scale": [2, 2, 2]});
    let parsed = parse_reported(&json!({"dataSource": usable, "rootPath": null})).unwrap();
    assert!(parsed.source.is_usable() && parsed.root_path.is_none());
    let parsed = parse_reported(&json!({"dataSource": unusable, "rootPath": "/a"})).unwrap();
    assert!(!parsed.source.is_usable());
    assert_eq!(parsed.source.status(), "broken");
    assert_eq!(parsed.root_path.as_deref(), Some("/a"));
    assert!(parse_reported(&json!({"dataSource": usable, "rootPath": 3})).is_err());
    assert!(parse_reported(&json!({"rootPath": "/a"})).is_err());
    // Equal sources hash equally regardless of key order; changes differ.
    let a = crate::dataset::source::parse_any_data_source(&usable).unwrap();
    let b = crate::dataset::source::parse_any_data_source(&json!({
        "dataLayers": [], "scale": [1, 1, 1], "id": {"team": "org", "name": "ds"}
    }))
    .unwrap();
    assert_eq!(a.inbox_source_hash(), b.inbox_source_hash());
    let c = crate::dataset::source::parse_any_data_source(&unusable).unwrap();
    assert_ne!(a.inbox_source_hash(), c.inbox_source_hash());
}
