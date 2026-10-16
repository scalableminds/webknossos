use super::*;

#[test]
fn explores_json_files_only() {
    let dir = std::env::temp_dir().join(format!("wk-mappings-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("mappings/sub.json")).unwrap();
    for name in ["b.json", "a.json", "c.JSON", "d.json.bak", "e.v2.json"] {
        std::fs::write(dir.join("mappings").join(name), b"{}").unwrap();
    }
    assert_eq!(explore_mappings(&dir), ["a", "b", "e.v2"]);
    assert!(explore_mappings(&dir.join("missing")).is_empty());
}
