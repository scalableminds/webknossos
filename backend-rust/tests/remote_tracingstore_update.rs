mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use common::{TestDb, object_id};
use prost::Message;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
};

const KEY: &str = "update-callback-service-key";

async fn setup(db: &TestDb) -> (Router, String) {
    let fixture = db.fixture().await;
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('actual','http://trace.internal','https://trace.example.test',$1)")
        .bind(KEY).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('data','http://data.internal','https://data.example.test','data-key')")
        .execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryName,sortingKey) SELECT $1,'data',_id,_rootFolder,'Dataset','dataset',NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,description,visibility,state,isLockedByOwner,modified,tracingTime) VALUES($1,$2,$3,'Explorational','before','Private','Finished',true,'2020-01-01T00:00:00Z',123)")
        .bind(&id).bind(&dataset).bind(&fixture.user_id).execute(&db.pool).await.unwrap();
    sqlx::query(r#"INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'keep','Skeleton','OldName','{"nodes":17}'),($1,'remove','Volume','Removed','{}')"#)
        .bind(&id).execute(&db.pool).await.unwrap();
    (
        webknossos_backend::router(AppState {
            pool: db.pool.clone(),
        }),
        id,
    )
}

fn layer(id: &str, name: &str, typ: AnnotationLayerTypeProto) -> AnnotationLayerProto {
    AnnotationLayerProto {
        tracing_id: id.into(),
        name: name.into(),
        typ: typ as i32,
    }
}

fn proto(description: &str, annotation_layers: Vec<AnnotationLayerProto>) -> AnnotationProto {
    AnnotationProto {
        description: description.into(),
        version: 81,
        earliest_accessible_version: 29,
        annotation_layers,
        skeleton_may_have_pending_updates: Some(true),
        editable_mappings_may_have_pending_updates: None,
        user_states: Vec::new(),
    }
}

async fn raw(
    app: &Router,
    query: &str,
    body: Vec<u8>,
    content_type: Option<&str>,
) -> (StatusCode, String, Vec<u8>) {
    let mut request = Request::post(format!(
        "/api/v16/tracingstores/informational-name/updateAnnotation?{query}"
    ));
    if let Some(content_type) = content_type {
        request = request.header(header::CONTENT_TYPE, content_type);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_owned())
        .unwrap_or_default();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, content_type, body)
}

async fn send(app: &Router, id: &str, update: &AnnotationProto) -> (StatusCode, String, Vec<u8>) {
    raw(
        app,
        &format!("key={KEY}&annotationId={id}"),
        update.encode_to_vec(),
        Some("application/x-protobuf"),
    )
    .await
}

