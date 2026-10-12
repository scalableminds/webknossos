//! POST /annotations/upload against a real database and one mock server acting
//! as tracing store and datastore.
mod common;

use std::io::{Cursor, Read, Write};
use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use common::{Fixture, TestDb, UserFixture, object_id};
use http_body_util::BodyExt;
use prost::Message;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    proto::{
        AnnotationLayerTypeProto, AnnotationProto, Vec3IntProto,
        datastore::{
            SkeletonTracings, VolumeTracing, VolumeTracings, volume_tracing::ElementClassProto,
        },
    },
    router,
};
use zip::write::SimpleFileOptions;

const BOUNDARY: &str = "wk-upload-test-boundary";
const SUCCESS: &str = "Successfully uploaded annotation file.";

// ---------------------------------------------------------------------------
// Mock tracing store + datastore
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Call {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Call {
    fn param(&self, key: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
    fn keys(&self) -> Vec<&str> {
        self.query.iter().map(|(k, _)| k.as_str()).collect()
    }
}

#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
    /// Path suffix answered with this status.
    fail: Arc<Mutex<Option<(String, u16)>>>,
}

impl Mock {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    /// Paths with tracing ids replaced by `:id`.
    fn paths(&self) -> Vec<String> {
        self.calls()
            .into_iter()
            .map(|c| {
                c.path
                    .split('/')
                    .map(|s| if s.len() == 36 { ":id" } else { s })
                    .collect::<Vec<_>>()
                    .join("/")
            })
            .collect()
    }
    fn fail(&self, suffix: &str, status: u16) {
        *self.fail.lock().unwrap() = Some((suffix.to_owned(), status));
    }
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_owned();
    let query: Vec<(String, String)> =
        serde_urlencoded::from_str(request.uri().query().unwrap_or("")).unwrap();
    let body = to_bytes(request.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    mock.calls.lock().unwrap().push(Call {
        method,
        path: path.clone(),
        query,
        body: body.to_vec(),
    });
    if let Some((suffix, status)) = mock.fail.lock().unwrap().clone()
        && path.ends_with(&suffix)
    {
        return (StatusCode::from_u16(status).unwrap(), "upstream secret").into_response();
    }
    if path.ends_with("/hasSegmentIndex") {
        return ([(header::CONTENT_TYPE, "application/json")], "false").into_response();
    }
    if path.starts_with("/tracings/mapping/") && path.ends_with("/save") {
        return ([(header::CONTENT_TYPE, "application/json")], "3").into_response();
    }
    StatusCode::OK.into_response()
}

async fn mock_server() -> (String, Mock) {
    let mock = Mock::default();
    let router = Router::new()
        .route("/{*path}", any(mock_handler))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}"), mock)
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

struct World {
    f: Fixture,
    foreign: UserFixture,
    dataset: String,
    mock: Mock,
    app: Router,
}

async fn world(db: &TestDb) -> World {
    let (url, mock) = mock_server().await;
    let f = db.fixture().await;
    let foreign = db
        .seed_user(&object_id(), &format!("foreign-{}", object_id()), true)
        .await;
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('upload-ds',$1,'https://data.example.test','k')")
        .bind(&url).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('upload-ts',$1,'https://trace.example.test','k')")
        .bind(&url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'upload-ds',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    for (name, category, element_class, largest, bbox, mags) in [
        (
            "color",
            "color",
            "uint8",
            None,
            (0, 0, 0, 100, 200, 50),
            vec![1, 2],
        ),
        (
            "segmentation",
            "segmentation",
            "uint16",
            Some(17_i64),
            (-10, 5, 0, 50, 50, 80),
            vec![1, 2, 4],
        ),
    ] {
        sqlx::query("INSERT INTO webknossos.dataset_layers(_dataset,name,category,elementClass,boundingBox,largestSegmentId,dataFormat) VALUES($1,$2,$3::webknossos.DATASET_LAYER_CATEGORY,$4::webknossos.DATASET_LAYER_ELEMENT_CLASS,ROW($5,$6,$7,$8,$9,$10)::webknossos.BOUNDING_BOX,$11,'wkw')")
            .bind(&dataset).bind(name).bind(category).bind(element_class)
            .bind(bbox.0).bind(bbox.1).bind(bbox.2).bind(bbox.3).bind(bbox.4).bind(bbox.5)
            .bind(largest)
            .execute(&db.pool).await.unwrap();
        for mag in mags {
            sqlx::query("INSERT INTO webknossos.dataset_mags(_dataset,dataLayerName,mag,path) VALUES($1,$2,ROW($3,$3,$3)::webknossos.vector3,$4)")
                .bind(&dataset).bind(name).bind(mag).bind(format!("{name}/{mag}"))
                .execute(&db.pool).await.unwrap();
        }
    }
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    World {
        f,
        foreign,
        dataset,
        mock,
        app,
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

enum Part<'a> {
    File(&'a str, Vec<u8>),
    Data(&'a str, &'a str),
}

fn multipart(parts: &[Part]) -> Vec<u8> {
    let mut body = Vec::new();
    for part in parts {
        body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
        match part {
            Part::File(name, bytes) => {
                body.extend_from_slice(
                    format!(
                        "Content-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
                    )
                    .as_bytes(),
                );
                body.extend_from_slice(bytes);
            }
            Part::Data(name, value) => {
                body.extend_from_slice(
                    format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}")
                        .as_bytes(),
                );
            }
        }
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    body
}

async fn upload(app: &Router, token: Option<&str>, parts: &[Part<'_>]) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/api/annotations/upload")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={BOUNDARY}"),
        );
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(multipart(parts))).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// NML on dataset directory `dir` with one tree; optional volume tag attributes.
fn nml(tree: &str, description: &str, volume: Option<&str>) -> Vec<u8> {
    let volume = volume
        .map(|attributes| format!("<volume id=\"0\" {attributes}/>"))
        .unwrap_or_default();
    format!(
        r#"<things><parameters><experiment name="dir" description="{description}"/></parameters>
<thing id="1" name="{tree}"><nodes><node id="1" x="1" y="2" z="3"/></nodes><edges/></thing>{volume}</things>"#
    )
    .into_bytes()
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        writer
            .start_file(*name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

async fn annotation_count(db: &TestDb) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM webknossos.annotations")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

/// (tracingId, typ, name, statistics) in insertion-independent name order.
async fn layers(db: &TestDb, id: &str) -> Vec<(String, String, String, Value)> {
    sqlx::query_as("SELECT tracingId,typ::text,name,statistics FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY name")
        .bind(id).fetch_all(&db.pool).await.unwrap()
}

fn find<'a>(calls: &'a [Call], suffix: &str) -> &'a Call {
    calls
        .iter()
        .find(|c| c.path.ends_with(suffix))
        .unwrap_or_else(|| panic!("no call {suffix} in {calls:?}"))
}

fn annotation_proto(calls: &[Call]) -> AnnotationProto {
    AnnotationProto::decode(find(calls, "/tracings/annotation/save").body.as_slice()).unwrap()
}

fn vec3(x: i32, y: i32, z: i32) -> Vec3IntProto {
    Vec3IntProto { x, y, z }
}

fn success_id(status: StatusCode, body: &Value) -> String {
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["annotation"]["typ"], "Explorational");
    assert_eq!(body["messages"], json!([{ "success": SUCCESS }]));
    let id = body["annotation"]["id"].as_str().unwrap().to_owned();
    assert_eq!(id.len(), 24);
    id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn single_nml_creates_explorational_with_merged_skeleton() {
    let db = TestDb::new().await;
    let w = world(&db).await;

    let (status, body) = upload(&w.app, None, &[Part::File("a.nml", nml("t", "", None))]).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    assert!(w.mock.calls().is_empty());

    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[
            Part::Data("createGroupForEachFile", "false"),
            Part::File(
                "my tracing.nml",
                nml("first tree", " My description ", None),
            ),
        ],
    )
    .await;
    let id = success_id(status, &body);

    assert_eq!(
        w.mock.paths(),
        [
            "/tracings/skeleton/mergedFromContents",
            "/tracings/annotation/save"
        ]
    );
    let calls = w.mock.calls();
    let merge = &calls[0];
    assert_eq!(merge.method, "POST");
    assert_eq!(merge.keys(), ["token", "newTracingId"]);
    let tracing_id = merge.param("newTracingId").unwrap().to_owned();
    assert!(uuid::Uuid::parse_str(&tracing_id).is_ok());
    let skeletons = SkeletonTracings::decode(merge.body.as_slice()).unwrap();
    assert_eq!(skeletons.tracings.len(), 1);
    let skeleton = skeletons.tracings[0].tracing.as_ref().unwrap();
    assert_eq!(skeleton.trees.len(), 1);
    assert_eq!(skeleton.trees[0].name, "first tree");
    assert_eq!(skeleton.dataset_name, "Dataset");

    let save = &calls[1];
    assert_eq!(save.keys(), ["token", "annotationId"]);
    assert_eq!(save.param("annotationId"), Some(id.as_str()));
    let proto = annotation_proto(&calls);
    assert_eq!(proto.description, "My description");
    assert_eq!(proto.version, 0);
    assert_eq!(proto.earliest_accessible_version, 0);
    assert_eq!(proto.annotation_layers.len(), 1);
    assert_eq!(proto.annotation_layers[0].tracing_id, tracing_id);
    assert_eq!(proto.annotation_layers[0].name, "Skeleton");
    assert_eq!(
        proto.annotation_layers[0].typ(),
        AnnotationLayerTypeProto::Skeleton
    );

    let row: (String, String, String, String, String, String, String, String, Option<String>) =
        sqlx::query_as(
            "SELECT _user,_dataset,typ::text,state::text,visibility::text,collaborationMode::text,name,description,_task FROM webknossos.annotations WHERE _id=$1",
        )
        .bind(&id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        row,
        (
            w.f.user_id.clone(),
            w.dataset.clone(),
            "Explorational".into(),
            "Active".into(),
            "Internal".into(),
            "OwnerOnly".into(),
            "my tracing".into(),
            "My description".into(),
            None
        )
    );
    assert_eq!(
        layers(&db, &id).await,
        [(tracing_id, "Skeleton".into(), "Skeleton".into(), json!({}))]
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn multiple_nmls_with_group_per_file_and_description_override() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[
            Part::Data("createGroupForEachFile", "true"),
            Part::Data("description", "custom"),
            Part::Data("datasetId", &w.dataset),
            Part::Data("fallbackEditPosition", "1,2,3"),
            Part::File("alpha.nml", nml("ta", "x", None)),
            Part::File("beta.nml", nml("tb", "y", None)),
        ],
    )
    .await;
    let id = success_id(status, &body);
    let calls = w.mock.calls();
    assert_eq!(
        w.mock.paths(),
        [
            "/tracings/skeleton/mergedFromContents",
            "/tracings/annotation/save"
        ]
    );
    let skeletons = SkeletonTracings::decode(calls[0].body.as_slice()).unwrap();
    let groups: Vec<(String, Vec<String>, Option<i32>)> = skeletons
        .tracings
        .iter()
        .map(|t| {
            let t = t.tracing.as_ref().unwrap();
            (
                t.tree_groups[0].name.clone(),
                t.trees.iter().map(|tree| tree.name.clone()).collect(),
                t.trees[0].group_id,
            )
        })
        .collect();
    assert_eq!(
        groups,
        [
            ("alpha".into(), vec!["ta".to_owned()], Some(1)),
            ("beta".into(), vec!["tb".to_owned()], Some(1)),
        ]
    );
    assert_eq!(annotation_proto(&calls).description, "custom");
    let (name, description): (String, String) =
        sqlx::query_as("SELECT name,description FROM webknossos.annotations WHERE _id=$1")
            .bind(&id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!((name.as_str(), description.as_str()), ("", "custom"));
    assert_eq!(layers(&db, &id).await.len(), 1);

    // An unparsable fallback value is Fox.empty: 404 before any work.
    let before = w.mock.calls().len();
    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[
            Part::Data("fallbackZoomLevel", "abc"),
            Part::File("a.nml", nml("t", "", None)),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert_eq!(w.mock.calls().len(), before);
    assert_eq!(annotation_count(&db).await, 1);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn zip_with_volume_data_saves_volume_and_forwards_initial_data() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let data = b"volume data zip bytes".to_vec();
    let archive = zip_of(&[
        (
            "annotation.nml",
            &nml(
                "t",
                "",
                Some(r#"location="data_Volume.zip" name="My_volume" fallbackLayer="segmentation""#),
            ),
        ),
        ("data_Volume.zip", &data),
    ]);
    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[Part::File("upload.zip", archive)],
    )
    .await;
    let id = success_id(status, &body);
    assert_eq!(
        w.mock.paths(),
        [
            format!(
                "/data/datasets/{}/layers/segmentation/hasSegmentIndex",
                w.dataset
            ),
            "/tracings/volume/save".into(),
            "/tracings/volume/:id/initialData".into(),
            "/tracings/skeleton/mergedFromContents".into(),
            "/tracings/annotation/save".into(),
        ]
    );
    let calls = w.mock.calls();
    let save = &calls[1];
    let volume_id = save.param("newTracingId").unwrap().to_owned();
    let volume = VolumeTracing::decode(save.body.as_slice()).unwrap();
    assert_eq!(volume.fallback_layer.as_deref(), Some("segmentation"));
    assert_eq!(volume.element_class(), ElementClassProto::Uint16);
    assert_eq!(volume.largest_segment_id, Some(17));
    assert_eq!(volume.has_segment_index, Some(false));
    assert_eq!(volume.mags, [vec3(1, 1, 1), vec3(2, 2, 2), vec3(4, 4, 4)]);
    assert_eq!(volume.bounding_box.top_left, vec3(-10, 5, 0));
    assert_eq!(
        (
            volume.bounding_box.width,
            volume.bounding_box.height,
            volume.bounding_box.depth
        ),
        (50, 50, 80)
    );
    assert_eq!(volume.mapping_name, None);

    let initial = &calls[2];
    assert_eq!(
        initial.path,
        format!("/tracings/volume/{volume_id}/initialData")
    );
    assert_eq!(initial.keys(), ["token", "annotationId"]);
    assert_eq!(initial.param("annotationId"), Some(id.as_str()));
    assert_eq!(initial.body, data);

    let proto = annotation_proto(&calls);
    let proto_layers: Vec<(String, AnnotationLayerTypeProto)> = proto
        .annotation_layers
        .iter()
        .map(|l| (l.name.clone(), l.typ()))
        .collect();
    assert_eq!(
        proto_layers,
        [
            ("Skeleton".into(), AnnotationLayerTypeProto::Skeleton),
            ("My_volume".into(), AnnotationLayerTypeProto::Volume),
        ]
    );
    assert_eq!(proto.earliest_accessible_version, 0);
    let stored = layers(&db, &id).await;
    assert_eq!(
        stored
            .iter()
            .map(|(t, typ, name, stats)| (t == &volume_id, typ.as_str(), name.as_str(), stats))
            .collect::<Vec<_>>(),
        [
            (true, "Volume", "My_volume", &json!({})),
            (false, "Skeleton", "Skeleton", &json!({})),
        ]
    );
    let name: String = sqlx::query_scalar("SELECT name FROM webknossos.annotations WHERE _id=$1")
        .bind(&id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(name, "upload");
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn editable_mapping_and_merged_volumes() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    // One annotation with an editable mapping: mapping save first (startVersion 1,
    // 3 versions saved → earliestAccessibleVersion 4), mappingName = tracing id.
    let edges = b"edges zip".to_vec();
    let archive = zip_of(&[
        (
            "proofread.nml",
            &nml(
                "t",
                "",
                Some(
                    r#"location="data.zip" editedMappingEdgesLocation="edges.zip" editedMappingBaseMappingName="agglomerate_view""#,
                ),
            ),
        ),
        ("edges.zip", &edges),
    ]);
    let (status, body) = upload(&w.app, Some(&w.f.token), &[Part::File("p.zip", archive)]).await;
    let id = success_id(status, &body);
    assert_eq!(
        w.mock.paths(),
        [
            "/tracings/mapping/:id/save",
            "/tracings/volume/save",
            "/tracings/skeleton/mergedFromContents",
            "/tracings/annotation/save"
        ]
    );
    let calls = w.mock.calls();
    let mapping = &calls[0];
    let volume_id = mapping.path.split('/').nth(3).unwrap().to_owned();
    assert_eq!(
        mapping.keys(),
        ["token", "annotationId", "baseMappingName", "startVersion"]
    );
    assert_eq!(mapping.param("annotationId"), Some(id.as_str()));
    assert_eq!(mapping.param("baseMappingName"), Some("agglomerate_view"));
    assert_eq!(mapping.param("startVersion"), Some("1"));
    assert_eq!(mapping.body, edges);
    let volume = VolumeTracing::decode(calls[1].body.as_slice()).unwrap();
    assert_eq!(calls[1].param("newTracingId"), Some(volume_id.as_str()));
    assert_eq!(volume.mapping_name.as_deref(), Some(volume_id.as_str()));
    assert_eq!(volume.has_editable_mapping, Some(true));
    // No fallback layer: default element class, data source box/mags, no RPC.
    assert_eq!(volume.element_class(), ElementClassProto::Uint32);
    assert_eq!(volume.has_segment_index, Some(true));
    assert_eq!(volume.bounding_box.top_left, vec3(-10, 0, 0));
    let proto = annotation_proto(&calls);
    assert_eq!(proto.earliest_accessible_version, 4);
    assert_eq!(proto.annotation_layers[1].name, "Volume0");

    // Two annotations with one volume layer each: merged into one `Volume` layer.
    let before = w.mock.calls().len();
    let first = zip_of(&[
        ("a.nml", &nml("ta", "", Some(r#"location="data_a.zip""#))),
        ("data_a.zip", b"AAA"),
    ]);
    let second = zip_of(&[
        ("b.nml", &nml("tb", "", Some(r#"location="data_b.zip""#))),
        ("data_b.zip", b"BBB"),
    ]);
    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[Part::File("a.zip", first), Part::File("b.zip", second)],
    )
    .await;
    let merged_id = success_id(status, &body);
    let paths = w.mock.paths()[before..].to_vec();
    assert_eq!(
        paths,
        [
            "/tracings/volume/initializeForMerge",
            "/tracings/volume/:id/initialDataMultiple",
            "/tracings/volume/mergedFromContents",
            "/tracings/skeleton/mergedFromContents",
            "/tracings/annotation/save"
        ]
    );
    let calls = w.mock.calls()[before..].to_vec();
    let new_tracing_id = calls[0].param("newTracingId").unwrap().to_owned();
    assert_eq!(
        calls[2].param("newTracingId"),
        Some(new_tracing_id.as_str())
    );
    assert_eq!(
        calls[1].path,
        format!("/tracings/volume/{new_tracing_id}/initialDataMultiple")
    );
    assert_eq!(calls[1].param("annotationId"), Some(merged_id.as_str()));
    let mut packed = zip::ZipArchive::new(Cursor::new(calls[1].body.clone())).unwrap();
    let mut contents = Vec::new();
    for index in 0..packed.len() {
        let mut entry = packed.by_index(index).unwrap();
        let mut content = String::new();
        entry.read_to_string(&mut content).unwrap();
        contents.push(content);
    }
    assert_eq!(contents, ["AAA", "BBB"]);
    let thinned = VolumeTracings::decode(calls[0].body.as_slice()).unwrap();
    assert_eq!(thinned.tracings.len(), 2);
    let full = VolumeTracings::decode(calls[2].body.as_slice()).unwrap();
    assert_eq!(full.tracings.len(), 2);
    let proto = annotation_proto(&calls);
    assert_eq!(proto.annotation_layers[1].name, "Volume");
    assert_eq!(proto.annotation_layers[1].tracing_id, new_tracing_id);
    assert_eq!(proto.earliest_accessible_version, 0);

    // Merge rules: two annotations with an editable mapping → 400, no RPC, no row.
    let before = w.mock.calls().len();
    let rows = annotation_count(&db).await;
    let proofread = zip_of(&[(
        "c.nml",
        &nml(
            "tc",
            "",
            Some(r#"location="d.zip" editedMappingEdgesLocation="e.zip""#),
        ),
    )]);
    let plain = zip_of(&[("d.nml", &nml("td", "", Some(r#"location="d.zip""#)))]);
    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[Part::File("c.zip", proofread), Part::File("d.zip", plain)],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        body,
        json!({"messages":[{"error":"Cannot merge multiple annotations with editable mapping (proofreading) edges."}]})
    );
    assert_eq!(w.mock.calls().len(), before);
    assert_eq!(annotation_count(&db).await, rows);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn parse_and_dataset_failures_return_message_lists() {
    let db = TestDb::new().await;
    let w = world(&db).await;

    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[Part::File("bad.nml", b"<things><broken".to_vec())],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert!(
        messages[0]["error"]
            .as_str()
            .unwrap()
            .starts_with("Could not parse file “bad.nml”: "),
        "{body}"
    );

    // No files at all: returnError without failures.
    let (status, body) = upload(&w.app, Some(&w.f.token), &[]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"messages":[{"error":"NML upload failed"}]}));

    // Unknown dataset id: the per-NML lookup fails.
    let missing = object_id();
    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[
            Part::Data("datasetId", &missing),
            Part::File("a.nml", nml("t", "", None)),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        body,
        json!({"messages":[{"error": format!("Could not parse file “a.nml”: Dataset “{missing}” could not be found or accessed.")}]})
    );

    // A user of another organization cannot read the dataset.
    let (status, body) = upload(
        &w.app,
        Some(&w.foreign.token),
        &[
            Part::Data("datasetId", &w.dataset),
            Part::File("a.nml", nml("t", "", None)),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body["messages"][0]["error"]
            .as_str()
            .unwrap()
            .contains("could not be found or accessed"),
        "{body}"
    );

    // NMLs on different datasets: differentDatasets.
    let other = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'upload-ds',_id,_rootfolder,'Other','other',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&other).bind(&w.f.organization_id).execute(&db.pool).await.unwrap();
    let other_nml = String::from_utf8(nml("t", "", None))
        .unwrap()
        .replace(r#"name="dir""#, r#"name="other""#);
    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[
            Part::File("a.nml", nml("t", "", None)),
            Part::File("b.nml", other_nml.into_bytes()),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body["messages"][0]["error"]
            .as_str()
            .unwrap()
            .contains("different datasets"),
        "{body}"
    );

    assert!(w.mock.calls().is_empty());
    assert_eq!(annotation_count(&db).await, 0);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn rpc_failures_leave_no_rows() {
    let db = TestDb::new().await;
    let w = world(&db).await;

    w.mock.fail("/tracings/annotation/save", 503);
    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[Part::File("a.nml", nml("t", "", None))],
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert!(!body.to_string().contains("upstream secret"));
    assert_eq!(annotation_count(&db).await, 0);

    w.mock.fail("/initialData", 500);
    let archive = zip_of(&[
        ("v.nml", &nml("t", "", Some(r#"location="data.zip""#))),
        ("data.zip", b"data"),
    ]);
    let (status, body) = upload(&w.app, Some(&w.f.token), &[Part::File("v.zip", archive)]).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
    // The request stops at the failing RPC.
    assert_eq!(
        w.mock.paths().last().map(String::as_str),
        Some("/tracings/volume/:id/initialData")
    );
    assert_eq!(annotation_count(&db).await, 0);

    // Unusable dataset: no RPC at all.
    sqlx::query("UPDATE webknossos.datasets SET isUsable=false WHERE _id=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let before = w.mock.calls().len();
    let (status, body) = upload(
        &w.app,
        Some(&w.f.token),
        &[
            Part::Data("datasetId", &w.dataset),
            Part::File("a.nml", nml("t", "", None)),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(w.mock.calls().len(), before);
    assert_eq!(annotation_count(&db).await, 0);
    db.cleanup().await;
}
