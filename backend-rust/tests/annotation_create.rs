//! POST /datasets/:datasetId/createExplorational and the tracing-store
//! callback POST /tracingstores/:name/createTracing against a real database
//! and one mock server acting as tracing store and datastore.
mod common;

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
        AnnotationLayerTypeProto, AnnotationProto, BoundingBoxProto, NamedBoundingBoxProto,
        Vec3DoubleProto, Vec3IntProto,
        datastore::{
            AdditionalCoordinateProto, Id32WithBool, SkeletonTracing, SkeletonUserStateProto,
            VolumeTracing, volume_tracing::ElementClassProto,
        },
    },
    router,
};

const KEY: &str = "create-tracing-service-key";
const CREATE_FAILED: &str = "Could not create annotation.";

fn error(message: &str) -> Value {
    json!({"messages":[{"error": message}]})
}

async fn send(
    app: &Router,
    method: Method,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Option<String>, Vec<u8>) {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let body = match body {
        Some(body) => {
            request = request.header(header::CONTENT_TYPE, "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, content_type, bytes.to_vec())
}

async fn create(
    app: &Router,
    token: Option<&str>,
    dataset: &str,
    body: Value,
) -> (StatusCode, Value) {
    let (status, _, bytes) = send(
        app,
        Method::POST,
        &format!("/api/datasets/{dataset}/createExplorational"),
        token,
        Some(body),
    )
    .await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

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
    /// Paths (suffix match) answered with this status.
    fail: Arc<Mutex<Option<(String, u16)>>>,
    has_segment_index: Arc<Mutex<bool>>,
    /// Answer for GET /tracings/skeleton/:id.
    skeleton: Arc<Mutex<Option<SkeletonTracing>>>,
}

impl Mock {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn paths(&self) -> Vec<String> {
        self.calls().into_iter().map(|c| c.path).collect()
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
    let body = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
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
        let answer = *mock.has_segment_index.lock().unwrap();
        return (
            [(header::CONTENT_TYPE, "application/json")],
            answer.to_string(),
        )
            .into_response();
    }
    if path.starts_with("/tracings/skeleton/") && !path.ends_with("/save") {
        let tracing = mock.skeleton.lock().unwrap().clone().unwrap();
        return (
            [(header::CONTENT_TYPE, "application/x-protobuf")],
            tracing.encode_to_vec(),
        )
            .into_response();
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
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('create-ds',$1,'https://data.example.test','k')")
        .bind(&url).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('create-ts',$1,'https://trace.example.test',$2)")
        .bind(&url).bind(KEY).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'create-ds',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
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
            "uint32",
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

async fn annotation_count(db: &TestDb) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM webknossos.annotations")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

async fn layers(db: &TestDb, id: &str) -> Vec<(String, String, String, Value)> {
    sqlx::query_as("SELECT tracingId,typ::text,name,statistics FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY name")
        .bind(id).fetch_all(&db.pool).await.unwrap()
}

fn vec3(x: i32, y: i32, z: i32) -> Vec3IntProto {
    Vec3IntProto { x, y, z }
}

fn find<'a>(calls: &'a [Call], suffix: &str) -> &'a Call {
    calls
        .iter()
        .find(|c| c.path.ends_with(suffix))
        .unwrap_or_else(|| panic!("no call {suffix} in {calls:?}"))
}

fn assert_uuid(value: &str) {
    assert!(uuid::Uuid::parse_str(value).is_ok(), "{value}");
    assert_eq!(value.len(), 36);
}

const SKELETON_STATS: &str =
    r#"{"treeCount":0,"nodeCount":0,"edgeCount":0,"branchPointCount":0,"boundingBoxCount":0}"#;
const VOLUME_STATS: &str = r#"{"segmentCount":0,"boundingBoxCount":0}"#;

// ---------------------------------------------------------------------------
// createExplorational
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn create_skeleton_only_saves_then_inserts() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let (status, body) = create(
        &w.app,
        Some(&w.f.token),
        &w.dataset,
        json!([{"typ": "Skeleton"}]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["id"].as_str().unwrap().to_owned();
    assert_eq!(id.len(), 24);

    let calls = w.mock.calls();
    assert_eq!(
        w.mock.paths(),
        ["/tracings/skeleton/save", "/tracings/annotation/save"]
    );
    let save = &calls[0];
    assert_eq!(save.method, "POST");
    assert_eq!(save.keys(), ["token", "newTracingId"]);
    let tracing_id = save.param("newTracingId").unwrap().to_owned();
    assert_uuid(&tracing_id);
    let skeleton = SkeletonTracing::decode(save.body.as_slice()).unwrap();
    assert_eq!(skeleton.dataset_name, "Dataset");
    assert_eq!(
        skeleton.organization_id.as_deref(),
        Some(w.f.organization_id.as_str())
    );
    // Union box (-10,0,0) .. (100,200,80): center (45,100,40).
    assert_eq!(skeleton.edit_position, vec3(45, 100, 40));
    assert_eq!(skeleton.zoom_level, 2.0);
    assert_eq!(skeleton.version, 0);
    assert!(skeleton.trees.is_empty() && skeleton.user_states.is_empty());

    let annotation_save = &calls[1];
    assert_eq!(annotation_save.keys(), ["token", "annotationId"]);
    assert_eq!(annotation_save.param("annotationId"), Some(id.as_str()));
    let proto = AnnotationProto::decode(annotation_save.body.as_slice()).unwrap();
    assert_eq!(proto.description, "");
    assert_eq!(proto.version, 0);
    assert_eq!(proto.earliest_accessible_version, 0);
    assert_eq!(proto.annotation_layers.len(), 1);
    assert_eq!(proto.annotation_layers[0].tracing_id, tracing_id);
    assert_eq!(proto.annotation_layers[0].name, "Skeleton");
    assert_eq!(
        proto.annotation_layers[0].typ(),
        AnnotationLayerTypeProto::Skeleton
    );

    // Response: publicWrites of the inserted annotation.
    assert_eq!(body["typ"], "Explorational");
    assert_eq!(body["state"], "Active");
    assert_eq!(body["name"], "");
    assert_eq!(body["description"], "");
    assert_eq!(body["visibility"], "Internal");
    assert_eq!(body["collaborationMode"], "OwnerOnly");
    assert_eq!(body["datasetId"], w.dataset.as_str());
    assert_eq!(body["owner"]["id"], w.f.user_id.as_str());
    assert_eq!(body["restrictions"]["allowUpdate"], true);
    assert_eq!(
        body["annotationLayers"][0]["tracingId"],
        tracing_id.as_str()
    );
    assert_eq!(body["annotationLayers"][0]["typ"], "Skeleton");
    assert_eq!(body["annotationLayers"][0]["name"], "Skeleton");

    let row: (String, String, String, String, String, Option<String>) = sqlx::query_as(
        "SELECT _user,_dataset,typ::text,state::text,visibility::text,_task FROM webknossos.annotations WHERE _id=$1",
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
            None
        )
    );
    assert_eq!(
        layers(&db, &id).await,
        [(
            tracing_id,
            "Skeleton".into(),
            "Skeleton".into(),
            serde_json::from_str::<Value>(SKELETON_STATS).unwrap()
        )]
    );
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn create_volume_with_auto_fallback_layer_asks_datastore() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    *w.mock.has_segment_index.lock().unwrap() = false;
    let (status, body) = create(
        &w.app,
        Some(&w.f.token),
        &w.dataset,
        json!([{"typ": "Volume", "autoFallbackLayer": true, "mappingName": "agglomerate"}]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["id"].as_str().unwrap().to_owned();
    let calls = w.mock.calls();
    assert_eq!(
        w.mock.paths(),
        [
            format!(
                "/data/datasets/{}/layers/segmentation/hasSegmentIndex",
                w.dataset
            ),
            "/tracings/volume/save".into(),
            "/tracings/annotation/save".into(),
        ]
    );
    assert_eq!(calls[0].method, "GET");
    assert_eq!(calls[0].keys(), ["token"]);
    let save = &calls[1];
    assert_eq!(save.keys(), ["token", "newTracingId"]);
    let tracing_id = save.param("newTracingId").unwrap().to_owned();
    assert_uuid(&tracing_id);
    let volume = VolumeTracing::decode(save.body.as_slice()).unwrap();
    assert_eq!(volume.fallback_layer.as_deref(), Some("segmentation"));
    assert_eq!(volume.largest_segment_id, Some(17));
    assert_eq!(volume.element_class(), ElementClassProto::Uint32);
    assert_eq!(volume.has_segment_index, Some(false));
    assert_eq!(volume.mapping_name.as_deref(), Some("agglomerate"));
    assert_eq!(volume.dataset_name, "dir");
    assert_eq!(
        volume.bounding_box,
        BoundingBoxProto {
            top_left: vec3(-10, 5, 0),
            width: 50,
            height: 50,
            depth: 80
        }
    );
    assert_eq!(volume.mags, [vec3(1, 1, 1), vec3(2, 2, 2), vec3(4, 4, 4)]);
    assert_eq!(volume.zoom_level, 1.0);

    let proto = AnnotationProto::decode(calls[2].body.as_slice()).unwrap();
    assert_eq!(proto.annotation_layers[0].name, "segmentation");
    assert_eq!(
        proto.annotation_layers[0].typ(),
        AnnotationLayerTypeProto::Volume
    );
    assert_eq!(
        layers(&db, &id).await,
        [(
            tracing_id,
            "Volume".into(),
            "segmentation".into(),
            serde_json::from_str::<Value>(VOLUME_STATS).unwrap()
        )]
    );
    assert_eq!(body["annotationLayers"][0]["name"], "segmentation");
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn create_skeleton_and_volume_serially() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let (status, body) = create(
        &w.app,
        Some(&w.f.token),
        &w.dataset,
        json!([{"typ": "Skeleton", "name": "Trees"}, {"typ": "Volume", "name": "Paint", "magRestrictions": {"min": 2}}]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["id"].as_str().unwrap().to_owned();
    // No fallback layer: no datastore call.
    assert_eq!(
        w.mock.paths(),
        [
            "/tracings/skeleton/save",
            "/tracings/volume/save",
            "/tracings/annotation/save"
        ]
    );
    let calls = w.mock.calls();
    let volume = VolumeTracing::decode(calls[1].body.as_slice()).unwrap();
    assert_eq!(volume.fallback_layer, None);
    assert_eq!(volume.largest_segment_id, Some(0));
    assert_eq!(volume.has_segment_index, Some(true));
    assert!(!volume.mags.is_empty());
    assert!(volume.mags.iter().all(|m| m.x.max(m.y).max(m.z) >= 2));
    let proto = AnnotationProto::decode(calls[2].body.as_slice()).unwrap();
    let names: Vec<_> = proto
        .annotation_layers
        .iter()
        .map(|l| (l.name.as_str(), l.tracing_id.as_str()))
        .collect();
    assert_eq!(
        names,
        [
            ("Trees", calls[0].param("newTracingId").unwrap()),
            ("Paint", calls[1].param("newTracingId").unwrap())
        ]
    );
    let stored = layers(&db, &id).await;
    assert_eq!(stored.len(), 2);
    assert_eq!(
        (stored[0].2.as_str(), stored[0].1.as_str()),
        ("Paint", "Volume")
    );
    assert_eq!(
        (stored[1].2.as_str(), stored[1].1.as_str()),
        ("Trees", "Skeleton")
    );
    assert_eq!(
        stored[1].3,
        serde_json::from_str::<Value>(SKELETON_STATS).unwrap()
    );
    // The data source of the new annotation is served to the tracing store.
    let (status, _, bytes) = send(
        &w.app,
        Method::GET,
        &format!("/api/tracingstores/create-ts/dataSource?key={KEY}&annotationId={id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let source: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(source["id"]["name"], "dir");
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn create_rejects_invalid_fallback_layer_and_bad_requests() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let before = annotation_count(&db).await;
    // A color layer is no segmentation layer (Fox.empty), a missing one
    // likewise; the too-tight mags fail with their own chain message.
    for params in [
        json!([{"typ": "Volume", "fallbackLayerName": "color"}]),
        json!([{"typ": "Volume", "fallbackLayerName": "missing"}]),
        json!([{"typ": "Skeleton"}, {"typ": "Volume", "magRestrictions": {"min": 64}}]),
    ] {
        let (status, body) = create(&w.app, Some(&w.f.token), &w.dataset, params).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(body, error(CREATE_FAILED));
    }
    // The skeleton of the last request was saved before the volume failed
    // (Scala serial order); nothing else reached the stores.
    assert_eq!(w.mock.paths(), ["/tracings/skeleton/save"]);
    assert_eq!(annotation_count(&db).await, before);

    // Invalid body.
    let (status, _) = create(
        &w.app,
        Some(&w.f.token),
        &w.dataset,
        json!([{"typ": "Hybrid"}]),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Unauthenticated.
    let (status, _) = create(&w.app, None, &w.dataset, json!([])).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(annotation_count(&db).await, before);
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn create_unknown_or_foreign_dataset_is_404() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let unknown = object_id();
    let (status, body) = create(&w.app, Some(&w.f.token), &unknown, json!([])).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        error(&format!(
            "Dataset “{unknown}” could not be found or accessed."
        ))
    );
    let (status, body) = create(&w.app, Some(&w.foreign.token), &w.dataset, json!([])).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        error(&format!(
            "Dataset “{}” could not be found or accessed.",
            w.dataset
        ))
    );
    assert!(w.mock.calls().is_empty());

    // An unusable dataset fails inside createLayersForExplorational.
    sqlx::query("UPDATE webknossos.datasets SET isUsable=false WHERE _id=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = create(&w.app, Some(&w.f.token), &w.dataset, json!([])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error(CREATE_FAILED));
    assert_eq!(annotation_count(&db).await, 0);
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn create_rpc_failure_leaves_no_annotation_row() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let before = annotation_count(&db).await;
    let layer_rows = || async {
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM webknossos.annotation_layers")
            .fetch_one(&db.pool)
            .await
            .unwrap()
    };

    w.mock.fail("/tracings/annotation/save", 500);
    let (status, body) = create(
        &w.app,
        Some(&w.f.token),
        &w.dataset,
        json!([{"typ": "Skeleton"}]),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
    assert_eq!(body, error(CREATE_FAILED));
    assert!(!body.to_string().contains("upstream secret"));

    w.mock.fail("/tracings/skeleton/save", 400);
    let (status, body) = create(
        &w.app,
        Some(&w.f.token),
        &w.dataset,
        json!([{"typ": "Skeleton"}]),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error(CREATE_FAILED));

    w.mock.fail("/hasSegmentIndex", 503);
    let (status, body) = create(
        &w.app,
        Some(&w.f.token),
        &w.dataset,
        json!([{"typ": "Volume", "fallbackLayerName": "segmentation"}]),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, error(CREATE_FAILED));

    assert_eq!(annotation_count(&db).await, before);
    assert_eq!(layer_rows().await, 0);

    // No tracing store at all.
    sqlx::query("DELETE FROM webknossos.tracingStores")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = create(&w.app, Some(&w.f.token), &w.dataset, json!([])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error(CREATE_FAILED));
    assert_eq!(annotation_count(&db).await, before);
}

// ---------------------------------------------------------------------------
// createTracing callback
// ---------------------------------------------------------------------------

async fn create_tracing(
    w: &World,
    key: &str,
    annotation: &str,
    body: Value,
) -> (StatusCode, Option<String>, Vec<u8>) {
    send(
        &w.app,
        Method::POST,
        &format!(
            "/api/v16/tracingstores/informational/createTracing?key={key}&annotationId={annotation}&previousVersion=7"
        ),
        None,
        Some(body),
    )
    .await
}

async fn seeded_annotation(db: &TestDb, w: &World) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,state,visibility) VALUES($1,$2,$3,'Explorational','Finished','Private')")
        .bind(&id).bind(&w.dataset).bind(&w.f.user_id).execute(&db.pool).await.unwrap();
    // Skeleton layers win precedence over volume layers regardless of id.
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'a-volume','Volume','Volume','{}'),($1,'z-skeleton','Skeleton','Skeleton','{}')")
        .bind(&id).execute(&db.pool).await.unwrap();
    id
}

fn old_precedence_skeleton() -> SkeletonTracing {
    let bbox = BoundingBoxProto {
        top_left: vec3(1, 1, 1),
        width: 5,
        height: 6,
        depth: 7,
    };
    SkeletonTracing {
        dataset_name: "Dataset".into(),
        created_timestamp: 1,
        edit_position: vec3(11, 22, 33),
        edit_rotation: Vec3DoubleProto {
            x: 90.0,
            y: 0.0,
            z: 45.0,
        },
        zoom_level: 3.5,
        version: 7,
        user_bounding_box: Some(bbox),
        user_bounding_boxes: vec![NamedBoundingBoxProto {
            id: 4,
            name: Some("box".into()),
            is_visible: Some(false),
            color: None,
            bounding_box: bbox,
        }],
        edit_position_additional_coordinates: vec![AdditionalCoordinateProto {
            name: "t".into(),
            value: 3,
        }],
        user_states: vec![SkeletonUserStateProto {
            user_id: "user-one".into(),
            active_node_id: Some(1),
            tree_group_expanded_states: Vec::new(),
            bounding_box_visibilities: vec![Id32WithBool { id: 4, value: true }],
            tree_visibilities: Vec::new(),
        }],
        ..Default::default()
    }
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn create_tracing_checks_key_and_annotation() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let id = seeded_annotation(&db, &w).await;

    let (status, _, body) = create_tracing(&w, "wrong-key", &id, json!({"typ": "Skeleton"})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        String::from_utf8(body).unwrap(),
        "Tracing store could not be found or accessed."
    );
    // The JSON body is validated before the key.
    let (status, _, _) = create_tracing(&w, "wrong-key", &id, json!({"typ": 1})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let unknown = object_id();
    let (status, _, body) = create_tracing(&w, KEY, &unknown, json!({"typ": "Skeleton"})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        error("Annotation could not be found or accessed.")
    );
    assert!(w.mock.calls().is_empty());
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn create_tracing_returns_adapted_tracing_bytes() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let id = seeded_annotation(&db, &w).await;
    *w.mock.skeleton.lock().unwrap() = Some(old_precedence_skeleton());
    *w.mock.has_segment_index.lock().unwrap() = true;

    let (status, content_type, body) = create_tracing(
        &w,
        KEY,
        &id,
        json!({"typ": "Volume", "fallbackLayerName": "segmentation"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    assert_eq!(content_type.as_deref(), Some("application/x-protobuf"));

    let calls = w.mock.calls();
    let fetch = find(&calls, "/tracings/skeleton/z-skeleton");
    assert_eq!(fetch.method, "GET");
    assert_eq!(fetch.keys(), ["token", "annotationId", "version"]);
    assert_eq!(fetch.param("annotationId"), Some(id.as_str()));
    assert_eq!(fetch.param("version"), Some("7"));
    find(&calls, "/layers/segmentation/hasSegmentIndex");
    // Nothing is saved by the callback.
    assert!(calls.iter().all(|c| !c.path.ends_with("/save")));
    assert_eq!(calls.len(), 2);

    let volume = VolumeTracing::decode(body.as_slice()).unwrap();
    let old = old_precedence_skeleton();
    assert_eq!(volume.fallback_layer.as_deref(), Some("segmentation"));
    assert_eq!(volume.has_segment_index, Some(true));
    assert_eq!(volume.largest_segment_id, Some(17));
    // Redundant properties come from the old precedence layer.
    assert_eq!(volume.edit_position, old.edit_position);
    assert_eq!(volume.edit_rotation, old.edit_rotation);
    assert_eq!(volume.zoom_level, 3.5);
    assert_eq!(
        volume.edit_position_additional_coordinates,
        old.edit_position_additional_coordinates
    );
    // userBoundingBoxes ++ the legacy single userBoundingBox (id 0).
    assert_eq!(volume.user_bounding_boxes.len(), 2);
    assert_eq!(volume.user_bounding_boxes[0], old.user_bounding_boxes[0]);
    assert_eq!(volume.user_bounding_boxes[1].id, 0);
    assert_eq!(
        volume.user_bounding_boxes[1].bounding_box,
        old.user_bounding_box.unwrap()
    );
    assert_eq!(volume.user_states.len(), 1);
    assert_eq!(volume.user_states[0].user_id, "user-one");
    assert_eq!(
        volume.user_states[0].bounding_box_visibilities,
        [Id32WithBool { id: 4, value: true }]
    );

    // A skeleton layer is adapted likewise; an annotation without layers needs no fetch.
    let (status, _, body) = create_tracing(&w, KEY, &id, json!({"typ": "Skeleton"})).await;
    assert_eq!(status, StatusCode::OK);
    let skeleton = SkeletonTracing::decode(body.as_slice()).unwrap();
    assert_eq!(skeleton.edit_position, old.edit_position);
    assert_eq!(skeleton.zoom_level, 3.5);
    assert_eq!(skeleton.dataset_name, "Dataset");

    sqlx::query("DELETE FROM webknossos.annotation_layers WHERE _annotation=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    let fetches_before = w
        .mock
        .paths()
        .iter()
        .filter(|p| p.contains("z-skeleton"))
        .count();
    let (status, _, body) = create_tracing(&w, KEY, &id, json!({"typ": "Skeleton"})).await;
    assert_eq!(status, StatusCode::OK);
    let skeleton = SkeletonTracing::decode(body.as_slice()).unwrap();
    assert_eq!(skeleton.edit_position, vec3(45, 100, 40));
    assert_eq!(skeleton.zoom_level, 2.0);
    assert_eq!(
        w.mock
            .paths()
            .iter()
            .filter(|p| p.contains("z-skeleton"))
            .count(),
        fetches_before
    );

    // Upstream fetch failure keeps its status; invalid fallback layer is Fox.empty.
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'z-skeleton','Skeleton','Skeleton','{}')")
        .bind(&id).execute(&db.pool).await.unwrap();
    let (status, _, _) = create_tracing(
        &w,
        KEY,
        &id,
        json!({"typ": "Volume", "fallbackLayerName": "color"}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    w.mock.fail("/tracings/skeleton/z-skeleton", 502);
    let (status, _, _) = create_tracing(&w, KEY, &id, json!({"typ": "Skeleton"})).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
}
