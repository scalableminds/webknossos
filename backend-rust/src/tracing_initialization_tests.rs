use super::*;
use prost::Message;

fn source(layers: Value) -> DataSource {
    dataset_source::parse_data_source(&json!({
        "id": {"name": "dir_name", "team": "org"},
        "dataLayers": layers,
        "scale": [11.24, 11.24, 28.0],
    }))
    .expect("valid data source")
}

fn color(name: &str, bbox: Value, mags: Value) -> Value {
    json!({
        "name": name, "category": "color", "dataFormat": "zarr", "boundingBox": bbox,
        "elementClass": "uint8", "mags": mags,
    })
}

fn segmentation(name: &str, element_class: &str, largest: Value, mags: Value) -> Value {
    json!({
        "name": name, "category": "segmentation", "dataFormat": "wkw",
        "boundingBox": {"topLeft": [10, 20, 30], "width": 100, "height": 50, "depth": 10},
        "elementClass": element_class, "mags": mags, "largestSegmentId": largest,
        "additionalAxes": [{"name": "t", "bounds": [0, 5], "index": 0}],
    })
}

fn mags(list: &[[i32; 3]]) -> Value {
    Value::Array(list.iter().map(|m| json!({"mag": m})).collect())
}

fn default_source() -> DataSource {
    source(json!([
        color(
            "color",
            json!({"topLeft": [-5, 0, 0], "width": 3, "height": 101, "depth": 64}),
            mags(&[[4, 4, 2], [1, 1, 1], [2, 2, 1]])
        ),
        segmentation(
            "segmentation",
            "uint32",
            json!(1234),
            mags(&[[2, 2, 1], [1, 1, 1]])
        ),
    ]))
}

fn dataset(source: &DataSource) -> ExplorationalDataset<'_> {
    ExplorationalDataset {
        data_source: source,
        dataset_name: "Dataset Name",
        organization_id: "org",
    }
}

fn params(value: Value) -> AnnotationLayerParameters {
    AnnotationLayerParameters::from_json(&value).expect("valid params")
}

fn v3(x: i32, y: i32, z: i32) -> Vec3IntProto {
    Vec3IntProto { x, y, z }
}

#[test]
fn layer_parameters_json_matches_play_format() {
    let minimal = params(json!({"typ": "Volume"}));
    assert_eq!(minimal.typ, AnnotationLayerType::Volume);
    assert!(!minimal.auto_fallback_layer);
    assert_eq!(minimal.mag_restrictions, None);
    assert_eq!(minimal.name_with_default(), "Volume");
    assert_eq!(
        minimal.to_json(),
        json!({"typ": "Volume", "autoFallbackLayer": false})
    );

    let full = params(json!({
        "typ": "Skeleton", "fallbackLayerName": null, "autoFallbackLayer": null,
        "mappingName": "agglomerate_view_5", "magRestrictions": {"min": 2.0, "max": null},
        "name": "Trees", "additionalAxes": [{"name": "t", "bounds": [0], "index": 1}],
        "unknown": 1,
    }));
    assert_eq!(full.fallback_layer_name, None);
    assert!(!full.auto_fallback_layer);
    assert_eq!(
        full.mag_restrictions,
        Some(MagRestrictions {
            min: Some(2),
            max: None
        })
    );
    assert_eq!(full.name_with_default(), "Trees");
    assert_eq!(full.additional_axes.as_ref().map(Vec::len), Some(1));
    let round_trip: AnnotationLayerParameters =
        serde_json::from_value(serde_json::to_value(&full).unwrap()).unwrap();
    assert_eq!(round_trip, full);
    assert_eq!(
        serde_json::to_value(&full).unwrap()["magRestrictions"],
        json!({"min": 2})
    );

    for invalid in [
        json!({}),
        json!({"typ": "volume"}),
        json!({"typ": "Volume", "autoFallbackLayer": "true"}),
        json!({"typ": "Volume", "magRestrictions": {"min": 1.5}}),
        json!({"typ": "Volume", "magRestrictions": 3}),
        json!({"typ": "Volume", "name": 3}),
        json!({"typ": "Volume", "additionalAxes": [{"name": "t", "bounds": [0, 1]}]}),
        json!([]),
    ] {
        assert!(
            serde_json::from_value::<AnnotationLayerParameters>(invalid.clone()).is_err(),
            "{invalid}"
        );
    }
}