async fn snapshot(db: &TestDb, id: &str) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('annotation',to_jsonb(a),'layers',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY tracingId) FROM webknossos.annotation_layers l WHERE l._annotation=a._id),'[]'::jsonb)) FROM webknossos.annotations a WHERE a._id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn protobuf_parser_precedes_global_key_validation_and_is_bounded() {
    let db = TestDb::new().await;
    let (app, id) = setup(&db).await;
    let before = snapshot(&db, &id).await;
    let corpus: Value =
        serde_json::from_str(include_str!("fixtures/annotation_proto_scala.json")).unwrap();
    let malformed = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == "missing_user_state_0")
        .unwrap()["hex"]
        .as_str()
        .unwrap();
    let malformed: Vec<u8> = malformed
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
        .collect();
    for bytes in [Vec::new(), vec![0xff], malformed] {
        let (status, content_type, body) = raw(
            &app,
            &format!("key=wrong&annotationId={id}"),
            bytes,
            Some("application/json"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(content_type.starts_with("text/plain"));
        assert_eq!(body, b"Invalid protobuf request body");
    }
    let valid = proto("after", Vec::new());
    let denied = raw(
        &app,
        &format!("key=wrong&annotationId={id}"),
        valid.encode_to_vec(),
        None,
    )
    .await;
    assert_eq!(denied.0, StatusCode::FORBIDDEN);
    assert!(denied.1.starts_with("text/plain"));
    assert_eq!(denied.2, b"Tracing store could not be found or accessed.");
    for query in [
        format!("annotationId={id}"),
        format!("key={KEY}"),
        format!("key={KEY}&annotationId=prefix-{id}"),
    ] {
        assert_eq!(
            raw(&app, &query, valid.encode_to_vec(), None).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    sqlx::query("UPDATE webknossos.tracingStores SET isDeleted=true")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(send(&app, &id, &valid).await.0, StatusCode::FORBIDDEN);
    sqlx::query("UPDATE webknossos.tracingStores SET isDeleted=false")
        .execute(&db.pool)
        .await
        .unwrap();
    let too_large = proto(&"x".repeat(2 * 1024 * 1024), Vec::new());
    assert_eq!(
        send(&app, &id, &too_large).await.0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(snapshot(&db, &id).await, before);
    // Raw body parser imposes no content-type check; uppercase query IDs normalize.
    let accepted = raw(
        &app,
        &format!("key={KEY}&annotationId={}", id.to_uppercase()),
        valid.encode_to_vec(),
        Some("text/plain"),
    )
    .await;
    assert_eq!(accepted.0, StatusCode::OK);
    assert!(accepted.2.is_empty());
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn callback_replaces_layers_but_preserves_existing_type_statistics_and_other_metadata() {
    let db = TestDb::new().await;
    let (app, id) = setup(&db).await;
    // The callback's global access also updates a soft-deleted, finished, private, locked row.
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=true WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    let before = snapshot(&db, &id).await;
    let update = proto(
        "a description with unicode μ and ' SQL text",
        vec![
            layer("keep", "Renamed", AnnotationLayerTypeProto::Volume),
            layer("new", "NewVolume", AnnotationLayerTypeProto::Volume),
        ],
    );
    assert_eq!(send(&app, &id, &update).await.0, StatusCode::OK);
    let after = snapshot(&db, &id).await;
    let mut expected_annotation = before["annotation"].clone();
    expected_annotation["description"] = json!(update.description);
    assert_eq!(after["annotation"], expected_annotation);
    assert_eq!(
        after["layers"],
        json!([
            {"_annotation":id,"tracingid":"keep","typ":"Skeleton","name":"Renamed","statistics":{"nodes":17}},
            {"_annotation":id,"tracingid":"new","typ":"Volume","name":"NewVolume","statistics":{}}
        ])
    );
    // Uniqueness is deferred: exchange names within one valid replacement.
    let swap = proto(
        "swapped",
        vec![
            layer("keep", "NewVolume", AnnotationLayerTypeProto::Skeleton),
            layer("new", "Renamed", AnnotationLayerTypeProto::Volume),
        ],
    );
    assert_eq!(send(&app, &id, &swap).await.0, StatusCode::OK);
    let duplicate_existing = proto(
        "duplicate-existing",
        vec![
            layer("keep", "First", AnnotationLayerTypeProto::Skeleton),
            layer("keep", "Last", AnnotationLayerTypeProto::Skeleton),
        ],
    );
    assert_eq!(send(&app, &id, &duplicate_existing).await.0, StatusCode::OK);
    let after = snapshot(&db, &id).await;
    assert_eq!(after["layers"].as_array().unwrap().len(), 1);
    assert_eq!(after["layers"][0]["name"], "Last");
    assert_eq!(
        send(&app, &id, &proto("", Vec::new())).await.0,
        StatusCode::OK
    );
    let cleared = snapshot(&db, &id).await;
    assert_eq!(cleared["layers"], json!([]));
    assert_eq!(cleared["annotation"]["description"], "");
    assert_eq!(
        send(&app, &object_id(), &proto("missing", Vec::new()))
            .await
            .0,
        StatusCode::OK
    );
    // Layer reports can precede the annotation row; schema185 has no FK here.
    let missing_id = object_id();
    assert_eq!(
        send(
            &app,
            &missing_id,
            &proto(
                "missing",
                vec![layer(
                    "missing",
                    "Missing",
                    AnnotationLayerTypeProto::Skeleton
                )]
            )
        )
        .await
        .0,
        StatusCode::OK
    );
    let reported: Option<String> = sqlx::query_scalar(
        "SELECT _annotation FROM webknossos.annotation_layers WHERE tracingId='missing'",
    )
    .fetch_optional(&db.pool)
    .await
    .unwrap();
    assert_eq!(reported.as_deref(), Some(missing_id.as_str()));
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.annotations WHERE _id=$1)")
            .bind(&missing_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(!exists);
    assert_eq!(
        send(&app, &missing_id, &proto("", Vec::new())).await.0,
        StatusCode::OK
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM webknossos.annotation_layers WHERE _annotation=$1"
        )
        .bind(&missing_id)
        .fetch_one(&db.pool)
        .await
        .unwrap(),
        0
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn constraint_and_late_failures_roll_back_and_concurrent_updates_never_mix() {
    let db = TestDb::new().await;
    let (app, id) = setup(&db).await;
    let before = snapshot(&db, &id).await;
    for (update, expected) in [
        (
            proto(
                "duplicate-new",
                vec![
                    layer("dup", "One", AnnotationLayerTypeProto::Skeleton),
                    layer("dup", "Two", AnnotationLayerTypeProto::Volume),
                ],
            ),
            StatusCode::CONFLICT,
        ),
        (
            proto(
                "deferred-duplicate-name",
                vec![
                    layer("keep", "Same", AnnotationLayerTypeProto::Skeleton),
                    layer("new", "Same", AnnotationLayerTypeProto::Volume),
                ],
            ),
            StatusCode::CONFLICT,
        ),
        (
            proto(
                "invalid-name",
                vec![layer("new", "Bad name!", AnnotationLayerTypeProto::Volume)],
            ),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        assert_eq!(send(&app, &id, &update).await.0, expected);
        assert_eq!(snapshot(&db, &id).await, before);
    }
    sqlx::raw_sql("CREATE FUNCTION webknossos.fail_callback_description() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.description='late-secret' THEN RAISE EXCEPTION 'sensitive fixture database detail'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_callback_description BEFORE UPDATE ON webknossos.annotations FOR EACH ROW EXECUTE FUNCTION webknossos.fail_callback_description();")
        .execute(&db.pool).await.unwrap();
    let failed = send(
        &app,
        &id,
        &proto(
            "late-secret",
            vec![layer("new", "New", AnnotationLayerTypeProto::Volume)],
        ),
    )
    .await;
    assert_eq!(failed.0, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        serde_json::from_slice::<Value>(&failed.2).unwrap(),
        json!({"messages":[{"error":"Internal server error."}]})
    );
    assert_eq!(snapshot(&db, &id).await, before);
    let left = proto(
        "left",
        vec![layer("left", "Left", AnnotationLayerTypeProto::Skeleton)],
    );
    let right = proto(
        "right",
        vec![layer("right", "Right", AnnotationLayerTypeProto::Volume)],
    );
    let (left_result, right_result) = tokio::join!(send(&app, &id, &left), send(&app, &id, &right));
    assert_eq!(left_result.0, StatusCode::OK);
    assert_eq!(right_result.0, StatusCode::OK);
    let after = snapshot(&db, &id).await;
    assert_eq!(after["layers"].as_array().unwrap().len(), 1);
    assert_eq!(
        after["layers"][0]["tracingid"],
        after["annotation"]["description"]
    );
    assert!(matches!(
        after["annotation"]["description"].as_str(),
        Some("left" | "right")
    ));
    db.cleanup().await;
}
