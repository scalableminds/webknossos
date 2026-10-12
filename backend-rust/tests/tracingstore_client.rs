mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    body::to_bytes,
    extract::{Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use common::TestDb;
use prost::Message;
use serde_json::{Value, json};
use webknossos_backend::{
    error::ApiError,
    id::ObjectId,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    service_clients::{ServiceClientConfig, ServiceError},
    tracingstore_client::{
        BoundingBox, MergeRequest, NamedBoundingBox, TracingStoreClient, TracingStoreError,
        decode_annotation_proto, first_tracing_store_url,
    },
};

const TOKEN: &str = "rpc-secret-for-tracingstore-tests";

#[derive(Debug, Clone)]
struct Observed {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    content_type: Option<String>,
    body: Value,
    raw_body: Vec<u8>,
}

type MockResponse = (StatusCode, Vec<u8>);

#[derive(Clone, Default)]
struct Mock {
    requests: Arc<Mutex<Vec<Observed>>>,
    /// Response for the next requests: status and raw bytes.
    response: Arc<Mutex<Option<MockResponse>>>,
    delay: Arc<Mutex<Duration>>,
}

async fn handler(State(mock): State<Mock>, request: Request) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_owned();
    let query = url::form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes())
        .into_owned()
        .collect();
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    mock.requests.lock().unwrap().push(Observed {
        method,
        path,
        query,
        content_type,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        raw_body: bytes.to_vec(),
    });
    let delay = *mock.delay.lock().unwrap();
    tokio::time::sleep(delay).await;
    let (status, body) = mock
        .response
        .lock()
        .unwrap()
        .clone()
        .unwrap_or((StatusCode::OK, Vec::new()));
    (
        status,
        [(header::CONTENT_TYPE, "application/x-protobuf")],
        body,
    )
        .into_response()
}

async fn server() -> (String, Mock) {
    let mock = Mock::default();
    let router = Router::new()
        .route("/{*path}", any(handler))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}"), mock)
}

fn config(timeout: Duration) -> ServiceClientConfig {
    ServiceClientConfig {
        request_timeout: timeout,
        connect_timeout: Duration::from_secs(2),
        max_response_bytes: 64 * 1024,
        rpc_token: TOKEN.to_owned(),
    }
}

fn annotation_proto() -> AnnotationProto {
    AnnotationProto {
        description: String::new(),
        version: 7,
        annotation_layers: vec![
            AnnotationLayerProto {
                tracing_id: "skeleton-tracing".to_owned(),
                name: "Skeleton".to_owned(),
                typ: AnnotationLayerTypeProto::Skeleton as i32,
            },
            AnnotationLayerProto {
                tracing_id: "volume-tracing".to_owned(),
                name: "Volume".to_owned(),
                typ: AnnotationLayerTypeProto::Volume as i32,
            },
        ],
        earliest_accessible_version: 0,
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: Some(false),
        user_states: Vec::new(),
    }
}

fn query_value<'a>(observed: &'a Observed, key: &str) -> Vec<&'a str> {
    observed
        .query
        .iter()
        .filter(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
        .collect()
}

#[tokio::test]
async fn get_annotation_proto_sends_token_and_version_and_decodes_real_protobuf() {
    let (base, mock) = server().await;
    let expected = annotation_proto();
    *mock.response.lock().unwrap() = Some((StatusCode::OK, expected.encode_to_vec()));
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let id = ObjectId::parse("0123456789ABCDEF01234567").unwrap();

    let decoded = client
        .get_annotation_proto(&base, &id, Some(3))
        .await
        .unwrap();
    assert_eq!(decoded, expected);
    let unversioned = client.get_annotation_proto(&base, &id, None).await.unwrap();
    assert_eq!(unversioned, expected);

    let requests = mock.requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].method, "GET");
    assert_eq!(
        requests[0].path,
        "/tracings/annotation/0123456789abcdef01234567"
    );
    assert_eq!(query_value(&requests[0], "token"), [TOKEN]);
    assert_eq!(query_value(&requests[0], "version"), ["3"]);
    assert_eq!(requests[0].query.len(), 2);
    assert_eq!(query_value(&requests[1], "token"), [TOKEN]);
    assert!(query_value(&requests[1], "version").is_empty());
}

#[tokio::test]
async fn merge_posts_exact_query_and_json_body_and_returns_annotation_proto() {
    let (base, mock) = server().await;
    let expected = annotation_proto();
    *mock.response.lock().unwrap() = Some((StatusCode::OK, expected.encode_to_vec()));
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let ids: Vec<ObjectId> = (0..4)
        .map(|i| ObjectId::parse(&format!("{i:024x}")).unwrap())
        .collect();
    let request = MergeRequest {
        annotation_ids: vec![ids[0].clone(), ids[1].clone()],
        owner_ids: vec![ids[2].clone(), ids[2].clone()],
        additional_bounding_boxes: vec![
            NamedBoundingBox {
                id: 0,
                name: Some("Task bounding box of instance a of task b".to_owned()),
                is_visible: None,
                color: None,
                bounding_box: BoundingBox {
                    top_left: [-1, 2, 3],
                    width: 10,
                    height: 20,
                    depth: 30,
                },
            },
            NamedBoundingBox {
                id: 4,
                name: None,
                is_visible: Some(false),
                color: Some([0.5, 0.25, 1.0, 1.0]),
                bounding_box: BoundingBox {
                    top_left: [0, 0, 0],
                    width: 1,
                    height: 1,
                    depth: 1,
                },
            },
            NamedBoundingBox {
                id: 5,
                name: None,
                is_visible: Some(true),
                color: Some([0.5, 0.25, 1.0, 0.5]),
                bounding_box: BoundingBox {
                    top_left: [0, 0, 0],
                    width: 0,
                    height: 0,
                    depth: 0,
                },
            },
        ],
        new_annotation_id: ids[3].clone(),
        to_temporary_store: true,
        requesting_user_id: ids[2].clone(),
        remap_segment_ids: true,
    };

    let merged = client
        .merge_annotations_by_ids(&base, &request)
        .await
        .unwrap();
    assert_eq!(merged, expected);

    let observed = mock.requests.lock().unwrap()[0].clone();
    assert_eq!(observed.method, "POST");
    assert_eq!(observed.path, "/tracings/annotation/mergedFromIds");
    assert_eq!(observed.content_type.as_deref(), Some("application/json"));
    assert_eq!(query_value(&observed, "token"), [TOKEN]);
    assert_eq!(query_value(&observed, "toTemporaryStore"), ["true"]);
    assert_eq!(query_value(&observed, "newAnnotationId"), [ids[3].as_str()]);
    assert_eq!(
        query_value(&observed, "requestingUserId"),
        [ids[2].as_str()]
    );
    assert_eq!(query_value(&observed, "remapSegmentIds"), ["true"]);
    assert_eq!(observed.query.len(), 5);
    assert_eq!(
        observed.body,
        json!({
            "annotationIds": [ids[0].as_str(), ids[1].as_str()],
            "ownerIds": [ids[2].as_str(), ids[2].as_str()],
            "additionalBoundingBoxes": [
                {"id":0,"name":"Task bounding box of instance a of task b",
                 "boundingBox":{"topLeft":[-1,2,3],"width":10,"height":20,"depth":30}},
                {"id":4,"isVisible":false,"color":[0.5,0.25,1.0],
                 "boundingBox":{"topLeft":[0,0,0],"width":1,"height":1,"depth":1}},
                {"id":5,"isVisible":true,"color":[0.5,0.25,1.0,0.5],
                 "boundingBox":{"topLeft":[0,0,0],"width":0,"height":0,"depth":0}}
            ]
        })
    );

    let flags_off = MergeRequest {
        to_temporary_store: false,
        remap_segment_ids: false,
        additional_bounding_boxes: Vec::new(),
        ..request
    };
    client
        .merge_annotations_by_ids(&base, &flags_off)
        .await
        .unwrap();
    let observed = mock.requests.lock().unwrap()[1].clone();
    assert_eq!(query_value(&observed, "toTemporaryStore"), ["false"]);
    assert_eq!(query_value(&observed, "remapSegmentIds"), ["false"]);
    assert_eq!(observed.body["additionalBoundingBoxes"], json!([]));
}

#[tokio::test]
async fn upstream_failures_keep_status_and_hide_bodies_tokens_and_urls() {
    let (base, mock) = server().await;
    *mock.response.lock().unwrap() = Some((
        StatusCode::NOT_FOUND,
        b"secret upstream annotation body".to_vec(),
    ));
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let id = ObjectId::new();
    let error = client
        .get_annotation_proto(&base, &id, None)
        .await
        .unwrap_err();
    assert_eq!(
        error,
        TracingStoreError::Service(ServiceError::UpstreamStatus(404))
    );
    let api: ApiError = error.into();
    assert_eq!(api.status, StatusCode::NOT_FOUND);
    for secret in ["secret upstream", TOKEN, base.as_str()] {
        assert!(!api.message.contains(secret), "{}", api.message);
    }
    assert!(!format!("{client:?}").contains(TOKEN));
}

