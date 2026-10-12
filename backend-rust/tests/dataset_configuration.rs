mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, dataset_configuration};

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(
            builder
                .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    )
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn default_admin_and_personal_configurations_merge_at_the_correct_levels() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('config-store','http://localhost:9001','http://localhost:9002','secret')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isPublic,isUsable,voxelSizeFactor,sortingKey,defaultViewConfiguration,adminViewConfiguration) SELECT $1,'config-store',$2,_rootFolder,'Config','Config',true,true,ROW(1,1,1)::webknossos.VECTOR3,NOW(),'{\"defaultOnly\":1,\"shared\":\"default\"}','{\"adminOnly\":2,\"shared\":\"admin\"}' FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat,defaultViewConfiguration,adminViewConfiguration) VALUES ($1,'color','color','uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'wkw','{\"color\":[1,2,3],\"defaultLayer\":true,\"shared\":1}','{\"alpha\":0.5,\"shared\":2}')")
        .bind(&id).execute(&db.pool).await.unwrap();
    let application = dataset_configuration::router().with_state(AppState {
        pool: db.pool.clone(),
    });
    let path = format!("/datasetConfigurations/{id}");
    let admin_path = format!("/datasetConfigurations/default/{id}");
    let (status, defaults) = request(
        &application,
        "POST",
        &path,
        None,
        Some(json!(["volume-tracing"])),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{defaults}");
    assert_eq!(
        defaults,
        json!({"defaultOnly":1,"adminOnly":2,"shared":"admin","layers":{"color":{"color":[1,2,3],"defaultLayer":true,"shared":2,"alpha":0.5},"volume-tracing":{}}})
    );
    let (status, admin) =
        request(&application, "GET", &admin_path, Some(&fixture.token), None).await;
    assert_eq!(status, StatusCode::OK, "{admin}");
    assert_eq!(admin["layers"]["color"], json!({"alpha":0.5,"shared":2}));
    let user = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    assert_eq!(request(&application,"PUT",&path,Some(&user.token),Some(json!({"personalOnly":3,"layers":{"color":{"alpha":0.9,"shared":3},"volume-tracing":{"isDisabled":true},"invalid":17}}))).await.0,StatusCode::OK);
    let (_, personal) = request(
        &application,
        "POST",
        &path,
        Some(&user.token),
        Some(json!(["volume-tracing"])),
    )
    .await;
    assert_eq!(
        personal,
        json!({"personalOnly":3,"layers":{"color":{"color":[1,2,3],"defaultLayer":true,"shared":3,"alpha":0.9},"volume-tracing":{"isDisabled":true}}})
    );
    // Dataset-level saved config replaces defaults; layer values overlay them.
    assert!(personal.get("adminOnly").is_none());
    assert_eq!(
        request(
            &application,
            "PUT",
            &path,
            Some(&user.token),
            Some(json!({"newPersonal":4,"layers":{"volume-tracing":{"color":[5,6,7]}}}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, personal) = request(
        &application,
        "POST",
        &path,
        Some(&user.token),
        Some(json!(["volume-tracing"])),
    )
    .await;
    assert_eq!(personal["newPersonal"], 4);
    assert_eq!(personal["layers"]["color"]["alpha"], 0.9);
    assert_eq!(
        personal["layers"]["volume-tracing"],
        json!({"color":[5,6,7]})
    );
    assert_eq!(
        request(
            &application,
            "PUT",
            &admin_path,
            Some(&user.token),
            Some(json!({"bad":true}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(request(&application,"PUT",&admin_path,Some(&fixture.token),Some(json!({"replacementAdmin":true,"layers":{"color":{"alpha":0.3},"nonexistent":{"test":1}}}))).await.0,StatusCode::OK);
    let (_, admin) = request(&application, "GET", &admin_path, Some(&fixture.token), None).await;
    assert_eq!(
        admin,
        json!({"defaultOnly":1,"shared":"default","replacementAdmin":true,"layers":{"color":{"alpha":0.3}}})
    );
    let version: i32 =
        sqlx::query_scalar("SELECT thumbnailCacheVersion FROM webknossos.datasets WHERE _id=$1")
            .bind(&id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(version, 1);
    // Whole invalid admin layer map is ignored, preserving the prior layer config.
    request(
        &application,
        "PUT",
        &admin_path,
        Some(&fixture.token),
        Some(json!({"layers":{"color":{"alpha":1},"invalid":1}})),
    )
    .await;
    let (_, admin) = request(&application, "GET", &admin_path, Some(&fixture.token), None).await;
    assert_eq!(admin["layers"]["color"], json!({"alpha":0.3}));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn inaccessible_missing_and_unusable_datasets_follow_configuration_fallback_contract() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('config-store','http://localhost:9001','http://localhost:9002','secret')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,sortingKey,sharingToken,adminViewConfiguration) SELECT $1,'config-store',$2,_rootFolder,'Private','Private',NOW(),'sharing','{\"zoom\":2}' FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    let application = dataset_configuration::router().with_state(AppState {
        pool: db.pool.clone(),
    });
    let path = format!("/datasetConfigurations/{id}");
    assert_eq!(
        request(&application, "POST", &path, None, Some(json!([]))).await,
        (StatusCode::OK, json!({}))
    );
    assert_eq!(
        request(
            &application,
            "POST",
            &format!("{path}?sharingToken=sharing"),
            None,
            Some(json!(["volume"]))
        )
        .await,
        (StatusCode::OK, json!({"zoom":2,"layers":{"volume":{}}}))
    );
    assert_eq!(
        request(
            &application,
            "POST",
            &format!("/datasetConfigurations/{}", object_id()),
            None,
            Some(json!([]))
        )
        .await,
        (StatusCode::OK, json!({}))
    );
    let user = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    // Scala stores personal settings independently from dataset read access.
    assert_eq!(
        request(
            &application,
            "PUT",
            &path,
            Some(&user.token),
            Some(json!({"position":[1,2,3]}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &application,
            "POST",
            &path,
            Some(&user.token),
            Some(json!([]))
        )
        .await,
        (StatusCode::OK, json!({"position":[1,2,3],"layers":{}}))
    );
    assert_eq!(
        request(
            &application,
            "GET",
            &format!("/datasetConfigurations/default/{id}"),
            Some(&user.token),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &application,
            "PUT",
            &format!("/datasetConfigurations/{}", object_id()),
            Some(&user.token),
            Some(json!({}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&application, "POST", &path, None, Some(json!({})))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let foreign = db.fixture().await;
    sqlx::query("UPDATE webknossos.users SET isAdmin=false,isDatasetManager=true WHERE _id=$1")
        .bind(&foreign.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &application,
            "PUT",
            &format!("/datasetConfigurations/default/{id}"),
            Some(&foreign.token),
            Some(json!({"foreignWrite":true}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    // allLayersFor parses the complete usable data source even for config
    // reads. User reads soften an invalid source to {}, admin reads fail.
    sqlx::query("UPDATE webknossos.datasets SET isPublic=true,isUsable=true WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&application, "POST", &path, None, Some(json!([]))).await,
        (StatusCode::OK, json!({}))
    );
    assert_eq!(
        request(
            &application,
            "GET",
            &format!("/datasetConfigurations/default/{id}"),
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    sqlx::query("UPDATE webknossos.datasets SET voxelSizeFactor=ROW(1,1,1)::webknossos.VECTOR3 WHERE _id=$1")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox) VALUES ($1,'invalid','color','uint8',ROW(0,0,0,1,1,1)::webknossos.BOUNDING_BOX)")
        .bind(&id).execute(&db.pool).await.unwrap();
    assert_eq!(
        request(
            &application,
            "POST",
            &path,
            Some(&user.token),
            Some(json!([]))
        )
        .await,
        (StatusCode::OK, json!({}))
    );
    assert_eq!(
        request(
            &application,
            "GET",
            &format!("/datasetConfigurations/default/{id}"),
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    db.cleanup().await;
}
