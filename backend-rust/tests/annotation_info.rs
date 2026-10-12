//! GET /annotations/:typ/:id/info and GET /annotations/:id/info against a real
//! database and, for compound types, a mock tracing store.
mod common;

use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use common::{Fixture, TestDb, UserFixture, object_id};
use http_body_util::BodyExt;
use prost::Message;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    annotation_info::{ANNOTATION_CANCELLED, NOT_FOUND_CONSIDER_LOGIN},
    annotation_metadata::NOT_ALLOWED,
    annotation_provider::ANNOTATION_NOT_FOUND,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    router,
};

const T: i64 = 1_700_000_000_000;

fn error(message: &str) -> Value {
    json!({"messages":[{"error": message}]})
}

async fn get(app: &Router, token: Option<&str>, uri: &str) -> (StatusCode, Value) {
    let mut request = Request::builder().uri(uri);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

// ---------------------------------------------------------------------------
// Mock tracing store answering mergedFromIds with one skeleton layer.
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct Mock {
    merges: Arc<Mutex<usize>>,
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let _ = to_bytes(request.into_body(), 1024 * 1024).await;
    if path.ends_with("/mergedFromIds") {
        *mock.merges.lock().unwrap() += 1;
    }
    let merged = AnnotationProto {
        description: String::new(),
        version: 0,
        annotation_layers: vec![AnnotationLayerProto {
            tracing_id: "merged-skeleton".into(),
            name: "Skeleton".into(),
            typ: AnnotationLayerTypeProto::Skeleton as i32,
        }],
        earliest_accessible_version: 0,
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: None,
        user_states: Vec::new(),
    };
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/x-protobuf")],
        merged.encode_to_vec(),
    )
        .into_response()
}

async fn mock_tracing_store() -> (String, Mock) {
    let mock = Mock::default();
    let router = Router::new()
        .route("/{*path}", any(mock_handler))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}"), mock)
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

struct World {
    f: Fixture,
    owner: UserFixture,
    member: UserFixture,
    foreign: UserFixture,
    dataset: String,
    task: String,
}

async fn world(db: &TestDb, tracing_url: &str) -> World {
    let f = db.fixture().await;
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let foreign = db
        .seed_user(&object_id(), &format!("foreign-{}", object_id()), true)
        .await;
    for user in [&owner.user_id, &member.user_id] {
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,false)",
        )
        .bind(user)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('info','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('info-ts',$1,'https://trace.example.test','k')")
        .bind(tracing_url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit,sharingToken) SELECT $1,'info',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT,'dataset-sharing-token' FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (task, project, task_type) = (object_id(), object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Info-project')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Info-type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation,boundingbox) VALUES($1,$2,$3,'test',0,10,8,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3,ROW(1,2,3,10,20,30)::webknossos.BOUNDING_BOX)")
        .bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    let w = World {
        f,
        owner,
        member,
        foreign,
        dataset,
        task,
    };
    // Task JSON needs the task's base annotation.
    let admin = w.f.user_id.clone();
    annotation(
        db,
        &w,
        &admin,
        "TracingBase",
        "Internal",
        "Active",
        "OwnerOnly",
    )
    .await;
    w
}

/// Seeds a live annotation with one skeleton layer and tracingTime 1234.
async fn annotation(
    db: &TestDb,
    w: &World,
    owner: &str,
    typ: &str,
    visibility: &str,
    state: &str,
    mode: &str,
) -> String {
    let id = object_id();
    let task = matches!(typ, "Task" | "TracingBase").then_some(&w.task);
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,collaborationMode,name,description,tags,tracingTime,created,modified) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,$7::webknossos.ANNOTATION_STATE,$8::webknossos.ANNOTATION_COLLABORATION_MODE,'Name','Description',ARRAY['tag'],1234,TIMESTAMPTZ '2020-01-01T00:00:00Z',TIMESTAMPTZ '2020-01-02T00:00:00Z')")
        .bind(&id).bind(&w.dataset).bind(task).bind(owner).bind(typ).bind(visibility).bind(state).bind(mode)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{\"treeCount\":1}')")
        .bind(&id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    id
}

fn app(db: &TestDb) -> Router {
    router(AppState {
        pool: db.pool.clone(),
    })
}

async fn spans(db: &TestDb, user: &str, annotation: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM webknossos.timespans WHERE _user=$1 AND _annotation=$2",
    )
    .bind(user)
    .bind(annotation)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

async fn all_spans(db: &TestDb) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM webknossos.timespans")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

