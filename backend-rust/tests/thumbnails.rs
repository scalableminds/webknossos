mod common;

use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, Bytes, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use webknossos_backend::{AppState, router};

const IMAGE: &[u8] = b"\xff\xd8\xff\xe0upstream-jpeg";

#[derive(Clone)]
struct Store {
    requests: Arc<Mutex<Vec<(String, Value)>>>,
    status: Arc<Mutex<StatusCode>>,
    /// Simulates a concurrent cache clear while the datastore renders.
    bump_version_of: Arc<Mutex<Option<String>>>,
    pool: PgPool,
}

async fn render(State(store): State<Store>, request: Request) -> Response {
    let uri = request.uri().to_string();
    let body = to_bytes(request.into_body(), 1 << 20).await.unwrap();
    let body = serde_json::from_slice(&body).unwrap_or(Value::Null);
    store.requests.lock().unwrap().push((uri, body));
    let bump = store.bump_version_of.lock().unwrap().take();
    if let Some(id) = bump {
        sqlx::query("UPDATE webknossos.datasets SET thumbnailCacheVersion=thumbnailCacheVersion+1 WHERE _id=$1")
            .bind(id).execute(&store.pool).await.unwrap();
    }
    let status = *store.status.lock().unwrap();
    (
        status,
        [(header::CONTENT_TYPE, "application/octet-stream")],
        IMAGE,
    )
        .into_response()
}

async fn upstream(pool: &PgPool) -> (String, Store, tokio::task::JoinHandle<()>) {
    let store = Store {
        requests: Arc::default(),
        status: Arc::new(Mutex::new(StatusCode::OK)),
        bump_version_of: Arc::default(),
        pool: pool.clone(),
    };
    let app = Router::new()
        .route(
            "/data/datasets/{id}/layers/{layer}/layerThumbnail",
            get(render),
        )
        .route("/data/datasets/{id}/datasetThumbnail", post(render))
        .with_state(store.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, store, task)
}

async fn seed_dataset(
    db: &TestDb,
    fixture: &Fixture,
    store_name: &str,
    default_configuration: Value,
    admin_configuration: Value,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,voxelSizeFactor,sortingKey,sharingToken,defaultViewConfiguration,adminViewConfiguration) SELECT $1,$3,_id,_rootFolder,$1,$1,true,ROW(1,1,1)::webknossos.VECTOR3,NOW(),'thumb-share',$4,$5 FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).bind(store_name).bind(default_configuration).bind(admin_configuration)
        .execute(&db.pool).await.unwrap();
    id
}

async fn seed_layer(
    db: &TestDb,
    id: &str,
    name: &str,
    category: &str,
    bbox: [i32; 6],
    mags: &[[i32; 3]],
    configurations: (Option<Value>, Option<Value>),
) {
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat,defaultViewConfiguration,adminViewConfiguration) VALUES ($1,$2,$3::webknossos.DATASET_LAYER_CATEGORY,'uint8',ROW($4,$5,$6,$7,$8,$9)::webknossos.BOUNDING_BOX,'zarr3',$10,$11)")
        .bind(id).bind(name).bind(category)
        .bind(f64::from(bbox[0])).bind(f64::from(bbox[1])).bind(f64::from(bbox[2]))
        .bind(f64::from(bbox[3])).bind(f64::from(bbox[4])).bind(f64::from(bbox[5]))
        .bind(configurations.0).bind(configurations.1)
        .execute(&db.pool).await.unwrap();
    for mag in mags {
        sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,$2,ROW($3,$4,$5)::webknossos.VECTOR3,'s3://bucket/mag')")
            .bind(id).bind(name).bind(f64::from(mag[0])).bind(f64::from(mag[1])).bind(f64::from(mag[2]))
            .execute(&db.pool).await.unwrap();
    }
}

