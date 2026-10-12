//! POST /tasks (TaskController.create) against a real database and a mock
//! tracing store that records every RPC and can fail selected ones.
mod common;

use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{Method, StatusCode, header},
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
    proto::{
        AnnotationLayerTypeProto, AnnotationProto,
        datastore::{SkeletonTracingsWithIds, VolumeTracing},
    },
    router,
};

const NOT_FOUND: &str = "Could not find or access the requested resource.";

fn error(message: &str) -> Value {
    json!({"messages":[{"error": message}]})
}

async fn post(app: &Router, token: Option<&str>, body: &str) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/api/tasks")
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn post_json(app: &Router, token: &str, body: Value) -> (StatusCode, Value) {
    post(app, Some(token), &body.to_string()).await
}

// ---------------------------------------------------------------------------
// Mock tracing store
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Call {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    content_type: Option<String>,
    body: Vec<u8>,
}

impl Call {
    fn param(&self, key: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
    fn keys(&self) -> Vec<&str> {
        self.query.iter().map(|(k, _)| k.as_str()).collect()
    }
}

#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
    /// (path substring, status) of RPCs to fail.
    failures: Arc<Mutex<Vec<(String, u16)>>>,
    /// saveMultiple answers `Failure` for this index.
    skeleton_failure: Arc<Mutex<Option<usize>>>,
}

impl Mock {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn clear(&self) {
        self.calls.lock().unwrap().clear();
        self.failures.lock().unwrap().clear();
        *self.skeleton_failure.lock().unwrap() = None;
    }
    fn fail(&self, path: &str, status: u16) {
        self.failures.lock().unwrap().push((path.into(), status));
    }
    fn paths(&self) -> Vec<String> {
        self.calls().into_iter().map(|c| c.path).collect()
    }
    fn with_path(&self, suffix: &str) -> Vec<Call> {
        self.calls()
            .into_iter()
            .filter(|c| c.path.ends_with(suffix))
            .collect()
    }
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_owned();
    let query: Vec<(String, String)> =
        serde_urlencoded::from_str(request.uri().query().unwrap_or("")).unwrap();
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_owned());
    let body = to_bytes(request.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    mock.calls.lock().unwrap().push(Call {
        method,
        path: path.clone(),
        query,
        content_type,
        body: body.clone(),
    });
    let failure = mock
        .failures
        .lock()
        .unwrap()
        .iter()
        .find(|(p, _)| path.contains(p.as_str()))
        .map(|(_, s)| *s);
    if let Some(status) = failure {
        return (
            StatusCode::from_u16(status).unwrap(),
            "upstream secret body",
        )
            .into_response();
    }
    if path.ends_with("/saveMultiple") {
        let request = SkeletonTracingsWithIds::decode(body.as_slice()).unwrap();
        let failing = *mock.skeleton_failure.lock().unwrap();
        let answer: Vec<Value> = request
            .tracings
            .iter()
            .enumerate()
            .map(|(i, t)| match (&t.tracing, failing) {
                (Some(_), Some(f)) if f == i => json!({"status":"Failure","value":"store failure"}),
                (Some(_), _) => json!({"status":"Full","value":true}),
                (None, _) => json!({"status":"Empty"}),
            })
            .collect();
        return axum::Json(answer).into_response();
    }
    StatusCode::OK.into_response()
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
    /// Team manager of team A (the dataset's allowed team) and of nothing else.
    manager: UserFixture,
    /// Plain member of team A, manager of team B.
    member: UserFixture,
    /// Same organization, no team.
    outsider: UserFixture,
    /// Admin of another organization.
    foreign: UserFixture,
    dataset: String,
    foreign_dataset: String,
    skeleton_type: String,
    volume_type: String,
    hybrid_type: String,
    script: String,
    mock: Mock,
    app: Router,
}

async fn add_role(db: &TestDb, user: &str, team: &str, manager: bool) {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,$3)",
    )
    .bind(user)
    .bind(team)
    .bind(manager)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn add_team(db: &TestDb, organization: &str, name: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.teams(_id,_organization,name) VALUES($1,$2,$3)")
        .bind(&id)
        .bind(organization)
        .bind(name)
        .execute(&db.pool)
        .await
        .unwrap();
    id
}

async fn add_project(db: &TestDb, organization: &str, team: &str, owner: &str, name: &str) {
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,$5)")
        .bind(object_id()).bind(organization).bind(team).bind(owner).bind(name)
        .execute(&db.pool).await.unwrap();
}