#[test]
fn skeleton_defaults_match_scala() {
    let source = default_source();
    let tracing = build_skeleton_tracing(&dataset(&source), 1_700_000_000_123);
    // Union box: topLeft (-5,0,0), bottomRight (110,101,64) → center trunc((105)/2)=52.
    assert_eq!(data_source_bounding_box(&source), [-5, 0, 0, 115, 101, 64]);
    let expected = SkeletonTracing {
        dataset_name: "Dataset Name".into(),
        trees: vec![],
        created_timestamp: 1_700_000_000_123,
        bounding_box: None,
        active_node_id: None,
        edit_position: v3(52, 50, 32),
        edit_rotation: zero_rotation(),
        zoom_level: 2.0,
        version: 0,
        user_bounding_box: None,
        tree_groups: vec![],
        user_bounding_boxes: vec![],
        organization_id: Some("org".into()),
        edit_position_additional_coordinates: vec![],
        additional_axes: vec![AdditionalAxisProto {
            name: "t".into(),
            index: 0,
            bounds: Vec2IntProto { x: 0, y: 5 },
        }],
        stored_with_external_tree_bodies: None,
        user_states: vec![],
    };
    assert_eq!(tracing, expected);
    let decoded = SkeletonTracing::decode(tracing.encode_to_vec().as_slice()).unwrap();
    assert_eq!(decoded, expected);
    let initial = InitialTracing::Skeleton(tracing);
    assert_eq!(initial.layer_type(), AnnotationLayerType::Skeleton);
    assert_eq!(
        layer_name(&params(json!({"typ": "Skeleton"})), &initial),
        "Skeleton"
    );
}

#[test]
fn center_uses_jvm_float_truncation() {
    // (-5 + -2) * 0.5f = -3.5 → -3 (toward zero); odd positive sums truncate down.
    assert_eq!(bbox_center(&[-5, 0, 1, 3, 3, 2]), [-3, 1, 2]);
    // Int → Float rounding for large coordinates (16777217 is not a float).
    assert_eq!(
        bbox_center(&[16_777_216, 0, 0, 2, 0, 0]),
        [16_777_216, 0, 0]
    );
    assert_eq!(data_source_center(&source(json!([]))), [0, 0, 0]);
}

#[test]
fn volume_without_fallback_uses_data_source_defaults() {
    let source = default_source();
    let p = params(json!({"typ": "Volume", "mappingName": "m"}));
    let plan = plan_volume_tracing(&dataset(&source), &p).unwrap();
    assert_eq!(plan.segment_index_lookup(), None);
    let tracing = plan.build(false, 42).unwrap();
    let expected = VolumeTracing {
        active_segment_id: None,
        bounding_box: bbox_proto(&[-5, 0, 0, 115, 101, 64]),
        created_timestamp: 42,
        dataset_name: "dir_name".into(),
        edit_position: v3(52, 50, 32),
        edit_rotation: zero_rotation(),
        element_class: ElementClassProto::Uint32 as i32,
        fallback_layer: None,
        largest_segment_id: Some(0),
        version: 0,
        zoom_level: 1.0,
        user_bounding_box: None,
        user_bounding_boxes: vec![],
        organization_id: Some("org".into()),
        // Union of all layer mags is distinct per maxDim → sorted by maxDim.
        mags: vec![v3(1, 1, 1), v3(2, 2, 1), v3(4, 4, 2)],
        segments: vec![],
        mapping_name: Some("m".into()),
        has_editable_mapping: None,
        segment_groups: vec![],
        has_segment_index: Some(true),
        edit_position_additional_coordinates: vec![],
        additional_axes: vec![AdditionalAxisProto {
            name: "t".into(),
            index: 0,
            bounds: Vec2IntProto { x: 0, y: 5 },
        }],
        mapping_is_locked: None,
        volume_bucket_data_has_changed: Some(false),
        unused_hide_unregistered_segments: None,
        user_states: vec![],
    };
    assert_eq!(tracing, expected);
    let decoded = VolumeTracing::decode(tracing.encode_to_vec().as_slice()).unwrap();
    assert_eq!(decoded, expected);
    let initial = InitialTracing::Volume(tracing);
    assert_eq!(layer_name(&p, &initial), "Volume");
    assert_eq!(
        VolumeTracing::decode(initial.encode_to_vec().as_slice()).unwrap(),
        expected
    );
}

