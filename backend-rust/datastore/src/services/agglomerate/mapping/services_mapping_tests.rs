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

/// Test vectors of Scala's JsonMappingTestSuite (#10410, #10417). Scala compares ids sign- or
/// zero-extended from the element width, Rust compares the narrowed bit patterns; `narrow_id`
/// maps one representation to the other, so both sides of each pair are narrowed here.
#[test]
fn maps_ids_like_the_scala_json_mapping_suite() {
    // Ids exceed narrow widths (300 == 44 as uint8), are negative (-1 == 255 as uint8), map to 0
    // and collide after truncation (300 and 44), where the later class wins.
    let json = br#"{"name": "test", "classes": [[1, 2, 3, 4], [10, 0, 11], [7, 300, -1, 70000], [5, 44], [-2, 6, 4294967296]]}"#;
    let expected: [(usize, &[(i64, i64)]); 8] = [
        // uint8: -1 is 255, 70000 is 112, 4294967296 is 0 and -2 is 254.
        (
            1,
            &[
                (0, 254),
                (2, 1),
                (44, 5),
                (255, 7),
                (112, 7),
                (6, 254),
                (12, 12),
            ],
        ),
        // int8
        (
            1,
            &[
                (0, -2),
                (2, 1),
                (44, 5),
                (-1, 7),
                (112, 7),
                (6, -2),
                (12, 12),
            ],
        ),
        // uint16: up to 32 bits, 4294967296 truncates to 0, so 0 -> -2 overrides 0 -> 10.
        (
            2,
            &[
                (0, 65534),
                (44, 5),
                (300, 7),
                (65535, 7),
                (4464, 7),
                (6, 65534),
            ],
        ),
        // int16
        (
            2,
            &[(0, -2), (44, 5), (300, 7), (-1, 7), (4464, 7), (12, 12)],
        ),
        // uint32
        (
            4,
            &[
                (0, 4294967294),
                (11, 10),
                (300, 7),
                (4294967295, 7),
                (6, 4294967294),
            ],
        ),
        // int32
        (4, &[(0, -2), (11, 10), (70000, 7), (-1, 7), (12, 12)]),
        // uint64
        (
            8,
            &[
                (0, 10),
                (4294967296, -2),
                (-1, 7),
                (6, -2),
                (44, 5),
                (12, 12),
            ],
        ),
        // int64
        (
            8,
            &[(0, 10), (4294967296, -2), (-1, 7), (i64::MIN, i64::MIN)],
        ),
    ];
    for (width, pairs) in expected {
        let mapping = parse_mapping(json, width).unwrap();
        for &(input, output) in pairs {
            let input = narrow_id(input as u64, width);
            let mapped = mapping.get(&input).copied().unwrap_or(input);
            assert_eq!(
                mapped,
                narrow_id(output as u64, width),
                "width {width}, id {input}"
            );
        }
    }
    assert_eq!(narrow_id(300, 1), 44);
    assert_eq!(narrow_id(-1i64 as u64, 2), 65535);
    assert_eq!(narrow_id(-1i64 as u64, 8), u64::MAX);
}