async fn add_task_type(
    db: &TestDb,
    organization: &str,
    team: &str,
    summary: &str,
    tracing_type: &str,
    mag_min: Option<i32>,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed,tracingType,settings_magRestrictions_min) VALUES($1,$2,$3,$4,'',true,true,$5::webknossos.TASKTYPE_TRACINGTYPES,$6)")
        .bind(&id).bind(organization).bind(team).bind(summary).bind(tracing_type).bind(mag_min)
        .execute(&db.pool).await.unwrap();
    id
}

async fn add_dataset(db: &TestDb, organization: &str, public: bool) -> String {
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,isPublic,voxelSizeFactor,voxelSizeUnit) SELECT $1,'task-ds',_id,_rootfolder,'Dataset','dir',now(),true,$3,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(organization).bind(public).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers(_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES($1,'color','color'::webknossos.DATASET_LAYER_CATEGORY,'uint8'::webknossos.DATASET_LAYER_ELEMENT_CLASS,ROW(0,0,0,100,200,50)::webknossos.BOUNDING_BOX,'wkw')")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    for mag in [1, 2, 4] {
        sqlx::query("INSERT INTO webknossos.dataset_mags(_dataset,dataLayerName,mag,path) VALUES($1,'color',ROW($2,$2,$2)::webknossos.vector3,$3)")
            .bind(&dataset).bind(mag).bind(format!("color/{mag}"))
            .execute(&db.pool).await.unwrap();
    }
    dataset
}