#[test]
fn volume_with_auto_fallback_uses_segmentation_layer() {
    let source = default_source();
    let p = params(json!({"typ": "Volume", "autoFallbackLayer": true}));
    let plan = plan_volume_tracing(&dataset(&source), &p).unwrap();
    assert_eq!(plan.segment_index_lookup(), Some("segmentation"));
    let tracing = plan.build(false, 7).unwrap();
    assert_eq!(tracing.fallback_layer.as_deref(), Some("segmentation"));
    assert_eq!(tracing.bounding_box, bbox_proto(&[10, 20, 30, 100, 50, 10]));
    assert_eq!(tracing.edit_position, v3(52, 50, 32));
    assert_eq!(tracing.largest_segment_id, Some(1234));
    assert_eq!(tracing.element_class, ElementClassProto::Uint32 as i32);
    assert_eq!(tracing.mags, vec![v3(1, 1, 1), v3(2, 2, 1)]);
    assert_eq!(tracing.has_segment_index, Some(false));
    assert_eq!(plan.build(true, 7).unwrap().has_segment_index, Some(true));
    assert_eq!(tracing.additional_axes.len(), 1);
    let initial = InitialTracing::Volume(tracing);
    assert_eq!(layer_name(&p, &initial), "segmentation");
    let named = params(json!({"typ": "Volume", "autoFallbackLayer": true, "name": "Mine"}));
    assert_eq!(layer_name(&named, &initial), "Mine");

    // Without autoFallbackLayer nothing is chosen; an explicit name wins.
    let none = plan_volume_tracing(&dataset(&source), &params(json!({"typ": "Volume"})));
    assert_eq!(none.unwrap().segment_index_lookup(), None);
    let unset_lsid = self::source(json!([
        segmentation("first", "uint8", json!(255), mags(&[[1, 1, 1]])),
        segmentation("second", "uint64", Value::Null, mags(&[[1, 1, 1]])),
    ]));
    let explicit = params(json!({
        "typ": "Volume", "autoFallbackLayer": true, "fallbackLayerName": "second",
    }));
    let tracing = plan_volume_tracing(&dataset(&unset_lsid), &explicit)
        .unwrap()
        .build(true, 0)
        .unwrap();
    assert_eq!(tracing.fallback_layer.as_deref(), Some("second"));
    assert_eq!(tracing.largest_segment_id, None);
    assert_eq!(tracing.element_class, ElementClassProto::Uint64 as i32);
}

#[test]
fn fallback_layer_errors() {
    let source = source(json!([
        color(
            "color",
            json!({"topLeft": [0, 0, 0], "width": 1, "height": 1, "depth": 1}),
            mags(&[[1, 1, 1]])
        ),
        segmentation("small", "uint8", json!(256), mags(&[[1, 1, 1]])),
        segmentation("signed", "int16", json!(-1), mags(&[[1, 1, 1]])),
        segmentation("unset", "uint16", Value::Null, mags(&[[1, 1, 1]])),
    ]));
    let plan = |name: &str| {
        plan_volume_tracing(
            &dataset(&source),
            &params(json!({"typ": "Volume", "fallbackLayerName": name})),
        )
    };
    for name in ["color", "missing"] {
        let error = plan(name).unwrap_err();
        assert_eq!(error, TracingInitError::FallbackLayerNotFound(name.into()));
        assert_eq!(error.message(), None);
    }
    assert_eq!(
        plan("small").unwrap_err().message().as_deref(),
        Some(
            "The largest segment id 256 specified for the annotation layer exceeds the range of its data type “uint8”."
        )
    );
    assert_eq!(
        plan("signed").unwrap_err(),
        TracingInitError::LargestSegmentIdExceedsRange {
            largest_segment_id: -1,
            element_class: "int16".into()
        }
    );
    assert!(plan("unset").is_ok());

    assert!(largest_segment_id_is_in_range(Some(-5), "uint64"));
    assert!(largest_segment_id_is_in_range(
        Some(i64::from(u32::MAX)),
        "uint32"
    ));
    assert!(!largest_segment_id_is_in_range(Some(1 << 32), "uint32"));
    assert!(largest_segment_id_is_in_range(Some(127), "int8"));
    assert!(!largest_segment_id_is_in_range(Some(128), "int8"));
    assert!(!largest_segment_id_is_in_range(None, "uint24"));
    assert!(!largest_segment_id_is_in_range(None, "float"));
    assert_eq!(
        element_class_to_proto("float")
            .unwrap_err()
            .message()
            .as_deref(),
        Some("Unsupported element class float for ElementClassProto")
    );
    assert_eq!(
        element_class_to_proto("int64").unwrap(),
        ElementClassProto::Int64
    );
}

