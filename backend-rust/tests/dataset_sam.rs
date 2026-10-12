mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Extension, Router,
    body::{Body, Bytes, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState, dataset_options::DatasetRouteConfig, dataset_options::SegmentAnythingConfig,
    dataset_sam, service_clients::ServiceClientConfig, service_clients::ServiceClients,
};

const IMAGE: &[u8] = b"\x01\x02\x03\x04";
const MASK: &[u8] = b"\xaa\xbb";

/// (uri, authorization header, content type, body)
type Call = (String, Option<String>, Option<String>, Vec<u8>);

#[derive(Clone, Default)]
struct Upstream {
    calls: Arc<Mutex<Vec<Call>>>,
    sam_status: Arc<Mutex<Option<StatusCode>>>,
}

async fn upstream_handler(State(upstream): State<Upstream>, request: Request) -> Response {
    let uri = request.uri().to_string();
    let path = request.uri().path().to_owned();
    let (parts, body) = request.into_parts();
    let header_text = |name: header::HeaderName| {
        parts
            .headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let authorization = header_text(header::AUTHORIZATION);
    let content_type = header_text(header::CONTENT_TYPE);
    let body = to_bytes(body, 1 << 20).await.unwrap();
    upstream
        .calls
        .lock()
        .unwrap()
        .push((uri, authorization, content_type, body.to_vec()));
    if path == "/sam/predict" {
        let status = upstream
            .sam_status
            .lock()
            .unwrap()
            .unwrap_or(StatusCode::OK);
        return (status, MASK).into_response();
    }
    if path.starts_with("/data/datasets/") && path.ends_with("/readData") {
        return IMAGE.into_response();
    }
    StatusCode::NOT_FOUND.into_response()
}

fn clients() -> ServiceClients {
    ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".to_owned(),
    })
    .unwrap()
}

fn app(db: &TestDb, config: DatasetRouteConfig) -> Router {
    dataset_sam::router(config)
        .layer(Extension(clients()))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}

async fn seed_dataset(db: &TestDb, fixture: &Fixture, usable: bool) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,voxelSizeFactor,sortingKey) SELECT $1,'sam-store',_id,_rootFolder,$1,$1,$3,ROW(1,1,1)::webknossos.VECTOR3,NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).bind(usable)
        .execute(&db.pool).await.unwrap();
    for (name, element_class) in [("color", "uint8"), ("floats", "float")] {
        sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,$2,'color',$3::webknossos.DATASET_LAYER_ELEMENT_CLASS,ROW(0,0,0,4096,4096,512)::webknossos.BOUNDING_BOX,'zarr3')")
            .bind(&id).bind(name).bind(element_class)
            .execute(&db.pool).await.unwrap();
        sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,$2,ROW(1,1,1)::webknossos.VECTOR3,'s3://bucket/mag')")
            .bind(&id).bind(name)
            .execute(&db.pool).await.unwrap();
    }
    id
}

async fn post(
    app: &Router,
    path: &str,
    token: &str,
    body: &Value,
) -> (StatusCode, HeaderMap, Bytes) {
    let request = axum::http::Request::builder()
        .method("POST")
        .uri(path)
        .header("x-auth-token", token)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    (
        status,
        headers,
        to_bytes(response.into_body(), 1 << 20).await.unwrap(),
    )
}

