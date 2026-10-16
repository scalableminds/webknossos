use std::io::Write;

use zip::write::SimpleFileOptions;

use super::*;
use crate::annotation::nml::parser::NmlParseSuccessWithoutFile;
use crate::proto::datastore::{ColorProto, Segment, Tree};

const DATASET_ID: &str = "5f0000000000000000000abc";

fn params() -> SharedParsingParameters {
    SharedParsingParameters {
        user_organization_id: "org".to_owned(),
        ..Default::default()
    }
}

fn context() -> NmlParseContext {
    NmlParseContext {
        now_millis: 1,
        task_bounding_box_color: ColorProto {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        },
    }
}

/// NML with one tree named `tree`, optionally a volume at `location`.
fn nml(volume_location: Option<&str>) -> Bytes {
    let volume = volume_location
        .map(|l| format!(r#"<volume id="0" location="{l}" name="v"/>"#))
        .unwrap_or_default();
    Bytes::from(format!(
        r#"<things><parameters><experiment name="ds" description="d"/></parameters>
<thing id="1" name="tree"><nodes><node id="1" x="1" y="2" z="3"/></nodes><edges/></thing>{volume}</things>"#
    ))
}

fn zip_of(entries: &[(&str, &[u8])]) -> Bytes {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        if name.ends_with('/') {
            writer
                .add_directory(*name, SimpleFileOptions::default())
                .unwrap();
        } else {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
    }
    Bytes::from(writer.finish().unwrap().into_inner())
}

struct TestLookup;

impl DatasetLookup for TestLookup {
    fn find_dataset(
        &self,
        dataset_id: Option<&str>,
        dataset_name: &str,
        organization_id: &str,
    ) -> impl Future<Output = ApiResult<Result<DatasetRef, String>>> + Send {
        let result = if dataset_name == "ds" && dataset_id.is_none() {
            Ok(DatasetRef {
                id: DATASET_ID.to_owned(),
                name: "ds".to_owned(),
                organization_id: organization_id.to_owned(),
            })
        } else {
            Err(msg_dataset_name_not_found(dataset_name))
        };
        std::future::ready(Ok(result))
    }
}

fn extract_with(
    files: Vec<(&str, Bytes)>,
    use_zip_name: bool,
    limits: ExtractionLimits,
) -> Result<MultiNmlParseResult, ExtractionLimitExceeded> {
    let files = files
        .into_iter()
        .map(|(name, bytes)| (name.to_owned(), bytes))
        .collect();
    let prepared = prepare_files(files, &params(), use_zip_name, &limits, &mut context)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    Ok(runtime.block_on(prepared.finish(&TestLookup)).unwrap())
}

fn extract(files: Vec<(&str, Bytes)>, use_zip_name: bool) -> MultiNmlParseResult {
    extract_with(files, use_zip_name, ExtractionLimits::default()).unwrap()
}

fn names(result: &MultiNmlParseResult) -> Vec<(&str, bool)> {
    result
        .parse_results
        .iter()
        .map(|r| (r.file_name(), r.succeeded()))
        .collect()
}

fn success(result: &NmlParseResult) -> &NmlParseSuccessWithoutFile {
    result.to_success().unwrap()
}

#[test]
fn plain_nml_files_are_parsed_in_order_without_base_path() {
    let result = extract(
        vec![
            ("a.nml", nml(Some("data.zip"))),
            ("b.txt", Bytes::from_static(b"<things>")),
            ("c.nml", Bytes::new()),
            ("FOO.ZIP", Bytes::from_static(b"not xml")),
        ],
        true,
    );
    assert_eq!(
        names(&result),
        vec![
            ("a.nml", true),
            ("b.txt", false),
            ("c.nml", false),
            ("FOO.ZIP", false)
        ]
    );
    assert!(matches!(
        result.parse_results[2],
        NmlParseResult::Empty { .. }
    ));
    assert!(result.contains_failure());
    let layer = &success(&result.parse_results[0]).volume_layers[0];
    assert_eq!(layer.data_zip_location, "data.zip");
    assert!(result.other_files.is_empty());
}

#[test]
fn zip_entries_are_parsed_reversed_renamed_and_keyed_by_path() {
    let other_nml = String::from_utf8(nml(None).to_vec())
        .unwrap()
        .replace(r#"name="ds""#, r#"name="missing""#);
    let archive = zip_of(&[
        ("dir/", b""),
        ("dir/first.nml", &nml(Some("volume.zip"))),
        ("./volume.zip", b"VOLUME"),
        (".hidden.nml", b"x"),
        ("__MACOSX/._first.nml", b"x"),
        ("second.nml", other_nml.as_bytes()),
    ]);
    let renamed = extract(vec![("up.zip", archive.clone())], true);
    // Failures keep their entry name; successes carry the zip name.
    assert_eq!(
        names(&renamed),
        vec![("second.nml", false), ("up.zip", true)]
    );
    let NmlParseResult::Failure { error, .. } = &renamed.parse_results[0] else {
        panic!("expected failure");
    };
    assert_eq!(
        error,
        "Dataset with name “missing” could not be found or accessed."
    );
    let layer = &success(&renamed.parse_results[1]).volume_layers[0];
    assert_eq!(layer.data_zip_location, "upload-0/volume.zip");
    assert_eq!(
        renamed.data_zip_for(layer).map(|b| b.as_ref()),
        Some(&b"VOLUME"[..])
    );
    assert_eq!(
        renamed.other_files.keys().collect::<Vec<_>>(),
        vec!["upload-0/volume.zip"]
    );

    let kept = extract(vec![("up.zip", archive)], false);
    assert_eq!(
        names(&kept),
        vec![("second.nml", false), ("dir/first.nml", true)]
    );
    // to_boxes: the failure propagates, the success carries its data zip.
    let boxes = kept.to_boxes();
    assert_eq!(
        boxes[0].skeleton.as_ref().unwrap_err(),
        "Couldn’t parse file: second.nml. Dataset with name “missing” could not be found or accessed."
    );
    let (layer, data) = boxes[1].volume.clone().unwrap().unwrap();
    assert_eq!(layer.name.as_deref(), Some("v"));
    assert_eq!(data.as_deref(), Some(&b"VOLUME"[..]));
    assert_eq!(boxes[1].dataset_id.as_deref(), Ok(DATASET_ID));
}

#[test]
fn nested_zips_are_unpacked_recursively_only_when_all_entries_are_zips() {
    let inner_a = zip_of(&[("a.nml", &nml(Some("v.zip"))), ("v.zip", b"V")]);
    let inner_b = zip_of(&[("b.nml", &nml(None))]);
    let outer = zip_of(&[("x/a.zip", &inner_a), ("b.zip", &inner_b), ("x/", b"")]);
    let result = extract(vec![("first.nml", nml(None)), ("outer.zip", outer)], true);
    assert_eq!(
        names(&result),
        vec![
            ("first.nml", true),
            ("upload-1/x/a.zip", true),
            ("upload-1/b.zip", true)
        ]
    );
    let layer = &success(&result.parse_results[1]).volume_layers[0];
    assert_eq!(layer.data_zip_location, "upload-1/x/a.zip/v.zip");
    // Only nested results are kept; the nested zips themselves are not other files.
    assert_eq!(
        result.other_files.keys().collect::<Vec<_>>(),
        vec!["upload-1/x/a.zip/v.zip"]
    );

    // A zip mixing NMLs and zips stores the inner zip as an other file.
    let mixed = zip_of(&[("m.nml", &nml(None)), ("inner.zip", &inner_b)]);
    let result = extract(vec![("mixed.zip", mixed)], false);
    assert_eq!(names(&result), vec![("m.nml", true)]);
    assert_eq!(
        result.other_files.keys().collect::<Vec<_>>(),
        vec!["upload-0/inner.zip"]
    );

    // Empty and unreadable zips contribute nothing.
    let result = extract(
        vec![
            ("empty.zip", zip_of(&[])),
            ("broken.zip", Bytes::from_static(b"PK nope")),
        ],
        true,
    );
    assert!(result.parse_results.is_empty() && result.other_files.is_empty());
}

#[test]
fn zip_slip_entries_stop_the_archive_but_keep_earlier_entries() {
    let archive = zip_of(&[
        ("ok.nml", &nml(None)),
        ("a/../b.nml", &nml(None)),
        ("a/../../evil.nml", &nml(None)),
        ("late.nml", &nml(None)),
    ]);
    let result = extract(vec![("z.zip", archive)], false);
    assert_eq!(names(&result), vec![("b.nml", true), ("ok.nml", true)]);
    let absolute = zip_of(&[("/abs.nml", &nml(None)), ("after.nml", &nml(None))]);
    assert!(
        extract(vec![("z.zip", absolute)], false)
            .parse_results
            .is_empty()
    );
}

#[test]
fn extraction_limits_are_enforced() {
    let limits = ExtractionLimits {
        max_zip_entries: 2,
        max_extracted_bytes: 10,
        max_zip_nesting_depth: 1,
    };
    let many = zip_of(&[("1", b""), ("2", b""), ("3", b"")]);
    assert!(extract_with(vec![("m.zip", many)], false, limits).is_err());
    let big = zip_of(&[("big.bin", &[0u8; 11])]);
    assert!(extract_with(vec![("b.zip", big)], false, limits).is_err());
    let fits = zip_of(&[("small.bin", &[0u8; 10])]);
    assert_eq!(
        extract_with(vec![("s.zip", fits)], false, limits)
            .unwrap()
            .other_files
            .len(),
        1
    );
    // One all-zip level is unpacked; the inner zip holds an NML, not only zips.
    let limits = ExtractionLimits {
        max_extracted_bytes: 1 << 20,
        ..limits
    };
    let one_level = zip_of(&[("i.zip", &zip_of(&[("a.nml", b"")]))]);
    let result = extract_with(vec![("l0.zip", one_level.clone())], false, limits).unwrap();
    assert_eq!(names(&result), vec![("a.nml", false)]);
    let two_levels = zip_of(&[("o.zip", &one_level)]);
    assert!(extract_with(vec![("l0.zip", two_levels)], false, limits).is_err());
}

#[test]
fn entry_path_helpers_follow_java() {
    assert_eq!(
        java_normalized_relative_path("a//./b/../c.nml").as_deref(),
        Some("a/c.nml")
    );
    assert_eq!(java_normalized_relative_path("a/..").as_deref(), Some(""));
    assert_eq!(
        java_normalized_relative_path("..x/y").as_deref(),
        Some("..x/y")
    );
    assert_eq!(java_normalized_relative_path("../y"), None);
    assert_eq!(java_normalized_relative_path("/y"), None);
    assert!(is_hidden_entry("a/.b") && is_hidden_entry(".a/") && is_hidden_entry("__MACOSXy"));
    assert!(!is_hidden_entry(".a/b") && !is_hidden_entry("a.b"));
}

fn tree(name: &str, group_id: Option<i32>) -> Tree {
    Tree {
        name: name.to_owned(),
        group_id,
        ..Default::default()
    }
}

fn success_result(file_name: &str, trees: Vec<Tree>, groups: Vec<TreeGroup>) -> NmlParseResult {
    NmlParseResult::Success {
        file_name: file_name.to_owned(),
        success: Box::new(NmlParseSuccessWithoutFile {
            skeleton_tracing: SkeletonTracing {
                trees,
                tree_groups: groups,
                ..Default::default()
            },
            volume_layers: vec![UploadedVolumeLayer {
                tracing: VolumeTracing {
                    segments: vec![Segment {
                        segment_id: 1,
                        ..Default::default()
                    }],
                    segment_groups: vec![SegmentGroup {
                        name: "sg".to_owned(),
                        group_id: 4,
                        children: vec![],
                        is_expanded: None,
                    }],
                    ..Default::default()
                },
                data_zip_location: String::new(),
                name: None,
                edited_mapping_edges_location: None,
                edited_mapping_base_mapping_name: None,
            }],
            dataset_id: DATASET_ID.to_owned(),
            description: String::new(),
            wk_url: None,
        }),
    }
}

fn group(name: &str, group_id: i32, children: Vec<TreeGroup>) -> TreeGroup {
    TreeGroup {
        name: name.to_owned(),
        group_id,
        children,
        is_expanded: None,
    }
}

#[test]
fn groups_are_wrapped_per_file() {
    let results = vec![
        success_result(
            "Some.File.NML",
            vec![tree("a", None), tree("b", Some(2))],
            vec![group("g", 2, vec![group("deep", 7, vec![])])],
        ),
        success_result("empty.zip", vec![], vec![]),
        NmlParseResult::Empty {
            file_name: "e.nml".to_owned(),
        },
    ];
    let wrapped = wrap_or_prefix_groups(results, true);
    let first = success(&wrapped[0]);
    let skeleton = &first.skeleton_tracing;
    assert_eq!(skeleton.tree_groups.len(), 1);
    let wrapper = &skeleton.tree_groups[0];
    assert_eq!(
        (wrapper.name.as_str(), wrapper.group_id, wrapper.is_expanded),
        ("Some.File", 8, Some(true))
    );
    assert_eq!(wrapper.children[0].children[0].name, "deep");
    assert_eq!(
        skeleton
            .trees
            .iter()
            .map(|t| t.group_id)
            .collect::<Vec<_>>(),
        vec![Some(8), Some(2)]
    );
    let volume = &first.volume_layers[0].tracing;
    assert_eq!(volume.segment_groups[0].group_id, 5);
    assert_eq!(volume.segment_groups[0].name, "Some.File");
    assert_eq!(volume.segment_groups[0].is_expanded, None);
    assert_eq!(volume.segments[0].group_id, Some(5));
    // No trees and no groups: skeleton untouched, segments still wrapped.
    let second = success(&wrapped[1]);
    assert!(second.skeleton_tracing.tree_groups.is_empty());
    assert_eq!(
        second.volume_layers[0].tracing.segment_groups[0].name,
        "empty"
    );
    assert!(matches!(wrapped[2], NmlParseResult::Empty { .. }));
}

#[test]
fn tree_names_are_prefixed_only_for_multiple_results() {
    let single = wrap_or_prefix_groups(
        vec![success_result("one.nml", vec![tree("a", None)], vec![])],
        false,
    );
    assert_eq!(success(&single[0]).skeleton_tracing.trees[0].name, "a");
    let multiple = wrap_or_prefix_groups(
        vec![
            success_result("x.y.nml", vec![tree("a", None)], vec![]),
            success_result("noext", vec![tree("b", None)], vec![]),
            NmlParseResult::Failure {
                file_name: "f.nml".to_owned(),
                error: "e".to_owned(),
            },
        ],
        false,
    );
    assert_eq!(
        success(&multiple[0]).skeleton_tracing.trees[0].name,
        "x.y_a"
    );
    assert_eq!(
        success(&multiple[1]).skeleton_tracing.trees[0].name,
        "noext_b"
    );
    assert!(
        success(&multiple[0])
            .skeleton_tracing
            .tree_groups
            .is_empty()
    );
}

#[test]
fn naming_description_and_wk_url_helpers() {
    assert_eq!(name_for_uploaded(&["a.nml"]).as_deref(), Some("a"));
    assert_eq!(name_for_uploaded(&["a.nml.nml"]).as_deref(), Some("a.nml"));
    assert_eq!(
        name_for_uploaded(&["x.zip.zipy.nml"]).as_deref(),
        Some("xy")
    );
    assert_eq!(name_for_uploaded(&["a.nml\n"]).as_deref(), Some("a\n"));
    assert_eq!(name_for_uploaded(&["a.NML"]).as_deref(), Some("a.NML"));
    assert_eq!(name_for_uploaded(&["a.nml", "b.nml"]), None);
    assert_eq!(name_for_uploaded(&[]), None);

    assert_eq!(
        description_for_nmls(&[Some(" d "), Some("d"), None, Some("")]),
        "d"
    );
    assert_eq!(description_for_nmls(&[Some("a"), Some("b")]), "");
    assert_eq!(description_for_nmls(&[Some("  "), Some("a")]), "");
    assert_eq!(description_for_nmls(&[None]), "");

    assert_eq!(wk_urls_for_nmls(&[Some("u"), Some("u")]), "u");
    assert_eq!(wk_urls_for_nmls(&[Some("u"), None]), "");
    assert_eq!(wk_urls_for_nmls(&[None, None]), "");
    assert_eq!(wk_urls_for_nmls(&[]), "");
}

#[test]
fn error_aggregation_and_consistency_checks() {
    let results = vec![
        NmlParseResult::Failure {
            file_name: "a.nml".to_owned(),
            error: "boom".to_owned(),
        },
        NmlParseResult::Empty {
            file_name: "b.nml".to_owned(),
        },
    ];
    assert_eq!(
        upload_error_messages(&results),
        vec!["Could not parse file “a.nml”: boom"]
    );
    assert_eq!(return_error(&results).status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        return_error(&results[1..]).status(),
        StatusCode::BAD_REQUEST
    );
    assert!(upload_error_messages(&results[1..]).is_empty());

    let with_org = |org: Option<&str>| SkeletonTracing {
        organization_id: org.map(str::to_owned),
        ..Default::default()
    };
    let (a, b, none) = (with_org(Some("a")), with_org(Some("b")), with_org(None));
    assert_eq!(
        uploaded_annotations_dataset_and_organization(&[&a, &none, &a], &[], &["x", "x"]).unwrap(),
        ("x".to_owned(), Some("a".to_owned()))
    );
    assert_eq!(
        uploaded_annotations_dataset_and_organization(&[&none], &[], &["x"]).unwrap(),
        ("x".to_owned(), None)
    );
    for (skeletons, ids) in [(vec![&a, &b], vec!["x"]), (vec![&a], vec!["x", "y"])] {
        let error =
            uploaded_annotations_dataset_and_organization(&skeletons, &[], &ids).unwrap_err();
        assert_eq!(
            (error.status, error.message.as_str()),
            (StatusCode::BAD_REQUEST, MSG_DIFFERENT_DATASETS)
        );
    }

    let (name, description, wk_url) = upload_metadata(&[success_result("f.zip", vec![], vec![])]);
    assert_eq!(
        (name.as_deref(), description.as_str(), wk_url.as_str()),
        (Some("f"), "", "")
    );
}
