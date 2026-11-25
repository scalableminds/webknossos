//! Bookmark tests from `NMLUnitTestSuite.scala` (writing and parsing round trips).

use super::*;
use crate::annotation::nml::parser::{
    NmlParseContext, NmlParseOutcome, NmlParsedParameters, SharedParsingParameters, parse_nml,
};
use crate::annotation::nml::writer::{
    NmlLayer, NmlLayerTracing, NmlWriteInput, VolumeDataZipFormat, write_nml,
};
use crate::proto::datastore::annotation_bookmark_state_proto::{MappingTypeProto, ViewModeProto};
use crate::proto::datastore::{
    AdditionalCoordinateProto, AnnotationBookmarkStateProto, BookmarkLayerStateProto,
    BookmarkMappingProto, BookmarkMeshProto, BookmarkTdCameraProto, ColorProto, MetadataEntryProto,
    SkeletonTracing, Vec2DoubleProto, Vec3DoubleProto, Vec3IntProto, VolumeTracing,
};
use crate::util::id::ObjectId;
use std::collections::HashSet;

const SKELETON_TRACING_ID: &str = "dummySkeletonTracingId";
const VOLUME_TRACING_ID: &str = "dummyVolumeTracingId";
const VOLUME_LAYER_NAME: &str = "My Volume";

fn v3(x: i32, y: i32, z: i32) -> Vec3IntProto {
    Vec3IntProto { x, y, z }
}

fn d3(x: f64, y: f64, z: f64) -> Vec3DoubleProto {
    Vec3DoubleProto { x, y, z }
}

fn layer(name: &str) -> BookmarkLayerStateProto {
    BookmarkLayerStateProto {
        layer_name: name.to_owned(),
        ..Default::default()
    }
}

fn full_bookmark() -> AnnotationBookmarkProto {
    AnnotationBookmarkProto {
        id: 3,
        created: 1_730_000_000_000,
        name: Some("A <special> \"bookmark\"".to_owned()),
        description: Some("multi\nline".to_owned()),
        state: AnnotationBookmarkStateProto {
            position: v3(1, 2, 3),
            mode: ViewModeProto::Flight as i32,
            zoom_step: 1.25,
            rotation: d3(10.5, 20.0, 30.0),
            active_node_id: Some(1),
            additional_coordinates: vec![AdditionalCoordinateProto {
                name: "t".to_owned(),
                value: 4,
            }],
            natively_rendered_layer_name: Some(VOLUME_TRACING_ID.to_owned()),
            clipping_distance: 55.5,
            clip_skeleton_to_current_section: true,
            td_camera: Some(BookmarkTdCameraProto {
                position: d3(1.5, 2.5, 3.5),
                up: d3(0.0, 0.0, -1.0),
                left: -100.0,
                right: 100.0,
                top: 80.0,
                bottom: -80.0,
            }),
            show_skeletons: Some(false),
            layers: vec![
                BookmarkLayerStateProto {
                    is_disabled: Some(false),
                    intensity_range: Some(Vec2DoubleProto { x: 0.0, y: 255.0 }),
                    color: Some(d3(255.0, 128.0, 0.0)),
                    is_inverted: Some(true),
                    gamma_correction_value: Some(1.5),
                    ..layer("color")
                },
                BookmarkLayerStateProto {
                    mapping: Some(BookmarkMappingProto {
                        mapping_name: VOLUME_TRACING_ID.to_owned(),
                        mapping_type: MappingTypeProto::Agglomerate as i32,
                    }),
                    mesh_file_name: Some("meshfile_1".to_owned()),
                    meshes: vec![
                        BookmarkMeshProto {
                            // The largest uint64 values are negative as Scala Longs.
                            segment_id: u64::MAX - 1,
                            seed_position: v3(4, 5, 6),
                            is_precomputed: true,
                            mesh_file_name: Some("meshfile_1".to_owned()),
                            mapping_name: None,
                            mapping_type: None,
                        },
                        BookmarkMeshProto {
                            segment_id: 7,
                            seed_position: v3(7, 8, 9),
                            is_precomputed: false,
                            mesh_file_name: None,
                            mapping_name: Some("agglomerate_view_5".to_owned()),
                            mapping_type: Some(MappingTypeProto::Json as i32),
                        },
                    ],
                    ..layer(VOLUME_TRACING_ID)
                },
                BookmarkLayerStateProto {
                    is_disabled: Some(true),
                    ..layer(SKELETON_TRACING_ID)
                },
            ],
        },
        created_at_version: 0,
        metadata: vec![
            MetadataEntryProto {
                key: "key".to_owned(),
                string_value: Some("value".to_owned()),
                ..Default::default()
            },
            MetadataEntryProto {
                key: "list".to_owned(),
                string_list_value: vec!["a".to_owned(), "b".to_owned()],
                ..Default::default()
            },
        ],
        thumbnail_saved_at_version: None,
        thumbnail_viewport: Some(ThumbnailViewportProto::Td as i32),
    }
}