fn error(body: &Bytes) -> String {
    let value: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    value["messages"][0]["error"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

fn parameters(width: i32, height: i32, depth: i32) -> Value {
    json!({
        "mag": [2, 2, 1],
        "surroundingBoundingBox": {"topLeft": [10, 20, 5], "width": width, "height": height, "depth": depth},
        "interactionType": "POINT",
        "pointX": 3,
        "pointY": -1,
    })
}

fn expected_payload(
    class: u8,
    intensity: Option<(f32, f32)>,
    interaction: &[i32],
    shape: [i32; 3],
) -> Vec<u8> {
    let mut expected = vec![class, u8::from(intensity.is_some())];
    let (min, max) = intensity.unwrap_or((0.0, 0.0));
    expected.extend(min.to_le_bytes());
    expected.extend(max.to_le_bytes());
    expected.push(if interaction.len() == 4 { 0 } else { 1 });
    for value in interaction.iter().chain(shape.iter()) {
        expected.extend(value.to_le_bytes());
    }
    expected.extend(IMAGE);
    expected
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn segment_anything_mask_validates_loads_data_and_forwards_the_sam_mask() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let upstream = Upstream::default();
    let mock = Router::new()
        .fallback(upstream_handler)
        .with_state(upstream.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('sam-store',$1,'http://public.invalid','k')")
        .bind(&base).execute(&db.pool).await.unwrap();
    let id = seed_dataset(&db, &fixture, true).await;
    let path = format!("/datasets/{id}/layers/color/segmentAnythingMask");
    let valid = parameters(2048, 2048, 10);

    // Feature flag and URI are checked before the dataset is looked up.
    let (status, _, body) = post(
        &app(&db, DatasetRouteConfig::default()),
        &path,
        &fixture.token,
        &valid,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "AI-based quick select is not enabled for this WEBKNOSSOS instance."
    );
    let no_uri = DatasetRouteConfig {
        segment_anything_enabled: true,
        ..DatasetRouteConfig::default()
    };
    let (status, _, body) = post(&app(&db, no_uri), &path, &fixture.token, &valid).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error(&body), "No URI for SAM server configured.");

    let app = app(
        &db,
        DatasetRouteConfig {
            segment_anything_enabled: true,
            segment_anything: SegmentAnythingConfig {
                uri: format!("{base}/sam"),
                user: "sam-user".into(),
                password: "sam-pw".into(),
            },
            ..DatasetRouteConfig::default()
        },
    );

    // Malformed bodies are rejected as invalid JSON.
    let (status, _, _) = post(&app, &path, &fixture.token, &json!({"mag": [1, 1, 1]})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Unreadable datasets are 404 (other organization's user).
    let outsider = db
        .seed_user(&object_id(), &format!("rust-test-{}", object_id()), false)
        .await;
    let (status, _, body) = post(&app, &path, &outsider.token, &valid).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        error(&body),
        format!("Dataset “{id}” could not be found or accessed.")
    );

    // Unknown layer and unusable datasets.
    let (status, _, body) = post(
        &app,
        &format!("/datasets/{id}/layers/missing/segmentAnythingMask"),
        &fixture.token,
        &valid,
    )
    .await;
    assert_eq!(
        (status, error(&body).as_str()),
        (StatusCode::BAD_REQUEST, "Dataset has no data layers.")
    );
    let unusable = seed_dataset(&db, &fixture, false).await;
    let (status, _, body) = post(
        &app,
        &format!("/datasets/{unusable}/layers/color/segmentAnythingMask"),
        &fixture.token,
        &valid,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        format!("Dataset “{unusable}” is not imported or incomplete.")
    );

    // Target-mag bbox constraints (size is ceil-divided by the mag).
    for (parameters, message) in [
        (
            parameters(2049, 2048, 10),
            "Target-mag selected bbox must be smaller than 1024×1024×depth (or transposed), got (1025, 1024, 10)",
        ),
        (
            parameters(2048, 2048, 51),
            "Target-mag selected bbox depth must be at most 50",
        ),
        (
            parameters(2048, 1024, 10),
            "Target-mag selected bbox must equally sized long edges, got (1024, 512, 10)",
        ),
        (
            json!({"mag": [2, 2, 1], "surroundingBoundingBox": {"topLeft": [10, 20, 5], "width": 2048, "height": 2048, "depth": 10}, "interactionType": "POINT", "pointX": 3}),
            "Missing pointX and pointY parameters for point interaction.",
        ),
        (
            json!({"mag": [2, 2, 1], "surroundingBoundingBox": {"topLeft": [10, 20, 5], "width": 2048, "height": 2048, "depth": 10}, "interactionType": "BOUNDING_BOX", "selectionTopLeftX": 1, "selectionTopLeftY": 2, "selectionBottomRightX": 3}),
            "Missing selectionTopLeft and selectionBottomRight parameters for bounding box interaction.",
        ),
    ] {
        let (status, _, body) = post(&app, &path, &fixture.token, &parameters).await;
        assert_eq!(
            (status, error(&body).as_str()),
            (StatusCode::BAD_REQUEST, message)
        );
    }
    assert!(upstream.calls.lock().unwrap().is_empty());

    // Point interaction on uint8: datastore readData then SAM predict with basic auth.
    let (status, headers, body) = post(&app, &path, &fixture.token, &valid).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    assert_eq!(body.as_ref(), MASK);
    assert_eq!(headers[header::CONTENT_TYPE], "application/octet-stream");
    {
        let mut calls = upstream.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        let (uri, auth, content_type, sent) = calls.remove(0);
        assert_eq!(
            uri,
            format!("/data/datasets/{id}/layers/color/readData?token=rpc-secret")
        );
        assert_eq!(auth, None);
        assert_eq!(content_type.as_deref(), Some("application/json"));
        assert_eq!(
            serde_json::from_slice::<Value>(&sent).unwrap(),
            json!({"position": [10, 20, 5], "cubeSize": [1024, 1024, 10], "mag": [2, 2, 1]})
        );
        let (uri, auth, content_type, sent) = calls.remove(0);
        assert_eq!(uri, "/sam/predict");
        assert_eq!(auth.as_deref(), Some("Basic c2FtLXVzZXI6c2FtLXB3"));
        assert_eq!(content_type.as_deref(), Some("application/octet-stream"));
        assert_eq!(sent, expected_payload(0, None, &[3, -1], [1024, 1024, 10]));
    }

    // Bounding-box interaction with additional coordinates on a float layer:
    // the intensity range is required (checked after loading the data).
    let float_path = format!("/datasets/{id}/layers/floats/segmentAnythingMask");
    let bbox_parameters = json!({
        "mag": [1, 1, 1],
        "surroundingBoundingBox": {"topLeft": [0, 0, 0], "width": 30, "height": 512, "depth": 512},
        "additionalCoordinates": [{"name": "t", "value": 4}],
        "interactionType": "BOUNDING_BOX",
        "selectionTopLeftX": 1, "selectionTopLeftY": 2, "selectionBottomRightX": 30, "selectionBottomRightY": 40,
    });
    let (status, _, body) = post(&app, &float_path, &fixture.token, &bbox_parameters).await;
    assert_eq!(
        (status, error(&body).as_str()),
        (
            StatusCode::BAD_REQUEST,
            "For float and double data, a supplied intensity range is required."
        )
    );
    assert_eq!(upstream.calls.lock().unwrap().len(), 1);
    upstream.calls.lock().unwrap().clear();
    let (status, _, body) = post(
        &app,
        &format!("{float_path}?intensityMin=-1.5&intensityMax=2"),
        &fixture.token,
        &bbox_parameters,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_ref(), MASK);
    {
        let calls = upstream.calls.lock().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&calls[0].3).unwrap(),
            json!({"position": [0, 0, 0], "cubeSize": [30, 512, 512], "mag": [1, 1, 1], "additionalCoordinates": [{"name": "t", "value": 4}]})
        );
        assert_eq!(
            calls[1].3,
            expected_payload(5, Some((-1.5, 2.0)), &[1, 2, 30, 40], [30, 512, 512])
        );
    }
    upstream.calls.lock().unwrap().clear();

    // SAM server failures surface as Scala's getMaskFailed message.
    *upstream.sam_status.lock().unwrap() = Some(StatusCode::INTERNAL_SERVER_ERROR);
    let (status, _, body) = post(&app, &path, &fixture.token, &valid).await;
    assert_eq!(
        (status, error(&body).as_str()),
        (
            StatusCode::BAD_REQUEST,
            "Could not get image mask from SAM server."
        )
    );

    // Datastore failures surface as getDataFailed without calling SAM.
    upstream.calls.lock().unwrap().clear();
    sqlx::query("UPDATE webknossos.dataStores SET url=$1 WHERE name='sam-store'")
        .bind(format!("{base}/broken"))
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, _, body) = post(&app, &path, &fixture.token, &valid).await;
    assert_eq!(
        (status, error(&body).as_str()),
        (
            StatusCode::BAD_REQUEST,
            "Could not get image data to send to SAM server."
        )
    );
    assert!(
        upstream
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|call| !call.0.starts_with("/sam/"))
    );

    server.abort();
    db.cleanup().await;
}
