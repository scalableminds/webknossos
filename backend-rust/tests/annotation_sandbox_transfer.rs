mod common;

use axum::{
    Extension, Router,
    body::Body,
    extract::Request,
    http::{Method, StatusCode, header},
};
use common::{Fixture, TestDb, UserFixture, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    annotation_metadata::{NOT_ALLOWED, PUBLIC_WRITES_FAILED},
    annotation_provider::{
        ANNOTATION_NOT_FOUND, AnnotationProvider, RESOURCE_NOT_FOUND, RESTRICTIONS_NOT_FOUND,
    },
    annotation_sandbox::{self, DUMMY_ID, DUMMY_TRACING_ID, SANDBOX_SKELETON_ONLY},
    annotation_transfer::{self, TRANSFEREE_NO_DATASET_ACCESS, user_not_found},
    service_clients::ServiceClientConfig,
    tracingstore_client::TracingStoreClient,
};

struct World {
    f: Fixture,
    owner: UserFixture,
    outsider: UserFixture,
    target: UserFixture,
    dataset: String,
}

async fn world(db: &TestDb) -> World {
    let f = db.fixture().await;
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let outsider = db.seed_user(&object_id(), &f.organization_id, false).await;
    let target = db.seed_user(&object_id(), &f.organization_id, false).await;
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('sandbox','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('sandbox','http://127.0.0.1:1','https://trace.example.test','k')")
        .execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,sharingToken,voxelSizeFactor,voxelSizeUnit) SELECT $1,'sandbox',_id,_rootfolder,'Sandbox dataset','dir',now(),true,'share-me',ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    World {
        f,
        owner,
        outsider,
        target,
        dataset,
    }
}

async fn annotation(db: &TestDb, w: &World, visibility: &str, state: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,visibility,state,name) VALUES($1,$2,$3,'Explorational',$4::webknossos.ANNOTATION_VISIBILITY,$5::webknossos.ANNOTATION_STATE,'Transfer me')")
        .bind(&id).bind(&w.dataset).bind(&w.owner.user_id).bind(visibility).bind(state).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{}')")
        .bind(&id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    id
}