fn minimal_bookmark() -> AnnotationBookmarkProto {
    AnnotationBookmarkProto {
        id: 5,
        created: 1,
        name: None,
        description: None,
        state: AnnotationBookmarkStateProto {
            position: v3(0, 0, 0),
            mode: ViewModeProto::Orthogonal as i32,
            zoom_step: 1.0,
            rotation: d3(0.0, 0.0, 0.0),
            clipping_distance: 50.0,
            clip_skeleton_to_current_section: false,
            ..Default::default()
        },
        created_at_version: 0,
        metadata: Vec::new(),
        thumbnail_saved_at_version: None,
        thumbnail_viewport: None,
    }
}

fn to_write(
    bookmark: AnnotationBookmarkProto,
    thumbnails: &[BookmarkThumbnailSize],
) -> NmlAnnotationBookmarkToWrite {
    NmlAnnotationBookmarkToWrite {
        bookmark,
        thumbnails: thumbnails.iter().map(|size| (*size, vec![1])).collect(),
    }
}

fn write(
    bookmarks: &[NmlAnnotationBookmarkToWrite],
    dataset_layer_names: Option<&HashSet<String>>,
) -> String {
    let dataset_id = ObjectId::parse("66f0a1b2c3d4e5f6a7b8c9e0").unwrap();
    let owner = ObjectId::parse("66f0a1b2c3d4e5f6a7b8c9e1").unwrap();
    let skeleton = SkeletonTracing {
        dataset_name: "ds".to_owned(),
        ..Default::default()
    };
    let volume = VolumeTracing::default();
    let layers = vec![
        NmlLayer {
            tracing_id: SKELETON_TRACING_ID,
            name: "Skeleton",
            tracing: NmlLayerTracing::Skeleton(&skeleton),
            has_edited_mapping_edges: false,
            base_mapping_name: None,
        },
        NmlLayer {
            tracing_id: VOLUME_TRACING_ID,
            name: VOLUME_LAYER_NAME,
            tracing: NmlLayerTracing::Volume(&volume),
            has_edited_mapping_edges: false,
            base_mapping_name: None,
        },
    ];
    write_nml(&NmlWriteInput {
        layers,
        annotation_user_states: &[],
        requesting_user_id: None,
        annotation_owner_id: &owner,
        annotation_owner_name: "Sample User",
        annotation: None,
        task_id: None,
        voxel_size: None,
        volume_filename: None,
        organization_id: "org",
        wk_url: "http://x",
        dataset_name: "ds",
        dataset_id: &dataset_id,
        skip_volume_data: true,
        volume_data_zip_format: VolumeDataZipFormat::Wkw,
        writer_git_commit: "",
        timestamp_millis: 0,
        bookmarks,
        dataset_layer_names,
    })
    .unwrap()
}