#[test]
fn mag_restrictions_and_template_layer() {
    let source = default_source();
    let restricted = params(json!({"typ": "Volume", "magRestrictions": {"min": 2, "max": 2}}));
    let tracing = plan_volume_tracing(&dataset(&source), &restricted)
        .unwrap()
        .build(false, 0)
        .unwrap();
    assert_eq!(tracing.mags, vec![v3(2, 2, 1)]);
    let too_tight = params(json!({"typ": "Volume", "magRestrictions": {"min": 8}}));
    let error = plan_volume_tracing(&dataset(&source), &too_tight).unwrap_err();
    assert_eq!(error, TracingInitError::MagRestrictionsTooTight);
    assert_eq!(error.to_string(), MAG_RESTRICTIONS_TOO_TIGHT);
    // Skeletons ignore mag restrictions.
    let skeleton = params(json!({"typ": "Skeleton", "magRestrictions": {"min": 8}}));
    assert!(matches!(
        create_tracing_for_explorational(&dataset(&source), &skeleton, None, false, 0),
        Ok(InitialTracing::Skeleton(_))
    ));

    // 2-2-1 and 2-2-2 share maxDim 2 → first layer with most mags, distinct.
    let conflicting = source_with_layers(&[
        &[[1, 1, 1], [2, 2, 1]],
        &[[1, 1, 1], [2, 2, 2], [2, 2, 2], [8, 8, 8]],
        &[[1, 1, 1], [4, 4, 4], [16, 16, 16]],
    ]);
    assert_eq!(
        mags_for_volume_tracing(&conflicting, None),
        vec![[1, 1, 1], [2, 2, 2], [8, 8, 8]]
    );
    // A fallback layer's mags are used as-is (sorted, not deduplicated).
    let fallback = &conflicting.layers[1];
    assert_eq!(
        mags_for_volume_tracing(&conflicting, Some(fallback)),
        vec![[1, 1, 1], [2, 2, 2], [2, 2, 2], [8, 8, 8]]
    );
}

fn source_with_layers(layer_mags: &[&[[i32; 3]]]) -> DataSource {
    source(Value::Array(
        layer_mags
            .iter()
            .enumerate()
            .map(|(i, m)| {
                color(
                    &format!("c{i}"),
                    json!({"topLeft": [0, 0, 0], "width": 8, "height": 8, "depth": 8}),
                    mags(m),
                )
            })
            .collect(),
    ))
}

#[test]
fn additional_axes_union_merges_like_scala_hash_map() {
    let mut layer_a = color(
        "a",
        json!({"topLeft": [0, 0, 0], "width": 1, "height": 1, "depth": 1}),
        mags(&[[1, 1, 1]]),
    );
    layer_a["additionalAxes"] = json!([
        {"name": "t", "bounds": [2, 5], "index": 3},
    ]);
    let mut layer_b = layer_a.clone();
    layer_b["name"] = json!("b");
    layer_b["additionalAxes"] = json!([
        {"name": "t", "bounds": [0, 4], "index": 9},
        {"name": "c", "bounds": [0, 2], "index": 1},
    ]);
    let source = source(json!([layer_a, layer_b]));
    // "c".hashCode = 99 → bucket 3; "t" = 116 → bucket 4.
    let axes = additional_axes_union(&source).unwrap();
    assert_eq!(
        axes,
        vec![
            Axis {
                name: "c".into(),
                bounds: vec![0, 2],
                index: 1
            },
            Axis {
                name: "t".into(),
                bounds: vec![0, 5],
                index: 3
            },
        ]
    );
    assert_eq!(java_string_hash("time"), 3_560_141);
    assert_eq!(additional_axes_union(&default_source_without_axes()), None);
    assert!(additional_axes_to_proto(None).is_empty());
}

