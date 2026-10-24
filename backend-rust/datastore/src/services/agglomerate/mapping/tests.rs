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

#[test]
fn refuses_mapping_names_outside_the_mappings_directory() {
    let base_dirs = BaseDirService::new(Vec::new());
    let id = DataSourceId::new("ds", "org");
    for name in ["../escape", "sub/name", "..\\escape", "nul\0byte"] {
        assert_eq!(
            load_mapping_bytes(&base_dirs, &id, "segmentation", name)
                .unwrap_err()
                .message,
            format!("Invalid mapping name: {name}")
        );
    }
}