fn parse(xml: &str) -> NmlParseOutcome {
    let params = SharedParsingParameters {
        user_organization_id: "org".to_owned(),
        ..Default::default()
    };
    let context = NmlParseContext {
        now_millis: 0,
        task_bounding_box_color: ColorProto {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        },
    };
    parse_nml("test.nml", xml.as_bytes(), &params, &context)
}

fn parsed(xml: &str) -> NmlParsedParameters {
    match parse(xml) {
        NmlParseOutcome::Parsed(parsed) => *parsed,
        other => panic!("expected success, got {other:?}"),
    }
}

fn failure(xml: &str) -> String {
    match parse(xml) {
        NmlParseOutcome::Failure(message) => message,
        other => panic!("expected failure, got {other:?}"),
    }
}

/// Replaces the encoded references to the NML layers with the tracingIds used in the test.
fn decode_layer_references(bookmark: &AnnotationBookmarkProto) -> AnnotationBookmarkProto {
    let decode = |name: &str| match NmlAnnotationLayerRef::decode(name) {
        Some(NmlAnnotationLayerRef::Volume(volume)) if volume == VOLUME_LAYER_NAME => {
            Some(VOLUME_TRACING_ID.to_owned())
        }
        Some(NmlAnnotationLayerRef::Skeleton) => Some(SKELETON_TRACING_ID.to_owned()),
        Some(_) => None,
        None => Some(name.to_owned()),
    };
    rewrite_layer_references(bookmark.clone(), decode, decode)
}

#[test]
fn round_trip_yields_the_same_bookmarks_with_references_to_the_nml_layers() {
    let xml = write(
        &[
            to_write(full_bookmark(), &[BookmarkThumbnailSize::Small]),
            to_write(minimal_bookmark(), &[]),
        ],
        None,
    );
    let parsed = parsed(&xml);
    let decoded: Vec<AnnotationBookmarkProto> = parsed
        .bookmarks
        .iter()
        .map(|b| decode_layer_references(&b.bookmark))
        .collect();
    assert_eq!(decoded, vec![full_bookmark(), minimal_bookmark()]);
    assert_eq!(
        NmlAnnotationLayerRef::decode(&parsed.bookmarks[0].bookmark.state.layers[1].layer_name),
        Some(NmlAnnotationLayerRef::Volume(VOLUME_LAYER_NAME.to_owned()))
    );
    let locations: Vec<_> = parsed
        .bookmarks
        .iter()
        .map(|b| b.thumbnail_locations.clone())
        .collect();
    assert_eq!(
        locations,
        vec![
            BTreeMap::from([(
                BookmarkThumbnailSize::Small,
                thumbnail_location(3, BookmarkThumbnailSize::Small)
            )]),
            BTreeMap::new(),
        ]
    );
}

#[test]
fn writes_the_bookmark_xml_like_scala() {
    let xml = write(
        &[to_write(
            full_bookmark(),
            &[BookmarkThumbnailSize::Small, BookmarkThumbnailSize::Large],
        )],
        None,
    );
    let start = xml.find("  <bookmarks>").unwrap();
    assert_eq!(
        &xml[start..],
        r#"  <bookmarks>
    <bookmark id="3" name="A &lt;special> &quot;bookmark&quot;" description="multi&#xa;line" created="1730000000000">
      <thumbnail size="large" viewport="3d" location="bookmark_thumbnails/3_large.jpg"/>
      <thumbnail size="small" viewport="3d" location="bookmark_thumbnails/3_small.jpg"/>
      <metadata>
        <metadataEntry key="key" stringValue="value"/>
        <metadataEntry key="list" stringListValue-0="a" stringListValue-1="b"/>
      </metadata>
      <state mode="flight" zoomStep="1.25" clippingDistance="55.5" clipSkeletonToCurrentSection="true" activeNodeId="1" showSkeletons="false">
        <position x="1" y="2" z="3" additionalCoordinate-t="4"/>
        <rotation xRot="10.5" yRot="20.0" zRot="30.0"/>
        <nativelyRenderedLayer volumeLayer="My Volume"/>
        <tdCamera left="-100.0" right="100.0" top="80.0" bottom="-80.0">
          <position x="1.5" y="2.5" z="3.5"/>
          <up x="0.0" y="0.0" z="-1.0"/>
        </tdCamera>
        <layer datasetLayer="color" isDisabled="false" isInverted="true" gammaCorrectionValue="1.5">
          <intensityRange min="0.0" max="255.0"/>
          <color r="255.0" g="128.0" b="0.0"/>
        </layer>
        <layer volumeLayer="My Volume" meshFileName="meshfile_1">
          <mapping editableMappingOfVolumeLayer="My Volume" mappingType="AGGLOMERATE"/>
          <mesh segmentId="18446744073709551614" isPrecomputed="true" meshFileName="meshfile_1">
            <seedPosition x="4" y="5" z="6"/>
          </mesh>
          <mesh segmentId="7" isPrecomputed="false" mappingName="agglomerate_view_5" mappingType="JSON">
            <seedPosition x="7" y="8" z="9"/>
          </mesh>
        </layer>
        <layer skeletonLayer="true" isDisabled="true"/>
      </state>
    </bookmark>
  </bookmarks>
</things>"#
    );
}