fn default_source_without_axes() -> DataSource {
    source_with_layers(&[&[[1, 1, 1]]])
}

fn layer(tracing_id: &str, typ: AnnotationLayerType) -> AnnotationLayer {
    AnnotationLayer {
        tracing_id: tracing_id.into(),
        typ,
        name: format!("{tracing_id}-name"),
    }
}

#[test]
fn precedence_layer_selection() {
    use AnnotationLayerType::{Skeleton, Volume};
    let annotation = ObjectId::parse("0123456789abcdef01234567").unwrap();
    assert_eq!(precedence_fetch_request(None, &[], Some(3)), Ok(None));
    let volumes = [layer("b", Volume), layer("a", Volume)];
    assert_eq!(
        precedence_fetch_request(None, &volumes, None),
        Err(TracingInitError::PrecedenceLayerNeedsAnnotationId)
    );
    let request = precedence_fetch_request(Some(&annotation), &volumes, Some(3))
        .unwrap()
        .unwrap();
    assert_eq!(
        request,
        PrecedenceFetchRequest {
            annotation_id: annotation.clone(),
            tracing_id: "a".into(),
            layer_name: "a-name".into(),
            typ: Volume,
            version: Some(3),
        }
    );
    let mixed = [
        layer("a", Volume),
        layer("z", Skeleton),
        layer("y", Skeleton),
    ];
    assert_eq!(
        select_layer_with_precedence(&mixed).unwrap().tracing_id,
        "y"
    );
    // UTF-16 order: U+FF5E sorts after U+1F600's surrogate pair (0xD83D).
    let unicode = [layer("\u{FF5E}", Skeleton), layer("\u{1F600}", Skeleton)];
    assert_eq!(
        select_layer_with_precedence(&unicode).unwrap().tracing_id,
        "\u{1F600}"
    );
}

fn visibility(id: i32, value: bool) -> Id32WithBool {
    Id32WithBool { id, value }
}

fn named_box(id: i32) -> NamedBoundingBoxProto {
    NamedBoundingBoxProto {
        id,
        name: Some(format!("box{id}")),
        is_visible: Some(true),
        color: None,
        bounding_box: bbox_proto(&[1, 2, 3, 4, 5, 6]),
    }
}

fn precedence_volume() -> VolumeTracing {
    let source = default_source();
    let mut volume = plan_volume_tracing(&dataset(&source), &params(json!({"typ": "Volume"})))
        .unwrap()
        .build(false, 0)
        .unwrap();
    volume.edit_position = v3(7, 8, 9);
    volume.edit_rotation = Vec3DoubleProto {
        x: 90.0,
        y: 0.0,
        z: 1.5,
    };
    volume.zoom_level = 0.75;
    volume.user_bounding_boxes = vec![named_box(3)];
    volume.user_bounding_box = Some(bbox_proto(&[0, 0, 0, 9, 9, 9]));
    volume.edit_position_additional_coordinates = vec![AdditionalCoordinateProto {
        name: "t".into(),
        value: 2,
    }];
    let state = |user: &str, vis: Vec<Id32WithBool>| VolumeUserStateProto {
        user_id: user.into(),
        active_segment_id: Some(5),
        segment_group_expanded_states: vec![],
        bounding_box_visibilities: vis,
        segment_visibilities: vec![],
    };
    volume.user_states = vec![
        state("u1", vec![visibility(3, false)]),
        state("u2", vec![visibility(3, true)]),
        state("u1", vec![visibility(3, true), visibility(0, false)]),
    ];
    volume
}