#[tokio::test]
async fn invalid_protobuf_responses_are_rejected_like_scalapb() {
    let (base, mock) = server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let id = ObjectId::new();

    let mut unknown_type = annotation_proto();
    unknown_type.annotation_layers[0].typ = 9;
    // Required fields (description, version, earliestAccessibleVersion) at
    // default values are still emitted by prost for proto2 `required`; build
    // messages without them by hand.
    let missing_version = {
        let mut bytes = Vec::new();
        prost::encoding::string::encode(1, &String::new(), &mut bytes);
        prost::encoding::int64::encode(4, &0, &mut bytes);
        bytes
    };
    let layer_missing_name = {
        let mut layer = Vec::new();
        prost::encoding::string::encode(1, &"tracing".to_owned(), &mut layer);
        prost::encoding::int32::encode(3, &1, &mut layer);
        let mut bytes = annotation_proto_without_layers();
        prost::encoding::bytes::encode(3, &layer, &mut bytes);
        bytes
    };
    for body in [
        b"\xff\xff\xff not protobuf".to_vec(),
        unknown_type.encode_to_vec(),
        missing_version,
        layer_missing_name,
    ] {
        *mock.response.lock().unwrap() = Some((StatusCode::OK, body));
        let error = client
            .get_annotation_proto(&base, &id, None)
            .await
            .unwrap_err();
        assert_eq!(error, TracingStoreError::InvalidProtobuf);
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    }

    // Optional fields and empty repeated fields may be absent.
    assert!(decode_annotation_proto(&annotation_proto_without_layers()).is_ok());
}

fn annotation_proto_without_layers() -> Vec<u8> {
    let mut bytes = Vec::new();
    prost::encoding::string::encode(1, &String::new(), &mut bytes);
    prost::encoding::int64::encode(2, &0, &mut bytes);
    prost::encoding::int64::encode(4, &0, &mut bytes);
    bytes
}