fn restrictions(access: bool, update: bool, finish: bool) -> Value {
    json!({"allowAccess":access,"allowUpdate":update,"allowFinish":finish,"allowDownload":access})
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn owner_reads_full_json_and_type_aliases_resolve() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    let private = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Private",
        "Active",
        "OwnerOnly",
    )
    .await;
    sqlx::query("INSERT INTO webknossos.user_annotationViewConfigurations(_annotation,_user,viewConfiguration) VALUES($1,$2,'{\"zoom\":2}')")
        .bind(&private).bind(&w.owner.user_id).execute(&db.pool).await.unwrap();

    let (status, body) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{private}/info"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["id"], private.as_str());
    assert_eq!(body["typ"], "Explorational");
    assert_eq!(body["state"], "Active");
    assert_eq!(body["visibility"], "Private");
    assert_eq!(body["name"], "Name");
    assert_eq!(body["description"], "Description");
    assert_eq!(body["created"], 1_577_836_800_000_i64);
    assert_eq!(body["modified"], 1_577_923_200_000_i64);
    assert_eq!(body["tracingTime"], 1234);
    assert_eq!(body["datasetId"], w.dataset.as_str());
    assert_eq!(body["dataSetName"], "Dataset");
    assert_eq!(body["organization"], w.f.organization_id.as_str());
    assert_eq!(body["tags"], json!(["Dataset", "tag"]));
    assert_eq!(body["viewConfiguration"], json!({"zoom":2}));
    assert_eq!(body["restrictions"], restrictions(true, true, true));
    assert_eq!(body["owner"]["id"], w.owner.user_id.as_str());
    assert_eq!(body["owner"], body["user"]);
    assert_eq!(body["task"], Value::Null);
    assert_eq!(body["teams"], json!([]));
    assert_eq!(body["contributors"], json!([]));
    assert_eq!(body["stats"], json!({}));
    assert_eq!(body["collaborationMode"], "OwnerOnly");
    assert_eq!(body["tracingStore"]["url"], "https://trace.example.test");
    assert_eq!(body["dataStore"]["name"], "info");
    assert_eq!(
        body["settings"]["allowedModes"],
        json!(["orthogonal", "flight"])
    );
    assert_eq!(
        body["annotationLayers"],
        json!([{"tracingId":format!("tracing-{private}"),"typ":"Skeleton","name":"Skeleton","stats":{"treeCount":1}}])
    );
    assert!(body.get("messages").is_none());

    // Saved type aliases are not compared with the stored type, and a
    // prefixed path ID is accepted by the ObjectId binder.
    let (status, alias) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/View/name-{private}/info"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(alias["typ"], "Explorational");
    assert_eq!(alias["restrictions"], body["restrictions"]);

    // Task annotation: task JSON and task-type settings.
    let task_annotation = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Task",
        "Internal",
        "Active",
        "OwnerOnly",
    )
    .await;
    let (status, body) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Task/{task_annotation}/info"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["task"]["id"], w.task.as_str());
    assert_eq!(body["settings"], body["task"]["type"]["settings"]);
    assert_eq!(all_spans(&db).await, 0, "no timestamp, no time tracking");
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn anonymous_access_is_public_only_and_ignores_sharing_tokens() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    let public = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Public",
        "Active",
        "OwnerOnly",
    )
    .await;
    let internal = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Active",
        "OwnerOnly",
    )
    .await;
    // The owner's view configuration must not leak as anonymous fallback.
    sqlx::query("INSERT INTO webknossos.user_annotationViewConfigurations(_annotation,_user,viewConfiguration) VALUES($1,$2,'{\"zoom\":2}')")
        .bind(&public).bind(&w.owner.user_id).execute(&db.pool).await.unwrap();

    let (status, body) = get(
        &app,
        None,
        &format!("/api/annotations/Explorational/{public}/info?sharingToken=dataset-sharing-token&timestamp={T}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["id"], public.as_str());
    assert_eq!(body["viewConfiguration"], Value::Null);
    assert_eq!(body["restrictions"], restrictions(true, false, false));
    assert_eq!(body["owner"]["id"], w.owner.user_id.as_str());
    // Logged-in users see their fallback view configuration.
    let (_, member_view) = get(
        &app,
        Some(&w.member.token),
        &format!("/api/annotations/Explorational/{public}/info"),
    )
    .await;
    assert_eq!(member_view["viewConfiguration"], json!({"zoom":2}));

    // Neither a dataset sharing token nor an annotation private-link token
    // grants annotation read access on this UserAwareAction.
    sqlx::query("INSERT INTO webknossos.annotation_privateLinks(_id,_annotation,accessToken) VALUES($1,$2,'private-link-token')")
        .bind(object_id()).bind(&internal).execute(&db.pool).await.unwrap();
    for query in [
        "",
        "?sharingToken=dataset-sharing-token",
        "?sharingToken=private-link-token",
    ] {
        let (status, body) = get(
            &app,
            None,
            &format!("/api/annotations/Explorational/{internal}/info{query}"),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::NOT_FOUND, error(NOT_FOUND_CONSIDER_LOGIN))
        );
    }
    // Untyped: plain notFound even for anonymous requesters.
    let (status, body) = get(&app, None, &format!("/api/annotations/{internal}/info")).await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
    );
    let (status, body) = get(&app, None, &format!("/api/annotations/{public}/info")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], public.as_str());
    assert_eq!(all_spans(&db).await, 0, "anonymous requests never log time");
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn access_denied_cancelled_invalid_type_and_bad_timestamp() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    let private = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Private",
        "Active",
        "OwnerOnly",
    )
    .await;
    let internal = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Active",
        "OwnerOnly",
    )
    .await;
    let cancelled = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Cancelled",
        "OwnerOnly",
    )
    .await;

    // DAO read access fails before restrictions: 404 notFound.
    for (token, id) in [(&w.member.token, &private), (&w.foreign.token, &internal)] {
        let (status, body) = get(
            &app,
            Some(token),
            &format!("/api/annotations/Explorational/{id}/info"),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
        );
        let (status, body) = get(&app, Some(token), &format!("/api/annotations/{id}/info")).await;
        assert_eq!(
            (status, body),
            (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
        );
    }
    // Organization admins read Private annotations of their organization.
    let (status, body) = get(
        &app,
        Some(&w.f.token),
        &format!("/api/annotations/Explorational/{private}/info"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["restrictions"], restrictions(true, false, true));

    let (status, body) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{cancelled}/info?timestamp={T}"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(ANNOTATION_CANCELLED))
    );
    // Annotation types are case-sensitive; parse failures are 404 notFound.
    let (status, body) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/explorational/{internal}/info"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
    );
    let (status, body) = get(
        &app,
        None,
        &format!("/api/annotations/Bogus/{internal}/info"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(NOT_FOUND_CONSIDER_LOGIN))
    );
    // Play's Long binder runs before the action.
    let (status, body) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{internal}/info?timestamp=soon"),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Cannot parse parameter timestamp as Long: For input string: \"soon\"")
        )
    );
    assert_eq!(all_spans(&db).await, 0);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn untyped_info_resolves_the_stored_type() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    let task_annotation = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Task",
        "Internal",
        "Active",
        "OwnerOnly",
    )
    .await;
    let explorational = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Active",
        "OwnerOnly",
    )
    .await;

    let (status, untyped) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/{task_annotation}/info"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{untyped}");
    let (_, typed) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Task/{task_annotation}/info"),
    )
    .await;
    assert_eq!(untyped, typed);
    assert_eq!(untyped["typ"], "Task");
    assert_eq!(untyped["task"]["id"], w.task.as_str());

    let (status, body) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/{explorational}/info?timestamp={T}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["typ"], "Explorational");
    // The stored type (Explorational) gates time tracking.
    assert_eq!(spans(&db, &w.owner.user_id, &explorational).await, 1);
    // Unknown IDs and invalid IDs.
    let (status, body) = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/{}/info", object_id()),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
    );
    let (status, _) = get(
        &app,
        Some(&w.owner.token),
        "/api/annotations/not-an-id/info",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn time_is_logged_only_for_task_or_explorational_contributors_with_timestamp() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    let owned = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Active",
        "OwnerOnly",
    )
    .await;
    let task_annotation = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Task",
        "Internal",
        "Active",
        "OwnerOnly",
    )
    .await;
    let concurrent = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Active",
        "Concurrent",
    )
    .await;
    let info =
        |typ: &str, id: &str, query: &str| format!("/api/annotations/{typ}/{id}/info{query}");
    let ts = format!("?timestamp={T}");

    // Owner without timestamp: no span.
    assert_eq!(
        get(
            &app,
            Some(&w.owner.token),
            &info("Explorational", &owned, "")
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(all_spans(&db).await, 0);
    // Requested View type never logs, even for the owner with a timestamp.
    assert_eq!(
        get(&app, Some(&w.owner.token), &info("View", &owned, &ts))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(all_spans(&db).await, 0);
    // Owner with timestamp: Explorational and Task log one span each.
    assert_eq!(
        get(
            &app,
            Some(&w.owner.token),
            &info("Explorational", &owned, &ts)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(spans(&db, &w.owner.user_id, &owned).await, 1);
    let (status, _) = get(
        &app,
        Some(&w.owner.token),
        &info(
            "Task",
            &task_annotation,
            &format!("?timestamp={}", T + 1000),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(spans(&db, &w.owner.user_id, &task_annotation).await, 1);
    // A reader of an OwnerOnly annotation is not a potential contributor.
    assert_eq!(
        get(
            &app,
            Some(&w.member.token),
            &info("Explorational", &owned, &ts)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        get(&app, Some(&w.f.token), &info("Explorational", &owned, &ts))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(spans(&db, &w.member.user_id, &owned).await, 0);
    assert_eq!(spans(&db, &w.f.user_id, &owned).await, 0);
    // Concurrent collaboration: every requester is a potential contributor.
    assert_eq!(
        get(
            &app,
            Some(&w.member.token),
            &info("Explorational", &concurrent, &ts)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(spans(&db, &w.member.user_id, &concurrent).await, 1);
    // Rejected requests never log.
    let cancelled = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Cancelled",
        "OwnerOnly",
    )
    .await;
    assert_eq!(
        get(
            &app,
            Some(&w.owner.token),
            &info("Explorational", &cancelled, &ts)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(spans(&db, &w.owner.user_id, &cancelled).await, 0);
    assert_eq!(all_spans(&db).await, 3);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_task_info_merges_once_and_applies_compound_restrictions() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let annotator = db
        .seed_user(&object_id(), &w.f.organization_id, false)
        .await;
    let instance = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state) VALUES($1,$2,$3,$4,'Task','Internal','Finished')")
        .bind(&instance).bind(&w.dataset).bind(&w.task).bind(&annotator.user_id)
        .execute(&db.pool).await.unwrap();
    let path = format!(
        "/api/annotations/CompoundTask/{}/info?timestamp={T}",
        w.task
    );
    let merges = || *mock.merges.lock().unwrap();

    // Anonymous: the task is unreadable, 404 with the login hint.
    let (status, body) = get(&app, None, &path).await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(NOT_FOUND_CONSIDER_LOGIN))
    );
    assert_eq!(merges(), 0);

    // Admin (organization admin = compound access) merges, becomes owner.
    let (status, body) = get(&app, Some(&w.f.token), &path).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(merges(), 1);
    assert_eq!(body["id"], w.task.as_str());
    assert_eq!(body["typ"], "CompoundTask");
    assert_eq!(body["state"], "Active");
    assert_eq!(body["visibility"], "Internal");
    assert_eq!(body["collaborationMode"], "OwnerOnly");
    assert_eq!(body["isLockedByOwner"], false);
    assert_eq!(body["task"], Value::Null);
    assert_eq!(body["tracingTime"], Value::Null);
    assert_eq!(body["viewConfiguration"], Value::Null);
    assert_eq!(body["teams"], json!([]));
    assert_eq!(body["contributors"], json!([]));
    assert_eq!(body["tags"], json!(["Dataset"]));
    assert_eq!(body["datasetId"], w.dataset.as_str());
    assert_eq!(body["owner"]["id"], w.f.user_id.as_str());
    assert_eq!(body["restrictions"], restrictions(true, false, false));
    assert_eq!(
        body["annotationLayers"],
        json!([{"tracingId":"merged-skeleton","typ":"Skeleton","name":"Skeleton","stats":{}}])
    );
    assert_eq!(
        body["settings"]["allowedModes"],
        json!(["orthogonal", "flight"])
    );
    assert_eq!(body["created"], body["modified"]);

    // A non-manager team member reads the cached compound but the compound
    // restrictions deny access (fail-closed 403).
    let (status, body) = get(&app, Some(&w.member.token), &path).await;
    assert_eq!((status, body), (StatusCode::FORBIDDEN, error(NOT_ALLOWED)));
    // Cache hit: no re-merge, owner stays the first requester.
    let (status, body) = get(&app, Some(&w.f.token), &path).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["owner"]["id"], w.f.user_id.as_str());
    assert_eq!(merges(), 1);
    // Compound types never log time.
    assert_eq!(all_spans(&db).await, 0);
    db.cleanup().await;
}
