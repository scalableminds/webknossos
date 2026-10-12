mod common;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, router};

async fn get(app: &Router, uri: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn dataset_versions_preserve_list_defaults_and_uint64_boundaries() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datastores(name,url,publicurl,key) VALUES('versions','http://localhost:9090','http://localhost:9090','never-expose')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,ispublic,isusable,voxelsizefactor,voxelsizeunit) SELECT $1,'versions',_id,_rootfolder,'Versions','versions',now(),true,true,ROW(1,1,1)::webknossos.vector3,'nanometer' FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    for (name, segment_id) in [
        ("a-safe", 9_007_199_254_740_991_i64),
        ("b-unsafe", 9_007_199_254_740_992_i64),
        ("c-uint64", -1_i64),
    ] {
        sqlx::query("INSERT INTO webknossos.dataset_layers(_dataset,name,category,elementclass,boundingbox,largestsegmentid,dataformat) VALUES($1,$2,'segmentation','uint64',ROW(0,0,0,10,10,10)::webknossos.bounding_box,$3,'wkw')")
            .bind(&id).bind(name).bind(segment_id).execute(&db.pool).await.unwrap();
    }
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    for prefix in ["/api", "/api/v16"] {
        for suffix in ["", "?compact=false", "?compact=true"] {
            let (status, list) = get(&app, &format!("{prefix}/datasets{suffix}")).await;
            assert_eq!(status, StatusCode::OK, "{list}");
            assert_eq!(list[0]["id"], id);
            assert!(list[0].get("dataSource").is_none());
            assert!(list[0]["segmentationLayerNames"].is_array());
        }
    }
    for version in 10..=16 {
        let prefix = format!("/api/v{version}");
        let (status, dataset) = get(&app, &format!("{prefix}/datasets/{id}")).await;
        assert_eq!(status, StatusCode::OK, "{dataset}");
        let layers = &dataset["dataSource"]["dataLayers"];
        let envelope = |value: &str| json!({"customJsonEncoding":"bigint","value":value});
        assert_eq!(
            layers[0]["largestSegmentId"],
            if version <= 14 {
                json!(9_007_199_254_740_991_u64)
            } else {
                envelope("9007199254740991")
            }
        );
        assert_eq!(layers[1]["largestSegmentId"], envelope("9007199254740992"));
        assert_eq!(
            layers[2]["largestSegmentId"],
            envelope("18446744073709551615")
        );
        assert_eq!(dataset["dataStore"]["jobsEnabled"], false);
        assert!(!dataset.to_string().contains("never-expose"));
        if version <= 15 {
            for suffix in ["", "?compact=false"] {
                let (status, list) = get(&app, &format!("{prefix}/datasets{suffix}")).await;
                assert_eq!(status, StatusCode::OK, "{list}");
                assert_eq!(list, json!([dataset]));
            }
            let (status, compact) = get(
                &app,
                &format!("{prefix}/datasets?compact=true&includeAnnotationCount=true"),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{compact}");
            assert_eq!(compact[0]["id"], id);
            assert!(compact[0].get("dataSource").is_none());
            assert!(compact[0]["annotationCount"].is_null());
        }
        let (status, error) = get(&app, &format!("{prefix}/datasets/{}", object_id())).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(error["messages"][0]["error"].is_string());
    }
    db.cleanup().await;
}