#[test]
fn old_precedence_properties_adapt_new_tracings() {
    let properties =
        RedundantTracingProperties::extract(&FetchedPrecedenceTracing::Volume(precedence_volume()));
    assert_eq!(properties.user_bounding_boxes.len(), 2);
    assert_eq!(
        properties.user_bounding_boxes[1],
        NamedBoundingBoxProto {
            id: 0,
            name: None,
            is_visible: None,
            color: None,
            bounding_box: bbox_proto(&[0, 0, 0, 9, 9, 9]),
        }
    );
    // toMap: first position, last value.
    assert_eq!(
        properties.user_state_bounding_box_visibilities,
        vec![
            ("u1".into(), vec![visibility(3, true), visibility(0, false)]),
            ("u2".into(), vec![visibility(3, true)]),
        ]
    );

    let source = default_source();
    let mut skeleton = build_skeleton_tracing(&dataset(&source), 0);
    skeleton.user_states = vec![SkeletonUserStateProto {
        user_id: "u2".into(),
        active_node_id: Some(4),
        tree_group_expanded_states: vec![visibility(1, true)],
        bounding_box_visibilities: vec![],
        tree_visibilities: vec![visibility(9, false)],
    }];
    let adapted = adapt_skeleton_tracing(skeleton.clone(), Some(&properties));
    assert_eq!(adapted.edit_position, v3(7, 8, 9));
    assert_eq!(adapted.edit_rotation.x, 90.0);
    assert_eq!(adapted.zoom_level, 0.75);
    assert_eq!(adapted.user_bounding_boxes, properties.user_bounding_boxes);
    assert_eq!(adapted.edit_position_additional_coordinates.len(), 1);
    assert_eq!(adapted.additional_axes, skeleton.additional_axes);
    assert_eq!(
        adapted.user_states,
        vec![
            SkeletonUserStateProto {
                user_id: "u2".into(),
                active_node_id: Some(4),
                tree_group_expanded_states: vec![visibility(1, true)],
                bounding_box_visibilities: vec![visibility(3, true)],
                tree_visibilities: vec![visibility(9, false)],
            },
            SkeletonUserStateProto {
                user_id: "u1".into(),
                active_node_id: None,
                tree_group_expanded_states: vec![],
                bounding_box_visibilities: vec![visibility(3, true), visibility(0, false)],
                tree_visibilities: vec![],
            },
        ]
    );
    assert_eq!(adapt_skeleton_tracing(skeleton.clone(), None), skeleton);

    let skeleton_precedence =
        RedundantTracingProperties::extract(&FetchedPrecedenceTracing::Skeleton(adapted));
    let fresh = plan_volume_tracing(&dataset(&source), &params(json!({"typ": "Volume"})))
        .unwrap()
        .build(false, 0)
        .unwrap();
    let volume = adapt_volume_tracing(fresh.clone(), Some(&skeleton_precedence));
    assert_eq!(volume.edit_position, v3(7, 8, 9));
    // The skeleton had no legacy userBoundingBox → no extra id-0 box.
    assert_eq!(volume.user_bounding_boxes, properties.user_bounding_boxes);
    assert_eq!(
        volume
            .user_states
            .iter()
            .map(|s| (s.user_id.as_str(), s.active_segment_id))
            .collect::<Vec<_>>(),
        vec![("u2", None), ("u1", None)]
    );
    assert_eq!(volume.mags, fresh.mags);
    assert_eq!(volume.largest_segment_id, Some(0));
    let decoded = VolumeTracing::decode(volume.encode_to_vec().as_slice()).unwrap();
    assert_eq!(decoded, volume);

    let created = create_tracing_for_explorational(
        &dataset(&source),
        &params(json!({"typ": "Volume"})),
        Some(&skeleton_precedence),
        false,
        0,
    )
    .unwrap();
    assert_eq!(created, InitialTracing::Volume(volume));
}

#[test]
fn combine_largest_segment_ids() {
    assert_eq!(
        combine_largest_segment_ids_by_precedence(Some(5), Some(Some(7))),
        Some(5)
    );
    assert_eq!(
        combine_largest_segment_ids_by_precedence(None, Some(None)),
        None
    );
    assert_eq!(
        combine_largest_segment_ids_by_precedence(None, Some(Some(7))),
        Some(7)
    );
    assert_eq!(
        combine_largest_segment_ids_by_precedence(None, None),
        Some(0)
    );
}