#[test]
fn does_not_write_the_versions_of_bookmarks() {
    let bookmark = AnnotationBookmarkProto {
        created_at_version: 12,
        thumbnail_saved_at_version: Some(13),
        ..minimal_bookmark()
    };
    let parsed = parsed(&write(&[to_write(bookmark, &[])], None));
    let bookmarks: Vec<_> = parsed.bookmarks.into_iter().map(|b| b.bookmark).collect();
    assert_eq!(bookmarks, vec![minimal_bookmark()]);
}

#[test]
fn drops_references_to_layers_that_do_not_exist() {
    let mut bookmark = minimal_bookmark();
    bookmark.state.natively_rendered_layer_name = Some("deletedVolumeTracingId".to_owned());
    bookmark.state.layers = vec![
        layer("color"),
        layer("deletedVolumeTracingId"),
        layer(VOLUME_TRACING_ID),
    ];
    let dataset_layer_names = HashSet::from(["color".to_owned()]);
    let parsed = parsed(&write(
        &[to_write(bookmark, &[])],
        Some(&dataset_layer_names),
    ));
    let state = decode_layer_references(&parsed.bookmarks[0].bookmark).state;
    assert_eq!(state.natively_rendered_layer_name, None);
    let names: Vec<_> = state.layers.iter().map(|l| l.layer_name.as_str()).collect();
    assert_eq!(names, vec!["color", VOLUME_TRACING_ID]);
}

#[test]
fn does_not_write_the_thumbnail_viewport_of_bookmarks_without_thumbnails() {
    let bookmark = AnnotationBookmarkProto {
        thumbnail_viewport: Some(ThumbnailViewportProto::Xy as i32),
        ..minimal_bookmark()
    };
    let parsed = parsed(&write(&[to_write(bookmark, &[])], None));
    let bookmarks: Vec<_> = parsed.bookmarks.into_iter().map(|b| b.bookmark).collect();
    assert_eq!(bookmarks, vec![minimal_bookmark()]);
}