async fn world(db: &TestDb) -> World {
    let (url, mock) = mock_tracing_store().await;
    let f = db.fixture().await;
    let org = f.organization_id.clone();
    let manager = db.seed_user(&object_id(), &org, false).await;
    let member = db.seed_user(&object_id(), &org, false).await;
    let outsider = db.seed_user(&object_id(), &org, false).await;
    let foreign_org = format!("foreign-{}", object_id());
    let foreign = db.seed_user(&object_id(), &foreign_org, true).await;
    let team_b = add_team(db, &org, "Team B").await;
    let team_c = add_team(db, &org, "Team C").await;
    add_role(db, &manager.user_id, &f.team_id, true).await;
    add_role(db, &member.user_id, &f.team_id, false).await;
    add_role(db, &member.user_id, &team_b, true).await;
    // Team C's only member also belongs to the dataset team: covered, no warning.
    add_role(db, &manager.user_id, &team_c, true).await;
    // Team B has a member outside the dataset team: warning.
    let b_member = db.seed_user(&object_id(), &org, false).await;
    add_role(db, &b_member.user_id, &team_b, false).await;
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('task-ds','http://127.0.0.1:9','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('task-ts',$1,'https://trace.example.test','k')")
        .bind(&url).execute(&db.pool).await.unwrap();
    let dataset = add_dataset(db, &org, false).await;
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let foreign_dataset = add_dataset(db, &foreign_org, true).await;
    add_project(db, &org, &f.team_id, &f.user_id, "Project-A").await;
    add_project(db, &org, &team_b, &f.user_id, "Project-B").await;
    add_project(db, &org, &team_c, &f.user_id, "Project-C").await;
    let skeleton_type =
        add_task_type(db, &org, &f.team_id, "Skeleton-type", "skeleton", None).await;
    let volume_type = add_task_type(db, &org, &f.team_id, "Volume-type", "volume", None).await;
    let hybrid_type = add_task_type(db, &org, &f.team_id, "Hybrid-type", "hybrid", Some(2)).await;
    let script = object_id();
    sqlx::query("INSERT INTO webknossos.scripts(_id,_owner,name,gist) VALUES($1,$2,'Script','https://gist.example.test/x')")
        .bind(&script).bind(&f.user_id).execute(&db.pool).await.unwrap();
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    World {
        f,
        manager,
        member,
        outsider,
        foreign,
        dataset,
        foreign_dataset,
        skeleton_type,
        volume_type,
        hybrid_type,
        script,
        mock,
        app,
    }
}

fn params(task_type: &str, dataset: &str, project: &str) -> Value {
    json!({
        "taskTypeId": task_type,
        "neededExperience": {"domain": "  basic ", "value": 3},
        "pendingInstances": 2,
        "projectName": project,
        "datasetId": dataset,
        "editPosition": [10, 20, 30],
        "editRotation": [0, 90, 0.5],
    })
}

fn with(mut value: Value, key: &str, field: Value) -> Value {
    value[key] = field;
    value
}

async fn count(db: &TestDb, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(&db.pool).await.unwrap()
}

/// (tasks, annotations, layers).
async fn totals(db: &TestDb) -> (i64, i64, i64) {
    (
        count(db, "SELECT count(*) FROM webknossos.tasks").await,
        count(db, "SELECT count(*) FROM webknossos.annotations WHERE typ='TracingBase'").await,
        count(db, "SELECT count(*) FROM webknossos.annotation_layers l JOIN webknossos.annotations a ON a._id=l._annotation WHERE a.typ='TracingBase'").await,
    )
}

type TaskRow = (
    String,
    Option<String>,
    String,
    i32,
    i64,
    i64,
    Option<String>,
    String,
    String,
    Option<String>,
);

async fn task_row(db: &TestDb, id: &str) -> TaskRow {
    sqlx::query_as("SELECT t._taskType,t._script,t.neededExperience_domain,t.neededExperience_value,t.totalInstances,t.pendingInstances,
        CASE WHEN t.boundingBox IS NULL THEN NULL ELSE concat_ws(',',(t.boundingBox).x,(t.boundingBox).y,(t.boundingBox).z,(t.boundingBox).width,(t.boundingBox).height,(t.boundingBox).depth) END,
        concat_ws(',',(t.editPosition).x,(t.editPosition).y,(t.editPosition).z),
        concat_ws(',',(t.editRotation).x,(t.editRotation).y,(t.editRotation).z), t.creationInfo
        FROM webknossos.tasks t WHERE t._id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

/// TracingBase of a task: (id, _user, _dataset, description, visibility|state|name, layers).
async fn base_of(
    db: &TestDb,
    task: &str,
) -> (
    String,
    String,
    String,
    String,
    String,
    Vec<(String, String, String, Value)>,
) {
    let (id, user, dataset, description, summary): (String, String, String, String, String) = sqlx::query_as(
        "SELECT _id,_user,_dataset,description,visibility::text||'|'||state::text||'|'||name||'|'||collaborationMode::text FROM webknossos.annotations WHERE _task=$1 AND typ='TracingBase'",
    )
    .bind(task)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    let layers = sqlx::query_as("SELECT tracingId,typ::text,name,statistics FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY typ")
        .bind(&id).fetch_all(&db.pool).await.unwrap();
    (id, user, dataset, description, summary, layers)
}

fn task_ids(body: &Value) -> Vec<String> {
    body["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["status"] == 200)
        .map(|t| t["success"]["id"].as_str().unwrap().to_owned())
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn creates_skeleton_tasks_with_fresh_bases() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let first = with(
        with(
            with(
                params(&w.skeleton_type, &w.dataset, "Project-A"),
                "boundingBox",
                json!({"topLeft": [1, 2, 3], "width": 10, "height": 20, "depth": 30}),
            ),
            "scriptId",
            json!(w.script),
        ),
        "creationInfo",
        json!("first.nml"),
    );
    let second = with(
        with(
            params(&w.skeleton_type, &w.dataset, "Project-C"),
            "boundingBox",
            json!({"topLeft": [1, 2, 3], "width": 0, "height": 20, "depth": 30}),
        ),
        "description",
        json!("Second description"),
    );
    let (status, body) = post_json(&w.app, &w.manager.token, json!([first, second])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // Team A is the dataset team, team C is covered by team A: no warnings.
    assert_eq!(body["warnings"], json!([]));
    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 2);
    for task in tasks {
        assert_eq!(task["status"], 200, "{task}");
        assert_eq!(
            task["success"]["status"],
            json!({"pending":2,"active":0,"finished":0})
        );
        assert_eq!(task["success"]["datasetId"], json!(w.dataset));
        assert_eq!(
            task["success"]["neededExperience"],
            json!({"domain":"basic","value":3})
        );
        assert_eq!(task["success"]["type"]["id"], json!(w.skeleton_type));
    }
    assert_eq!(tasks[0]["success"]["projectName"], "Project-A");
    assert_eq!(tasks[0]["success"]["script"]["id"], json!(w.script));
    assert_eq!(
        tasks[0]["success"]["boundingBox"],
        json!({"topLeft":[1,2,3],"width":10,"height":20,"depth":30})
    );
    assert_eq!(tasks[0]["success"]["creationInfo"], "first.nml");
    assert_eq!(tasks[1]["success"]["boundingBox"], Value::Null);
    let ids = task_ids(&body);

    // RPCs: one saveMultiple with both fresh skeletons, then one AnnotationProto per task.
    let paths = w.mock.paths();
    assert_eq!(
        paths,
        [
            "/tracings/skeleton/saveMultiple",
            "/tracings/annotation/save",
            "/tracings/annotation/save"
        ]
    );
    let save = &w.mock.with_path("/saveMultiple")[0];
    assert_eq!(save.method, "POST");
    assert_eq!(save.keys(), ["token"]);
    assert_eq!(save.content_type.as_deref(), Some("application/x-protobuf"));
    let saved = SkeletonTracingsWithIds::decode(save.body.as_slice()).unwrap();
    assert_eq!(saved.tracings.len(), 2);
    let skeleton = saved.tracings[0].tracing.as_ref().unwrap();
    assert_eq!(skeleton.dataset_name, "unused");
    assert_eq!(skeleton.active_node_id, Some(1));
    assert_eq!(skeleton.zoom_level, 2.0);
    let bbox = skeleton.bounding_box.unwrap();
    assert_eq!((bbox.top_left.x, bbox.width, bbox.depth), (1, 10, 30));
    assert_eq!(
        (skeleton.edit_position.x, skeleton.edit_position.z),
        (10, 30)
    );
    assert_eq!(skeleton.edit_rotation.y, 90.0);
    assert_eq!(skeleton.trees.len(), 1);
    assert_eq!(skeleton.trees[0].nodes[0].position.y, 20);
    assert_eq!(skeleton.trees[0].branch_points.len(), 1);
    // The empty bounding box is dropped.
    assert_eq!(
        saved.tracings[1].tracing.as_ref().unwrap().bounding_box,
        None
    );

    for (index, id) in ids.iter().enumerate() {
        let tracing_id = saved.tracing_id[index].string_value.clone().unwrap();
        assert!(saved.annotation_id[index].string_value.is_some());
        let (base_id, user, dataset, description, summary, layers) = base_of(&db, id).await;
        assert_eq!(user, w.manager.user_id);
        assert_eq!(dataset, w.dataset);
        assert_eq!(summary, "Internal|Active||OwnerOnly");
        assert_eq!(
            layers,
            [(
                tracing_id.clone(),
                "Skeleton".into(),
                "Skeleton".into(),
                json!({})
            )]
        );
        assert_eq!(
            description,
            if index == 0 { "" } else { "Second description" }
        );
        // The AnnotationProto is saved under the TracingBase id.
        let proto_call = &w.mock.with_path("/annotation/save")[index];
        assert_eq!(proto_call.param("annotationId"), Some(base_id.as_str()));
        let proto = AnnotationProto::decode(proto_call.body.as_slice()).unwrap();
        assert_eq!(proto.description, "");
        assert_eq!(proto.version, 0);
        assert_eq!(proto.annotation_layers.len(), 1);
        assert_eq!(proto.annotation_layers[0].tracing_id, tracing_id);
        assert_eq!(proto.annotation_layers[0].name, "Skeleton");
        assert_eq!(
            proto.annotation_layers[0].typ,
            AnnotationLayerTypeProto::Skeleton as i32
        );
    }
    assert_eq!(
        task_row(&db, &ids[0]).await,
        (
            w.skeleton_type.clone(),
            Some(w.script.clone()),
            "basic".into(),
            3,
            2,
            2,
            Some("1,2,3,10,20,30".into()),
            "10,20,30".into(),
            "0,90,0.5".into(),
            Some("first.nml".into()),
        )
    );
    assert_eq!(
        count(&db, &format!("SELECT count(*) FROM webknossos.experienceDomains WHERE domain='basic' AND _organization='{}'", w.f.organization_id)).await,
        1
    );
    assert_eq!(totals(&db).await, (2, 2, 2));

    // Admin creating in project B: team B has an uncovered member → warning.
    w.mock.clear();
    let (status, body) = post_json(
        &w.app,
        &w.f.token,
        json!([params(&w.skeleton_type, &w.dataset, "Project-B")]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["warnings"],
        json!(["Project team “Team B” has no read permission to dataset “Dataset”."])
    );
    assert_eq!(body["tasks"][0]["status"], 200);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn creates_hybrid_and_volume_tasks_with_fresh_bases() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let hybrid = with(
        params(&w.hybrid_type, &w.dataset, "Project-A"),
        "boundingBox",
        json!({"topLeft": [5, 6, 7], "width": 8, "height": 9, "depth": 10}),
    );
    let (status, body) = post_json(&w.app, &w.manager.token, json!([hybrid])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = &task_ids(&body)[0];
    assert_eq!(
        w.mock.paths(),
        [
            "/tracings/skeleton/saveMultiple",
            "/tracings/volume/save",
            "/tracings/annotation/save"
        ]
    );
    let volume_call = &w.mock.with_path("/volume/save")[0];
    let volume = VolumeTracing::decode(volume_call.body.as_slice()).unwrap();
    // Task box, start position/rotation, mags restricted by the task type (min 2).
    assert_eq!(
        (
            volume.bounding_box.top_left.x,
            volume.bounding_box.width,
            volume.bounding_box.depth
        ),
        (5, 8, 10)
    );
    assert_eq!(volume.edit_position.y, 20);
    assert_eq!(volume.edit_rotation.z, 0.5);
    let mags: Vec<i32> = volume.mags.iter().map(|m| m.x).collect();
    assert_eq!(mags, [2, 4]);
    assert_eq!(volume.fallback_layer, None);
    assert_eq!(volume.has_segment_index, Some(true));
    assert_eq!(volume.dataset_name, "dir");
    let (_, _, _, _, _, layers) = base_of(&db, id).await;
    let names: Vec<(&str, &str)> = layers
        .iter()
        .map(|l| (l.1.as_str(), l.2.as_str()))
        .collect();
    assert_eq!(names, [("Skeleton", "Skeleton"), ("Volume", "Volume")]);
    assert_eq!(
        volume_call.param("newTracingId"),
        Some(layers[1].0.as_str())
    );
    let saved =
        SkeletonTracingsWithIds::decode(w.mock.with_path("/saveMultiple")[0].body.as_slice())
            .unwrap();
    assert_eq!(
        saved.tracing_id[0].string_value.as_deref(),
        Some(layers[0].0.as_str())
    );

    // Volume-only task type: no skeleton in saveMultiple, volume uses the data source box.
    w.mock.clear();
    let (status, body) = post_json(
        &w.app,
        &w.manager.token,
        json!([params(&w.volume_type, &w.dataset, "Project-A")]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let saved =
        SkeletonTracingsWithIds::decode(w.mock.with_path("/saveMultiple")[0].body.as_slice())
            .unwrap();
    assert_eq!(saved.tracings[0].tracing, None);
    assert_eq!(saved.tracing_id[0].string_value, None);
    let volume =
        VolumeTracing::decode(w.mock.with_path("/volume/save")[0].body.as_slice()).unwrap();
    assert_eq!(
        (
            volume.bounding_box.width,
            volume.bounding_box.height,
            volume.bounding_box.depth
        ),
        (100, 200, 50)
    );
    assert_eq!(volume.mags.len(), 3);
    let (_, _, _, _, _, layers) = base_of(&db, &task_ids(&body)[0]).await;
    assert_eq!(layers.len(), 1);
    assert_eq!(layers[0].1, "Volume");

    // A failing volume save is a per-task item keeping the upstream status.
    w.mock.clear();
    w.mock.fail("/tracings/volume/save", 500);
    let before = totals(&db).await;
    let (status, body) = post_json(
        &w.app,
        &w.manager.token,
        json!([params(&w.volume_type, &w.dataset, "Project-A")]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["tasks"],
        json!([{"status": 500, "error": "Could not save volume tracing for new task."}])
    );
    assert_eq!(totals(&db).await, before);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn duplicates_base_annotations_and_tasks() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    // An explorational base owned by the member with only a skeleton layer.
    let base = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,visibility) VALUES($1,$2,$3,'Explorational','Internal')")
        .bind(&base).bind(&w.dataset).bind(&w.member.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'base-skeleton','Skeleton','Skeleton','{}')")
        .bind(&base).execute(&db.pool).await.unwrap();
    let request = with(
        with(
            params(&w.hybrid_type, &w.dataset, "Project-A"),
            "baseAnnotation",
            json!({"baseId": base}),
        ),
        "boundingBox",
        json!({"topLeft": [1, 2, 3], "width": 4, "height": 5, "depth": 6}),
    );
    let (status, body) = post_json(&w.app, &w.manager.token, json!([request])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["tasks"][0]["status"], 200);
    let task = &task_ids(&body)[0];
    let (base_id, _, _, _, _, layers) = base_of(&db, task).await;
    let (skeleton_id, volume_id) = (layers[0].0.clone(), layers[1].0.clone());
    assert_eq!(
        w.mock.paths(),
        [
            "/tracings/skeleton/base-skeleton/duplicate".to_owned(),
            "/tracings/volume/save".to_owned(),
            "/tracings/skeleton/saveMultiple".to_owned(),
            "/tracings/annotation/save".to_owned(),
        ]
    );
    let duplicate = &w.mock.with_path("/duplicate")[0];
    assert_eq!(duplicate.method, "POST");
    assert!(duplicate.body.is_empty());
    assert_eq!(
        duplicate.keys(),
        [
            "token",
            "newAnnotationId",
            "newTracingId",
            "ownerId",
            "requestingUserId",
            "editPosition",
            "editRotation",
            "boundingBox"
        ]
    );
    assert_eq!(duplicate.param("newTracingId"), Some(skeleton_id.as_str()));
    assert_eq!(duplicate.param("ownerId"), Some(w.member.user_id.as_str()));
    assert_eq!(
        duplicate.param("requestingUserId"),
        Some(w.manager.user_id.as_str())
    );
    assert_eq!(duplicate.param("editPosition"), Some("10,20,30"));
    assert_eq!(duplicate.param("editRotation"), Some("0.0,90.0,0.5"));
    assert_eq!(duplicate.param("boundingBox"), Some("1,2,3,4,5,6"));
    let new_annotation_id = duplicate.param("newAnnotationId").unwrap().to_owned();
    // The base has no volume: a fresh volume is saved under the new annotation id.
    let volume_save = &w.mock.with_path("/volume/save")[0];
    assert_eq!(volume_save.param("newTracingId"), Some(volume_id.as_str()));
    // Scala parity: the TracingBase gets its own fresh id, not newAnnotationId.
    assert_ne!(base_id, new_annotation_id);
    // Nothing left to save in saveMultiple.
    let saved =
        SkeletonTracingsWithIds::decode(w.mock.with_path("/saveMultiple")[0].body.as_slice())
            .unwrap();
    assert_eq!(saved.tracings[0].tracing, None);

    // A volume base layer is duplicated with the task type's mag restrictions.
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'base-volume','Volume','Volume','{}')")
        .bind(&base).execute(&db.pool).await.unwrap();
    w.mock.clear();
    let request = with(
        params(&w.hybrid_type, &w.dataset, "Project-A"),
        "baseAnnotation",
        json!({"baseId": base}),
    );
    let (status, body) = post_json(&w.app, &w.manager.token, json!([request])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let volume_duplicate = &w.mock.with_path("/tracings/volume/base-volume/duplicate")[0];
    assert_eq!(
        volume_duplicate.keys(),
        [
            "token",
            "newAnnotationId",
            "newTracingId",
            "ownerId",
            "requestingUserId",
            "editPosition",
            "editRotation",
            "minMag"
        ]
    );
    assert_eq!(volume_duplicate.param("minMag"), Some("2"));
    assert!(w.mock.with_path("/volume/save").is_empty());

    // A finished single-instance task as base resolves to its Task annotation.
    let base_task = object_id();
    let project_a: String =
        sqlx::query_scalar("SELECT _id FROM webknossos.projects WHERE name='Project-A'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation) VALUES($1,$2,$3,'test',0,1,1,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)")
        .bind(&base_task).bind(&project_a).bind(&w.skeleton_type).execute(&db.pool).await.unwrap();
    let finished = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,state) VALUES($1,$2,$3,$4,'Task','Finished')")
        .bind(&finished).bind(&w.dataset).bind(&base_task).bind(&w.outsider.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'task-skeleton','Skeleton','Skeleton','{}')")
        .bind(&finished).execute(&db.pool).await.unwrap();
    w.mock.clear();
    let request = with(
        params(&w.skeleton_type, &w.dataset, "Project-A"),
        "baseAnnotation",
        json!({"baseId": base_task}),
    );
    let (status, body) = post_json(&w.app, &w.manager.token, json!([request.clone()])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let duplicate = &w
        .mock
        .with_path("/tracings/skeleton/task-skeleton/duplicate")[0];
    assert_eq!(
        duplicate.param("ownerId"),
        Some(w.outsider.user_id.as_str())
    );
    assert!(duplicate.param("boundingBox").is_none());

    // Not exactly one finished instance: whole request fails before any RPC.
    sqlx::query("UPDATE webknossos.annotations SET state='Active' WHERE _id=$1")
        .bind(&finished)
        .execute(&db.pool)
        .await
        .unwrap();
    w.mock.clear();
    let before = totals(&db).await;
    let (status, body) = post_json(&w.app, &w.manager.token, json!([request])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error("The specified base task does not have exactly one (finished) instance.")
    );
    // Unknown base id (neither annotation nor task): Fox.empty.
    let (status, body) = post_json(
        &w.app,
        &w.manager.token,
        json!([with(
            params(&w.skeleton_type, &w.dataset, "Project-A"),
            "baseAnnotation",
            json!({"baseId": object_id()})
        )]),
    )
    .await;
    assert_eq!((status, body), (StatusCode::NOT_FOUND, error(NOT_FOUND)));
    let (status, body) = post_json(
        &w.app,
        &w.manager.token,
        json!([with(
            params(&w.skeleton_type, &w.dataset, "Project-A"),
            "baseAnnotation",
            json!({"baseId": "nope"})
        )]),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error("The supplied resource id “nope” is not a valid ObjectId.")
    );
    // Duplicate RPC failure keeps the upstream status, nothing inserted.
    let request = with(
        params(&w.hybrid_type, &w.dataset, "Project-A"),
        "baseAnnotation",
        json!({"baseId": base}),
    );
    w.mock.fail("/duplicate", 502);
    let (status, _) = post_json(&w.app, &w.manager.token, json!([request])).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(w.mock.with_path("/saveMultiple").is_empty());
    assert_eq!(totals(&db).await, before);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn rejects_invalid_requests_before_side_effects() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let ok = params(&w.skeleton_type, &w.dataset, "Project-A");
    let token = w.manager.token.as_str();

    let (status, _) = post(&w.app, None, &json!([ok]).to_string()).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body) = post(&w.app, Some(token), "{not json").await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error("Invalid JSON request body."))
    );
    let mut missing = ok.clone();
    missing.as_object_mut().unwrap().remove("editRotation");
    let (status, _) = post_json(&w.app, token, json!([missing])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let cases = [
        (json!([]), "Zero tasks were requested.".to_owned()),
        (
            json!([ok, params(&w.volume_type, &w.dataset, "Project-A")]),
            "Cannot create tasks with differing task types in one go.".to_owned(),
        ),
        (
            json!([
                ok,
                params(&w.skeleton_type, &w.foreign_dataset, "Project-A")
            ]),
            "Cannot create tasks on multiple datasets in one go.".to_owned(),
        ),
        (
            json!([params(&object_id(), &w.dataset, "Project-A")]),
            String::new(),
        ),
        (
            json!([params(&w.skeleton_type, &w.foreign_dataset, "Project-A")]),
            "Cannot create tasks for datasets of other organizations.".to_owned(),
        ),
    ];
    for (body, message) in cases {
        let (status, response) = post_json(&w.app, token, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{response}");
        if !message.is_empty() {
            assert_eq!(response, error(&message));
        } else {
            assert!(
                response["messages"][0]["error"]
                    .as_str()
                    .unwrap()
                    .starts_with("Task type “")
            );
        }
    }
    // Task type not readable by a user without team (400, Scala has no ~> 404).
    let (status, body) = post_json(&w.app, &w.outsider.token, json!([ok])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error(&format!(
            "Task type “{}” could not be found or accessed.",
            w.skeleton_type
        ))
    );
    // Foreign admin cannot read the task type either.
    let (status, _) = post_json(&w.app, &w.foreign.token, json!([ok])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Unknown dataset.
    let unknown = object_id();
    let (status, body) = post_json(
        &w.app,
        token,
        json!([params(&w.skeleton_type, &unknown, "Project-A")]),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error(&format!(
            "Dataset “{unknown}” could not be found or accessed."
        ))
    );
    // Unusable dataset.
    sqlx::query("UPDATE webknossos.datasets SET isUsable=false WHERE _id=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = post_json(&w.app, token, json!([ok])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error(&format!(
            "Dataset “{}” is not imported or incomplete.",
            w.dataset
        ))
    );
    sqlx::query("UPDATE webknossos.datasets SET isUsable=true WHERE _id=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    // Batch limits: 100 for volume, 1000 for skeleton.
    let volumes: Vec<Value> = (0..101)
        .map(|_| params(&w.volume_type, &w.dataset, "Project-A"))
        .collect();
    let (status, body) = post_json(&w.app, token, Value::Array(volumes)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error("Cannot create more than 100 tasks in one request.")
    );
    let skeletons: Vec<Value> = (0..1001).map(|_| ok.clone()).collect();
    let (status, body) = post_json(&w.app, token, Value::Array(skeletons)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error("Cannot create more than 1000 tasks in one request.")
    );
    // Mag restrictions too tight for a fresh volume base: whole request.
    sqlx::query("UPDATE webknossos.tasktypes SET settings_magRestrictions_min=8 WHERE _id=$1")
        .bind(&w.hybrid_type)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = post_json(
        &w.app,
        token,
        json!([params(&w.hybrid_type, &w.dataset, "Project-A")]),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error("Mag restrictions are too tight, resulting annotation has no magnifications.")
    );

    assert!(w.mock.calls().is_empty(), "{:?}", w.mock.paths());
    assert_eq!(totals(&db).await, (0, 0, 0));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reports_per_task_failures_as_items() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let ok_b = params(&w.skeleton_type, &w.dataset, "Project-B");
    // The member manages team B but is a plain member of team A.
    let not_manager = params(&w.skeleton_type, &w.dataset, "Project-A");
    let script = object_id();
    let bad_script = with(ok_b.clone(), "scriptId", json!(script));
    let negative = with(ok_b.clone(), "pendingInstances", json!(-1));
    let store_failure = ok_b.clone();
    *w.mock.skeleton_failure.lock().unwrap() = Some(4);
    let (status, body) = post_json(
        &w.app,
        &w.member.token,
        json!([ok_b, not_manager, bad_script, negative, store_failure]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 5);
    assert_eq!(tasks[0]["status"], 200);
    assert_eq!(tasks[0]["success"]["projectName"], "Project-B");
    assert_eq!(tasks[1], json!({"status": 400, "error": "Empty"}));
    assert_eq!(
        tasks[2],
        json!({"status": 400, "error": format!("Script “{script}” could not be found or accessed.")})
    );
    assert_eq!(
        tasks[3],
        json!({"status": 400, "error": "Invalid resource values."})
    );
    assert_eq!(
        tasks[4],
        json!({"status": 400, "error": "Could not save skeleton tracing for new task."})
    );
    // The member reads team A and manages team B: team B is not covered.
    assert_eq!(
        body["warnings"],
        json!(["Project team “Team B” has no read permission to dataset “Dataset”."])
    );
    assert_eq!(totals(&db).await, (1, 1, 1));
    // Annotation protos were only saved for tasks passing the checks (task 0
    // and the negative-pending task whose insert then failed).
    assert_eq!(w.mock.with_path("/annotation/save").len(), 2);

    // AnnotationProto save failure: item with the upstream status, no rows.
    w.mock.clear();
    w.mock.fail("/tracings/annotation/save", 503);
    let (status, body) = post_json(
        &w.app,
        &w.member.token,
        json!([params(&w.skeleton_type, &w.dataset, "Project-B")]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["tasks"],
        json!([{"status": 503, "error": "Service returned an unsuccessful status."}])
    );
    assert_eq!(totals(&db).await, (1, 1, 1));

    // Scala quirk kept: an unknown project fails its item AND the warnings
    // step, so the request fails although the other tasks were created.
    w.mock.clear();
    let (status, body) = post_json(
        &w.app,
        &w.member.token,
        json!([
            params(&w.skeleton_type, &w.dataset, "Project-B"),
            params(&w.skeleton_type, &w.dataset, "Unknown-project")
        ]),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error("Project with name “Unknown-project” could not be found or accessed.")
    );
    assert_eq!(totals(&db).await, (2, 2, 2));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn whole_request_rpc_failures() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let request = json!([params(&w.skeleton_type, &w.dataset, "Project-A")]);
    // saveMultiple failure keeps the upstream status, nothing inserted.
    w.mock.fail("/saveMultiple", 503);
    let (status, body) = post_json(&w.app, &w.manager.token, request.clone()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert_eq!(body, error("Service returned an unsuccessful status."));
    assert!(w.mock.with_path("/annotation/save").is_empty());
    assert_eq!(totals(&db).await, (0, 0, 0));
    // Without any tracing store the request fails with 400.
    w.mock.clear();
    sqlx::query("DELETE FROM webknossos.tracingStores")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = post_json(&w.app, &w.manager.token, request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error("Tracing store could not be found or accessed."));
    assert!(w.mock.calls().is_empty());
    assert_eq!(totals(&db).await, (0, 0, 0));
    db.cleanup().await;
}
