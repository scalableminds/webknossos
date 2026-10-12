mod common;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::{Fixture, TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, annotation_access, router};

async fn request(
    app: &Router,
    token: Option<&str>,
    method: &str,
    path: &str,
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
                .body(Body::from(
                    body.map(|value| value.to_string()).unwrap_or_default(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
struct Annotations {
    dataset: String,
    annotation: String,
    other: String,
}
async fn seed(db: &TestDb, f: &Fixture) -> Annotations {
    let data = Annotations {
        dataset: object_id(),
        annotation: object_id(),
        other: object_id(),
    };
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('links','http://localhost:9000','https://data.example.test','never-return-this-key')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('tracing','http://localhost:9001','https://tracing.example.test','never-return-tracing-key')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey) SELECT $1,'links',_id,_rootfolder,'Dataset','directory',now() FROM webknossos.organizations WHERE _id=$2")
        .bind(&data.dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    for id in [&data.annotation, &data.other] {
        sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,visibility) VALUES($1,$2,$3,'Explorational','Private')").bind(id).bind(&data.dataset).bind(&f.user_id).execute(&db.pool).await.unwrap();
    }
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'a-skeleton','Skeleton','Skeleton','{\"treeCount\":2}'::jsonb),($1,'b-volume','Volume','Volume','{\"segmentCount\":3}'::jsonb)")
        .bind(&data.annotation).execute(&db.pool).await.unwrap();
    data
}
async fn create_link(app: &Router, f: &Fixture, annotation: &str, expiration: Value) -> Value {
    let (status, value) = request(
        app,
        Some(&f.token),
        "POST",
        "/api/zarrPrivateLinks",
        Some(json!({"annotation":annotation,"expirationDateTime":expiration})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{value}");
    value
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn private_links_preserve_owner_crud_expiration_and_token_lifecycle() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let a = seed(&db, &f).await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let expiry = chrono::Utc::now().timestamp_millis() + 3_600_000;
    let created = create_link(&app, &f, &a.annotation, json!(expiry.to_string())).await;
    assert_eq!(created["annotation"], a.annotation);
    assert_eq!(created["expirationDateTime"], expiry);
    let id = created["id"].as_str().unwrap();
    let token = created["accessToken"].as_str().unwrap();
    assert_eq!(token.len(), 16);
    assert_eq!(created.as_object().unwrap().len(), 4);
    let path = format!("/api/zarrPrivateLinks/{id}");
    assert_eq!(
        request(&app, Some(&f.token), "GET", &path, None).await.1,
        created
    );
    assert_eq!(
        request(&app, Some(&f.token), "GET", "/api/zarrPrivateLinks", None)
            .await
            .1,
        json!([created])
    );
    assert_eq!(
        request(
            &app,
            Some(&f.token),
            "GET",
            &format!("/api/zarrPrivateLinks/byAnnotation/{}", a.annotation),
            None
        )
        .await
        .1,
        json!([created])
    );
    let (status, moved) = request(
        &app,
        Some(&f.token),
        "PUT",
        &path,
        Some(json!({"annotation":a.other,"expirationDateTime":null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(moved["accessToken"], token);
    assert_eq!(moved["annotation"], a.other);
    assert!(moved["expirationDateTime"].is_null());
    assert_eq!(
        request(
            &app,
            Some(&f.token),
            "GET",
            &format!("/api/zarrPrivateLinks/byAnnotation/{}", a.annotation),
            None
        )
        .await
        .1,
        json!([])
    );
    let (status, expired) = request(
        &app,
        Some(&f.token),
        "PUT",
        &path,
        Some(json!({"annotation":a.other,"expirationDateTime":"2020-01-01T00:00:00.000Z"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(expired["expirationDateTime"], 1577836800000_i64);
    assert_eq!(
        request(&app, Some(&f.token), "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, Some(&f.token), "GET", "/api/zarrPrivateLinks", None)
            .await
            .1,
        json!([expired])
    );
    assert_eq!(
        request(&app, Some(&f.token), "DELETE", &path, None).await.0,
        StatusCode::OK
    );
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT isDeleted FROM webknossos.annotation_privateLinks WHERE _id=$1"
        )
        .bind(id)
        .fetch_one(&db.pool)
        .await
        .unwrap()
    );
    assert_eq!(
        request(&app, Some(&f.token), "GET", "/api/zarrPrivateLinks", None)
            .await
            .1,
        json!([])
    );
    assert_eq!(
        request(
            &app,
            Some(&f.token),
            "PUT",
            &path,
            Some(json!({"annotation":a.annotation}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn private_link_permissions_are_owner_only_and_rejected_rebind_is_atomic() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let a = seed(&db, &f).await;
    let admin = db.seed_user(&object_id(), &f.organization_id, true).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let foreign = db.fixture().await;
    let target = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,visibility) VALUES($1,$2,$3,'Explorational','Internal')").bind(&target).bind(&a.dataset).bind(&admin.user_id).execute(&db.pool).await.unwrap();
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let created = create_link(&app, &f, &a.annotation, Value::Null).await;
    let id = created["id"].as_str().unwrap();
    let path = format!("/api/zarrPrivateLinks/{id}");
    for token in [&admin.token, &member.token, &foreign.token] {
        assert_eq!(
            request(&app, Some(token), "GET", "/api/zarrPrivateLinks", None)
                .await
                .1,
            json!([])
        );
        assert_eq!(
            request(&app, Some(token), "GET", &path, None).await.0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            request(&app, Some(token), "DELETE", &path, None).await.0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            request(
                &app,
                Some(token),
                "PUT",
                &path,
                Some(json!({"annotation":a.other}))
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            request(
                &app,
                Some(token),
                "POST",
                "/api/zarrPrivateLinks",
                Some(json!({"annotation":a.annotation}))
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        request(&app, None, "GET", "/api/zarrPrivateLinks", None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            Some(&f.token),
            "PUT",
            &path,
            Some(json!({"annotation":target}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&app, Some(&f.token), "GET", &path, None).await.1,
        created
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM webknossos.annotation_privateLinks")
            .fetch_one(&db.pool)
            .await
            .unwrap(),
        1
    );
    // Finished and owner-locked states do not remove AnnotationDAO mutation grants.
    sqlx::query(
        "UPDATE webknossos.annotations SET state='Finished',isLockedByOwner=true WHERE _id=$1",
    )
    .bind(&a.other)
    .execute(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        request(
            &app,
            Some(&f.token),
            "PUT",
            &path,
            Some(json!({"annotation":a.other}))
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=true WHERE _id=$1")
        .bind(&a.other)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, Some(&f.token), "GET", "/api/zarrPrivateLinks", None)
            .await
            .1,
        json!([])
    );
    assert_eq!(
        request(&app, Some(&f.token), "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn annotation_source_uses_private_link_or_query_user_token_and_real_metadata() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let a = seed(&db, &f).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let created = create_link(&app, &f, &a.annotation, Value::Null).await;
    let access = created["accessToken"].as_str().unwrap();
    let (status, value) = request(
        &app,
        None,
        "GET",
        &format!("/api/annotations/source/{access}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({"id":a.annotation,"annotationLayers":[{"tracingId":"a-skeleton","typ":"Skeleton","name":"Skeleton","stats":{"treeCount":2}},{"tracingId":"b-volume","typ":"Volume","name":"Volume","stats":{"segmentCount":3}}],"datasetDirectoryName":"directory","datasetId":a.dataset,"organizationId":f.organization_id,"dataStoreUrl":"https://data.example.test","tracingStoreUrl":"https://tracing.example.test","accessViaPrivateLink":true})
    );
    assert!(!value.to_string().contains("never-return"));
    let path = format!("/api/annotations/source/{}", a.annotation);
    assert_eq!(
        request(&app, Some(&f.token), "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    ); // Header auth is ignored by this raw Action.
    let (status, direct) = request(
        &app,
        None,
        "GET",
        &format!("{path}?userToken={}", f.token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(direct["accessViaPrivateLink"], false);
    assert_eq!(
        request(
            &app,
            None,
            "GET",
            &format!("{path}?userToken={}", member.token),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &app,
            None,
            "GET",
            &format!("{path}?userToken=invalid"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    // The Scala userForToken helper accepts valid bearer records regardless of token type.
    let job = db.seed_token(&f.user_id, "Job").await;
    assert_eq!(
        request(&app, None, "GET", &format!("{path}?userToken={job}"), None)
            .await
            .0,
        StatusCode::OK
    );
    let reset = db.seed_token(&f.user_id, "ResetPassword").await;
    assert_eq!(
        request(
            &app,
            None,
            "GET",
            &format!("{path}?userToken={reset}"),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let last_used: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT lastUsedDateTime FROM webknossos.tokens WHERE value=$1")
            .bind(&reset)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    request(
        &app,
        None,
        "GET",
        &format!("{path}?userToken={reset}"),
        None,
    )
    .await;
    assert_eq!(
        sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
            "SELECT lastUsedDateTime FROM webknossos.tokens WHERE value=$1"
        )
        .bind(&reset)
        .fetch_one(&db.pool)
        .await
        .unwrap(),
        last_used
    );
    sqlx::query(
        "UPDATE webknossos.tokens SET expirationDateTime=now()-interval '1 minute' WHERE value=$1",
    )
    .bind(&job)
    .execute(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        request(&app, None, "GET", &format!("{path}?userToken={job}"), None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("INSERT INTO webknossos.tokens(_id,value,_user,lastUsedDateTime,expirationDateTime,tokenType,created) SELECT $1,value,_user,lastUsedDateTime,expirationDateTime,tokenType,created FROM webknossos.tokens WHERE value=$2")
        .bind(object_id()).bind(&reset).execute(&db.pool).await.unwrap();
    assert_eq!(
        request(
            &app,
            None,
            "GET",
            &format!("{path}?userToken={reset}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.annotations SET visibility='Public' WHERE _id=$1")
        .bind(&a.annotation)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &app,
            None,
            "GET",
            &format!("{path}?userToken=invalid"),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query("UPDATE webknossos.annotation_privateLinks SET expirationDateTime=TIMESTAMPTZ '2020-01-01T00:00:00Z' WHERE _id=$1").bind(created["id"].as_str().unwrap()).execute(&db.pool).await.unwrap();
    assert_eq!(
        request(
            &app,
            None,
            "GET",
            &format!("/api/annotations/source/{access}"),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    ); // Expired token falls through to ObjectId parsing, matching controller.
    sqlx::query("UPDATE webknossos.tracingStores SET isDeleted=true")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, None, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn annotation_dao_access_and_runtime_restrictions_remain_distinct() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let a = seed(&db, &f).await;
    let owner = webknossos_backend::auth::authenticate(&db.pool, &f.token)
        .await
        .unwrap();
    let peer = db.seed_user(&object_id(), &f.organization_id, false).await;
    let peer = webknossos_backend::auth::authenticate(&db.pool, &peer.token)
        .await
        .unwrap();
    assert!(
        annotation_access::find(&db.pool, Some(&peer), &a.annotation, false)
            .await
            .is_err()
    );
    let metadata = annotation_access::find(&db.pool, Some(&owner), &a.annotation, false)
        .await
        .unwrap();
    let restricted = annotation_access::restrictions(&metadata, Some(&owner));
    assert!(
        restricted.allow_access
            && restricted.allow_update
            && restricted.allow_update_with_mutex
            && restricted.allow_finish
            && restricted.allow_download
    );
    sqlx::query("UPDATE webknossos.annotations SET collaborationMode='Exclusive',visibility='Internal' WHERE _id=$1").bind(&a.annotation).execute(&db.pool).await.unwrap();
    let metadata = annotation_access::find(&db.pool, Some(&peer), &a.annotation, false)
        .await
        .unwrap();
    let restricted = annotation_access::restrictions(&metadata, Some(&peer));
    assert!(restricted.allow_access && restricted.allow_update);
    assert!(!restricted.allow_update_with_mutex);
    assert!(!restricted.allow_finish);
    sqlx::query("INSERT INTO webknossos.annotation_mutexes(_annotation,_user,sessionId,expiry) VALUES($1,$2,'session',now()+interval '1 hour')").bind(&a.annotation).bind(&peer.id).execute(&db.pool).await.unwrap();
    let metadata = annotation_access::find(&db.pool, Some(&peer), &a.annotation, false)
        .await
        .unwrap();
    assert!(annotation_access::restrictions(&metadata, Some(&peer)).allow_update_with_mutex);
    sqlx::query("UPDATE webknossos.annotations SET state='Finished' WHERE _id=$1")
        .bind(&a.annotation)
        .execute(&db.pool)
        .await
        .unwrap();
    let metadata = annotation_access::find(&db.pool, Some(&owner), &a.annotation, false)
        .await
        .unwrap();
    let restricted = annotation_access::restrictions(&metadata, Some(&owner));
    assert!(!restricted.allow_update && !restricted.allow_finish);
    assert!(restricted.allow_finish_soft);
    sqlx::query("UPDATE webknossos.annotations SET isLockedByOwner=true WHERE _id=$1")
        .bind(&a.annotation)
        .execute(&db.pool)
        .await
        .unwrap();
    let metadata = annotation_access::find(&db.pool, Some(&owner), &a.annotation, false)
        .await
        .unwrap();
    assert!(!annotation_access::restrictions(&metadata, Some(&owner)).allow_finish_soft);
    sqlx::query("UPDATE webknossos.annotations SET visibility='Public' WHERE _id=$1")
        .bind(&a.annotation)
        .execute(&db.pool)
        .await
        .unwrap();
    let metadata = annotation_access::find(&db.pool, None, &a.annotation, false)
        .await
        .unwrap();
    let restricted = annotation_access::restrictions(&metadata, None);
    assert!(restricted.allow_access && restricted.allow_download);
    assert!(!restricted.allow_update && !restricted.allow_finish);
    // Private task managers are a runtime restriction grant, separate from DAO read.
    let project = object_id();
    let task_type = object_id();
    let task = object_id();
    let task_annotation = object_id();
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,true)",
    )
    .bind(&peer.id)
    .bind(&f.team_id)
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Managed-task')").bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Managed-type','',true,true)").bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation) VALUES($1,$2,$3,'test',0,1,1,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)").bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility) VALUES($1,$2,$3,$4,'Task','Private')").bind(&task_annotation).bind(&a.dataset).bind(&task).bind(&f.user_id).execute(&db.pool).await.unwrap();
    assert!(
        annotation_access::find(&db.pool, Some(&peer), &task_annotation, false)
            .await
            .is_err()
    );
    let metadata = annotation_access::find(&db.pool, Some(&peer), &task_annotation, true)
        .await
        .unwrap();
    let restriction = annotation_access::restrictions(&metadata, Some(&peer));
    assert!(restriction.allow_access && restriction.allow_finish && !restriction.allow_update);
    let mut tx = db.pool.begin().await.unwrap();
    annotation_access::lock_for_mutation(&mut tx, &peer, &task_annotation)
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    sqlx::query("UPDATE webknossos.projects SET isDeleted=true WHERE _id=$1")
        .bind(&project)
        .execute(&db.pool)
        .await
        .unwrap();
    let metadata = annotation_access::find(&db.pool, Some(&peer), &task_annotation, true)
        .await
        .unwrap();
    let restriction = annotation_access::restrictions(&metadata, Some(&peer));
    assert!(!restriction.allow_access && !restriction.allow_finish);
    db.cleanup().await;
}