#[test]
fn ignores_different_or_unknown_thumbnail_viewports_but_keeps_the_thumbnails() {
    let bookmark = AnnotationBookmarkProto {
        thumbnail_viewport: Some(ThumbnailViewportProto::Xy as i32),
        ..minimal_bookmark()
    };
    let xml = write(
        &[to_write(
            bookmark,
            &[BookmarkThumbnailSize::Small, BookmarkThumbnailSize::Large],
        )],
        None,
    );
    let with_different = xml.replacen(r#"viewport="xy""#, r#"viewport="yz""#, 1);
    let with_unknown = xml.replace(r#"viewport="xy""#, r#"viewport="unknown""#);
    assert!(with_different != xml && with_unknown != xml);
    for xml in [with_different, with_unknown] {
        let parsed = parsed(&xml);
        assert_eq!(parsed.bookmarks.len(), 1);
        assert_eq!(parsed.bookmarks[0].bookmark.thumbnail_viewport, None);
        assert_eq!(parsed.bookmarks[0].thumbnail_locations.len(), 2);
    }
}

#[test]
fn only_accepts_jpeg_thumbnails() {
    assert!(is_jpeg(&[0xff, 0xd8, 0xff, 0xe0]));
    assert!(!is_jpeg(&[0x89, 0x50, 0x4e, 0x47]));
    assert!(!is_jpeg(b"RIFF\0\0\0\0WEBP"));
    assert!(!is_jpeg(&[]));
}

#[test]
fn fails_for_duplicate_bookmark_ids() {
    let xml = write(
        &[
            to_write(minimal_bookmark(), &[]),
            to_write(minimal_bookmark(), &[]),
        ],
        None,
    );
    assert_eq!(failure(&xml), "Bookmark ids must be unique.");
}

#[test]
fn fails_for_a_bookmark_without_position() {
    let xml = write(&[to_write(minimal_bookmark(), &[])], None);
    let start = xml.find("<position ").unwrap();
    let end = start + xml[start..].find("/>").unwrap() + 2;
    let without_position = format!("{}{}", &xml[..start], &xml[end..]);
    assert_eq!(
        failure(&without_position),
        "Invalid bookmark elements. <~ Invalid state of bookmark 5. <~ Missing or invalid position."
    );
}

#[test]
fn fails_for_invalid_bookmark_ids() {
    let xml = write(&[to_write(minimal_bookmark(), &[])], None)
        .replace(r#"<bookmark id="5""#, r#"<bookmark id="x""#);
    assert_eq!(
        failure(&xml),
        "Invalid bookmark elements. <~ Invalid bookmark id “x”."
    );
}

#[test]
fn layer_references_round_trip_and_cannot_collide_with_names() {
    for layer_ref in [
        NmlAnnotationLayerRef::Volume("Volume".to_owned()),
        NmlAnnotationLayerRef::Skeleton,
    ] {
        assert_eq!(
            NmlAnnotationLayerRef::decode(&layer_ref.encode()),
            Some(layer_ref)
        );
    }
    assert_eq!(NmlAnnotationLayerRef::decode("volume:Volume"), None);
    assert_eq!(NmlAnnotationLayerRef::decode("skeleton"), None);
}

#[test]
fn rewrite_drops_mappings_and_meshes_of_dropped_mappings() {
    let mut bookmark = full_bookmark();
    bookmark.state.layers[1].layer_name = "segmentation".to_owned();
    let rewritten = rewrite_layer_references(
        bookmark,
        |name| (name != SKELETON_TRACING_ID).then(|| name.to_owned()),
        |name| (name == "agglomerate_view_5").then(|| name.to_owned()),
    );
    let layers = &rewritten.state.layers;
    assert_eq!(layers.len(), 2);
    assert_eq!(layers[1].mapping, None);
    // The precomputed mesh has no mapping and stays.
    assert_eq!(layers[1].meshes.len(), 2);
    assert_eq!(
        rewritten.state.natively_rendered_layer_name.as_deref(),
        Some(VOLUME_TRACING_ID)
    );
}

#[test]
fn thumbnail_names() {
    assert_eq!(
        thumbnail_location(3, BookmarkThumbnailSize::Large),
        "bookmark_thumbnails/3_large.jpg"
    );
    assert_eq!(
        BookmarkThumbnailSize::from_name("small"),
        Some(BookmarkThumbnailSize::Small)
    );
    assert_eq!(BookmarkThumbnailSize::from_name("Small"), None);
    assert_eq!(
        thumbnail_viewport_from_string("3d"),
        Some(ThumbnailViewportProto::Td)
    );
    assert_eq!(thumbnail_viewport_to_string(99), None);
}
