mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use common::send;
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use webknossos_datastore::{AppState, router};
const ID: &str = "0123456789abcdef01234567";
fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}
fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        if e.path().is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).unwrap();
        }
    }
}
fn array(dir: &Path, shape: &[usize], dtype: &str, bytes: Vec<u8>) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("zarr.json"),serde_json::to_vec(&json!({"zarr_format":3,"node_type":"array","shape":shape,"data_type":dtype,"chunk_grid":{"name":"regular","configuration":{"chunk_shape":shape}},"chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},"fill_value":0,"codecs":[{"name":"bytes","configuration":{"endian":"little"}}]})).unwrap()).unwrap();
    let path = dir.join(
        std::iter::once("c")
            .chain(shape.iter().map(|_| "0"))
            .collect::<PathBuf>(),
    );
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}
fn index(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("zarr.json"),serde_json::to_vec(&json!({"zarr_format":3,"node_type":"group","attributes":{"voxelytics":{"artifact_schema_version":1,"artifact_attributes":{"n_hash_buckets":1,"hash_function":"identity","dtype_bucket_entries":"uint16"}}}})).unwrap()).unwrap();
    array(
        &dir.join("hash_bucket_offsets"),
        &[2],
        "uint64",
        [0u64, 1].into_iter().flat_map(u64::to_le_bytes).collect(),
    );
    array(
        &dir.join("hash_buckets"),
        &[2, 3],
        "uint64",
        [17u64, 0, 1, 0, 0, 0]
            .into_iter()
            .flat_map(u64::to_le_bytes)
            .collect(),
    );
    array(&dir.join("top_lefts"), &[1, 3], "uint16", vec![0; 6]);
}
fn segmentation(dir: &Path, width: usize, points: &[(usize, usize, usize, u64)], xsize: usize) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join(".zarray"),serde_json::to_vec(&json!({"zarr_format":2,"shape":[xsize,32,32],"chunks":[32,32,32],"dtype":format!("<u{width}"),"order":"F","compressor":null,"fill_value":0})).unwrap()).unwrap();
    for bucket in 0..xsize.div_ceil(32) {
        let mut bytes = vec![0; 32768 * width];
        for &(x, y, z, id) in points {
            if x / 32 == bucket {
                let at = (x % 32 + 32 * (y + 32 * z)) * width;
                bytes[at..at + width].copy_from_slice(&id.to_le_bytes()[..width]);
            }
        }
        std::fs::write(dir.join(format!("{bucket}.0.0")), bytes).unwrap();
    }
}
async fn start() -> (MockWk, Router, AppState, PathBuf) {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let root = std::env::temp_dir().join(format!(
        "wk-fullmesh-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    copy_dir(&fixtures().join("full_mesh"), &root.join("meshes"));
    std::fs::copy(
        fixtures().join("meshes/real.hdf5"),
        root.join("meshes/real.hdf5"),
    )
    .unwrap();
    index(&root.join("index"));
    let mut layers = Vec::new();
    for (name, width) in [
        ("uint8", 1),
        ("int8", 1),
        ("uint16", 2),
        ("int16", 2),
        ("uint32", 4),
        ("int32", 4),
        ("uint64", 8),
        ("int64", 8),
        ("idx", 1),
        ("hdf-idx", 1),
        ("bfs", 1),
        ("agg", 1),
    ] {
        let points = match name {
            "bfs" => vec![(127, 4, 5, 17), (128, 4, 5, 17)],
            "idx" | "hdf-idx" => vec![(0, 0, 0, 17)],
            "agg" => vec![(0, 0, 0, 2)],
            _ => vec![(0, 0, 0, u64::MAX)],
        };
        let xsize = if name == "bfs" { 160 } else { 32 };
        segmentation(&root.join(name), width, &points, xsize);
        let mapping = root.join("org/ds").join(name).join("mappings");
        std::fs::create_dir_all(&mapping).unwrap();
        std::fs::write(
            mapping.join("json.json"),
            br#"{"name":"ignored-display-name","classes":[[],[17,"-1"]]}"#,
        )
        .unwrap();
        let mut attachments = json!({"meshes":[{"name":"float","dataFormat":"hdf5","path":root.join("meshes/float.hdf5")},{"name":"zarr","dataFormat":"zarr3","path":root.join("meshes/zarr3")},{"name":"pc","dataFormat":"neuroglancerPrecomputed","path":root.join("meshes/precomputed")},{"name":"real","dataFormat":"hdf5","path":root.join("meshes/real.hdf5")}],"agglomerates":[{"name":"agg","dataFormat":"hdf5","path":root.join("meshes/agg.hdf5")}]});
        if name == "idx" {
            attachments["segmentIndex"] =
                json!({"name":"idx","dataFormat":"zarr3","path":root.join("index")});
        }
        if name == "hdf-idx" {
            attachments["segmentIndex"] =
                json!({"name":"idx","dataFormat":"hdf5","path":root.join("meshes/index.hdf5")});
        }
        let class = if ["idx", "hdf-idx", "bfs", "agg"].contains(&name) {
            "uint8"
        } else {
            name
        };
        layers.push(json!({"name":name,"category":"segmentation","elementClass":class,"dataFormat":"zarr","largestSegmentId":{"customJsonEncoding":"bigint","value":u64::MAX.to_string()},"boundingBox":{"topLeft":[0,0,0],"width":if name=="agg"{xsize*32}else{xsize},"height":if name=="agg"{1024}else{32},"depth":if name=="agg"{1024}else{32}},"mags":[{"mag":[1,1,1],"path":root.join(name),"axisOrder":{"x":0,"y":1,"z":2}},{"mag":[32,32,32],"path":root.join(name),"axisOrder":{"x":0,"y":1,"z":2}}],"attachments":attachments}));
    }
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":layers});
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            Reply::json(
                StatusCode::OK,
                json!({"granted":call.query_value("token").as_deref()!=Some("denied")}),
            )
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let mut config = wk.config();
    config.base_directories = vec![webknossos_datastore::config::BaseDirectory {
        path: root.to_string_lossy().into(),
        is_remote: false,
        organization_id: None,
        allows_upload: true,
        do_scan: true,
    }];
    let state = AppState::new(config);
    let app = router(state.clone());
    (wk, app, state, root)
}
async fn call(
    app: &Router,
    layer: &str,
    route: &str,
    body: Value,
    token: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    send(
        app.clone(),
        Request::builder()
            .method("POST")
            .uri(format!("/data/datasets/{ID}/layers/{layer}/{route}"))
            .header("x-auth-token", token)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
    .await
}
fn request() -> Value {
    json!({"position":[0,0,0],"mag":[1,1,1],"cubeSize":[2,2,2],"segmentId":{"customJsonEncoding":"bigint","value":u64::MAX.to_string()},"voxelSizeFactorInUnit":[2.5,0.75,4]})
}
fn complete(raw: &[u8]) -> Vec<u8> {
    let mut out = vec![0; 80];
    out.extend(((raw.len() / 50) as u32).to_le_bytes());
    out.extend(raw);
    out
}
#[tokio::test]
async fn ad_hoc_reads_every_integer_storage_width_and_maps_data_and_segment() {
    let (_wk, app, _, _) = start().await;
    let expected = std::fs::read(fixtures().join("draco/route_cube.bin")).unwrap();
    for class in [
        "uint8", "int8", "uint16", "int16", "uint32", "int32", "uint64", "int64",
    ] {
        for mapped in [false, true] {
            let mut r = request();
            if mapped {
                r["mapping"] = json!("json");
                r["mappingType"] = json!("JSON");
            }
            let (status, headers, bytes) = call(&app, class, "adHocMesh", r, "t").await;
            assert_eq!(
                status,
                StatusCode::OK,
                "{class}: {}",
                String::from_utf8_lossy(&bytes)
            );
            assert_eq!(bytes, expected, "{class}");
            assert_eq!(headers["neighbors"], "[0, 1, 2]");
            assert_eq!(headers["access-control-expose-headers"], "NEIGHBORS");
        }
    }
}
#[tokio::test]
async fn explicit_hdf5_agglomerate_mapping_applies_even_above_mag16() {
    let (_wk, app, _, _) = start().await;
    for kind in ["AGGLOMERATE", "HDF5"] {
        let mut r = request();
        r["segmentId"] = json!(42);
        r["mag"] = json!([32, 32, 32]);
        r["voxelSizeFactorInUnit"] = json!([2.5 / 32., 0.75 / 32., 4. / 32.]);
        r["mapping"] = json!("agg");
        r["mappingType"] = json!(kind);
        let (status, _, bytes) = call(&app, "agg", "adHocMesh", r, "t").await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&bytes)
        );
        assert_eq!(
            bytes,
            std::fs::read(fixtures().join("draco/route_cube.bin")).unwrap()
        );
    }
}
#[tokio::test]
async fn full_mesh_and_surface_from_all_file_formats_match_jni_goldens() {
    let (_wk, app, _, _) = start().await;
    for file in ["float", "zarr", "pc", "real"] {
        let id = if file == "real" { 30 } else { 42 };
        let names = if file == "pc" {
            vec!["integer_sequential_full", "integer_edgebreaker_full"]
        } else if file == "real" {
            vec!["real_30_full"]
        } else {
            vec!["float_sequential", "float_edgebreaker"]
        };
        let mut raw = Vec::new();
        for name in names {
            raw.extend(std::fs::read(fixtures().join(format!("draco/{name}.stlraw"))).unwrap());
        }
        let (status, _, bytes) = call(
            &app,
            "idx",
            "meshes/fullMesh.stl",
            json!({"meshFileName":file,"segmentId":id}),
            "t",
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{file}: {}",
            String::from_utf8_lossy(&bytes)
        );
        assert_eq!(bytes, complete(&raw), "{file}");
        let mut surface_request = json!({"meshFileName":file,"segmentIds":[id],"mag":[1,1,1]});
        if file == "real" {
            surface_request["mappingName"] = json!("agglomerate_view_70");
        }
        let (status, _, bytes) = call(
            &app,
            "idx",
            "segmentStatistics/surfaceArea",
            surface_request,
            "t",
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{file}: {}",
            String::from_utf8_lossy(&bytes)
        );
        let values: Vec<f32> = serde_json::from_slice(&bytes).unwrap();
        let expected = if file == "real" {
            webknossos_datastore::services::mesh_geometry::surface_area(&raw).unwrap()
        } else if file == "pc" {
            webknossos_datastore::services::mesh_geometry::surface_area(&raw[..100]).unwrap() * 2.
        } else {
            509.66205 * 2.
        };
        assert_eq!(values, [expected], "{file}");
    }
}
#[tokio::test]
async fn full_ad_hoc_index_and_bfs_order_match_actual_scala_stl() {
    let (_wk, app, _, _) = start().await;
    for (layer, fixture) in [("idx", "indexed"), ("hdf-idx", "indexed"), ("bfs", "bfs")] {
        let raw = std::fs::read(fixtures().join(format!("draco/{fixture}.stlraw"))).unwrap();
        let mut r = json!({"segmentId":17,"mag":[1,1,1]});
        if layer == "bfs" {
            r["seedPosition"] = json!([0, 0, 0]);
        }
        let (status, _, bytes) = call(&app, layer, "meshes/fullMesh.stl", r, "t").await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{layer}: {}",
            String::from_utf8_lossy(&bytes)
        );
        assert_eq!(bytes, complete(&raw), "{layer}");
        if layer != "bfs" {
            let (status, _, bytes) = call(
                &app,
                layer,
                "segmentStatistics/surfaceArea",
                json!({"segmentIds":[17],"mag":[1,1,1]}),
                "t",
            )
            .await;
            assert_eq!(
                status,
                StatusCode::OK,
                "{}",
                String::from_utf8_lossy(&bytes)
            );
            let values: Vec<f32> = serde_json::from_slice(&bytes).unwrap();
            let oracle: Value = serde_json::from_slice(
                &std::fs::read(fixtures().join("draco/areas.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(
                values[0],
                oracle[format!("{fixture}.stlraw")].as_f64().unwrap() as f32
            );
        }
    }
}
#[tokio::test]
async fn denial_validation_and_empty_meshes_do_not_fake_geometry() {
    let (wk, app, _, _) = start().await;
    let (s, _, _) = call(&app, "uint8", "adHocMesh", request(), "denied").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(
        wk.calls()
            .iter()
            .all(|c| c.path.ends_with("/validateUserAccess"))
    );
    let mut r = request();
    r["findNeighbors"] = json!(false);
    let (s, h, _) = call(&app, "uint8", "adHocMesh", r, "t").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(h["neighbors"], "[]");
    for update in [
        json!({"mag":[0,1,1]}),
        json!({"cubeSize":[0,2,2]}),
        json!({"mappingType":"invalid"}),
    ] {
        let mut r = request();
        for (k, v) in update.as_object().unwrap() {
            r[k] = v.clone();
        }
        assert_eq!(
            call(&app, "uint8", "adHocMesh", r, "t").await.0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        call(
            &app,
            "bfs",
            "meshes/fullMesh.stl",
            json!({"segmentId":17}),
            "t"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "bfs",
            "meshes/fullMesh.stl",
            json!({"segmentId":17,"mag":[1,1,1]}),
            "t"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (s, _, bytes) = call(
        &app,
        "idx",
        "meshes/fullMesh.stl",
        json!({"segmentId":99,"mag":[1,1,1]}),
        "t",
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, complete(&[]));
    assert_eq!(
        call(
            &app,
            "idx",
            "meshes/fullMesh.stl",
            json!({"segmentId":42,"meshFileName":"float","lod":-1}),
            "t"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "bfs",
            "segmentStatistics/surfaceArea",
            json!({"segmentIds":[17],"mag":[1,1,1]}),
            "t"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}
async fn invalidate(app: &Router, layer: &str) {
    let (status, _, body) = send(
        app.clone(),
        Request::builder()
            .method("DELETE")
            .uri(format!("/data/datasets/{ID}?layerName={layer}"))
            .header("x-auth-token", "t")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
}
#[tokio::test]
async fn mapped_geometry_and_surface_cache_invalidate_and_warm_cache_denial_is_enforced() {
    let (_wk, app, state, root) = start().await;
    let mut r = request();
    r["mapping"] = json!("json");
    r["mappingType"] = json!("JSON");
    let (_, _, original) = call(&app, "uint8", "adHocMesh", r.clone(), "first").await;
    assert!(!original.is_empty());
    std::fs::write(
        root.join("org/ds/uint8/mappings/json.json"),
        br#"{"name":"x","classes":[[0,-1]]}"#,
    )
    .unwrap();
    assert_eq!(
        call(&app, "uint8", "adHocMesh", r.clone(), "second")
            .await
            .2,
        original
    );
    assert_eq!(
        call(&app, "uint8", "adHocMesh", r.clone(), "denied")
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let source = webknossos_datastore::models::DataSourceId::new("ds", "org");
    assert_eq!(state.mappings.clear_caches(&source, Some("other")), 0);
    invalidate(&app, "uint8").await;
    let (status, _, changed) = call(&app, "uint8", "adHocMesh", r, "second").await;
    assert_eq!(status, StatusCode::OK);
    assert!(changed.is_empty());
    let area = json!({"mag":[1,1,1],"segmentIds":[17]});
    let (status, _, old) = call(
        &app,
        "idx",
        "segmentStatistics/surfaceArea",
        area.clone(),
        "first",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    std::fs::write(root.join("idx/0.0.0"), vec![0; 32768]).unwrap();
    assert_eq!(
        call(
            &app,
            "idx",
            "segmentStatistics/surfaceArea",
            area.clone(),
            "second"
        )
        .await
        .2,
        old
    );
    assert_eq!(
        call(
            &app,
            "idx",
            "segmentStatistics/surfaceArea",
            area.clone(),
            "denied"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(state.full_mesh.clear_caches(&source, Some("other")), 0);
    invalidate(&app, "idx").await;
    let (status, _, changed) =
        call(&app, "idx", "segmentStatistics/surfaceArea", area, "second").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&changed).unwrap(),
        json!([0.])
    );
}
#[tokio::test]
async fn malformed_file_payloads_and_gzip_encoding_fail_explicitly() {
    let (_wk, app, _, root) = start().await;
    let chunk = root.join("meshes/zarr3/neuroglancer/c/0");
    let mut bytes = std::fs::read(&chunk).unwrap();
    bytes[0] = 0;
    std::fs::write(&chunk, bytes).unwrap();
    let (status, _, bytes) = call(
        &app,
        "idx",
        "meshes/fullMesh.stl",
        json!({"meshFileName":"zarr","segmentId":42}),
        "t",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(String::from_utf8_lossy(&bytes).contains("Invalid DRACO"));
    let metadata = root.join("meshes/zarr3/zarr.json");
    let mut json: Value = serde_json::from_slice(&std::fs::read(&metadata).unwrap()).unwrap();
    json["attributes"]["voxelytics"]["artifact_attributes"]["mesh_format"] = json!("draco+gzip");
    std::fs::write(metadata, serde_json::to_vec(&json).unwrap()).unwrap();
    invalidate(&app, "idx").await;
    let (status, _, bytes) = call(
        &app,
        "idx",
        "meshes/fullMesh.stl",
        json!({"meshFileName":"zarr","segmentId":42}),
        "t",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(String::from_utf8_lossy(&bytes).contains("only draco is supported"));
}
#[tokio::test]
async fn background_neighbor_search_is_finite() {
    let (_wk, app, _, _root) = start().await;
    let (status, _, bytes) = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        call(
            &app,
            "uint8",
            "meshes/fullMesh.stl",
            json!({"segmentId":0,"mag":[1,1,1],"seedPosition":[0,0,0]}),
            "t",
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    assert_eq!(u32::from_le_bytes(bytes[80..84].try_into().unwrap()), 8);
}
#[tokio::test]
async fn full_remote_mesh_uses_each_current_token_after_metadata_cache_hits() {
    use axum::{extract::OriginalUri, http::header, response::IntoResponse};
    use std::sync::{Arc, Mutex};
    let reads = Arc::new(Mutex::new(Vec::<(String, Option<String>)>::new()));
    let log = Arc::clone(&reads);
    let server =
        Router::new().fallback(move |OriginalUri(uri): OriginalUri, headers: HeaderMap| {
            let log = Arc::clone(&log);
            async move {
                let path = uri.path().trim_start_matches('/').to_owned();
                log.lock().unwrap().push((
                    path.clone(),
                    headers
                        .get("x-auth-token")
                        .and_then(|h| h.to_str().ok())
                        .map(str::to_owned),
                ));
                let bytes = std::fs::read(fixtures().join("full_mesh").join(path)).unwrap();
                if let Some(range) = headers.get(header::RANGE) {
                    let (a, b) = range
                        .to_str()
                        .unwrap()
                        .trim_start_matches("bytes=")
                        .split_once('-')
                        .unwrap();
                    let a = a.parse::<usize>().unwrap();
                    let b = b.parse::<usize>().unwrap();
                    (
                        StatusCode::PARTIAL_CONTENT,
                        [(
                            header::CONTENT_RANGE,
                            format!("bytes {a}-{b}/{}", bytes.len()),
                        )],
                        bytes[a..=b].to_vec(),
                    )
                        .into_response()
                } else {
                    bytes.into_response()
                }
            }
        });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, server).await.unwrap();
    });
    let uri = format!("http://{address}");
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{"name":"seg","category":"segmentation","elementClass":"uint8","dataFormat":"zarr","largestSegmentId":42,"boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},"mags":[{"mag":[1,1,1],"path":"/not-read"}],"attachments":{"meshes":[{"name":"remote","dataFormat":"neuroglancerPrecomputed","path":format!("{uri}/precomputed")}]}}]});
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            Reply::json(
                StatusCode::OK,
                json!({"granted":call.query_value("token").as_deref()!=Some("denied")}),
            )
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let mut config = wk.config();
    config.http.uri = uri;
    let app = router(AppState::new(config));
    let mut raw = std::fs::read(fixtures().join("draco/integer_sequential_full.stlraw")).unwrap();
    raw.extend(std::fs::read(fixtures().join("draco/integer_edgebreaker_full.stlraw")).unwrap());
    for token in ["first", "second"] {
        let (status, _, bytes) = call(
            &app,
            "seg",
            "meshes/fullMesh.stl",
            json!({"meshFileName":"remote","segmentId":42}),
            token,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&bytes)
        );
        assert_eq!(bytes, complete(&raw));
    }
    let log = reads.lock().unwrap().clone();
    assert_eq!(log.iter().filter(|(p, _)| p.ends_with("info")).count(), 1);
    assert_eq!(
        log.iter()
            .filter(|(_, t)| t.as_deref() == Some("second"))
            .count(),
        3,
        "{log:?}"
    );
    let (status, _, _) = call(
        &app,
        "seg",
        "meshes/fullMesh.stl",
        json!({"meshFileName":"remote","segmentId":42}),
        "denied",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(reads.lock().unwrap().len(), log.len());
    task.abort();
}