#[test]
fn scala_pb_wire_corpus_preserves_nested_required_fields() {
    // Accepted/rejected by the compiled repository ScalaPB parser using
    // tools/AnnotationProtoOracle.java. No JVM is required to run this test.
    let corpus: Value =
        serde_json::from_str(include_str!("fixtures/annotation_proto_scala.json")).unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let hex = case["hex"].as_str().unwrap();
        assert_eq!(hex.len() % 2, 0);
        let bytes: Vec<u8> = hex
            .as_bytes()
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
        let decoded = decode_annotation_proto(&bytes);
        assert_eq!(
            decoded.is_ok(),
            case["accepted"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
        if case["name"] == "complete" {
            let annotation = decoded.unwrap();
            assert_eq!(annotation.version, 42);
            assert_eq!(annotation.earliest_accessible_version, 3);
            let state = &annotation.user_states[0];
            assert_eq!(state.user_id, "0123456789abcdef01234567");
            assert_eq!(state.edit_position.x, -3);
            assert_eq!(state.edit_position.y, 0);
            assert_eq!(state.edit_position.z, 12);
            assert_eq!(state.edit_rotation.y, -0.5);
            assert_eq!(state.zoom_level, 1.5);
            assert_eq!(state.edit_position_additional_coordinates[0].name, "t");
            assert_eq!(state.edit_position_additional_coordinates[0].value, 0);
        }
    }
}

#[tokio::test]
async fn merge_uses_the_long_timeout_and_reads_use_the_normal_timeout() {
    let (base, mock) = server().await;
    *mock.response.lock().unwrap() = Some((StatusCode::OK, annotation_proto().encode_to_vec()));
    *mock.delay.lock().unwrap() = Duration::from_millis(300);
    let client = TracingStoreClient::with_long_timeout(
        config(Duration::from_millis(100)),
        Duration::from_secs(5),
    )
    .unwrap();
    let id = ObjectId::new();
    assert_eq!(
        client
            .get_annotation_proto(&base, &id, None)
            .await
            .unwrap_err(),
        TracingStoreError::Service(ServiceError::Timeout)
    );
    let request = MergeRequest {
        annotation_ids: vec![id.clone()],
        owner_ids: vec![id.clone()],
        additional_bounding_boxes: Vec::new(),
        new_annotation_id: ObjectId::new(),
        to_temporary_store: true,
        requesting_user_id: id,
        remap_segment_ids: true,
    };
    assert!(
        client
            .merge_annotations_by_ids(&base, &request)
            .await
            .is_ok()
    );
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn first_tracing_store_url_uses_internal_url_of_live_store() {
    let db = TestDb::new().await;
    let error = first_tracing_store_url(&db.pool).await.unwrap_err();
    assert_eq!(error.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error.message,
        "Tracing store could not be found or accessed."
    );
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key,isDeleted) VALUES('a-deleted','http://deleted.internal','https://deleted.example.test','k',true),('b-live','http://tracing.internal:9050','https://tracing.example.test','k',false)")
        .execute(&db.pool).await.unwrap();
    assert_eq!(
        first_tracing_store_url(&db.pool).await.unwrap(),
        "http://tracing.internal:9050"
    );
    db.cleanup().await;
}

// ---- TI2a: tracing save/get RPCs ------------------------------------------

use webknossos_backend::{
    annotation_provider::AnnotationDataSourceStore,
    proto::{
        ColorProto, NamedBoundingBoxProto, Vec3DoubleProto, Vec3IntProto,
        datastore::{
            AdditionalAxisProto, AdditionalCoordinateProto, Edge, Id32WithBool, Id64WithBool,
            MetadataEntryProto, Node, Segment, SegmentGroup, SkeletonTracing,
            SkeletonUserStateProto, Tree, TreeGroup, Vec2IntProto, VolumeTracing,
            VolumeUserStateProto,
        },
    },
    tracingstore_client::{VolumeSaveDataSource, decode_skeleton_tracing, decode_volume_tracing},
};

fn skeleton_tracing() -> SkeletonTracing {
    SkeletonTracing {
        dataset_name: "ds".to_owned(),
        trees: vec![Tree {
            tree_id: 1,
            nodes: vec![Node {
                id: 0,
                position: Vec3IntProto { x: 0, y: -1, z: 2 },
                rotation: Vec3DoubleProto {
                    x: 0.0,
                    y: 0.5,
                    z: 0.0,
                },
                radius: 1.5,
                additional_coordinates: vec![AdditionalCoordinateProto {
                    name: "t".to_owned(),
                    value: 0,
                }],
                ..Default::default()
            }],
            edges: vec![Edge {
                source: 0,
                target: 0,
            }],
            color: Some(ColorProto {
                r: 1.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            }),
            name: "tree".to_owned(),
            metadata: vec![MetadataEntryProto {
                key: "k".to_owned(),
                string_value: Some("v".to_owned()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        created_timestamp: 1_700_000_000_000,
        edit_position: Vec3IntProto {
            x: 10,
            y: 20,
            z: 30,
        },
        zoom_level: 1.0,
        tree_groups: vec![TreeGroup {
            name: "root".to_owned(),
            group_id: 1,
            children: vec![TreeGroup {
                name: "child".to_owned(),
                group_id: 2,
                ..Default::default()
            }],
            is_expanded: Some(true),
        }],
        user_bounding_boxes: vec![NamedBoundingBoxProto {
            id: 1,
            color: Some(ColorProto {
                r: 0.0,
                g: 1.0,
                b: 0.0,
                a: 0.5,
            }),
            ..Default::default()
        }],
        additional_axes: vec![AdditionalAxisProto {
            name: "t".to_owned(),
            index: 0,
            bounds: Vec2IntProto { x: 0, y: 5 },
        }],
        user_states: vec![SkeletonUserStateProto {
            user_id: "0123456789abcdef01234567".to_owned(),
            tree_visibilities: vec![Id32WithBool {
                id: 1,
                value: false,
            }],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn volume_tracing() -> VolumeTracing {
    VolumeTracing {
        created_timestamp: 1_700_000_000_000,
        dataset_name: "ds".to_owned(),
        element_class: 4,
        fallback_layer: Some("segmentation".to_owned()),
        largest_segment_id: Some(0),
        zoom_level: 1.0,
        mags: vec![
            Vec3IntProto { x: 1, y: 1, z: 1 },
            Vec3IntProto { x: 2, y: 2, z: 1 },
        ],
        segments: vec![Segment {
            segment_id: 7,
            anchor_position: Some(Vec3IntProto { x: 1, y: 2, z: 3 }),
            ..Default::default()
        }],
        segment_groups: vec![SegmentGroup {
            name: "g".to_owned(),
            group_id: 0,
            children: vec![SegmentGroup {
                name: "h".to_owned(),
                group_id: 1,
                ..Default::default()
            }],
            ..Default::default()
        }],
        has_segment_index: Some(true),
        user_states: vec![VolumeUserStateProto {
            user_id: "0123456789abcdef01234567".to_owned(),
            segment_visibilities: vec![Id64WithBool {
                id: u64::MAX,
                value: true,
            }],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn read_field(bytes: &mut &[u8]) -> (u32, prost::encoding::WireType, Vec<u8>, Option<Vec<u8>>) {
    use prost::encoding::{WireType, decode_key, decode_varint};
    let start = *bytes;
    let (tag, wire_type) = decode_key(bytes).unwrap();
    let payload = match wire_type {
        WireType::Varint => {
            decode_varint(bytes).unwrap();
            None
        }
        WireType::SixtyFourBit => {
            *bytes = &bytes[8..];
            None
        }
        WireType::ThirtyTwoBit => {
            *bytes = &bytes[4..];
            None
        }
        WireType::LengthDelimited => {
            let length = decode_varint(bytes).unwrap() as usize;
            let payload = bytes[..length].to_vec();
            *bytes = &bytes[length..];
            Some(payload)
        }
        WireType::StartGroup | WireType::EndGroup => unreachable!(),
    };
    let raw = start[..start.len() - bytes.len()].to_vec();
    (tag, wire_type, raw, payload)
}

/// Rewrite the message reached by following the first occurrence of each tag
/// of `path` from the encoded root message.
fn edit_nested(bytes: &[u8], path: &[u32], edit: &dyn Fn(&[u8]) -> Vec<u8>) -> Vec<u8> {
    let Some((head, rest)) = path.split_first() else {
        return edit(bytes);
    };
    let mut input = bytes;
    let mut output = Vec::new();
    let mut done = false;
    while !input.is_empty() {
        let (tag, _, raw, payload) = read_field(&mut input);
        match payload {
            Some(payload) if tag == *head && !done => {
                done = true;
                prost::encoding::bytes::encode(
                    tag,
                    &edit_nested(&payload, rest, edit),
                    &mut output,
                );
            }
            _ => output.extend_from_slice(&raw),
        }
    }
    assert!(done, "path {path:?} not present");
    output
}

fn without_tag(tag: u32) -> impl Fn(&[u8]) -> Vec<u8> {
    move |bytes| {
        let mut input = bytes;
        let mut output = Vec::new();
        let mut removed = false;
        while !input.is_empty() {
            let (field_tag, _, raw, _) = read_field(&mut input);
            if field_tag == tag {
                removed = true;
            } else {
                output.extend_from_slice(&raw);
            }
        }
        assert!(removed, "tag {tag} not present");
        output
    }
}

fn with_unknown_group(bytes: &[u8]) -> Vec<u8> {
    use prost::encoding::{WireType, encode_key};
    let mut output = bytes.to_vec();
    encode_key(99, WireType::StartGroup, &mut output);
    encode_key(99, WireType::EndGroup, &mut output);
    output
}

#[test]
fn skeleton_and_volume_decoders_round_trip_complete_messages_and_explicit_zeros() {
    let skeleton = skeleton_tracing();
    assert_eq!(
        decode_skeleton_tracing(&skeleton.encode_to_vec()).unwrap(),
        skeleton
    );
    let volume = volume_tracing();
    assert_eq!(
        decode_volume_tracing(&volume.encode_to_vec()).unwrap(),
        volume
    );
    // Default messages still carry every required field (prost emits proto2
    // required scalars even at their default values).
    assert!(decode_skeleton_tracing(&SkeletonTracing::default().encode_to_vec()).is_ok());
    assert!(decode_volume_tracing(&VolumeTracing::default().encode_to_vec()).is_ok());
    // ScalaPB keeps unrecognized enum values; so does prost.
    let unknown_element_class = VolumeTracing {
        element_class: 99,
        ..volume_tracing()
    };
    assert_eq!(
        decode_volume_tracing(&unknown_element_class.encode_to_vec())
            .unwrap()
            .element_class,
        99
    );
    // Unknown varint / length-delimited fields are ignored like ScalaPB.
    let mut unknown = skeleton.encode_to_vec();
    prost::encoding::int32::encode(99, &5, &mut unknown);
    prost::encoding::string::encode(98, &"x".to_owned(), &mut unknown);
    assert!(decode_skeleton_tracing(&unknown).is_ok());
}

#[test]
fn skeleton_decoder_rejects_missing_required_fields_at_every_nesting_level() {
    let bytes = skeleton_tracing().encode_to_vec();
    let cases: &[(&[u32], u32)] = &[
        (&[], 1),         // datasetName
        (&[], 3),         // createdTimestamp
        (&[], 6),         // editPosition
        (&[], 7),         // editRotation
        (&[], 8),         // zoomLevel
        (&[], 9),         // version
        (&[6], 2),        // editPosition.y
        (&[7], 3),        // editRotation.z
        (&[2], 1),        // tree.treeId
        (&[2], 7),        // tree.name
        (&[2], 8),        // tree.createdTimestamp
        (&[2, 2], 9),     // node.createdTimestamp
        (&[2, 2], 2),     // node.position
        (&[2, 2, 2], 1),  // node.position.x
        (&[2, 2, 3], 2),  // node.rotation.y
        (&[2, 2, 10], 2), // node.additionalCoordinates.value
        (&[2, 3], 2),     // edge.target
        (&[2, 4], 4),     // tree.color.a
        (&[2, 13], 1),    // metadata.key
        (&[11], 2),       // treeGroup.groupId
        (&[11, 3], 1),    // treeGroup.children.name (recursive)
        (&[12], 5),       // userBoundingBox.boundingBox
        (&[12, 5, 1], 3), // userBoundingBox.boundingBox.topLeft.z
        (&[12, 4], 1),    // userBoundingBox.color.r
        (&[22, 3], 2),    // additionalAxis.bounds.y
        (&[24], 1),       // userState.userId
        (&[24, 5], 2),    // userState.treeVisibilities.value
    ];
    for (path, tag) in cases {
        let malformed = edit_nested(&bytes, path, &without_tag(*tag));
        assert_eq!(
            decode_skeleton_tracing(&malformed),
            Err(TracingStoreError::InvalidProtobuf),
            "{path:?}/{tag}"
        );
    }
    for path in [&[][..], &[2, 2][..], &[11, 3][..]] {
        let malformed = edit_nested(&bytes, path, &with_unknown_group);
        assert_eq!(
            decode_skeleton_tracing(&malformed),
            Err(TracingStoreError::InvalidProtobuf),
            "group at {path:?}"
        );
    }
    assert_eq!(
        decode_skeleton_tracing(b"\xff\xff\xff not protobuf"),
        Err(TracingStoreError::InvalidProtobuf)
    );
}

#[test]
fn volume_decoder_rejects_missing_required_fields_at_every_nesting_level() {
    let bytes = volume_tracing().encode_to_vec();
    let cases: &[(&[u32], u32)] = &[
        (&[], 2),      // boundingBox
        (&[], 3),      // createdTimestamp
        (&[], 4),      // datasetName
        (&[], 5),      // editPosition
        (&[], 6),      // editRotation
        (&[], 7),      // elementClass
        (&[], 10),     // version
        (&[], 11),     // zoomLevel
        (&[2], 1),     // boundingBox.topLeft
        (&[2], 4),     // boundingBox.depth
        (&[2, 1], 2),  // boundingBox.topLeft.y
        (&[15], 3),    // mags.z
        (&[16], 1),    // segment.segmentId
        (&[16, 2], 1), // segment.anchorPosition.x
        (&[19, 3], 2), // segmentGroup.children.groupId (recursive)
        (&[26], 1),    // userState.userId
        (&[26, 5], 1), // userState.segmentVisibilities.id
    ];
    for (path, tag) in cases {
        let malformed = edit_nested(&bytes, path, &without_tag(*tag));
        assert_eq!(
            decode_volume_tracing(&malformed),
            Err(TracingStoreError::InvalidProtobuf),
            "{path:?}/{tag}"
        );
    }
    // A second, incomplete occurrence of a repeated message is rejected too.
    let mut second_mag = Vec::new();
    prost::encoding::int32::encode(1, &4, &mut second_mag);
    let mut malformed = bytes.clone();
    prost::encoding::bytes::encode(15, &second_mag, &mut malformed);
    assert_eq!(
        decode_volume_tracing(&malformed),
        Err(TracingStoreError::InvalidProtobuf)
    );
    // Optional fields may be absent.
    let optional_absent = edit_nested(&bytes, &[], &without_tag(8));
    assert!(decode_volume_tracing(&optional_absent).is_ok());
}

#[tokio::test]
async fn save_rpcs_post_protobuf_bodies_with_token_and_exact_queries() {
    let (base, mock) = server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let annotation_id = ObjectId::parse("0123456789ABCDEF01234567").unwrap();
    let dataset_id = ObjectId::parse("89abcdef0123456789abcdef").unwrap();
    let store = AnnotationDataSourceStore::default();
    let data_source = json!({"id":{"name":"ds","team":"org"},"dataLayers":[]});

    let skeleton = skeleton_tracing();
    client
        .save_skeleton_tracing(&base, &skeleton, "skeleton-id")
        .await
        .unwrap();
    let volume = volume_tracing();
    client
        .save_volume_tracing(
            &base,
            &annotation_id,
            "volume-id",
            &volume,
            VolumeSaveDataSource {
                store: &store,
                data_source: &data_source,
                dataset_id: &dataset_id,
            },
        )
        .await
        .unwrap();
    let annotation = annotation_proto();
    client
        .save_annotation_proto(&base, &annotation_id, &annotation)
        .await
        .unwrap();

    let stored = store.find(&annotation_id).unwrap();
    assert_eq!(stored.data_source, data_source);
    assert_eq!(stored.dataset_id, dataset_id);

    let requests = mock.requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 3);
    let expected = [
        (
            "/tracings/skeleton/save",
            ("newTracingId", "skeleton-id"),
            skeleton.encode_to_vec(),
        ),
        (
            "/tracings/volume/save",
            ("newTracingId", "volume-id"),
            volume.encode_to_vec(),
        ),
        (
            "/tracings/annotation/save",
            ("annotationId", "0123456789abcdef01234567"),
            annotation.encode_to_vec(),
        ),
    ];
    for (observed, (path, (key, value), body)) in requests.iter().zip(expected) {
        assert_eq!(observed.method, "POST");
        assert_eq!(observed.path, path);
        assert_eq!(
            observed.content_type.as_deref(),
            Some("application/x-protobuf")
        );
        assert_eq!(query_value(observed, "token"), [TOKEN]);
        assert_eq!(query_value(observed, key), [value]);
        assert_eq!(observed.query.len(), 2);
        assert_eq!(observed.raw_body, body);
    }
}

#[tokio::test]
async fn save_volume_registers_data_source_before_the_rpc_and_maps_upstream_errors() {
    let (base, mock) = server().await;
    *mock.response.lock().unwrap() = Some((
        StatusCode::INTERNAL_SERVER_ERROR,
        b"secret upstream body".to_vec(),
    ));
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let annotation_id = ObjectId::new();
    let dataset_id = ObjectId::new();
    let store = AnnotationDataSourceStore::default();
    let data_source = json!({"dataLayers":[]});
    let error = client
        .save_volume_tracing(
            &base,
            &annotation_id,
            "volume-id",
            &volume_tracing(),
            VolumeSaveDataSource {
                store: &store,
                data_source: &data_source,
                dataset_id: &dataset_id,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error, ServiceError::UpstreamStatus(500));
    // Scala stores into the temporary store before (and regardless of) the RPC.
    assert!(store.find(&annotation_id).is_some());
    let api: ApiError = error.into();
    assert_eq!(api.status, StatusCode::INTERNAL_SERVER_ERROR);
    for secret in ["secret upstream", TOKEN, base.as_str()] {
        assert!(!api.message.contains(secret), "{}", api.message);
    }
    assert_eq!(
        client
            .save_skeleton_tracing(&base, &skeleton_tracing(), "s")
            .await,
        Err(ServiceError::UpstreamStatus(500))
    );
    assert_eq!(
        client
            .save_annotation_proto(&base, &annotation_id, &annotation_proto())
            .await,
        Err(ServiceError::UpstreamStatus(500))
    );
}

#[tokio::test]
async fn get_tracings_send_annotation_id_and_optional_version_and_decode() {
    let (base, mock) = server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let annotation_id = ObjectId::parse("0123456789ABCDEF01234567").unwrap();

    let skeleton = skeleton_tracing();
    *mock.response.lock().unwrap() = Some((StatusCode::OK, skeleton.encode_to_vec()));
    assert_eq!(
        client
            .get_skeleton_tracing(&base, "skeleton id/1", &annotation_id, Some(4))
            .await
            .unwrap(),
        skeleton
    );
    let volume = volume_tracing();
    *mock.response.lock().unwrap() = Some((StatusCode::OK, volume.encode_to_vec()));
    assert_eq!(
        client
            .get_volume_tracing(&base, "volume-id", &annotation_id, None)
            .await
            .unwrap(),
        volume
    );

    let requests = mock.requests.lock().unwrap().clone();
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/tracings/skeleton/skeleton%20id%2F1");
    assert_eq!(query_value(&requests[0], "token"), [TOKEN]);
    assert_eq!(
        query_value(&requests[0], "annotationId"),
        ["0123456789abcdef01234567"]
    );
    assert_eq!(query_value(&requests[0], "version"), ["4"]);
    assert_eq!(requests[0].query.len(), 3);
    assert_eq!(requests[1].method, "GET");
    assert_eq!(requests[1].path, "/tracings/volume/volume-id");
    assert_eq!(query_value(&requests[1], "token"), [TOKEN]);
    assert_eq!(
        query_value(&requests[1], "annotationId"),
        ["0123456789abcdef01234567"]
    );
    assert!(query_value(&requests[1], "version").is_empty());
    assert_eq!(requests[1].query.len(), 2);

    // Invalid protobuf (here: a skeleton missing its required version) and
    // upstream failures map like getAnnotationProto.
    let missing_version = edit_nested(&skeleton.encode_to_vec(), &[], &without_tag(9));
    *mock.response.lock().unwrap() = Some((StatusCode::OK, missing_version));
    let error = client
        .get_skeleton_tracing(&base, "s", &annotation_id, None)
        .await
        .unwrap_err();
    assert_eq!(error, TracingStoreError::InvalidProtobuf);
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    // An empty body lacks every required VolumeTracing field.
    *mock.response.lock().unwrap() = Some((StatusCode::OK, Vec::new()));
    assert_eq!(
        client
            .get_volume_tracing(&base, "v", &annotation_id, None)
            .await
            .unwrap_err(),
        TracingStoreError::InvalidProtobuf
    );
    *mock.response.lock().unwrap() = Some((StatusCode::NOT_FOUND, b"secret".to_vec()));
    assert_eq!(
        client
            .get_volume_tracing(&base, "v", &annotation_id, None)
            .await
            .unwrap_err(),
        TracingStoreError::Service(ServiceError::UpstreamStatus(404))
    );
}

#[tokio::test]
async fn skeleton_rpcs_use_the_long_timeout_and_volume_and_annotation_rpcs_the_default() {
    let (base, mock) = server().await;
    *mock.delay.lock().unwrap() = Duration::from_millis(300);
    let client = TracingStoreClient::with_long_timeout(
        config(Duration::from_millis(100)),
        Duration::from_secs(5),
    )
    .unwrap();
    let annotation_id = ObjectId::new();
    let store = AnnotationDataSourceStore::default();
    let data_source = json!({});

    assert!(
        client
            .save_skeleton_tracing(&base, &skeleton_tracing(), "s")
            .await
            .is_ok()
    );
    *mock.response.lock().unwrap() = Some((StatusCode::OK, skeleton_tracing().encode_to_vec()));
    assert!(
        client
            .get_skeleton_tracing(&base, "s", &annotation_id, None)
            .await
            .is_ok()
    );
    assert_eq!(
        client
            .save_volume_tracing(
                &base,
                &annotation_id,
                "v",
                &volume_tracing(),
                VolumeSaveDataSource {
                    store: &store,
                    data_source: &data_source,
                    dataset_id: &annotation_id,
                },
            )
            .await,
        Err(ServiceError::Timeout)
    );
    assert_eq!(
        client
            .save_annotation_proto(&base, &annotation_id, &annotation_proto())
            .await,
        Err(ServiceError::Timeout)
    );
    *mock.response.lock().unwrap() = Some((StatusCode::OK, volume_tracing().encode_to_vec()));
    assert_eq!(
        client
            .get_volume_tracing(&base, "v", &annotation_id, None)
            .await
            .unwrap_err(),
        TracingStoreError::Service(ServiceError::Timeout)
    );
}

// ---- D1: download RPCs ----------------------------------------------------

use std::collections::HashMap;

use webknossos_backend::{
    nml_writer::{NmlVoxelSize, VolumeDataZipFormat},
    proto::datastore::{SkeletonTracingOpt, SkeletonTracings, VolumeTracingOpt, VolumeTracings},
    tracingstore_client::{
        FetchedVolumeLayer, GET_MULTIPLE_BATCH_SIZE, VolumeLayerFetch, decode_skeleton_tracings,
        decode_volume_tracings,
    },
};

/// Mock answering per request path (exact, percent-encoded) instead of one
/// response for every request; unknown paths get 404.
#[derive(Clone, Default)]
struct RoutedMock {
    requests: Arc<Mutex<Vec<Observed>>>,
    routes: Arc<Mutex<HashMap<String, MockResponse>>>,
    delay: Arc<Mutex<Duration>>,
}

impl RoutedMock {
    fn route(&self, path: &str, status: StatusCode, body: Vec<u8>) {
        self.routes
            .lock()
            .unwrap()
            .insert(path.to_owned(), (status, body));
    }

    fn requests(&self) -> Vec<Observed> {
        self.requests.lock().unwrap().clone()
    }
}

async fn routed_handler(State(mock): State<RoutedMock>, request: Request) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_owned();
    let query = url::form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes())
        .into_owned()
        .collect();
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    mock.requests.lock().unwrap().push(Observed {
        method,
        path: path.clone(),
        query,
        content_type,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        raw_body: bytes.to_vec(),
    });
    let delay = *mock.delay.lock().unwrap();
    tokio::time::sleep(delay).await;
    let (status, body) = mock
        .routes
        .lock()
        .unwrap()
        .get(&path)
        .cloned()
        .unwrap_or((StatusCode::NOT_FOUND, Vec::new()));
    (status, body).into_response()
}

async fn routed_server() -> (String, RoutedMock) {
    let mock = RoutedMock::default();
    let router = Router::new()
        .route("/{*path}", any(routed_handler))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}"), mock)
}

fn as_pairs(observed: &Observed) -> Vec<(&str, &str)> {
    observed
        .query
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect()
}

fn voxel_size() -> NmlVoxelSize {
    NmlVoxelSize {
        factor: [11.24, 11.0, 0.1],
        unit: "nanometer".to_owned(),
    }
}

fn zip_bytes() -> Vec<u8> {
    // Not a real zip: the client passes the bytes through untouched.
    let mut bytes = b"PK\x03\x04".to_vec();
    bytes.extend((0..=255_u8).cycle().take(3000));
    bytes
}

fn skeleton_tracings(count: usize) -> SkeletonTracings {
    SkeletonTracings {
        tracings: (0..count)
            .map(|i| SkeletonTracingOpt {
                tracing: (i % 2 == 0).then(skeleton_tracing),
            })
            .collect(),
    }
}

fn volume_tracings(count: usize) -> VolumeTracings {
    VolumeTracings {
        tracings: (0..count)
            .map(|i| VolumeTracingOpt {
                tracing: (i % 2 == 1).then(volume_tracing),
            })
            .collect(),
    }
}

#[tokio::test]
async fn all_data_zip_sends_exact_queries_and_returns_raw_bytes() {
    let (base, mock) = routed_server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let annotation_id = ObjectId::parse("0123456789abcdef01234567").unwrap();
    mock.route(
        "/tracings/volume/vol%2F1/allDataZip",
        StatusCode::OK,
        zip_bytes(),
    );
    mock.route("/tracings/volume/v/allDataZip", StatusCode::OK, Vec::new());

    let voxel = voxel_size();
    assert_eq!(
        client
            .get_volume_data_zip(
                &base,
                "vol/1",
                &annotation_id,
                Some(12),
                VolumeDataZipFormat::Zarr3,
                Some(&voxel),
            )
            .await
            .unwrap(),
        zip_bytes()
    );
    // No version / voxel size: those parameters are omitted; empty bodies pass.
    assert_eq!(
        client
            .get_volume_data_zip(
                &base,
                "v",
                &annotation_id,
                None,
                VolumeDataZipFormat::Wkw,
                None
            )
            .await
            .unwrap(),
        Vec::<u8>::new()
    );
    // Compound getVolumeData: no annotationId and no version.
    assert_eq!(
        client
            .get_volume_data(&base, "vol/1", VolumeDataZipFormat::Wkw, Some(&voxel))
            .await
            .unwrap(),
        zip_bytes()
    );

    let requests = mock.requests();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/tracings/volume/vol%2F1/allDataZip");
    assert_eq!(
        as_pairs(&requests[0]),
        [
            ("token", TOKEN),
            ("volumeDataZipFormat", "zarr3"),
            ("annotationId", "0123456789abcdef01234567"),
            ("version", "12"),
            // Vec3Double.toUriLiteral with Java Double.toString.
            ("voxelSizeFactor", "11.24,11.0,0.1"),
            ("voxelSizeUnit", "nanometer"),
        ]
    );
    assert!(requests[0].raw_body.is_empty());
    assert_eq!(requests[1].path, "/tracings/volume/v/allDataZip");
    assert_eq!(
        as_pairs(&requests[1]),
        [
            ("token", TOKEN),
            ("volumeDataZipFormat", "wkw"),
            ("annotationId", "0123456789abcdef01234567"),
        ]
    );
    assert_eq!(requests[2].method, "GET");
    assert_eq!(
        as_pairs(&requests[2]),
        [
            ("token", TOKEN),
            ("volumeDataZipFormat", "wkw"),
            ("voxelSizeFactor", "11.24,11.0,0.1"),
            ("voxelSizeUnit", "nanometer"),
        ]
    );

    // Upstream failures keep their status and hide the body.
    mock.route(
        "/tracings/volume/v/allDataZip",
        StatusCode::BAD_REQUEST,
        b"secret".to_vec(),
    );
    let error = client
        .get_volume_data(&base, "v", VolumeDataZipFormat::Wkw, None)
        .await
        .unwrap_err();
    assert_eq!(error, ServiceError::UpstreamStatus(400));
    assert!(!ApiError::from(error).message.contains("secret"));
}

#[tokio::test]
async fn edited_edges_zip_and_mapping_info_send_exact_queries() {
    let (base, mock) = routed_server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let annotation_id = ObjectId::parse("0123456789abcdef01234567").unwrap();
    mock.route(
        "/tracings/mapping/m/editedEdgesZip",
        StatusCode::OK,
        zip_bytes(),
    );
    mock.route(
        "/tracings/mapping/m/info",
        StatusCode::OK,
        serde_json::to_vec(&json!({
            "tracingId": "m",
            "baseMappingName": "agglomerate_view_5",
            "largestAgglomerateId": 18446744073709551615_u64,
            "createdTimestamp": 1,
        }))
        .unwrap(),
    );

    assert_eq!(
        client
            .get_edited_mapping_edges_zip(&base, "m", Some(3))
            .await
            .unwrap(),
        zip_bytes()
    );
    assert_eq!(
        client
            .get_edited_mapping_edges_zip(&base, "m", None)
            .await
            .unwrap(),
        zip_bytes()
    );
    assert_eq!(
        client
            .get_base_mapping_name(&base, "m", &annotation_id, Some(3))
            .await
            .unwrap(),
        "agglomerate_view_5"
    );
    assert_eq!(
        client
            .get_base_mapping_name(&base, "m", &annotation_id, None)
            .await
            .unwrap(),
        "agglomerate_view_5"
    );

    let requests = mock.requests();
    let pairs: Vec<Vec<(String, String)>> = requests.iter().map(|r| r.query.clone()).collect();
    let owned = |items: &[(&str, &str)]| -> Vec<(String, String)> {
        items
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    };
    assert!(requests.iter().all(|r| r.method == "GET"));
    assert_eq!(requests[0].path, "/tracings/mapping/m/editedEdgesZip");
    // editedEdgesZip carries no annotationId (as Scala).
    assert_eq!(pairs[0], owned(&[("token", TOKEN), ("version", "3")]));
    assert_eq!(pairs[1], owned(&[("token", TOKEN)]));
    assert_eq!(requests[2].path, "/tracings/mapping/m/info");
    assert_eq!(
        pairs[2],
        owned(&[
            ("token", TOKEN),
            ("version", "3"),
            ("annotationId", "0123456789abcdef01234567"),
        ])
    );
    assert_eq!(
        pairs[3],
        owned(&[
            ("token", TOKEN),
            ("annotationId", "0123456789abcdef01234567")
        ])
    );

    // Scala: getWithJsonResponse[JsObject] then `as[String](_ \ "baseMappingName")`.
    for invalid in [
        b"not json".to_vec(),
        b"[\"agglomerate_view_5\"]".to_vec(),
        b"\"agglomerate_view_5\"".to_vec(),
        serde_json::to_vec(&json!({"tracingId": "m"})).unwrap(),
        serde_json::to_vec(&json!({"baseMappingName": null})).unwrap(),
        serde_json::to_vec(&json!({"baseMappingName": 5})).unwrap(),
    ] {
        mock.route("/tracings/mapping/m/info", StatusCode::OK, invalid);
        assert_eq!(
            client
                .get_base_mapping_name(&base, "m", &annotation_id, None)
                .await
                .unwrap_err(),
            ServiceError::InvalidJson
        );
    }
    mock.route(
        "/tracings/mapping/m/editedEdgesZip",
        StatusCode::NOT_FOUND,
        b"secret".to_vec(),
    );
    assert_eq!(
        client
            .get_edited_mapping_edges_zip(&base, "m", None)
            .await
            .unwrap_err(),
        ServiceError::UpstreamStatus(404)
    );
}

#[tokio::test]
async fn get_multiple_posts_selector_json_in_batches_and_decodes_wrappers() {
    let (base, mock) = routed_server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    mock.route(
        "/tracings/skeleton/getMultiple",
        StatusCode::OK,
        skeleton_tracings(2).encode_to_vec(),
    );
    mock.route(
        "/tracings/volume/getMultiple",
        StatusCode::OK,
        volume_tracings(2).encode_to_vec(),
    );

    let ids = vec![Some("skeleton-a".to_owned()), None];
    assert_eq!(
        client.get_skeleton_tracings(&base, &ids).await.unwrap(),
        [Some(skeleton_tracing()), None]
    );
    assert_eq!(
        client.get_volume_tracings(&base, &ids).await.unwrap(),
        [None, Some(volume_tracing())]
    );
    let requests = mock.requests();
    assert_eq!(requests.len(), 2);
    for (request, kind) in requests.iter().zip(["skeleton", "volume"]) {
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, format!("/tracings/{kind}/getMultiple"));
        assert_eq!(request.query, [("token".to_owned(), TOKEN.to_owned())]);
        assert_eq!(request.content_type.as_deref(), Some("application/json"));
        // List[Option[TracingSelector]]: None -> null, version omitted.
        assert_eq!(request.body, json!([{"tracingId": "skeleton-a"}, null]));
    }

    // Empty selector list: no RPC at all (grouped(1000) yields no batch).
    assert!(
        client
            .get_skeleton_tracings(&base, &[])
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(mock.requests().len(), 2);

    // 1001 selectors -> serial batches of 1000 and 1, results concatenated
    // in order (the mock answers 2 entries per batch; lengths are not checked).
    let many: Vec<Option<String>> = (0..=GET_MULTIPLE_BATCH_SIZE)
        .map(|i| Some(format!("t{i}")))
        .collect();
    assert_eq!(
        client.get_volume_tracings(&base, &many).await.unwrap(),
        [None, Some(volume_tracing()), None, Some(volume_tracing())]
    );
    let requests = mock.requests();
    assert_eq!(requests.len(), 4);
    assert_eq!(requests[2].body.as_array().unwrap().len(), 1000);
    assert_eq!(requests[2].body[0], json!({"tracingId": "t0"}));
    assert_eq!(requests[2].body[999], json!({"tracingId": "t999"}));
    assert_eq!(requests[3].body, json!([{"tracingId": "t1000"}]));

    // Decoding errors (validated like ScalaPB) and upstream failures.
    let missing_version = edit_nested(
        &skeleton_tracings(1).encode_to_vec(),
        &[1, 1],
        &without_tag(9),
    );
    mock.route(
        "/tracings/skeleton/getMultiple",
        StatusCode::OK,
        missing_version,
    );
    let error = client.get_skeleton_tracings(&base, &ids).await.unwrap_err();
    assert_eq!(error, TracingStoreError::InvalidProtobuf);
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    mock.route(
        "/tracings/volume/getMultiple",
        StatusCode::OK,
        b"\xff\xff".to_vec(),
    );
    assert_eq!(
        client.get_volume_tracings(&base, &ids).await.unwrap_err(),
        TracingStoreError::InvalidProtobuf
    );
    mock.route(
        "/tracings/volume/getMultiple",
        StatusCode::FORBIDDEN,
        b"secret".to_vec(),
    );
    assert_eq!(
        client.get_volume_tracings(&base, &ids).await.unwrap_err(),
        TracingStoreError::Service(ServiceError::UpstreamStatus(403))
    );
}

#[test]
fn wrapper_decoders_check_required_fields_of_every_present_tracing() {
    let skeletons = skeleton_tracings(3);
    assert_eq!(
        decode_skeleton_tracings(&skeletons.encode_to_vec()).unwrap(),
        skeletons
    );
    let volumes = volume_tracings(3);
    assert_eq!(
        decode_volume_tracings(&volumes.encode_to_vec()).unwrap(),
        volumes
    );
    // Empty wrappers and absent (None) tracings are valid.
    assert_eq!(
        decode_skeleton_tracings(&[]).unwrap(),
        SkeletonTracings::default()
    );
    assert!(
        decode_volume_tracings(&volume_tracings(1).encode_to_vec())
            .unwrap()
            .tracings[0]
            .tracing
            .is_none()
    );
    // Missing required fields deep inside the first present tracing
    // (wrapper tag 1 -> Opt tag 1 -> tracing).
    let skeleton_bytes = skeletons.encode_to_vec();
    let skeleton_cases: &[(&[u32], u32)] = &[
        (&[1, 1], 9),        // SkeletonTracing.version
        (&[1, 1, 2], 7),     // tree.name
        (&[1, 1, 2, 2], 9),  // node.createdTimestamp
        (&[1, 1, 11, 3], 2), // treeGroup.children.groupId (recursive)
        (&[1, 1, 24, 5], 2), // userState.treeVisibilities.value
    ];
    for (path, tag) in skeleton_cases {
        let edited = edit_nested(&skeleton_bytes, path, &without_tag(*tag));
        assert_eq!(
            decode_skeleton_tracings(&edited),
            Err(TracingStoreError::InvalidProtobuf),
            "{path:?}/{tag}"
        );
    }
    // volume_tracings(n) starts with an absent tracing; edit_nested follows
    // the first occurrence, so use a wrapper with one present tracing.
    let volume_bytes = VolumeTracings {
        tracings: vec![VolumeTracingOpt {
            tracing: Some(volume_tracing()),
        }],
    }
    .encode_to_vec();
    let volume_cases: &[(&[u32], u32)] = &[
        (&[1, 1], 11),       // VolumeTracing.zoomLevel
        (&[1, 1, 16], 1),    // segment.segmentId
        (&[1, 1, 19, 3], 2), // segmentGroup.children.groupId (recursive)
    ];
    for (path, tag) in volume_cases {
        let edited = edit_nested(&volume_bytes, path, &without_tag(*tag));
        assert_eq!(
            decode_volume_tracings(&edited),
            Err(TracingStoreError::InvalidProtobuf),
            "{path:?}/{tag}"
        );
    }
    assert_eq!(
        decode_skeleton_tracings(&with_unknown_group(&skeleton_bytes)).unwrap_err(),
        TracingStoreError::InvalidProtobuf
    );
}

#[tokio::test]
async fn fetch_volume_layer_follows_scala_get_volume_tracing() {
    let (base, mock) = routed_server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let annotation_id = ObjectId::parse("0123456789abcdef01234567").unwrap();
    let voxel = voxel_size();
    let plain = volume_tracing();
    let editable = VolumeTracing {
        has_editable_mapping: Some(true),
        ..volume_tracing()
    };
    mock.route(
        "/tracings/volume/plain",
        StatusCode::OK,
        plain.encode_to_vec(),
    );
    mock.route(
        "/tracings/volume/plain/allDataZip",
        StatusCode::OK,
        zip_bytes(),
    );
    mock.route(
        "/tracings/volume/editable",
        StatusCode::OK,
        editable.encode_to_vec(),
    );
    mock.route(
        "/tracings/mapping/editable/editedEdgesZip",
        StatusCode::OK,
        b"edges".to_vec(),
    );
    mock.route(
        "/tracings/mapping/editable/info",
        StatusCode::OK,
        br#"{"baseMappingName":"base"}"#.to_vec(),
    );
    let fetch = |tracing_id, skip| VolumeLayerFetch {
        tracing_id,
        annotation_id: &annotation_id,
        version: Some(2),
        skip_volume_and_edges_data: skip,
        volume_data_zip_format: VolumeDataZipFormat::Zarr3,
        voxel_size: Some(&voxel),
    };

    assert_eq!(
        client
            .fetch_volume_layer(&base, fetch("plain", false))
            .await
            .unwrap(),
        FetchedVolumeLayer {
            tracing: plain.clone(),
            data: Some(zip_bytes()),
            edited_mapping_edges: None,
            base_mapping_name: None,
        }
    );
    let paths = |mock: &RoutedMock| -> Vec<String> {
        mock.requests().into_iter().map(|r| r.path).collect()
    };
    assert_eq!(
        paths(&mock),
        [
            "/tracings/volume/plain",
            "/tracings/volume/plain/allDataZip"
        ]
    );
    assert_eq!(
        query_value(&mock.requests()[1], "volumeDataZipFormat"),
        ["zarr3"]
    );
    assert_eq!(query_value(&mock.requests()[1], "version"), ["2"]);

    assert_eq!(
        client
            .fetch_volume_layer(&base, fetch("editable", false))
            .await
            .unwrap(),
        FetchedVolumeLayer {
            tracing: editable.clone(),
            data: None,
            edited_mapping_edges: Some(b"edges".to_vec()),
            base_mapping_name: Some("base".to_owned()),
        }
    );
    assert_eq!(
        paths(&mock)[2..],
        [
            "/tracings/volume/editable",
            "/tracings/mapping/editable/editedEdgesZip",
            "/tracings/mapping/editable/info",
        ]
    );

    // skipVolumeData: only the tracing itself.
    for (id, tracing) in [("plain", &plain), ("editable", &editable)] {
        assert_eq!(
            client
                .fetch_volume_layer(&base, fetch(id, true))
                .await
                .unwrap(),
            FetchedVolumeLayer {
                tracing: tracing.clone(),
                data: None,
                edited_mapping_edges: None,
                base_mapping_name: None,
            }
        );
    }
    assert_eq!(paths(&mock).len(), 7);

    // A failing data step fails the whole fetch.
    mock.route(
        "/tracings/mapping/editable/info",
        StatusCode::OK,
        b"{}".to_vec(),
    );
    assert_eq!(
        client
            .fetch_volume_layer(&base, fetch("editable", false))
            .await
            .unwrap_err(),
        TracingStoreError::Service(ServiceError::InvalidJson)
    );
}

#[tokio::test]
async fn download_rpcs_use_the_long_timeout_except_the_volume_tracing_get() {
    let (base, mock) = routed_server().await;
    *mock.delay.lock().unwrap() = Duration::from_millis(300);
    let client = TracingStoreClient::with_long_timeout(
        config(Duration::from_millis(100)),
        Duration::from_secs(5),
    )
    .unwrap();
    let annotation_id = ObjectId::new();
    mock.route("/tracings/volume/v/allDataZip", StatusCode::OK, zip_bytes());
    mock.route(
        "/tracings/mapping/v/editedEdgesZip",
        StatusCode::OK,
        zip_bytes(),
    );
    mock.route(
        "/tracings/mapping/v/info",
        StatusCode::OK,
        br#"{"baseMappingName":"b"}"#.to_vec(),
    );
    mock.route(
        "/tracings/skeleton/getMultiple",
        StatusCode::OK,
        skeleton_tracings(1).encode_to_vec(),
    );
    mock.route(
        "/tracings/volume/getMultiple",
        StatusCode::OK,
        volume_tracings(1).encode_to_vec(),
    );
    mock.route(
        "/tracings/volume/v",
        StatusCode::OK,
        volume_tracing().encode_to_vec(),
    );
    let ids = [Some("v".to_owned())];

    assert!(
        client
            .get_volume_data_zip(
                &base,
                "v",
                &annotation_id,
                None,
                VolumeDataZipFormat::Wkw,
                None
            )
            .await
            .is_ok()
    );
    assert!(
        client
            .get_volume_data(&base, "v", VolumeDataZipFormat::Wkw, None)
            .await
            .is_ok()
    );
    assert!(
        client
            .get_edited_mapping_edges_zip(&base, "v", None)
            .await
            .is_ok()
    );
    assert!(
        client
            .get_base_mapping_name(&base, "v", &annotation_id, None)
            .await
            .is_ok()
    );
    assert!(client.get_skeleton_tracings(&base, &ids).await.is_ok());
    assert!(client.get_volume_tracings(&base, &ids).await.is_ok());
    // Scala's getVolumeTracing fetches the tracing itself without withLongTimeout.
    assert_eq!(
        client
            .fetch_volume_layer(
                &base,
                VolumeLayerFetch {
                    tracing_id: "v",
                    annotation_id: &annotation_id,
                    version: None,
                    skip_volume_and_edges_data: false,
                    volume_data_zip_format: VolumeDataZipFormat::Wkw,
                    voxel_size: None,
                },
            )
            .await
            .unwrap_err(),
        TracingStoreError::Service(ServiceError::Timeout)
    );
}

// ---- RPC consolidation: upload / task creation / duplicate RPCs -----------

use webknossos_backend::{
    proto::datastore::{SkeletonTracingsWithIds, StringOpt},
    tracingstore_client::{DuplicateAnnotationRequest, SaveMultipleResult},
};

fn duplicate_request() -> DuplicateAnnotationRequest {
    DuplicateAnnotationRequest {
        source_annotation_id: ObjectId::parse("aaaaaaaaaaaaaaaaaaaaaaaa").unwrap(),
        new_annotation_id: ObjectId::parse("bbbbbbbbbbbbbbbbbbbbbbbb").unwrap(),
        owner_id: ObjectId::parse("cccccccccccccccccccccccc").unwrap(),
        requesting_user_id: ObjectId::parse("dddddddddddddddddddddddd").unwrap(),
        version: Some(7),
        is_from_task: true,
        dataset_bounding_box: Some([1, -2, 3, 40, 50, 60]),
    }
}

fn skeletons_with_ids() -> SkeletonTracingsWithIds {
    SkeletonTracingsWithIds {
        tracings: vec![
            SkeletonTracingOpt {
                tracing: Some(skeleton_tracing()),
            },
            SkeletonTracingOpt { tracing: None },
        ],
        annotation_id: vec![
            StringOpt {
                string_value: Some("0123456789abcdef01234567".to_owned()),
            },
            StringOpt { string_value: None },
        ],
        tracing_id: vec![
            StringOpt {
                string_value: Some("skeleton-id".to_owned()),
            },
            StringOpt { string_value: None },
        ],
    }
}

#[tokio::test]
async fn initial_data_and_editable_mapping_save_post_raw_bodies_with_exact_queries() {
    let (base, mock) = routed_server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let annotation_id = ObjectId::parse("0123456789ABCDEF01234567").unwrap();
    mock.route(
        "/tracings/volume/v%201/initialData",
        StatusCode::OK,
        Vec::new(),
    );
    mock.route("/tracings/mapping/m/save", StatusCode::OK, b"5".to_vec());

    // Annotation upload: empty MagRestrictions, both mags omitted.
    client
        .upload_volume_initial_data(&base, &annotation_id, "v 1", None, None, zip_bytes())
        .await
        .unwrap();
    // Task creation: MagRestrictions min/max.
    client
        .upload_volume_initial_data(&base, &annotation_id, "v 1", Some(2), Some(16), zip_bytes())
        .await
        .unwrap();
    client
        .upload_volume_initial_data(&base, &annotation_id, "v 1", None, Some(4), vec![1, 2])
        .await
        .unwrap();
    assert_eq!(
        client
            .save_editable_mapping(&base, &annotation_id, "m", "base map", 3, zip_bytes())
            .await,
        Ok(5)
    );

    let requests = mock.requests();
    assert_eq!(requests.len(), 4);
    for observed in &requests {
        assert_eq!(observed.method, "POST");
        assert_eq!(
            observed.content_type.as_deref(),
            Some("application/octet-stream")
        );
    }
    let id = "0123456789abcdef01234567";
    assert_eq!(requests[0].path, "/tracings/volume/v%201/initialData");
    assert_eq!(
        as_pairs(&requests[0]),
        [("token", TOKEN), ("annotationId", id)]
    );
    assert_eq!(requests[0].raw_body, zip_bytes());
    assert_eq!(
        as_pairs(&requests[1]),
        [
            ("token", TOKEN),
            ("annotationId", id),
            ("minMag", "2"),
            ("maxMag", "16")
        ]
    );
    assert_eq!(
        as_pairs(&requests[2]),
        [("token", TOKEN), ("annotationId", id), ("maxMag", "4")]
    );
    assert_eq!(requests[2].raw_body, [1, 2]);
    assert_eq!(requests[3].path, "/tracings/mapping/m/save");
    assert_eq!(
        as_pairs(&requests[3]),
        [
            ("token", TOKEN),
            ("annotationId", id),
            ("baseMappingName", "base map"),
            ("startVersion", "3")
        ]
    );
    assert_eq!(requests[3].raw_body, zip_bytes());

    // The mapping save answers a JSON Long; anything else is InvalidJson.
    for body in [&b"\"5\""[..], b"1.5", b""] {
        mock.route("/tracings/mapping/m/save", StatusCode::OK, body.to_vec());
        assert_eq!(
            client
                .save_editable_mapping(&base, &annotation_id, "m", "b", 1, Vec::new())
                .await,
            Err(ServiceError::InvalidJson)
        );
    }
    mock.route("/tracings/mapping/m/save", StatusCode::CONFLICT, Vec::new());
    assert_eq!(
        client
            .save_editable_mapping(&base, &annotation_id, "m", "b", 1, Vec::new())
            .await,
        Err(ServiceError::UpstreamStatus(409))
    );
    mock.route(
        "/tracings/volume/v%201/initialData",
        StatusCode::INTERNAL_SERVER_ERROR,
        Vec::new(),
    );
    assert_eq!(
        client
            .upload_volume_initial_data(&base, &annotation_id, "v 1", None, None, Vec::new())
            .await,
        Err(ServiceError::UpstreamStatus(500))
    );
}

#[tokio::test]
async fn merge_volume_by_contents_thins_initialize_registers_data_source_and_merges() {
    let (base, mock) = routed_server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let annotation_id = ObjectId::parse("0123456789ABCDEF01234567").unwrap();
    let dataset_id = ObjectId::parse("89abcdef0123456789abcdef").unwrap();
    let store = AnnotationDataSourceStore::default();
    let data_source = json!({"dataLayers":[]});
    let with_boxes = VolumeTracing {
        user_bounding_boxes: vec![NamedBoundingBoxProto {
            id: 1,
            ..Default::default()
        }],
        ..volume_tracing()
    };
    let tracings = [with_boxes.clone(), volume_tracing()];
    mock.route(
        "/tracings/volume/initializeForMerge",
        StatusCode::OK,
        Vec::new(),
    );
    mock.route(
        "/tracings/volume/new-id/initialDataMultiple",
        StatusCode::OK,
        Vec::new(),
    );
    mock.route(
        "/tracings/volume/mergedFromContents",
        StatusCode::OK,
        Vec::new(),
    );

    client
        .merge_volume_tracings_by_contents(
            &base,
            &annotation_id,
            "new-id",
            &tracings,
            zip_bytes(),
            VolumeSaveDataSource {
                store: &store,
                data_source: &data_source,
                dataset_id: &dataset_id,
            },
        )
        .await
        .unwrap();
    let stored = store.find(&annotation_id).unwrap();
    assert_eq!(stored.data_source, data_source);
    assert_eq!(stored.dataset_id, dataset_id);

    let requests = mock.requests();
    let paths: Vec<_> = requests.iter().map(|r| r.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            "/tracings/volume/initializeForMerge",
            "/tracings/volume/new-id/initialDataMultiple",
            "/tracings/volume/mergedFromContents"
        ]
    );
    for observed in &requests {
        assert_eq!(observed.method, "POST");
    }
    // 1. initializeForMerge: thinned tracings.
    assert_eq!(
        as_pairs(&requests[0]),
        [("token", TOKEN), ("newTracingId", "new-id")]
    );
    assert_eq!(
        requests[0].content_type.as_deref(),
        Some("application/x-protobuf")
    );
    let thinned = decode_volume_tracings(&requests[0].raw_body).unwrap();
    assert_eq!(thinned.tracings.len(), 2);
    for (opt, original) in thinned.tracings.iter().zip(&tracings) {
        let tracing = opt.tracing.as_ref().unwrap();
        assert!(tracing.segments.is_empty());
        assert!(tracing.segment_groups.is_empty());
        assert!(tracing.user_bounding_boxes.is_empty());
        assert!(tracing.user_states.is_empty());
        assert_eq!(
            tracing,
            &VolumeTracing {
                segments: Vec::new(),
                segment_groups: Vec::new(),
                user_bounding_boxes: Vec::new(),
                user_states: Vec::new(),
                ..original.clone()
            }
        );
    }
    // 2. initialDataMultiple: packed zip passed through.
    assert_eq!(
        as_pairs(&requests[1]),
        [
            ("token", TOKEN),
            ("annotationId", "0123456789abcdef01234567")
        ]
    );
    assert_eq!(
        requests[1].content_type.as_deref(),
        Some("application/octet-stream")
    );
    assert_eq!(requests[1].raw_body, zip_bytes());
    // 3. mergedFromContents: full tracings.
    assert_eq!(
        as_pairs(&requests[2]),
        [("token", TOKEN), ("newTracingId", "new-id")]
    );
    assert_eq!(
        requests[2].content_type.as_deref(),
        Some("application/x-protobuf")
    );
    assert_eq!(
        requests[2].raw_body,
        VolumeTracings {
            tracings: tracings
                .iter()
                .map(|t| VolumeTracingOpt {
                    tracing: Some(t.clone()),
                })
                .collect(),
        }
        .encode_to_vec()
    );

    // A failing initializeForMerge stops before the data source and the
    // remaining RPCs (Scala for-comprehension).
    let (base, mock) = routed_server().await;
    mock.route(
        "/tracings/volume/initializeForMerge",
        StatusCode::BAD_REQUEST,
        Vec::new(),
    );
    let other = ObjectId::new();
    assert_eq!(
        client
            .merge_volume_tracings_by_contents(
                &base,
                &other,
                "new-id",
                &tracings,
                zip_bytes(),
                VolumeSaveDataSource {
                    store: &store,
                    data_source: &data_source,
                    dataset_id: &dataset_id,
                },
            )
            .await,
        Err(ServiceError::UpstreamStatus(400))
    );
    assert!(store.find(&other).is_none());
    assert_eq!(mock.requests().len(), 1);
    // A failing initialDataMultiple happens after the data source was stored.
    mock.route(
        "/tracings/volume/initializeForMerge",
        StatusCode::OK,
        Vec::new(),
    );
    assert_eq!(
        client
            .merge_volume_tracings_by_contents(
                &base,
                &other,
                "new-id",
                &tracings,
                zip_bytes(),
                VolumeSaveDataSource {
                    store: &store,
                    data_source: &data_source,
                    dataset_id: &dataset_id,
                },
            )
            .await,
        Err(ServiceError::UpstreamStatus(404))
    );
    assert!(store.find(&other).is_some());
    assert_eq!(mock.requests().len(), 3);
}

#[tokio::test]
async fn merge_skeletons_by_contents_and_save_multiple_post_protobuf() {
    let (base, mock) = routed_server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    mock.route(
        "/tracings/skeleton/mergedFromContents",
        StatusCode::OK,
        Vec::new(),
    );
    mock.route(
        "/tracings/skeleton/saveMultiple",
        StatusCode::OK,
        serde_json::to_vec(&json!([
            {"status": "Full", "value": true},
            {"status": "Empty"},
            {"status": "Failure", "value": "could not save"},
            {"status": "Full", "value": false}
        ]))
        .unwrap(),
    );

    let first = skeleton_tracing();
    let second = SkeletonTracing {
        dataset_name: "other".to_owned(),
        ..skeleton_tracing()
    };
    client
        .merge_skeleton_tracings_by_contents(&base, "merged-id", &[&first, &second])
        .await
        .unwrap();
    let with_ids = skeletons_with_ids();
    assert_eq!(
        client.save_skeleton_tracings(&base, &with_ids).await,
        Ok(vec![
            SaveMultipleResult::Full,
            SaveMultipleResult::Empty,
            SaveMultipleResult::Failure("could not save".to_owned()),
            SaveMultipleResult::Full,
        ])
    );

    let requests = mock.requests();
    assert_eq!(requests.len(), 2);
    for observed in &requests {
        assert_eq!(observed.method, "POST");
        assert_eq!(
            observed.content_type.as_deref(),
            Some("application/x-protobuf")
        );
    }
    assert_eq!(requests[0].path, "/tracings/skeleton/mergedFromContents");
    assert_eq!(
        as_pairs(&requests[0]),
        [("token", TOKEN), ("newTracingId", "merged-id")]
    );
    assert_eq!(
        requests[0].raw_body,
        SkeletonTracings {
            tracings: vec![
                SkeletonTracingOpt {
                    tracing: Some(first),
                },
                SkeletonTracingOpt {
                    tracing: Some(second),
                },
            ],
        }
        .encode_to_vec()
    );
    assert_eq!(requests[1].path, "/tracings/skeleton/saveMultiple");
    assert_eq!(as_pairs(&requests[1]), [("token", TOKEN)]);
    assert_eq!(requests[1].raw_body, with_ids.encode_to_vec());

    // Box entries outside JsonHelper.boxFormat are InvalidJson.
    for body in [
        json!([{"status": "Full"}]),
        json!([{"status": "Full", "value": "true"}]),
        json!([{"status": "Failure"}]),
        json!([{"status": "Other"}]),
        json!({"status": "Empty"}),
    ] {
        mock.route(
            "/tracings/skeleton/saveMultiple",
            StatusCode::OK,
            serde_json::to_vec(&body).unwrap(),
        );
        assert_eq!(
            client.save_skeleton_tracings(&base, &with_ids).await,
            Err(ServiceError::InvalidJson),
            "{body}"
        );
    }
    mock.route(
        "/tracings/skeleton/saveMultiple",
        StatusCode::SERVICE_UNAVAILABLE,
        Vec::new(),
    );
    assert_eq!(
        client.save_skeleton_tracings(&base, &with_ids).await,
        Err(ServiceError::UpstreamStatus(503))
    );
    mock.route(
        "/tracings/skeleton/mergedFromContents",
        StatusCode::BAD_REQUEST,
        Vec::new(),
    );
    assert_eq!(
        client
            .merge_skeleton_tracings_by_contents(&base, "merged-id", &[])
            .await,
        Err(ServiceError::UpstreamStatus(400))
    );
}

#[tokio::test]
async fn duplicate_annotation_sends_scala_query_order_and_decodes_proto() {
    let (base, mock) = routed_server().await;
    let client = TracingStoreClient::new(config(Duration::from_secs(5))).unwrap();
    let path = "/tracings/annotation/aaaaaaaaaaaaaaaaaaaaaaaa/duplicate";
    mock.route(path, StatusCode::OK, annotation_proto().encode_to_vec());

    let request = duplicate_request();
    assert_eq!(
        client.duplicate_annotation(&base, &request).await,
        Ok(annotation_proto())
    );
    let plain = DuplicateAnnotationRequest {
        version: None,
        is_from_task: false,
        dataset_bounding_box: None,
        ..request
    };
    client.duplicate_annotation(&base, &plain).await.unwrap();

    let requests = mock.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].method, "POST");
    assert_eq!(requests[0].path, path);
    assert!(requests[0].raw_body.is_empty());
    assert_eq!(
        as_pairs(&requests[0]),
        [
            ("token", TOKEN),
            ("newAnnotationId", "bbbbbbbbbbbbbbbbbbbbbbbb"),
            ("version", "7"),
            ("datasetBoundingBox", "1,-2,3,40,50,60"),
            ("isFromTask", "true"),
            ("ownerId", "cccccccccccccccccccccccc"),
            ("requestingUserId", "dddddddddddddddddddddddd"),
        ]
    );
    assert_eq!(
        as_pairs(&requests[1]),
        [
            ("token", TOKEN),
            ("newAnnotationId", "bbbbbbbbbbbbbbbbbbbbbbbb"),
            ("isFromTask", "false"),
            ("ownerId", "cccccccccccccccccccccccc"),
            ("requestingUserId", "dddddddddddddddddddddddd"),
        ]
    );

    // An empty body lacks the required AnnotationProto fields.
    mock.route(path, StatusCode::OK, Vec::new());
    assert_eq!(
        client.duplicate_annotation(&base, &plain).await,
        Err(TracingStoreError::InvalidProtobuf)
    );
    mock.route(path, StatusCode::NOT_FOUND, b"secret".to_vec());
    assert_eq!(
        client.duplicate_annotation(&base, &plain).await,
        Err(TracingStoreError::Service(ServiceError::UpstreamStatus(
            404
        )))
    );
}

#[tokio::test]
async fn consolidated_upload_task_and_duplicate_rpcs_use_the_long_timeout() {
    let (base, mock) = routed_server().await;
    *mock.delay.lock().unwrap() = Duration::from_millis(300);
    let client = TracingStoreClient::with_long_timeout(
        config(Duration::from_millis(100)),
        Duration::from_secs(5),
    )
    .unwrap();
    let annotation_id = ObjectId::new();
    let store = AnnotationDataSourceStore::default();
    let data_source = json!({"dataLayers":[]});
    for path in [
        "/tracings/volume/v/initialData",
        "/tracings/volume/initializeForMerge",
        "/tracings/volume/v/initialDataMultiple",
        "/tracings/volume/mergedFromContents",
        "/tracings/skeleton/mergedFromContents",
    ] {
        mock.route(path, StatusCode::OK, Vec::new());
    }
    mock.route("/tracings/mapping/v/save", StatusCode::OK, b"1".to_vec());
    mock.route(
        "/tracings/skeleton/saveMultiple",
        StatusCode::OK,
        b"[]".to_vec(),
    );
    mock.route(
        "/tracings/annotation/aaaaaaaaaaaaaaaaaaaaaaaa/duplicate",
        StatusCode::OK,
        annotation_proto().encode_to_vec(),
    );

    client
        .upload_volume_initial_data(&base, &annotation_id, "v", None, None, Vec::new())
        .await
        .unwrap();
    assert_eq!(
        client
            .save_editable_mapping(&base, &annotation_id, "v", "b", 1, Vec::new())
            .await,
        Ok(1)
    );
    client
        .merge_volume_tracings_by_contents(
            &base,
            &annotation_id,
            "v",
            &[volume_tracing()],
            Vec::new(),
            VolumeSaveDataSource {
                store: &store,
                data_source: &data_source,
                dataset_id: &ObjectId::new(),
            },
        )
        .await
        .unwrap();
    client
        .merge_skeleton_tracings_by_contents(&base, "s", &[&skeleton_tracing()])
        .await
        .unwrap();
    assert_eq!(
        client
            .save_skeleton_tracings(&base, &skeletons_with_ids())
            .await,
        Ok(Vec::new())
    );
    client
        .duplicate_annotation(&base, &duplicate_request())
        .await
        .unwrap();
    assert_eq!(mock.requests().len(), 8);
}
