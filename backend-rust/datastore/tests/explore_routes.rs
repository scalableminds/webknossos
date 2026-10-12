//! POST /datasets/exploreRemote through the actual router on local (whitelisted) fixtures.
mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::send;
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use webknossos_datastore::{AppState, router};

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-explore-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p.canonicalize().unwrap()
}

fn write_json(path: &Path, value: Value) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
}

fn zarray(shape: &[i64], dtype: &str) -> Value {
    json!({"zarr_format":2,"shape":shape,"chunks":shape,"dtype":dtype,"order":"C",
        "compressor":null,"fill_value":0,"filters":null})
}

async fn start(whitelist: &Path) -> (MockWk, Router) {
    let wk = MockWk::start(|call| {
        assert!(call.path.ends_with("/validateUserAccess"));
        Reply::json(StatusCode::OK, json!({"granted":true}))
    })
    .await;
    let mut config = wk.config();
    config.local_directory_whitelist = vec![whitelist.to_str().unwrap().to_owned()];
    (wk, router(AppState::new(config)))
}

async fn explore(app: &Router, uris: &[&str]) -> Value {
    let parameters: Vec<Value> = uris.iter().map(|u| json!({"remoteUri": u})).collect();
    let (status, _, body) = send(
        app.clone(),
        Request::post("/data/datasets/exploreRemote")
            .header("x-auth-token", "t")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({"layerParameters":parameters,"organizationId":"org"}))
                    .unwrap(),
            ))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn explores_zarr_arrays_and_hides_local_reports() {
    let root = temp();
    write_json(
        &root.join("segmentation/.zarray"),
        zarray(&[10, 20, 30], "<u4"),
    );
    let (_wk, app) = start(&root).await;
    let uri = format!("file://{}/segmentation/.zarray", root.display());
    let response = explore(&app, &[&uri]).await;
    // file:// requests drop the exploration details from the report.
    assert_eq!(response["report"], "Resulted in dataSource with 1 layers.");
    let source = &response["dataSource"];
    assert_eq!(source["id"], json!({"name":"","team":""}));
    assert_eq!(
        source["scale"],
        json!({"factor":[1,1,1],"unit":"nanometer"})
    );
    let layer = &source["dataLayers"][0];
    assert_eq!(layer["name"], "segmentation");
    assert_eq!(layer["category"], "segmentation");
    assert_eq!(layer["elementClass"], "uint32");
    assert_eq!(layer["dataFormat"], "zarr");
    // Guessed ZYX order: x is the last axis.
    assert_eq!(
        layer["boundingBox"],
        json!({"topLeft":[0,0,0],"width":30,"height":20,"depth":10})
    );
    assert_eq!(
        layer["mags"][0]["path"],
        root.join("segmentation").to_str().unwrap()
    );
    assert_eq!(layer["mags"][0]["axisOrder"], json!({"x":2,"y":1,"z":0}));
}

#[tokio::test]
async fn explores_ngff_with_channel_settings_and_reports() {
    let root = temp();
    let image = root.join("img");
    write_json(
        &image.join(".zattrs"),
        json!({"multiscales":[{"version":"0.4","name":"img","axes":[
                {"name":"c","type":"channel"},
                {"name":"z","type":"space","unit":"micrometer"},
                {"name":"y","type":"space","unit":"micrometer"},
                {"name":"x","type":"space","unit":"micrometer"}],
            "datasets":[
                {"path":"0","coordinateTransformations":[{"type":"scale","scale":[1,1,0.5,0.5]}]},
                {"path":"1","coordinateTransformations":[{"type":"scale","scale":[1,2,1,1]}]}]}],
            "omero":{"channels":[{"color":"FF0000","label":"Red Ch",
                "window":{"min":0,"max":255,"start":10,"end":200}}]}}),
    );
    write_json(&image.join("0/.zarray"), zarray(&[1, 8, 16, 16], "|u1"));
    write_json(&image.join("1/.zarray"), zarray(&[1, 4, 8, 8], "|u1"));
    let (_wk, app) = start(&root).await;
    // A plain absolute path (no file:// scheme) keeps the detailed report, like Scala.
    let response = explore(&app, &[image.to_str().unwrap()]).await;
    let report = response["report"].as_str().unwrap();
    assert!(
        report.contains(&format!(
            "Found 1 OME NGFF Zarr v0.4 layers at {}.",
            image.display()
        )),
        "{report}"
    );
    assert!(report.contains("Error when reading"), "{report}");
    assert!(report.ends_with("Resulted in dataSource with 1 layers."));
    let source = &response["dataSource"];
    assert_eq!(
        source["scale"],
        json!({"factor":[0.5,0.5,1],"unit":"micrometer"})
    );
    let layer = &source["dataLayers"][0];
    assert_eq!(layer["name"], "RedCh");
    assert_eq!(layer["category"], "color");
    assert_eq!(
        layer["mags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["mag"].clone())
            .collect::<Vec<_>>(),
        [json!([1, 1, 1]), json!([2, 2, 2])]
    );
    assert_eq!(layer["mags"][0]["channelIndex"], 0);
    assert_eq!(
        layer["mags"][0]["axisOrder"],
        json!({"x":3,"y":2,"z":1,"c":0})
    );
    assert_eq!(
        layer["boundingBox"],
        json!({"topLeft":[0,0,0],"width":16,"height":16,"depth":8})
    );
    assert_eq!(
        layer["defaultViewConfiguration"],
        json!({"color":[255,0,0],"intensityRange":[10,200],"min":0,"max":255})
    );
    assert_eq!(layer["additionalAxes"], json!([]));
}

#[tokio::test]
async fn searches_sub_directories_and_unifies_voxel_sizes() {
    let root = temp();
    write_json(&root.join("data/color/.zarray"), zarray(&[4, 4, 4], "|u1"));
    write_json(&root.join("data/color/.zarray"), zarray(&[4, 4, 4], "|u1"));
    let (_wk, app) = start(&root).await;
    let response = explore(&app, &[root.join("data").to_str().unwrap()]).await;
    let report = response["report"].as_str().unwrap();
    assert!(report.contains("Found 1 Zarr Array layers at"), "{report}");
    assert_eq!(response["dataSource"]["dataLayers"][0]["name"], "color");

    // Two URIs with the same layer name are renamed uniquely.
    let color = root.join("data/color");
    let response = explore(&app, &[color.to_str().unwrap(), color.to_str().unwrap()]).await;
    let names: Vec<&str> = response["dataSource"]["dataLayers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["color", "color_2"]);
}

#[tokio::test]
async fn refuses_paths_outside_the_whitelist() {
    let root = temp();
    let outside = temp();
    write_json(&outside.join("x/.zarray"), zarray(&[4, 4, 4], "|u1"));
    let (_wk, app) = start(&root).await;
    let response = explore(&app, &[outside.join("x").to_str().unwrap()]).await;
    assert!(response.get("dataSource").is_none());
    let report = response["report"].as_str().unwrap();
    assert!(
        report.starts_with("Error when exploring as layer set: Absolute path"),
        "{report}"
    );
    assert!(report.contains("is not in path whitelist"));

    let response = explore(&app, &[root.to_str().unwrap()]).await;
    assert!(
        response["report"]
            .as_str()
            .unwrap()
            .ends_with("Error when exploring as layer set: Empty"),
        "{}",
        response["report"]
    );
}