async fn join_team(db: &TestDb, w: &World, user: &str, manager: bool) {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,$3)",
    )
    .bind(user)
    .bind(&w.f.team_id)
    .bind(manager)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn owner_of(db: &TestDb, id: &str) -> String {
    sqlx::query_scalar("SELECT _user FROM webknossos.annotations WHERE _id=$1")
        .bind(id)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

fn app(db: &TestDb) -> Router {
    let provider = AnnotationProvider::new(
        db.pool.clone(),
        TracingStoreClient::new(ServiceClientConfig::default()).unwrap(),
    );
    Router::new()
        .nest(
            "/api",
            annotation_sandbox::router(false).merge(annotation_transfer::router(false)),
        )
        .layer(Extension(provider))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}

async fn send(
    app: &Router,
    method: Method,
    token: Option<&str>,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let body = match body {
        Some(body) => {
            request = request.header(header::CONTENT_TYPE, "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn error(message: &str) -> Value {
    json!({"messages":[{"error":message}]})
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn sandbox_serializes_a_never_persisted_skeleton_annotation() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let app = app(&db);
    let base = format!("/api/datasets/{}/sandbox", w.dataset);

    // Private dataset: anonymous without token and unknown datasets are 404,
    // before the tracing type is even looked at.
    let not_found = error(&annotation_sandbox::dataset_not_found(&w.dataset));
    for path in [
        format!("{base}/skeleton"),
        format!("{base}/invalid"),
        format!("{base}/skeleton?sharingToken=wrong"),
    ] {
        assert_eq!(
            send(&app, Method::GET, None, &path, None).await,
            (StatusCode::NOT_FOUND, not_found.clone())
        );
    }
    let missing = object_id();
    assert_eq!(
        send(
            &app,
            Method::GET,
            Some(&w.f.token),
            &format!("/api/datasets/{missing}/sandbox/skeleton"),
            None
        )
        .await,
        (
            StatusCode::NOT_FOUND,
            error(&annotation_sandbox::dataset_not_found(&missing))
        )
    );

    // Readable: volume/hybrid are rejected, unknown tracing types are Fox.Empty.
    for (typ, expected) in [
        ("volume", (StatusCode::BAD_REQUEST, SANDBOX_SKELETON_ONLY)),
        ("hybrid", (StatusCode::BAD_REQUEST, SANDBOX_SKELETON_ONLY)),
        ("Skeleton", (StatusCode::NOT_FOUND, RESOURCE_NOT_FOUND)),
    ] {
        assert_eq!(
            send(
                &app,
                Method::GET,
                None,
                &format!("{base}/{typ}?sharingToken=share-me"),
                None
            )
            .await,
            (expected.0, error(expected.1))
        );
    }

    let (status, anonymous) = send(
        &app,
        Method::GET,
        None,
        &format!("{base}/skeleton?sharingToken=share-me"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{anonymous}");
    assert_eq!(anonymous["id"], DUMMY_ID);
    assert_eq!(anonymous["typ"], "Explorational");
    assert_eq!(anonymous["state"], "Active");
    assert_eq!(anonymous["visibility"], "Internal");
    assert_eq!(anonymous["collaborationMode"], "OwnerOnly");
    assert_eq!(anonymous["name"], "");
    assert_eq!(anonymous["description"], "");
    assert_eq!(anonymous["isLockedByOwner"], false);
    assert_eq!(
        anonymous["annotationLayers"],
        json!([{"tracingId":DUMMY_TRACING_ID,"typ":"Skeleton","name":"Skeleton","stats":{}}])
    );
    assert_eq!(anonymous["datasetId"], w.dataset);
    assert_eq!(anonymous["dataSetName"], "Sandbox dataset");
    assert_eq!(anonymous["organization"], w.f.organization_id);
    assert_eq!(anonymous["dataStore"]["name"], "sandbox");
    assert_eq!(
        anonymous["tracingStore"],
        json!({"name":"sandbox","url":"https://trace.example.test"})
    );
    assert_eq!(anonymous["tags"], json!(["Sandbox dataset"]));
    assert_eq!(anonymous["teams"], json!([]));
    assert_eq!(anonymous["contributors"], json!([]));
    for field in ["owner", "user", "task", "viewConfiguration", "tracingTime"] {
        assert!(anonymous[field].is_null(), "{field}");
    }
    assert_eq!(anonymous["stats"], json!({}));
    assert_eq!(
        anonymous["settings"]["allowedModes"],
        json!(["orthogonal", "flight"])
    );
    let no_restrictions =
        json!({"allowAccess":false,"allowUpdate":false,"allowFinish":false,"allowDownload":false});
    assert_eq!(anonymous["restrictions"], no_restrictions);
    assert!(anonymous["created"].as_i64().unwrap() > 1_600_000_000_000);

    // Organization admin needs no token; the dummy owner still grants nothing.
    let (status, admin) = send(
        &app,
        Method::GET,
        Some(&w.f.token),
        &format!("{base}/skeleton"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(admin["restrictions"], no_restrictions);
    // A user without dataset access can still use the sharing token.
    assert_eq!(
        send(
            &app,
            Method::GET,
            Some(&w.outsider.token),
            &format!("{base}/skeleton"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(
            &app,
            Method::GET,
            Some(&w.outsider.token),
            &format!("{base}/skeleton?sharingToken=share-me"),
            None
        )
        .await
        .0,
        StatusCode::OK
    );

    let persisted: i64 = sqlx::query_scalar("SELECT count(*) FROM webknossos.annotations")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(persisted, 0);

    // A missing tracing store is a publicWrites failure.
    sqlx::query("UPDATE webknossos.tracingStores SET isDeleted=true")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        send(
            &app,
            Method::GET,
            Some(&w.f.token),
            &format!("{base}/skeleton"),
            None
        )
        .await,
        (StatusCode::BAD_REQUEST, error(PUBLIC_WRITES_FAILED))
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn transfer_checks_finish_rights_user_access_and_transferee_dataset_access() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let app = app(&db);
    let id = annotation(&db, &w, "Internal", "Active").await;
    let path = format!("/api/annotations/Explorational/{id}/transfer");
    let to_target = json!({"userId": w.target.user_id});

    assert_eq!(
        send(&app, Method::PATCH, None, &path, Some(to_target.clone()))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(
            &app,
            Method::PATCH,
            Some(&w.f.token),
            &path,
            Some(json!({"userId":"nope"}))
        )
        .await,
        (StatusCode::BAD_REQUEST, error("Invalid JSON request body."))
    );
    // Unknown types and annotations fail inside restrictionsFor.
    for path in [
        format!("/api/annotations/Unknown/{id}/transfer"),
        format!("/api/annotations/Explorational/{}/transfer", object_id()),
        format!("/api/annotations/CompoundTask/{}/transfer", object_id()),
    ] {
        assert_eq!(
            send(
                &app,
                Method::PATCH,
                Some(&w.f.token),
                &path,
                Some(to_target.clone())
            )
            .await,
            (StatusCode::NOT_FOUND, error(RESTRICTIONS_NOT_FOUND))
        );
    }
    // Readable but not finishable for a plain organization member.
    assert_eq!(
        send(
            &app,
            Method::PATCH,
            Some(&w.outsider.token),
            &path,
            Some(to_target.clone())
        )
        .await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );
    // The owner may finish, but cannot read the other user.
    assert_eq!(
        send(
            &app,
            Method::PATCH,
            Some(&w.owner.token),
            &path,
            Some(to_target.clone())
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error(&user_not_found(&w.target.user_id))
        )
    );
    let missing = object_id();
    assert_eq!(
        send(
            &app,
            Method::PATCH,
            Some(&w.f.token),
            &path,
            Some(json!({"userId": missing}))
        )
        .await,
        (StatusCode::BAD_REQUEST, error(&user_not_found(&missing)))
    );
    // The organization admin can read the target, but the target cannot read
    // the (non-public, unshared) dataset; a sharing token does not count.
    assert_eq!(
        send(
            &app,
            Method::PATCH,
            Some(&w.f.token),
            &path,
            Some(to_target.clone())
        )
        .await,
        (StatusCode::BAD_REQUEST, error(TRANSFEREE_NO_DATASET_ACCESS))
    );
    assert_eq!(owner_of(&db, &id).await, w.owner.user_id);

    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&w.dataset)
        .bind(&w.f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    join_team(&db, &w, &w.target.user_id, false).await;
    let (status, body) = send(
        &app,
        Method::PATCH,
        Some(&w.f.token),
        &path,
        Some(to_target.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(owner_of(&db, &id).await, w.target.user_id);
    assert_eq!(body["id"], id);
    assert_eq!(body["name"], "Transfer me");
    assert_eq!(body["owner"]["id"], w.target.user_id);
    assert_eq!(body["user"]["id"], w.target.user_id);
    assert_eq!(body["state"], "Active");
    assert!(body.get("messages").is_none());
    // Restrictions of the pre-transfer annotation for the requesting admin.
    assert_eq!(
        body["restrictions"],
        json!({"allowAccess":true,"allowUpdate":false,"allowFinish":true,"allowDownload":true})
    );

    // Finished annotations cannot be finished, hence not transferred.
    let finished = annotation(&db, &w, "Internal", "Finished").await;
    assert_eq!(
        send(
            &app,
            Method::PATCH,
            Some(&w.owner.token),
            &format!("/api/annotations/Explorational/{finished}/transfer"),
            Some(json!({"userId": w.owner.user_id}))
        )
        .await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );
    assert_eq!(owner_of(&db, &finished).await, w.owner.user_id);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn transfer_persists_even_when_the_reload_is_no_longer_readable() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let app = app(&db);
    // The non-admin owner manages a team the target belongs to, so the target
    // is readable; the dataset is public.
    join_team(&db, &w, &w.owner.user_id, true).await;
    join_team(&db, &w, &w.target.user_id, false).await;
    sqlx::query("UPDATE webknossos.datasets SET isPublic=true WHERE _id=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();

    // Internal: still readable by the former owner after the transfer.
    let internal = annotation(&db, &w, "Internal", "Active").await;
    let (status, body) = send(
        &app,
        Method::PATCH,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{internal}/transfer"),
        Some(json!({"userId": w.target.user_id})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["owner"]["id"], w.target.user_id);
    assert_eq!(
        body["restrictions"],
        json!({"allowAccess":true,"allowUpdate":true,"allowFinish":true,"allowDownload":true})
    );

    // Private: Scala commits the owner change, then the reload under the
    // former owner's read access fails without a route message.
    let private = annotation(&db, &w, "Private", "Active").await;
    assert_eq!(
        send(
            &app,
            Method::PATCH,
            Some(&w.owner.token),
            &format!("/api/annotations/Explorational/{private}/transfer"),
            Some(json!({"userId": w.target.user_id}))
        )
        .await,
        (StatusCode::BAD_REQUEST, error(ANNOTATION_NOT_FOUND))
    );
    assert_eq!(owner_of(&db, &private).await, w.target.user_id);
    db.cleanup().await;
}
