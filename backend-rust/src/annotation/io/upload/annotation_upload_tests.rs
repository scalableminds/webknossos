use super::*;

#[test]
fn fallback_literals_follow_scala_parsers() {
    assert_eq!(
        parse_vec3_int("1,22,333"),
        Some(Vec3IntProto {
            x: 1,
            y: 22,
            z: 333
        })
    );
    for invalid in [
        "",
        "1,2",
        "1,2,3,4",
        "-1,2,3",
        " 1,2,3",
        "1,2,99999999999",
        "1.0,2,3",
    ] {
        assert_eq!(parse_vec3_int(invalid), None, "{invalid}");
    }
    assert_eq!(
        parse_vec3_double(" 1.5, 2 ,3e1,"),
        Some(Vec3DoubleProto {
            x: 1.5,
            y: 2.0,
            z: 30.0
        })
    );
    assert_eq!(parse_vec3_double("1,2,3,4").map(|v| v.z), Some(3.0));
    for invalid in ["1,2", "1,,2,3", "a,b,c", "inf,1,2"] {
        assert_eq!(parse_vec3_double(invalid), None, "{invalid}");
    }
    assert_eq!(java_parse_double("2.5d"), Some(2.5));
    assert_eq!(java_parse_double("-Infinity"), Some(f64::NEG_INFINITY));
    assert_eq!(java_parse_double("infinity"), None);
    assert_eq!(java_parse_double(""), None);
}

fn layer(fallback: Option<&str>, edges: bool) -> UploadedVolumeLayer {
    UploadedVolumeLayer {
        tracing: VolumeTracing {
            fallback_layer: fallback.map(str::to_owned),
            ..Default::default()
        },
        data_zip_location: "upload-0/data.zip".into(),
        name: None,
        edited_mapping_edges_location: edges.then(|| "edges.zip".to_owned()),
        edited_mapping_base_mapping_name: None,
    }
}

fn message(result: Result<(), ProviderError>) -> Option<String> {
    result.err().map(|error| error.to_string())
}

#[test]
fn volume_merge_rules_in_scala_order() {
    assert_eq!(message(check_volume_merge_rules(&[])), None);
    assert_eq!(
        message(check_volume_merge_rules(&[vec![
            layer(Some("seg"), false),
            layer(None, true),
            layer(None, false),
        ]])),
        None
    );
    assert_eq!(
        message(check_volume_merge_rules(&[vec![
            layer(Some("seg"), false),
            layer(Some("seg"), false),
        ]]))
        .as_deref(),
        Some(DUPLICATE_FALLBACK_LAYER)
    );
    assert_eq!(
        message(check_volume_merge_rules(&[
            vec![layer(None, false), layer(None, false)],
            vec![layer(None, false)],
        ]))
        .as_deref(),
        Some(MULTIPLE_MULTI_LAYER)
    );
    assert_eq!(
        message(check_volume_merge_rules(&[
            vec![layer(None, true)],
            vec![layer(None, false)],
        ]))
        .as_deref(),
        Some(MULTIPLE_EDITABLE_MAPPINGS)
    );
}

#[test]
fn packed_data_zips_keep_order() {
    let a = Bytes::from_static(b"first");
    let b = Bytes::from_static(b"second");
    let packed =
        pack_volume_data_zips(&[("upload-0/data_a.zip", &a), ("upload-1/x/data_a.zip", &b)])
            .unwrap();
    let mut archive = zip::ZipArchive::new(Cursor::new(packed)).unwrap();
    assert_eq!(archive.len(), 2);
    let names: Vec<String> = (0..2)
        .map(|i| archive.by_index(i).unwrap().name().unwrap().into_owned())
        .collect();
    assert_eq!(names, ["0_data_a.zip", "1_data_a.zip"]);
    let mut content = String::new();
    std::io::Read::read_to_string(&mut archive.by_index(1).unwrap(), &mut content).unwrap();
    assert_eq!(content, "second");
}
