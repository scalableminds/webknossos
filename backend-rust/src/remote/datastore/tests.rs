use super::*;
use crate::dataset::source::inbox_source_hash;

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
    assert!(parsed.data_source.is_usable() && parsed.root_path.is_none());
    let parsed = parse_reported(&json!({"dataSource": unusable, "rootPath": "/a"})).unwrap();
    assert!(!parsed.data_source.is_usable());
    assert_eq!(parsed.data_source.status_opt(), Some("broken"));
    assert_eq!(parsed.root_path.as_deref(), Some("/a"));
    assert!(parse_reported(&json!({"dataSource": usable, "rootPath": 3})).is_err());
    assert!(parse_reported(&json!({"rootPath": "/a"})).is_err());
    // Equal sources hash equally regardless of key order; changes differ.
    let a = DataSource::from_json(&usable).unwrap();
    let b = DataSource::from_json(&json!({
        "dataLayers": [], "scale": [1, 1, 1], "id": {"team": "org", "name": "ds"}
    }))
    .unwrap();
    assert_eq!(inbox_source_hash(&a), inbox_source_hash(&b));
    let c = DataSource::from_json(&unusable).unwrap();
    assert_ne!(inbox_source_hash(&a), inbox_source_hash(&c));
}
