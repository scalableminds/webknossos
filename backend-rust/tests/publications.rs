mod common;
use axum::{
    body::Body,
    http::{HeaderMap, Request},
};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, router};

async fn get(app: &axum::Router, uri: &str, token: Option<&str>) -> (u16, HeaderMap, Value) {
    let mut request = Request::builder().uri(uri);
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, headers, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn publications_embed_datasets_and_annotations() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('pub-store','http://store.internal','http://store.public','secret-key')")
        .execute(&db.pool).await.unwrap();
    let publication = object_id();
    let empty = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.publications (_id,publicationDate,imageUrl,title,description,created)
          VALUES ($1,to_timestamp(1234),'https://img.test/a.png','Paper','About it',to_timestamp(1)),
                 ($2,NULL,NULL,NULL,NULL,to_timestamp(2))"#,
    )
    .bind(&publication)
    .bind(&empty)
    .execute(&db.pool)
    .await
    .unwrap();
    let deleted = object_id();
    sqlx::query("INSERT INTO webknossos.publications (_id,isDeleted) VALUES ($1,TRUE)")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,_publication,_uploader,name,directoryName,isPublic,sortingKey,created) SELECT $1,'pub-store',$2,_rootFolder,$3,$4,'pub-ds','pub-ds',TRUE,to_timestamp(5),to_timestamp(5) FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).bind(&publication).bind(&f.user_id)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset,_team) VALUES ($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let annotation = object_id();
    sqlx::query("INSERT INTO webknossos.annotations (_id,_dataset,_user,_publication,name,description,typ,visibility) VALUES ($1,$2,$3,$4,'Pub annotation','Desc','Explorational','Public')")
        .bind(&annotation).bind(&dataset).bind(&f.user_id).bind(&publication)
        .execute(&db.pool).await.unwrap();

    // The annotation needs a tracing store: Play answers with an empty Fox (404).
    let (status, headers, body) =
        get(&app, &format!("/api/publications/{publication}"), None).await;
    assert_eq!(status, 404, "{body}");
    assert_eq!(headers["access-control-allow-origin"], "*");
    sqlx::query("INSERT INTO webknossos.tracingStores (name,url,publicUrl,key) VALUES ('pub-tracing','http://tracing.internal','http://tracing.public','secret')")
        .execute(&db.pool).await.unwrap();

    let (status, headers, body) =
        get(&app, &format!("/api/publications/{publication}"), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(headers["access-control-allow-origin"], "*");
    assert_eq!(headers["access-control-max-age"], "600");
    // Embedded datasets render exactly like an anonymous dataset read.
    let (status, _, dataset_json) = get(&app, &format!("/api/datasets/{dataset}"), None).await;
    assert_eq!(status, 200, "{dataset_json}");
    assert_eq!(dataset_json["allowedTeams"], json!([]));
    assert_eq!(dataset_json["isEditable"], false);
    assert_eq!(dataset_json["uploaderFullName"], Value::Null);
    assert!(!body.to_string().contains("secret"));
    assert_eq!(
        body,
        json!({
            "id": publication,
            "publicationDate": 1_234_000,
            "imageUrl": "https://img.test/a.png",
            "title": "Paper",
            "description": "About it",
            "created": 1000,
            "datasets": [dataset_json.clone()],
            "annotations": [{
                "id": annotation,
                "name": "Pub annotation",
                "description": "Desc",
                "typ": "Explorational",
                "tracingStore": {"name": "pub-tracing", "url": "http://tracing.public"},
                "dataset": dataset_json
            }]
        })
    );
    // The requesting identity does not influence the rendering.
    let (status, _, authenticated) = get(
        &app,
        &format!("/api/publications/{publication}"),
        Some(&f.token),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(authenticated, body);

    let (status, _, list) = get(&app, "/api/publications", None).await;
    assert_eq!(status, 200);
    assert_eq!(
        list,
        json!([body, {
            "id": empty,
            "publicationDate": null,
            "imageUrl": null,
            "title": null,
            "description": null,
            "created": 2000,
            "datasets": [],
            "annotations": []
        }])
    );
    let (status, headers, missing) = get(&app, &format!("/api/publications/{deleted}"), None).await;
    assert_eq!(
        (status, missing),
        (
            404,
            json!({"messages": [{"error": "Publication could not be found."}]})
        )
    );
    assert_eq!(headers["access-control-allow-origin"], "*");
    assert_eq!(get(&app, "/api/publications/not-an-id", None).await.0, 400);
    // Deleted annotations and datasets are not embedded.
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=TRUE WHERE _id=$1")
        .bind(&annotation)
        .execute(&db.pool)
        .await
        .unwrap();
    let (_, _, body) = get(&app, &format!("/api/v12/publications/{publication}"), None).await;
    assert_eq!(body["annotations"], json!([]));
    assert_eq!(body["datasets"].as_array().unwrap().len(), 1);
    db.cleanup().await;
}