async fn call(app: &Router, path: &str, token: Option<&str>) -> (StatusCode, HeaderMap, Bytes) {
    let mut builder = axum::http::Request::builder().uri(path);
    if let Some(token) = token {
        builder = builder.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    (
        status,
        headers,
        to_bytes(response.into_body(), 1 << 20).await.unwrap(),
    )
}

/// The process RPC token is random per router; verify it is first and
/// non-empty, then compare the remaining query exactly.
fn split_token(uri: &str) -> (String, String) {
    let (path, query) = uri.split_once('?').unwrap();
    let (token, rest) = query.split_once('&').unwrap_or((query, ""));
    let token = token.strip_prefix("token=").expect("token first");
    assert!(!token.is_empty());
    (path.to_owned(), rest.to_owned())
}

async fn thumbnail_rows(db: &TestDb, id: &str) -> Vec<Value> {
    sqlx::query_scalar("SELECT jsonb_build_object('layer',dataLayerName,'width',width,'height',height,'mapping',mappingName,'mimetype',mimetype,'image',encode(image,'hex'),'mag',jsonb_build_array((mag).x::int,(mag).y::int,(mag).z::int),'bbox',jsonb_build_array((mag1BoundingBox).x::int,(mag1BoundingBox).y::int,(mag1BoundingBox).z::int,(mag1BoundingBox).width::int,(mag1BoundingBox).height::int,(mag1BoundingBox).depth::int)) FROM webknossos.dataset_thumbnails WHERE _dataset=$1 ORDER BY dataLayerName,width,height,mappingName")
        .bind(id).fetch_all(&db.pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn layer_thumbnail_selects_parameters_caches_and_keeps_public_cache_headers() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let (base, store, server) = upstream(&db.pool).await;
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('thumb-store',$1,'http://public.invalid','store-key')")
        .bind(&base).execute(&db.pool).await.unwrap();
    let id = seed_dataset(
        &db,
        &fixture,
        "thumb-store",
        json!({"zoom":1}),
        json!({"zoom":2}),
    )
    .await;
    seed_layer(
        &db,
        &id,
        "color",
        "color",
        [0, 0, 0, 1000, 1000, 100],
        &[[1, 1, 1], [2, 2, 1], [4, 4, 2]],
        (
            Some(json!({"color":[255,0,0],"intensityRange":[0,255.5],"isInverted":true})),
            Some(json!({"mapping":{"name":"agg"}})),
        ),
    )
    .await;
    seed_layer(
        &db,
        &id,
        "seg",
        "segmentation",
        [100, 100, 10, 1000, 1000, 100],
        &[[1, 1, 1]],
        (None, None),
    )
    .await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let path = format!("/api/datasets/{id}/layers/color/thumbnail");

    let (status, _, _) = call(&app, &format!("{path}?w=50&h=5000"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(store.requests.lock().unwrap().is_empty());

    let (status, headers, body) =
        call(&app, &format!("{path}?w=50&h=5000"), Some(&fixture.token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_ref(), IMAGE);
    assert_eq!(headers[header::CONTENT_TYPE], "image/jpeg");
    assert_eq!(headers[header::CACHE_CONTROL], "public, max-age=86400");
    assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
    assert_eq!(headers["access-control-max-age"], "600");
    {
        let requests = store.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let (path, query) = split_token(&requests[0].0);
        assert_eq!(
            path,
            format!("/data/datasets/{id}/layers/color/layerThumbnail")
        );
        // Intersection center (550,550,55); zoom 2 selects mag 2-2-1; h clamps to 4000.
        assert_eq!(
            query,
            "mag=2-2-1&x=500&y=-3450&z=55&width=50&height=4000&mappingName=agg&intensityMin=0.0&intensityMax=255.5&color=%23ff0000&invertColor=true"
        );
    }
    assert_eq!(
        thumbnail_rows(&db, &id).await,
        [
            json!({"layer":"color","width":50,"height":4000,"mapping":"agg","mimetype":"image/jpeg","image":hex(IMAGE),"mag":[2,2,1],"bbox":[500,-3450,55,100,8000,1]})
        ]
    );

    // The DB cache is keyed by the requested mapping (Scala stores the resolved
    // one), so an explicit mappingName hits and the implicit request misses.
    let (status, headers, body) = call(
        &app,
        &format!("{path}?w=50&h=4000&mappingName=agg&sharingToken=thumb-share"),
        None,
    )
    .await;
    assert_eq!((status, body.as_ref()), (StatusCode::OK, IMAGE));
    assert_eq!(headers[header::CACHE_CONTROL], "public, max-age=86400");
    assert_eq!(store.requests.lock().unwrap().len(), 1);
    call(&app, &format!("{path}?w=50&h=4000"), Some(&fixture.token)).await;
    assert_eq!(store.requests.lock().unwrap().len(), 2);

    // Explicit mapping overrides configuration; defaults are 400x400.
    let (status, _, _) = call(
        &app,
        &format!("{path}?mappingName=other"),
        Some(&fixture.token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, query) = split_token(&store.requests.lock().unwrap()[2].0);
    assert!(
        query.starts_with("mag=2-2-1&x=150&y=150&z=55&width=400&height=400&mappingName=other&")
    );

    // Upstream failures keep their status and are never cached.
    *store.status.lock().unwrap() = StatusCode::INTERNAL_SERVER_ERROR;
    let (status, _, body) = call(&app, &format!("{path}?w=7"), Some(&fixture.token)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!String::from_utf8_lossy(&body).contains("upstream-jpeg"));
    *store.status.lock().unwrap() = StatusCode::OK;

    // A cache clear while the datastore renders must not leave a stale entry.
    *store.bump_version_of.lock().unwrap() = Some(id.clone());
    let (status, _, _) = call(&app, &format!("{path}?w=8"), Some(&fixture.token)).await;
    assert_eq!(status, StatusCode::OK);
    let widths: Vec<i64> = thumbnail_rows(&db, &id)
        .await
        .iter()
        .map(|row| row["width"].as_i64().unwrap())
        .collect();
    assert!(!widths.contains(&7) && !widths.contains(&8), "{widths:?}");

    let calls = store.requests.lock().unwrap().len();
    let (status, _, body) = call(
        &app,
        &format!("/api/datasets/{id}/layers/missing/thumbnail"),
        Some(&fixture.token),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body:?}");
    seed_layer(
        &db,
        &id,
        "nomags",
        "color",
        [0, 0, 0, 1, 1, 1],
        &[],
        (None, None),
    )
    .await;
    let (status, _, _) = call(
        &app,
        &format!("/api/datasets/{id}/layers/nomags/thumbnail"),
        Some(&fixture.token),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    sqlx::query("UPDATE webknossos.datasets SET isUsable=false WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, _, _) = call(&app, &format!("{path}?w=9"), Some(&fixture.token)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(store.requests.lock().unwrap().len(), calls);
    // Errors keep the global no-store default.
    let (_, headers, _) = call(&app, &format!("{path}?w=9"), Some(&fixture.token)).await;
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");

    server.abort();
    db.cleanup().await;
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn dataset_thumbnail_posts_layer_composition_and_caches_with_sentinel() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let (base, store, server) = upstream(&db.pool).await;
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('thumb-store',$1,'http://public.invalid','store-key')")
        .bind(&base).execute(&db.pool).await.unwrap();
    let id = seed_dataset(
        &db,
        &fixture,
        "thumb-store",
        json!({"position":[10,20,30],"zoom":1.5,"blendMode":"Cover"}),
        json!({"colorLayerOrder":["b-color","a-color"]}),
    )
    .await;
    let bbox = [0, 0, 0, 100, 100, 100];
    seed_layer(
        &db,
        &id,
        "a-color",
        "color",
        bbox,
        &[[1, 1, 1], [2, 2, 2]],
        (None, None),
    )
    .await;
    seed_layer(
        &db,
        &id,
        "b-color",
        "color",
        bbox,
        &[[2, 2, 1], [4, 4, 1]],
        (
            Some(json!({"alpha":50,"color":[0,128,255]})),
            Some(json!({"intensityRange":[1,2]})),
        ),
    )
    .await;
    seed_layer(&db, &id, "c-empty", "color", bbox, &[], (None, None)).await;
    seed_layer(
        &db,
        &id,
        "z-seg",
        "segmentation",
        bbox,
        &[[1, 1, 1]],
        (None, None),
    )
    .await;
    seed_layer(
        &db,
        &id,
        "a-seg",
        "segmentation",
        bbox,
        &[[1, 1, 1]],
        (Some(json!({"mapping":{"name":"m"}})), None),
    )
    .await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let path = format!("/api/datasets/{id}/thumbnail?w=100&h=60");
    let (status, headers, body) = call(&app, &path, Some(&fixture.token)).await;
    assert_eq!((status, body.as_ref()), (StatusCode::OK, IMAGE));
    assert_eq!(headers[header::CACHE_CONTROL], "public, max-age=86400");
    {
        let requests = store.requests.lock().unwrap();
        let (path, query) = split_token(&requests[0].0);
        assert_eq!(path, format!("/data/datasets/{id}/datasetThumbnail"));
        assert_eq!(query, "");
        assert_eq!(
            requests[0].1,
            json!({"width":100,"height":60,"blendMode":"Cover","layers":[
                {"dataLayerName":"b-color","x":-65,"y":-25,"z":30,"mag":"2-2-1","width":75,"height":45,
                 "intensityMin":1.0,"intensityMax":2.0,"color":"#0080ff","invertColor":false,"opacity":50.0},
                {"dataLayerName":"a-color","x":-65,"y":-25,"z":30,"mag":"1-1-1","width":150,"height":90,"opacity":100.0},
                {"dataLayerName":"a-seg","x":-65,"y":-25,"z":30,"mag":"1-1-1","width":150,"height":90,"mappingName":"m","opacity":20.0}
            ]})
        );
    }
    assert_eq!(
        thumbnail_rows(&db, &id).await,
        [
            json!({"layer":"","width":100,"height":60,"mapping":"","mimetype":"image/jpeg","image":hex(IMAGE),"mag":[1,1,1],"bbox":[-65,-25,30,150,90,1]})
        ]
    );
    call(&app, &path, Some(&fixture.token)).await;
    assert_eq!(store.requests.lock().unwrap().len(), 1);

    // Clearing the cache forces a new render; with every layer disabled the
    // selection falls back to all renderable layers (segmentation only: 60%).
    let (status, _, _) = {
        let request = axum::http::Request::builder()
            .method("PUT")
            .uri(format!("/api/datasets/{id}/clearThumbnailCache"))
            .header("x-auth-token", &fixture.token)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        (response.status(), (), ())
    };
    assert_eq!(status, StatusCode::OK);
    sqlx::query("DELETE FROM webknossos.dataset_layers WHERE _dataset=$1 AND category='color'")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.dataset_layers SET adminViewConfiguration='{\"isDisabled\":true}' WHERE _dataset=$1")
        .bind(&id).execute(&db.pool).await.unwrap();
    let (status, _, _) = call(&app, &path, Some(&fixture.token)).await;
    assert_eq!(status, StatusCode::OK);
    {
        let requests = store.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        let layers = requests[1].1["layers"].as_array().unwrap();
        assert_eq!(layers.len(), 1);
        assert_eq!(layers[0]["dataLayerName"], "a-seg");
        assert_eq!(layers[0]["opacity"], json!(60.0));
        assert_eq!(requests[1].1["blendMode"], "Cover");
    }

    let empty = seed_dataset(&db, &fixture, "thumb-store", json!({}), json!({})).await;
    let (status, _, _) = call(
        &app,
        &format!("/api/datasets/{empty}/thumbnail"),
        Some(&fixture.token),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let foreign = db.fixture().await;
    let (status, _, _) = call(&app, &path, Some(&foreign.token)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(store.requests.lock().unwrap().len(), 2);
    server.abort();
    db.cleanup().await;
}
