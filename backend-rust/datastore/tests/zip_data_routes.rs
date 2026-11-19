//! ZIP metadata and chunk reads via actual authorization, readers and reload invalidation.
use crate::common;
use crate::mock_wk;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use common::{header, send};
use mock_wk::{MockWk, Reply};
use serde_json::json;
use std::{
    io::Write,
    path::{Path, PathBuf},
};
use webknossos_datastore::{AppState, router};
const ID: &str = "0123456789abcdef01234567";
fn archive(path: &Path, value: u8) {
    let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("color/1/.zarray", options).unwrap();
    zip.write_all(
        &serde_json::to_vec(
            &json!({"zarr_format":2, "shape":[64,32,32],"chunks":[32,32,32],
        "dtype":"|u1", "order":"F", "compressor":null,"fill_value":0}),
        )
        .unwrap(),
    )
    .unwrap();
    zip.start_file("color/1/0.0.0", options).unwrap();
    zip.write_all(&vec![value; 32768]).unwrap();
    zip.finish().unwrap();
}
fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "wk-zip-route-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("data.zip")
}
#[tokio::test]
async fn zipped_dataset_data_missing_denial_and_replacement_reload() {
    let path = temp();
    archive(&path, 7);
    let source = json!({"id":{"name":"zip","team":"org"},"scale":[1,1,1],"dataLayers":[{
        "name":"color","category":"color","elementClass":"uint8","dataFormat":"zarr",
        "boundingBox":{"topLeft":[0,0,0],"width":64,"height":32,"depth":32},
        "mags":[{"mag":[1,1,1],"path":format!("{}|zip:color/1",path.display()),"axisOrder":{"x":0,"y":1,"z":2}}]}]});
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("validateUserAccess") {
            Reply::json(
                StatusCode::OK,
                json!({"granted":call.query_value("token").as_deref() == Some("good")}),
            )
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let state = AppState::new(wk.config());
    let app = router(state);
    let read = |token: &str| {
        Request::post(format!("/data/datasets/{ID}/layers/color/data"))
            .header("x-auth-token", token)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!([
                    {"position":[0,0,0],"mag":[1,1,1],"cubeSize":32},
                    {"position":[32,0,0],"mag":[1,1,1],"cubeSize":32}
                ]))
                .unwrap(),
            ))
            .unwrap()
    };
    let (status, headers, bytes) = send(app.clone(), read("good")).await;
    assert_eq!(status, StatusCode::OK);
    // Missing Zarr chunks decode to metadata fill values, hence successful bucket reads.
    assert_eq!(header(&headers, "empty-bucket-indices"), Some("[]"));
    assert_eq!(header(&headers, "failure-bucket-indices"), Some("[]"));
    assert_eq!(&bytes[..32768], vec![7; 32768]);
    assert_eq!(&bytes[32768..], vec![0; 32768]);
    let count = wk.calls().len();
    assert_eq!(
        send(app.clone(), read("denied")).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        wk.calls().len(),
        count + 1,
        "denial only performs access check"
    );
    archive(&path, 19);
    assert_eq!(
        &send(app.clone(), read("good")).await.2[..32768],
        vec![7; 32768],
        "warm reader remains cached"
    );
    let (status, _, _) = send(
        app.clone(),
        Request::delete(format!("/data/datasets/{ID}"))
            .header("x-auth-token", "good")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, bytes) = send(app, read("good")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        &bytes[..32768],
        vec![19; 32768],
        "reload drops ZIP directory and reader/chunk caches"
    );
}
