use super::*;

const COLOR: ColorProto = ColorProto {
    r: 0.25,
    g: 0.5,
    b: 0.75,
    a: 1.0,
};

fn params() -> SharedParsingParameters {
    SharedParsingParameters {
        user_organization_id: "userOrg".to_owned(),
        ..Default::default()
    }
}

fn context() -> NmlParseContext {
    NmlParseContext {
        now_millis: 4242,
        task_bounding_box_color: COLOR,
    }
}

fn parse_with(xml: &str, params: &SharedParsingParameters) -> NmlParseOutcome {
    parse_nml("test.nml", xml.as_bytes(), params, &context())
}

fn parsed_with(xml: &str, params: &SharedParsingParameters) -> NmlParsedParameters {
    match parse_with(xml, params) {
        NmlParseOutcome::Parsed(parsed) => *parsed,
        other => panic!("expected success, got {other:?}"),
    }
}

fn parsed(xml: &str) -> NmlParsedParameters {
    parsed_with(xml, &params())
}

fn failure(xml: &str) -> String {
    match parse_with(xml, &params()) {
        NmlParseOutcome::Failure(message) => message,
        other => panic!("expected failure, got {other:?}"),
    }
}

/// Minimal NML around `body` (trees, branchpoints, comments, groups, volumes).
fn nml(body: &str) -> String {
    format!(r#"<things><parameters><experiment name="ds"/></parameters>{body}</things>"#)
}

fn tree(id: &str, nodes: &[i32], edges: &[(i32, i32)], extra: &str) -> String {
    let nodes: String = nodes
        .iter()
        .map(|n| format!(r#"<node id="{n}" x="1" y="2" z="3"/>"#))
        .collect();
    let edges: String = edges
        .iter()
        .map(|(s, t)| format!(r#"<edge source="{s}" target="{t}"/>"#))
        .collect();
    format!(
        r#"<thing id="{id}" name="t{id}" {extra}><nodes>{nodes}</nodes><edges>{edges}</edges></thing>"#
    )
}

const FULL: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<things>
  <meta name="writer" content="NmlWriter.scala"/>
  <parameters>
    <experiment name="my_dataset" datasetId="5F0000000000000000000ABC" organization="sample_org"
                description="A &amp; B" wkUrl="https://wk.example"/>
    <scale x="11.24" y="11.24" z="28.0" unit="nanometer"/>
    <offset x="0" y="0" z="0"/>
    <time ms="1600000000000"/>
    <activeNode id="7"/>
    <editPosition x="10" y="20.6" z="30" additionalCoordinate-t="4"/>
    <editRotation xRot="1.5" yRot="2" zRot="3"/>
    <zoomLevel zoom="1.25"/>
    <userBoundingBox id="3" name="box" isVisible="false" color.r="1" color.g="0" color.b="0" color.a="1"
                     topLeftX="1" topLeftY="2" topLeftZ="3" width="4" height="5" depth="6"/>
    <userBoundingBox id="1" name="" topLeftX="0" topLeftY="0" topLeftZ="0" width="1" height="1" depth="1"/>
    <taskBoundingBox topLeftX="7" topLeftY="8" topLeftZ="9" width="10" height="11" depth="12"/>
    <additionalAxes>
      <additionalAxis name="t" index="0" start="0" end="10"/>
      <additionalAxis name="c" index="1" start="0" end="3"/>
    </additionalAxes>
  </parameters>
  <thing id="2" color.r="0.1" color.g="0.2" color.b="0.3" color.a="0" name="axon" groupId="5" type="AGGLOMERATE">
    <nodes>
      <node id="7" radius="2.5" x="1.5" y="2" z="3" rotX="0.5" rotY="0" rotZ="1" inVp="2" inMag="1"
            bitDepth="8" interpolation="TRUE" time="300" additionalCoordinate-t="2"/>
      <node id="8" x="4" y="5" z="6" time="200"/>
    </nodes>
    <edges><edge source="7" target="8"/></edges>
    <metadata>
      <metadataEntry key="s" stringValue="hello"/>
      <metadataEntry key="b" boolValue="true"/>
      <metadataEntry key="n" numberValue="1.5"/>
      <metadataEntry key="l" stringListValue-10="z" stringListValue-2="a&amp;b"/>
    </metadata>
  </thing>
  <thing id="4" name="empty"/>
  <branchpoints>
    <branchpoint id="7" time="123"/>
    <branchpoint id="8"/>
  </branchpoints>
  <comments>
    <comment node="7" content="first"/>
    <comment node="7" content="second"/>
  </comments>
  <groups>
    <group id="5" name="outer"><group id="6" name="inner" isExpanded="false"/></group>
  </groups>
  <volume id="0" location="data_Volume.zip" fallbackLayer="segmentation" name="Volume" largestSegmentId="99"
          mappingName="agglo" mappingIsLocked="true" editedMappingEdgesLocation="edges.zip"
          editedMappingBaseMappingName="base">
    <segments>
      <segment id="12" name="seg" anchorPositionX="1" anchorPositionY="2" anchorPositionZ="3" created="55"
               color.r="1" color.g="1" color.b="1" color.a="1" groupId="1" additionalCoordinate-t="1">
        <metadata><metadataEntry key="k" numberValue="2"/></metadata>
      </segment>
      <segment id="13" anchorPositionX="1"/>
    </segments>
    <groups><group id="1" name="sg"><group id="2" name="child"/></group></groups>
  </volume>
</things>"#;

#[test]
fn parses_full_document() {
    let p = parsed(FULL);
    assert_eq!(p.dataset_name, "my_dataset");
    assert_eq!(
        p.dataset_id_opt.as_deref(),
        Some("5F0000000000000000000ABC")
    );
    assert_eq!(p.organization_id, "sample_org");
    assert_eq!(p.description, "A & B");
    assert_eq!(p.wk_url.as_deref(), Some("https://wk.example"));
    assert_eq!(p.timestamp, 1_600_000_000_000);
    assert_eq!(p.active_node_id, Some(7));
    assert_eq!(
        p.edit_position,
        Vec3IntProto {
            x: 10,
            y: 21,
            z: 30
        }
    );
    assert_eq!(
        p.edit_position_additional_coordinates,
        vec![AdditionalCoordinateProto {
            name: "t".to_owned(),
            value: 4
        }]
    );
    assert_eq!(
        p.edit_rotation,
        Vec3DoubleProto {
            x: 1.5,
            y: 2.0,
            z: 3.0
        }
    );
    assert_eq!(p.zoom_level, 1.25);
    assert_eq!(p.additional_axes.len(), 2);
    assert_eq!(p.additional_axes[1].name, "c");
    assert_eq!(p.additional_axes[1].bounds, Vec2IntProto { x: 0, y: 3 });
    // Not a task upload: task bounding box becomes a user bounding box.
    assert_eq!(p.task_bounding_box, None);
    assert_eq!(p.user_bounding_boxes.len(), 3);
    let first = &p.user_bounding_boxes[0];
    assert_eq!(
        (first.id, first.name.as_deref(), first.is_visible),
        (3, Some("box"), Some(false))
    );
    assert_eq!(first.color.map(|c| c.r), Some(1.0));
    assert_eq!(
        first.bounding_box.top_left,
        Vec3IntProto { x: 1, y: 2, z: 3 }
    );
    assert_eq!(p.user_bounding_boxes[1].name, None);
    let task = &p.user_bounding_boxes[2];
    assert_eq!(task.id, 4);
    assert_eq!(task.name.as_deref(), Some("task bounding box"));
    assert_eq!(task.color, Some(COLOR));
    assert_eq!(task.bounding_box.depth, 12);

    assert_eq!(p.trees.len(), 2);
    let axon = &p.trees[0];
    assert_eq!(axon.tree_id, 2);
    assert_eq!(axon.name, "axon");
    assert_eq!(axon.group_id, Some(5));
    assert_eq!(axon.r#type, Some(1));
    assert_eq!(axon.color.map(|c| c.r), Some(f64::from(0.1f32)));
    // No isVisible attribute: derived from alpha 0.
    assert_eq!(axon.is_visible, Some(false));
    assert_eq!(axon.created_timestamp, 200);
    let node = &axon.nodes[0];
    assert_eq!(node.position, Vec3IntProto { x: 2, y: 2, z: 3 });
    assert_eq!(
        node.rotation,
        Vec3DoubleProto {
            x: 0.5,
            y: 0.0,
            z: 1.0
        }
    );
    assert_eq!(
        (
            node.radius,
            node.viewport,
            node.mag,
            node.bit_depth,
            node.interpolation
        ),
        (2.5, 2, 1, 8, true)
    );
    assert_eq!(node.created_timestamp, 300);
    assert_eq!(node.additional_coordinates[0].value, 2);
    let defaults = &axon.nodes[1];
    assert_eq!(
        (
            defaults.radius,
            defaults.viewport,
            defaults.mag,
            defaults.interpolation
        ),
        (1.0, 0, 0, false)
    );
    assert_eq!(
        axon.edges,
        vec![Edge {
            source: 7,
            target: 8
        }]
    );
    assert_eq!(
        axon.branch_points,
        vec![
            BranchPoint {
                node_id: 7,
                created_timestamp: 123
            },
            // No time: document timestamp minus the branchpoint index.
            BranchPoint {
                node_id: 8,
                created_timestamp: 1_600_000_000_000 - 1
            },
        ]
    );
    // Comments of one node are in reverse document order (Scala map prepends).
    let contents: Vec<&str> = axon.comments.iter().map(|c| c.content.as_str()).collect();
    assert_eq!(contents, ["second", "first"]);
    assert_eq!(axon.metadata.len(), 4);
    assert_eq!(axon.metadata[0].string_value.as_deref(), Some("hello"));
    assert_eq!(axon.metadata[1].bool_value, Some(true));
    assert_eq!(axon.metadata[2].number_value, Some(1.5));
    // Sorted by index; Scala re-escapes attribute text (Text.toString).
    assert_eq!(axon.metadata[3].string_list_value, ["a&amp;b", "z"]);
    let empty = &p.trees[1];
    assert_eq!(empty.created_timestamp, 4242);
    assert_eq!(
        (empty.color, empty.is_visible, empty.group_id),
        (None, None, None)
    );

    assert_eq!(p.tree_groups.len(), 1);
    assert_eq!(p.tree_groups[0].is_expanded, Some(true));
    assert_eq!(p.tree_groups[0].children[0].is_expanded, Some(false));

    assert_eq!(p.volumes.len(), 1);
    let volume = &p.volumes[0];
    assert_eq!(volume.data_zip_path, "data_Volume.zip");
    assert_eq!(volume.fallback_layer_name.as_deref(), Some("segmentation"));
    assert_eq!(volume.largest_segment_id, Some(99));
    assert_eq!(volume.mapping_is_locked, Some(true));
    assert_eq!(volume.segment_groups[0].children[0].name, "child");
    let segment = &volume.segments[0];
    assert_eq!(segment.segment_id, 12);
    assert_eq!(
        segment.anchor_position,
        Some(Vec3IntProto { x: 1, y: 2, z: 3 })
    );
    assert_eq!(
        (segment.creation_time, segment.group_id, segment.is_visible),
        (Some(55), Some(1), Some(true))
    );
    assert_eq!(segment.metadata[0].number_value, Some(2.0));
    assert_eq!(segment.anchor_position_additional_coordinates.len(), 1);
    // Incomplete anchor position is ignored.
    assert_eq!(volume.segments[1].anchor_position, None);
}

#[test]
fn into_success_builds_tracings() {
    let p = parsed(FULL);
    let dataset = DatasetRef {
        id: "5f0000000000000000000abc".to_owned(),
        name: "renamed".to_owned(),
        organization_id: "sample_org".to_owned(),
    };
    assert_eq!(
        p.validated_dataset_id(),
        Ok(Some("5f0000000000000000000abc".to_owned()))
    );
    let success = p.into_success(&dataset, Some("/tmp/upload.zip"));
    let skeleton = &success.skeleton_tracing;
    assert_eq!(skeleton.dataset_name, "renamed");
    assert_eq!(skeleton.organization_id.as_deref(), Some("sample_org"));
    assert_eq!(skeleton.created_timestamp, 1_600_000_000_000);
    assert_eq!(skeleton.version, 0);
    assert_eq!(skeleton.bounding_box, None);
    assert_eq!(skeleton.trees.len(), 2);
    assert_eq!(skeleton.user_bounding_boxes.len(), 3);
    assert_eq!(success.dataset_id, "5f0000000000000000000abc");
    assert_eq!(success.description, "A & B");
    let layer = &success.volume_layers[0];
    assert_eq!(layer.data_zip_location, "/tmp/upload.zipdata_Volume.zip");
    assert_eq!(
        layer.edited_mapping_edges_location.as_deref(),
        Some("/tmp/upload.zipedges.zip")
    );
    assert_eq!(layer.name.as_deref(), Some("Volume"));
    let volume = &layer.tracing;
    assert_eq!(volume.element_class, ElementClassProto::Uint32 as i32);
    assert_eq!(volume.bounding_box, empty_bbox());
    assert_eq!(volume.has_editable_mapping, Some(true));
    assert_eq!(volume.has_segment_index, None);
    assert_eq!(volume.largest_segment_id, Some(99));
    assert_eq!(volume.mapping_name.as_deref(), Some("agglo"));
    assert_eq!(
        volume.edit_position,
        Vec3IntProto {
            x: 10,
            y: 21,
            z: 30
        }
    );
    assert_eq!(volume.additional_axes.len(), 2);
}

#[test]
fn task_upload_keeps_task_bounding_box_and_uses_fallbacks() {
    let xml = r#"<things><parameters>
            <taskBoundingBox topLeftX="1" topLeftY="2" topLeftZ="3" width="4" height="5" depth="6"/>
            <editPosition x="a" y="1" z="1"/>
            </parameters></things>"#;
    let params = SharedParsingParameters {
        is_task_upload: true,
        overwriting_dataset_id: Some("abc".to_owned()),
        fallback_edit_position: Some(Vec3IntProto { x: 5, y: 6, z: 7 }),
        fallback_edit_rotation: Some(Vec3DoubleProto {
            x: 1.0,
            y: 0.0,
            z: 0.0,
        }),
        fallback_zoom_level: Some(3.0),
        ..params()
    };
    let p = parsed_with(xml, &params);
    assert_eq!(p.task_bounding_box.map(|b| b.width), Some(4));
    assert!(p.user_bounding_boxes.is_empty());
    assert_eq!(p.edit_position, Vec3IntProto { x: 5, y: 6, z: 7 });
    assert_eq!(p.edit_rotation.x, 1.0);
    assert_eq!(p.zoom_level, 3.0);
    assert_eq!(p.dataset_id_opt.as_deref(), Some("abc"));
    assert_eq!(p.organization_id, "userOrg");
    assert_eq!((p.dataset_name.as_str(), p.wk_url.clone()), ("", None));
    assert_eq!(
        p.validated_dataset_id(),
        Err("The supplied resource id “abc” is not a valid ObjectId.".to_owned())
    );
    let success = p.into_success(
        &DatasetRef {
            id: "x".to_owned(),
            name: "d".to_owned(),
            organization_id: "o".to_owned(),
        },
        None,
    );
    assert_eq!(
        success.skeleton_tracing.bounding_box.map(|b| b.depth),
        Some(6)
    );
}

#[test]
fn legacy_and_default_parameters() {
    // Single user bounding box without id; experiment without wkUrl/description.
    let p = parsed(
        r#"<things><parameters><experiment name="old"/>
            <userBoundingBox topLeftX="1" topLeftY="1" topLeftZ="1" width="2" height="2" depth="2"/>
            </parameters></things>"#,
    );
    assert_eq!(p.user_bounding_boxes.len(), 1);
    assert_eq!(p.user_bounding_boxes[0].id, 0);
    assert_eq!(p.user_bounding_boxes[0].name, None);
    assert_eq!(p.wk_url.as_deref(), Some(""));
    assert_eq!(p.description, "");
    assert_eq!(p.timestamp, 0);
    assert_eq!(p.edit_position, Vec3IntProto { x: 0, y: 0, z: 0 });
    assert_eq!(p.zoom_level, DEFAULT_ZOOM_LEVEL);
    assert!(p.trees.is_empty() && p.volumes.is_empty());

    // Invalid user bounding boxes are skipped silently; task box id continues after max.
    let p = parsed(
        r#"<things><parameters>
            <userBoundingBox id="x" topLeftX="1" topLeftY="1" topLeftZ="1" width="2" height="2" depth="2"/>
            <userBoundingBox id="2" topLeftX="1" topLeftY="1" topLeftZ="1" width="2" height="2"/>
            <taskBoundingBox topLeftX="1" topLeftY="1" topLeftZ="1" width="2" height="2" depth="2"/>
            </parameters></things>"#,
    );
    assert_eq!(p.user_bounding_boxes.len(), 1);
    assert_eq!(p.user_bounding_boxes[0].id, 0);

    // Prefixed elements match by local name; xmlns attributes are ignored.
    let p = parsed(
        r#"<a:things xmlns:a="urn:x"><a:parameters><a:time ms="5"/></a:parameters></a:things>"#,
    );
    assert_eq!(p.timestamp, 5);
}

#[test]
fn explicit_visibility_and_invalid_segment_groups() {
    let p = parsed(&nml(
        r#"<thing id="1" isVisible="TRUE" color.r="0" color.g="0" color.b="0" color.a="0"/>
            <volume location="v.zip" name="a"><groups><group id="x"/></groups></volume>"#,
    ));
    assert_eq!(p.trees[0].is_visible, Some(true));
    assert!(p.volumes[0].segment_groups.is_empty());
}

#[test]
fn empty_documents_are_empty() {
    for xml in [
        "",
        "  \n ",
        "<?xml version=\"1.0\"?>",
        "<!-- only a comment -->",
    ] {
        assert_eq!(
            parse_with(xml, &params()),
            NmlParseOutcome::Empty,
            "{xml:?}"
        );
    }
    assert_eq!(
        parse_nml("x", b"\xEF\xBB\xBF", &params(), &context()),
        NmlParseOutcome::Empty
    );
}

#[test]
fn malformed_xml_fails_with_location() {
    let message = failure("<things>\n<parameters></things>");
    assert!(
        message.starts_with("Failed to parse NML 'test.nml'. Error in Line 2"),
        "{message}"
    );
    let message = failure("<!DOCTYPE x><things/>");
    assert!(message.contains("DOCTYPE is disallowed"), "{message}");
    let message = failure("<things a=\"&foo;\"/>");
    assert!(
        message.starts_with("Failed to parse NML 'test.nml'. Error in Line 1"),
        "{message}"
    );
    let message = failure("<things><x>&foo;</x></things>");
    assert!(
        message.contains("The entity \"foo\" was referenced, but not declared."),
        "{message}"
    );
    let message = failure("garbage<things/>");
    assert!(
        message.ends_with("Content is not allowed in prolog."),
        "{message}"
    );
    let message = failure("<things/><other/>");
    assert!(message.contains("following the root element"), "{message}");
    let message = failure("<things><parameters>");
    assert!(
        message.contains("must start and end within the same entity"),
        "{message}"
    );
    let message = failure("<things a=\"1\" a=\"2\"/>");
    assert!(
        message.starts_with("Failed to parse NML 'test.nml'. Error in Line 1"),
        "{message}"
    );
    let message = parse_nml("bad", b"<things>\xFF</things>", &params(), &context());
    assert!(matches!(message, NmlParseOutcome::Failure(m) if m.contains("UTF-8")));
}

#[test]
fn element_validation_messages() {
    let cases: Vec<(String, &str)> = vec![
            ("<things/>".to_owned(), "No parameters section found."),
            (
                nml(r#"<comments><comment node="x" content="c"/></comments>"#),
                "Invalid comment elements. <~ Invalid node id “x” in comment.",
            ),
            (
                nml(r#"<branchpoints><branchpoint id="1"/><branchpoint id=""/></branchpoints>"#),
                "Invalid branchpoint elements. <~ Invalid branchpoint node id “”.",
            ),
            (
                nml(r#"<thing id="1"/><thing id="x"/><thing id="y"/>"#),
                "Invalid tree elements. <~ Invalid tree id “x”.",
            ),
            (
                nml(r#"<thing id="1"><nodes><node id="q" x="1" y="1" z="1"/></nodes></thing>"#),
                "Invalid tree elements. <~ Invalid nodes in tree 1. <~ Invalid node id “q”.",
            ),
            (
                nml(r#"<thing id="1"><nodes><node id="3" x="1" y="1"/></nodes></thing>"#),
                "Invalid tree elements. <~ Invalid nodes in tree 1. <~ Invalid node position for node id 3.",
            ),
            (
                nml(r#"<thing id="1"><edges><edge source="a" target="2"/></edges></thing>"#),
                "Invalid tree elements. <~ Invalid edges in tree 1. <~ Invalid edge “a-2”.",
            ),
            (
                nml(r#"<groups><group id="1"><group id="z"/></group></groups>"#),
                "Invalid tree group elements. <~ Invalid tree group id “z”.",
            ),
            (
                nml(r#"<volume location="a.zip"/><volume location="b.zip"/>"#),
                MSG_DUPLICATE_VOLUME_LAYER_NAMES,
            ),
            (
                r#"<things><parameters><additionalAxes><a name="t" index="0" start="0" end="1"/><b name="t" index="1" start="0" end="1"/></additionalAxes></parameters></things>"#
                    .to_owned(),
                MSG_ADDITIONAL_COORDINATES_NOT_UNIQUE,
            ),
        ];
    for (xml, expected) in cases {
        assert_eq!(failure(&xml), expected, "{xml}");
    }
}

#[test]
fn tree_validator_messages() {
    let cases: Vec<(String, &str)> = vec![
        (
            nml(&format!(
                "{}{}",
                tree("1", &[1], &[], ""),
                tree("1", &[2], &[], "")
            )),
            "Duplicate treeIds: 1",
        ),
        (
            nml(&format!(
                "{}{}",
                tree("1", &[1], &[], ""),
                tree("2", &[1], &[], "")
            )),
            "Duplicate nodeIds: 1",
        ),
        (
            nml(&tree("1", &[1, 2], &[(1, 2), (2, 1)], "")),
            "Duplicate edges in tree 1: Edge(2,1,UnknownFieldSet(Map()))",
        ),
        (
            nml(&format!(
                "{}<groups><group id=\"3\"/><group id=\"3\"/></groups>",
                tree("1", &[1], &[], "")
            )),
            "Duplicate treeGroupIds: 3",
        ),
        (
            nml(&tree("1", &[1], &[], "groupId=\"9999\"")),
            "Some treeGroups used in trees don't exist. treeGroups: 9999",
        ),
        (
            nml(&format!(
                "{}<branchpoints><branchpoint id=\"99\"/></branchpoints>",
                tree("1", &[1], &[], "")
            )),
            "Some branchPoints refer to non-existent nodes. branchPoints: 99",
        ),
        (
            nml(&format!(
                "{}<comments><comment node=\"98\"/><comment node=\"1\"/></comments>",
                tree("1", &[1], &[], "")
            )),
            "Some comments refer to non-existent nodes. comments: 98",
        ),
        // The multi-component splitter (JGraphT) throws before the validator runs.
        (
            nml(&tree("1", &[1], &[(1, 99)], "")),
            "Failed to parse NML 'test.nml': java.lang.IllegalArgumentException: no such vertex in graph: 99",
        ),
        (
            nml(&tree("1", &[1, 2], &[(1, 2), (2, 2)], "")),
            "Failed to parse NML 'test.nml': java.lang.IllegalArgumentException: loops not allowed",
        ),
    ];
    for (xml, expected) in cases {
        assert_eq!(failure(&xml), expected, "{xml}");
    }
}

#[test]
fn number_format_exceptions_and_precedence() {
    assert_eq!(
        failure(&nml(
            r#"<thing id="1"><nodes><node id="1" x="1" y="1" z="1" additionalCoordinate-t="1.5"/></nodes></thing>"#
        )),
        "Failed to parse NML 'test.nml': java.lang.NumberFormatException: For input string: \"1.5\""
    );
    assert_eq!(
        failure(&nml(
            r#"<volume><segments><segment id="abc"/></segments></volume>"#
        )),
        "Failed to parse NML 'test.nml': java.lang.NumberFormatException: For input string: \"abc\""
    );
    assert_eq!(
        failure(&nml(
            r#"<volume><segments><segment anchorPositionX="1" anchorPositionY="" anchorPositionZ="1"/></segments></volume>"#
        )),
        "Failed to parse NML 'test.nml': java.lang.NumberFormatException: For input string: \"\""
    );
    // Box.combined evaluates every tree, so a later exception wins over an earlier failure.
    assert_eq!(
        failure(&nml(
            r#"<thing id="x"/><thing id="2"><nodes><node id="1" x="1" y="1" z="1" additionalCoordinate-t="q"/></nodes></thing>"#
        )),
        "Failed to parse NML 'test.nml': java.lang.NumberFormatException: For input string: \"q\""
    );
    // Additional coordinates of the edit position are parsed eagerly.
    assert!(
            failure(r#"<things><parameters><editPosition additionalCoordinate-t="x"/></parameters></things>"#)
                .contains("NumberFormatException")
        );
    // Attributes with longer axis names are not additional coordinates.
    let p = parsed(
        r#"<things><parameters><editPosition x="1" y="2" z="3" additionalCoordinate-tt="x"/></parameters></things>"#,
    );
    assert!(p.edit_position_additional_coordinates.is_empty());
}

#[test]
fn splits_multi_component_trees() {
    let xml = nml(&format!(
        "{}{}<groups><group id=\"4\" name=\"g\"/></groups><comments><comment node=\"3\" content=\"c\"/></comments>",
        tree("2", &[1, 2, 3], &[(1, 2)], "type=\"AGGLOMERATE\""),
        tree("7", &[10, 11], &[], "groupId=\"4\""),
    ));
    let p = parsed(&xml);
    let summary: Vec<(i32, &str, Option<i32>, usize)> = p
        .trees
        .iter()
        .map(|t| (t.tree_id, t.name.as_str(), t.group_id, t.nodes.len()))
        .collect();
    assert_eq!(
        summary,
        [
            (8, "t2_0", Some(5), 2),
            (9, "t2_1", Some(5), 1),
            (10, "t7_0", Some(6), 1),
            (11, "t7_1", Some(6), 1),
        ]
    );
    // Split trees lose their type; comments follow their component.
    assert_eq!(p.trees[0].r#type, None);
    assert_eq!(p.trees[1].comments.len(), 1);
    assert_eq!(p.trees[0].edges.len(), 1);
    // Tree without a group: new top-level group prepended; with a group: nested child.
    assert_eq!(p.tree_groups.len(), 2);
    assert_eq!(
        (p.tree_groups[0].group_id, p.tree_groups[0].name.as_str()),
        (5, "t2")
    );
    assert_eq!(p.tree_groups[0].is_expanded, None);
    assert_eq!(p.tree_groups[1].children[0].group_id, 6);
}

#[test]
fn finish_parse_result_mirrors_upload_service() {
    let outcome = parse_with(FULL, &params());
    let result = finish_parse_result("a.nml", outcome, None, |id, name, organization| {
        assert_eq!(
            (id, name, organization),
            (Some("5f0000000000000000000abc"), "my_dataset", "sample_org")
        );
        Ok(DatasetRef {
            id: id.unwrap_or_default().to_owned(),
            name: name.to_owned(),
            organization_id: organization.to_owned(),
        })
    });
    assert!(result.succeeded());
    assert_eq!(result.description(), Some("A & B"));
    assert_eq!(result.clone().with_name("z.zip").file_name(), "z.zip");
    assert!(result.to_success().is_ok());

    let failed = finish_parse_result(
        "b.nml",
        parse_with("<things/>", &params()),
        None,
        |_, _, _| unreachable!(),
    );
    assert_eq!(
        failed.to_success().unwrap_err(),
        "Couldn’t parse file: b.nml. No parameters section found."
    );
    let lookup_failed = finish_parse_result(
        "c.nml",
        parse_with(&nml(""), &params()),
        None,
        |_, name, _| {
            Err(format!(
                "Dataset with name “{name}” could not be found or accessed."
            ))
        },
    );
    assert_eq!(
        lookup_failed,
        NmlParseResult::Failure {
            file_name: "c.nml".to_owned(),
            error: "Dataset with name “ds” could not be found or accessed.".to_owned()
        }
    );
    let empty = finish_parse_result(
        "d.nml",
        NmlParseOutcome::Empty,
        None,
        |_, _, _| unreachable!(),
    );
    assert_eq!(
        empty.to_success().unwrap_err(),
        "Couldn’t parse file: d.nml"
    );
    assert!(!empty.succeeded());
}

#[test]
fn java_conversions() {
    assert_eq!(to_int("+5"), Some(5));
    assert_eq!(to_int(" 5"), None);
    assert_eq!(to_int("2147483648"), None);
    assert_eq!(to_long("-9"), Some(-9));
    assert_eq!(to_float(" 1.5f "), Some(1.5));
    assert_eq!(to_double("1e3d"), Some(1000.0));
    assert_eq!(to_double("-Infinity"), Some(f64::NEG_INFINITY));
    assert!(to_double("NaN").is_some_and(f64::is_nan));
    assert_eq!(to_double("inf"), None);
    assert_eq!(to_double("nan"), None);
    assert_eq!(to_double(".5"), Some(0.5));
    assert_eq!(to_double("e5"), None);
    assert_eq!(to_bool("TrUe"), Some(true));
    assert_eq!(to_bool("yes"), None);
    assert_eq!(java_round_float(-1.5), -1);
    assert_eq!(java_round_float(2.5), 3);
    assert_eq!(java_round_float(f32::NAN), 0);
    assert_eq!(java_round_float(1e20), i32::MAX);
    assert_eq!(file_name_without_extension("a.NML"), "a");
    assert_eq!(file_name_without_extension("a.zip"), "a");
    assert_eq!(file_name_without_extension("a.txt"), "a.txt");
    assert_eq!(file_name_without_extension("é"), "é");
    assert_eq!(scala_xml_escape("a<\"&>\u{1}b"), "a&lt;&quot;&amp;&gt;b");
    let color = random_color();
    assert!((0.0..1.0).contains(&color.r) && color.a == 1.0);
}
