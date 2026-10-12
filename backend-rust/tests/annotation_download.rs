//! GET /annotations/:typ/:id/download and GET /annotations/:id/download
//! (AnnotationIOController.download / downloadWithoutType) against a real
//! database and a mock tracing store serving protobuf and zip bytes.
mod common;

use std::{
    io::{Cursor, Read},
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, Method, StatusCode, header},
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
    annotation_download::{
        DOWNLOAD_FAILED, DOWNLOAD_NOT_ALLOWED, NOT_ALLOWED, play_header_parameter,
    },
    annotation_provider::{ANNOTATION_NOT_FOUND, project_not_found},
    proto::{
        AnnotationProto, SkeletonTracing, VolumeTracing,
        datastore::{
            Node, SkeletonTracingOpt, SkeletonTracings, Tree, VolumeTracingOpt, VolumeTracings,
        },
    },
    router,
};

// ---------------------------------------------------------------------------
// Mock tracing store
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Call {
    method: Method,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
}

impl Call {
    fn query(&self, key: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
}

impl Mock {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn clear(&self) {
        self.calls.lock().unwrap().clear();
    }
    fn paths(&self) -> Vec<String> {
        self.calls().into_iter().map(|call| call.path).collect()
    }
    fn find(&self, path: &str) -> Call {
        self.calls()
            .into_iter()
            .find(|call| call.path == path)
            .unwrap_or_else(|| panic!("no call to {path}: {:?}", self.paths()))
    }
}

fn skeleton(tracing_id: &str) -> SkeletonTracing {
    SkeletonTracing {
        dataset_name: "Dataset".into(),
        trees: vec![Tree {
            tree_id: 1,
            nodes: vec![Node {
                id: 1,
                radius: 1.0,
                ..Default::default()
            }],
            name: format!("tree-{tracing_id}"),
            ..Default::default()
        }],
        created_timestamp: 1_700_000_000_000,
        zoom_level: 1.0,
        ..Default::default()
    }
}

/// Tracing ids containing `editable` have an editable mapping.
fn volume(tracing_id: &str) -> VolumeTracing {
    VolumeTracing {
        created_timestamp: 1_700_000_000_000,
        dataset_name: "Dataset".into(),
        element_class: 4,
        largest_segment_id: Some(5),
        zoom_level: 1.0,
        has_editable_mapping: tracing_id.contains("editable").then_some(true),
        ..Default::default()
    }
}

fn data_zip(tracing_id: &str) -> Vec<u8> {
    format!("PK-data-of-{tracing_id}").into_bytes()
}

fn edges_zip(tracing_id: &str) -> Vec<u8> {
    format!("PK-edges-of-{tracing_id}").into_bytes()
}

fn protobuf(bytes: Vec<u8>) -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/x-protobuf")],
        bytes,
    )
        .into_response()
}

fn requested_ids(body: &Value) -> Vec<Option<String>> {
    body.as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["tracingId"].as_str().map(str::to_owned))
        .collect()
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let query: Vec<(String, String)> =
        serde_urlencoded::from_str(request.uri().query().unwrap_or("")).unwrap();
    let bytes = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    mock.calls.lock().unwrap().push(Call {
        method,
        path: path.clone(),
        query,
        body: body.clone(),
    });
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    match segments.as_slice() {
        ["tracings", "skeleton", "getMultiple"] => protobuf(
            SkeletonTracings {
                tracings: requested_ids(&body)
                    .iter()
                    .map(|id| SkeletonTracingOpt {
                        tracing: id.as_deref().map(skeleton),
                    })
                    .collect(),
            }
            .encode_to_vec(),
        ),
        ["tracings", "volume", "getMultiple"] => protobuf(
            VolumeTracings {
                tracings: requested_ids(&body)
                    .iter()
                    .map(|id| VolumeTracingOpt {
                        tracing: id.as_deref().map(volume),
                    })
                    .collect(),
            }
            .encode_to_vec(),
        ),
        ["tracings", "skeleton", id] => protobuf(skeleton(id).encode_to_vec()),
        ["tracings", "volume", id] => protobuf(volume(id).encode_to_vec()),
        ["tracings", "volume", id, "allDataZip"] => (StatusCode::OK, data_zip(id)).into_response(),
        ["tracings", "mapping", id, "editedEdgesZip"] => {
            (StatusCode::OK, edges_zip(id)).into_response()
        }
        ["tracings", "mapping", _, "info"] => {
            axum::Json(json!({"baseMappingName": "base-mapping"})).into_response()
        }
        ["tracings", "annotation", _] => protobuf(
            AnnotationProto {
                description: String::new(),
                version: 4,
                annotation_layers: Vec::new(),
                earliest_accessible_version: 0,
                skeleton_may_have_pending_updates: None,
                editable_mappings_may_have_pending_updates: None,
                user_states: Vec::new(),
            }
            .encode_to_vec(),
        ),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
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
    manager: UserFixture,
    dataset: String,
    project: String,
    task: String,
    task_type: String,
}

async fn world(db: &TestDb, tracing_url: &str) -> World {
    let f = db.fixture().await;
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let manager = db.seed_user(&object_id(), &f.organization_id, false).await;
    for (user, is_manager) in [
        (&owner.user_id, false),
        (&member.user_id, false),
        (&manager.user_id, true),
    ] {
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,$3)",
        )
        .bind(user)
        .bind(&f.team_id)
        .bind(is_manager)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('dl','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('dl-ts',$1,'https://trace.example.test','k')")
        .bind(tracing_url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'dl',_id,_rootfolder,'Dataset','dir',now(),true,ROW(11.24,11,0.1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (task, project, task_type) = (object_id(), object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Proj€ö')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Type summary','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation,boundingbox) VALUES($1,$2,$3,'test',0,10,8,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3,ROW(1,2,3,10,20,30)::webknossos.BOUNDING_BOX)")
        .bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    World {
        f,
        owner,
        member,
        manager,
        dataset,
        project,
        task,
        task_type,
    }
}

struct Seed<'a> {
    owner: &'a str,
    typ: &'a str,
    visibility: &'a str,
    state: &'a str,
    name: &'a str,
    /// (tracing id suffix, typ, layer name)
    layers: &'a [(&'a str, &'a str, &'a str)],
}

/// Seeds a live annotation; tracing ids are `<suffix>-<annotation id>`.
async fn annotation(db: &TestDb, w: &World, seed: Seed<'_>) -> String {
    let id = object_id();
    let task = matches!(seed.typ, "Task" | "TracingBase").then_some(&w.task);
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,collaborationMode,name,description,tags,created,modified) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,$7::webknossos.ANNOTATION_STATE,'OwnerOnly',$8,'Desc',ARRAY[]::text[],now(),now())")
        .bind(&id).bind(&w.dataset).bind(task).bind(seed.owner).bind(seed.typ).bind(seed.visibility).bind(seed.state).bind(seed.name)
        .execute(&db.pool).await.unwrap();
    for (suffix, typ, name) in seed.layers {
        sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,$3::webknossos.ANNOTATION_LAYER_TYPE,$4,'{}')")
            .bind(&id).bind(format!("{suffix}-{id}")).bind(typ).bind(name).execute(&db.pool).await.unwrap();
    }
    id
}

fn app(db: &TestDb) -> Router {
    router(AppState {
        pool: db.pool.clone(),
    })
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Reply {
    fn header(&self, name: header::HeaderName) -> &str {
        self.headers
            .get(name)
            .map(|v| v.to_str().unwrap())
            .unwrap_or("")
    }
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
    fn text(&self) -> String {
        String::from_utf8(self.body.clone()).unwrap()
    }
    fn error(&self) -> String {
        self.json()["messages"][0]["error"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }
}

async fn get(app: &Router, token: Option<&str>, uri: &str) -> Reply {
    let mut request = Request::builder().method(Method::GET).uri(uri);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    Reply {
        status,
        headers,
        body,
    }
}

/// Entry names and contents in archive order.
fn unzip(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..archive.len())
        .map(|index| {
            let mut file = archive.by_index(index).unwrap();
            assert_eq!(file.compression(), zip::CompressionMethod::Deflated);
            let mut content = Vec::new();
            file.read_to_end(&mut content).unwrap();
            (file.name().unwrap().into_owned(), content)
        })
        .collect()
}

fn names(entries: &[(String, Vec<u8>)]) -> Vec<&str> {
    entries.iter().map(|(name, _)| name.as_str()).collect()
}

fn hash(id: &str) -> &str {
    &id[id.len() - 6..]
}

const SKELETON_ONLY: &[(&str, &str, &str)] = &[("skel", "Skeleton", "Skeleton")];

// ---------------------------------------------------------------------------
// Saved annotations
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn skeleton_only_explorational_is_a_plain_nml_with_scala_headers() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let named = annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Explorational",
            visibility: "Internal",
            state: "Active",
            name: "My Ännotation+1",
            layers: SKELETON_ONLY,
        },
    )
    .await;

    let reply = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{named}/download"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(reply.header(header::CONTENT_TYPE), "application/xml");
    // URLEncoder.encode(name + ".nml", UTF-8).replace("+", "%20")
    assert_eq!(
        reply.header(header::CONTENT_DISPOSITION),
        "attachment; filename=\"My%20%C3%84nnotation%2B1.nml\""
    );
    let nml = reply.text();
    assert!(nml.starts_with("<things>"), "{nml}");
    assert!(nml.ends_with("</things>"), "{nml}");
    assert!(nml.contains(&format!("tree-skel-{named}")), "{nml}");
    assert!(nml.contains("name=\"Dataset\""), "{nml}");
    assert!(
        nml.contains(&format!(
            "<meta name=\"annotationId\" content=\"{named}\"/>"
        )),
        "{nml}"
    );
    assert!(!nml.contains("<volume"), "{nml}");

    // Skeleton GET (annotationId, no version), then the annotation proto.
    let calls = mock.calls();
    assert_eq!(
        mock.paths(),
        vec![
            format!("/tracings/skeleton/skel-{named}"),
            format!("/tracings/annotation/{named}"),
        ]
    );
    assert_eq!(calls[0].query("annotationId"), Some(named.as_str()));
    assert_eq!(calls[0].query("version"), None);
    assert!(calls[0].query("token").is_some());
    assert_eq!(calls[1].query("version"), None);

    // version is forwarded to every tracing-store fetch.
    mock.clear();
    let reply = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{named}/download?version=5&version=9"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    let calls = mock.calls();
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|call| call.query("version") == Some("5")));

    // Unnamed: nameForAnnotation (dataset__explorational__abbrev__hash).
    let unnamed = annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Explorational",
            visibility: "Public",
            state: "Active",
            name: "",
            layers: SKELETON_ONLY,
        },
    )
    .await;
    let reply = get(
        &app,
        Some(&w.member.token),
        &format!("/api/annotations/Explorational/{unnamed}/download"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(
        reply.header(header::CONTENT_DISPOSITION),
        format!(
            "attachment; filename=\"Dataset__explorational__rtest__{}.nml\"",
            hash(&unnamed)
        )
    );
    // Anonymous requesters may download public annotations; the owner's
    // MultiUser is unreadable for them, so the user part is empty.
    let reply = get(
        &app,
        None,
        &format!("/api/annotations/Explorational/{unnamed}/download"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(
        reply.header(header::CONTENT_DISPOSITION),
        format!(
            "attachment; filename=\"Dataset__explorational____{}.nml\"",
            hash(&unnamed)
        )
    );

    // Bad query parameters are rejected by the binders.
    let reply = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{named}/download?version=x"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn hybrid_download_zips_nml_volume_data_and_edited_edges() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    // Layers are ordered by tracing id: a-vol < b-editable < skel.
    let id = annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Explorational",
            visibility: "Internal",
            state: "Active",
            name: "hybrid",
            layers: &[
                ("skel", "Skeleton", "Skeleton"),
                ("a-vol", "Volume", "Seg_A"),
                ("b-editable", "Volume", "Seg_B"),
            ],
        },
    )
    .await;

    let reply = get(
        &app,
        Some(&w.owner.token),
        &format!(
            "/api/annotations/Explorational/{id}/download?version=3&volumeDataZipFormat=zarr3"
        ),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(reply.header(header::CONTENT_TYPE), "application/zip");
    assert_eq!(
        reply.header(header::CONTENT_DISPOSITION),
        "attachment; filename=\"hybrid.zip\""
    );
    let entries = unzip(&reply.body);
    assert_eq!(
        names(&entries),
        vec![
            "hybrid.nml",
            "data_0_Seg_A.zip",
            "editedMappingEdges_1_Seg_B.zip"
        ]
    );
    // Nested zips are passed through byte-for-byte.
    assert_eq!(entries[1].1, data_zip(&format!("a-vol-{id}")));
    assert_eq!(entries[2].1, edges_zip(&format!("b-editable-{id}")));
    let nml = String::from_utf8(entries[0].1.clone()).unwrap();
    assert!(
        nml.contains("location=\"data_0_Seg_A.zip\""),
        "volume location missing: {nml}"
    );
    assert!(nml.contains("format=\"zarr3\""), "{nml}");
    assert!(
        nml.contains("editedMappingEdgesLocation=\"editedMappingEdges_1_Seg_B.zip\" editedMappingBaseMappingName=\"base-mapping\""),
        "{nml}"
    );
    assert!(nml.contains(&format!("tree-skel-{id}")), "{nml}");

    // Fetch order and parameters (volumes first, then skeleton, then proto).
    let a_vol = format!("a-vol-{id}");
    let b_vol = format!("b-editable-{id}");
    assert_eq!(
        mock.paths(),
        vec![
            format!("/tracings/volume/{a_vol}"),
            format!("/tracings/volume/{a_vol}/allDataZip"),
            format!("/tracings/volume/{b_vol}"),
            format!("/tracings/mapping/{b_vol}/editedEdgesZip"),
            format!("/tracings/mapping/{b_vol}/info"),
            format!("/tracings/skeleton/skel-{id}"),
            format!("/tracings/annotation/{id}"),
        ]
    );
    let data = mock.find(&format!("/tracings/volume/{a_vol}/allDataZip"));
    assert_eq!(data.query("volumeDataZipFormat"), Some("zarr3"));
    assert_eq!(data.query("annotationId"), Some(id.as_str()));
    assert_eq!(data.query("version"), Some("3"));
    assert_eq!(data.query("voxelSizeFactor"), Some("11.24,11.0,0.1"));
    assert_eq!(data.query("voxelSizeUnit"), Some("nanometer"));
    assert!(
        mock.calls()
            .iter()
            .all(|call| call.method == Method::GET && call.query("version") == Some("3"))
    );

    // A single volume layer has no index in its data zip name; an unknown
    // format falls back to wkw.
    let single = annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Explorational",
            visibility: "Internal",
            state: "Active",
            name: "single",
            layers: &[("vol", "Volume", "Volume")],
        },
    )
    .await;
    mock.clear();
    let reply = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{single}/download?volumeDataZipFormat=ZARR3"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    let entries = unzip(&reply.body);
    assert_eq!(names(&entries), vec!["single.nml", "data_Volume.zip"]);
    let data = mock.find(&format!("/tracings/volume/vol-{single}/allDataZip"));
    assert_eq!(data.query("volumeDataZipFormat"), Some("wkw"));
    assert_eq!(data.query("version"), None);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn skip_volume_data_keeps_only_the_nml_in_the_zip() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let id = annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Explorational",
            visibility: "Internal",
            state: "Active",
            name: "skipped",
            layers: &[
                ("skel", "Skeleton", "Skeleton"),
                ("a-vol", "Volume", "Seg_A"),
                ("b-editable", "Volume", "Seg_B"),
            ],
        },
    )
    .await;
    let reply = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{id}/download?skipVolumeData=true"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(reply.header(header::CONTENT_TYPE), "application/zip");
    let entries = unzip(&reply.body);
    assert_eq!(names(&entries), vec!["skipped.nml"]);
    let nml = String::from_utf8(entries[0].1.clone()).unwrap();
    assert!(
        nml.contains("<!--Note that volume data was omitted when downloading this annotation.-->"),
        "{nml}"
    );
    let paths = mock.paths();
    assert!(
        paths
            .iter()
            .all(|path| !path.ends_with("/allDataZip") && !path.starts_with("/tracings/mapping")),
        "{paths:?}"
    );
    assert_eq!(paths.len(), 4, "{paths:?}");
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn permissions_fail_closed_and_untyped_route_resolves_the_stored_type() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);

    // Private: not readable by another member or anonymously -> 404.
    let private = annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Explorational",
            visibility: "Private",
            state: "Active",
            name: "private",
            layers: SKELETON_ONLY,
        },
    )
    .await;
    for token in [Some(w.member.token.as_str()), None] {
        let reply = get(
            &app,
            token,
            &format!("/api/annotations/Explorational/{private}/download"),
        )
        .await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{}", reply.text());
        assert_eq!(reply.error(), DOWNLOAD_FAILED);
    }

    // Readable but allowDownload = false (private task annotation whose
    // task was deleted): Scala binds the Fox[Boolean] without asserting,
    // Rust fails closed with Msg.Annotation.Download.notAllowed / 403.
    let orphaned = annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Task",
            visibility: "Private",
            state: "Active",
            name: "orphaned",
            layers: SKELETON_ONLY,
        },
    )
    .await;
    sqlx::query("UPDATE webknossos.tasks SET isDeleted=true WHERE _id=$1")
        .bind(&w.task)
        .execute(&db.pool)
        .await
        .unwrap();
    let reply = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Task/{orphaned}/download"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN, "{}", reply.text());
    assert_eq!(reply.error(), DOWNLOAD_FAILED);
    let chain = reply.json()["messages"][1]["chain"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(chain.contains(DOWNLOAD_NOT_ALLOWED), "{chain}");
    assert!(mock.calls().is_empty(), "{:?}", mock.paths());
    sqlx::query("UPDATE webknossos.tasks SET isDeleted=false WHERE _id=$1")
        .bind(&w.task)
        .execute(&db.pool)
        .await
        .unwrap();

    // Untyped route: provideAnnotation(id) then download with the stored type.
    let task_annotation = annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Task",
            visibility: "Internal",
            state: "Active",
            name: "",
            layers: SKELETON_ONLY,
        },
    )
    .await;
    let typed = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Task/{task_annotation}/download"),
    )
    .await;
    let untyped = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/{task_annotation}/download?version=2"),
    )
    .await;
    assert_eq!(untyped.status, StatusCode::OK, "{}", untyped.text());
    let expected = format!(
        "attachment; filename=\"Dataset__{}__rtest__{}.nml\"",
        w.task,
        hash(&task_annotation)
    );
    assert_eq!(typed.header(header::CONTENT_DISPOSITION), expected);
    assert_eq!(untyped.header(header::CONTENT_DISPOSITION), expected);
    assert!(
        untyped
            .text()
            .contains(&format!("<meta name=\"taskId\" content=\"{}\"/>", w.task)),
        "{}",
        untyped.text()
    );
    assert_eq!(
        mock.find(&format!("/tracings/annotation/{task_annotation}"))
            .query("version"),
        None
    );
    assert!(mock.calls().iter().any(|call| call.path
        == format!("/tracings/skeleton/skel-{task_annotation}")
        && call.query("version") == Some("2")));

    // Untyped route with an unknown or unreadable id: Msg.Annotation.notFound.
    for (token, id) in [
        (Some(w.owner.token.as_str()), object_id()),
        (Some(w.member.token.as_str()), private.clone()),
    ] {
        let reply = get(&app, token, &format!("/api/annotations/{id}/download")).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{}", reply.text());
        assert_eq!(reply.error(), ANNOTATION_NOT_FOUND);
    }

    // View annotations cannot be downloaded.
    let reply = get(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/View/{task_annotation}/download"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.error(), "Cannot download View annotation");
    db.cleanup().await;
}

// ---------------------------------------------------------------------------
// Compound downloads
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_downloads_zip_finished_task_annotations_for_managers() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let skeleton_only = annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Task",
            visibility: "Internal",
            state: "Finished",
            name: "ignored name",
            layers: SKELETON_ONLY,
        },
    )
    .await;
    // created is now(); keep creation order deterministic.
    sqlx::query("UPDATE webknossos.annotations SET created=created-INTERVAL '1 hour' WHERE _id=$1")
        .bind(&skeleton_only)
        .execute(&db.pool)
        .await
        .unwrap();
    let hybrid = annotation(
        &db,
        &w,
        Seed {
            owner: &w.member.user_id,
            typ: "Task",
            visibility: "Internal",
            state: "Finished",
            name: "",
            layers: &[
                ("skel", "Skeleton", "my_skeleton"),
                ("vol", "Volume", "my_volume"),
            ],
        },
    )
    .await;
    // Active task annotations and explorationals are not included.
    annotation(
        &db,
        &w,
        Seed {
            owner: &w.owner.user_id,
            typ: "Task",
            visibility: "Internal",
            state: "Active",
            name: "",
            layers: SKELETON_ONLY,
        },
    )
    .await;
    let name1 = format!("Dataset__{}__rtest__{}", w.task, hash(&skeleton_only));
    let name2 = format!("Dataset__{}__rtest__{}", w.task, hash(&hybrid));

    // Team manager downloads the project.
    let reply = get(
        &app,
        Some(&w.manager.token),
        &format!(
            "/api/annotations/CompoundProject/{}/download?version=4&volumeDataZipFormat=zarr3",
            w.project
        ),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(reply.header(header::CONTENT_TYPE), "application/zip");
    // normalize("Proj€ö_nmls.zip") = "Proj€oe_nmls.zip", Play parameter encoding.
    assert_eq!(
        reply.header(header::CONTENT_DISPOSITION),
        "attachment; filename=\"Proj?oe_nmls.zip\"; filename*=utf-8''Proj%e2%82%acoe_nmls.zip"
    );
    let entries = unzip(&reply.body);
    assert_eq!(
        names(&entries),
        vec![format!("{name1}.nml"), format!("{name2}.zip")]
    );
    let nml1 = String::from_utf8(entries[0].1.clone()).unwrap();
    assert!(
        nml1.contains(&format!("tree-skel-{skeleton_only}")),
        "{nml1}"
    );
    let inner = unzip(&entries[1].1);
    assert_eq!(
        names(&inner),
        vec![format!("{name2}_data.zip"), format!("{name2}.nml")]
    );
    let vol = format!("vol-{hybrid}");
    assert_eq!(inner[0].1, data_zip(&vol));
    let nml2 = String::from_utf8(inner[1].1.clone()).unwrap();
    assert!(
        nml2.contains(&format!("location=\"{name2}_data.zip\"")),
        "{nml2}"
    );
    // Layers are renamed to the defaults; the format is always wkw.
    assert!(nml2.contains("name=\"Volume\""), "{nml2}");
    assert!(!nml2.contains("my_volume"), "{nml2}");
    assert!(nml2.contains("format=\"wkw\""), "{nml2}");

    // getMultiple batches and a version-less allDataZip.
    let skeletons = mock.find("/tracings/skeleton/getMultiple");
    assert_eq!(skeletons.method, Method::POST);
    assert_eq!(
        skeletons.body,
        json!([
            {"tracingId": format!("skel-{skeleton_only}")},
            {"tracingId": format!("skel-{hybrid}")}
        ])
    );
    let volumes = mock.find("/tracings/volume/getMultiple");
    assert_eq!(volumes.body, json!([null, {"tracingId": vol}]));
    let data = mock.find(&format!("/tracings/volume/{vol}/allDataZip"));
    assert_eq!(data.query("volumeDataZipFormat"), Some("wkw"));
    assert_eq!(data.query("annotationId"), None);
    assert_eq!(data.query("version"), None);
    assert_eq!(data.query("voxelSizeFactor"), Some("11.24,11.0,0.1"));

    // skipVolumeData: plain NMLs, no data RPC.
    mock.clear();
    let reply = get(
        &app,
        Some(&w.f.token),
        &format!(
            "/api/annotations/CompoundProject/{}/download?skipVolumeData=1",
            w.project
        ),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(
        names(&unzip(&reply.body)),
        vec![format!("{name1}.nml"), format!("{name2}.nml")]
    );
    assert!(
        mock.paths()
            .iter()
            .all(|path| !path.ends_with("/allDataZip")),
        "{:?}",
        mock.paths()
    );

    // Task and task type compounds (admin).
    let reply = get(
        &app,
        Some(&w.f.token),
        &format!("/api/annotations/CompoundTask/{}/download", w.task),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(
        reply.header(header::CONTENT_DISPOSITION),
        format!("attachment; filename=\"{}_nmls.zip\"", w.task)
    );
    assert_eq!(
        names(&unzip(&reply.body)),
        vec![format!("{name1}.nml"), format!("{name2}.zip")]
    );
    let reply = get(
        &app,
        Some(&w.manager.token),
        &format!("/api/annotations/CompoundTaskType/{}/download", w.task_type),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(
        reply.header(header::CONTENT_DISPOSITION),
        "attachment; filename=\"Type summary_nmls.zip\""
    );
    assert_eq!(unzip(&reply.body).len(), 2);

    // Non-managers and anonymous requesters: Msg.notAllowed, 403.
    mock.clear();
    for (token, typ, id) in [
        (Some(w.member.token.as_str()), "CompoundProject", &w.project),
        (Some(w.member.token.as_str()), "CompoundTask", &w.task),
        (
            Some(w.member.token.as_str()),
            "CompoundTaskType",
            &w.task_type,
        ),
        (None, "CompoundProject", &w.project),
    ] {
        let reply = get(
            &app,
            token,
            &format!("/api/annotations/{typ}/{id}/download"),
        )
        .await;
        assert_eq!(
            reply.status,
            StatusCode::FORBIDDEN,
            "{typ}: {}",
            reply.text()
        );
        assert_eq!(reply.error(), NOT_ALLOWED);
    }
    assert!(mock.calls().is_empty());

    // Unknown project: Msg.Project.notFound(id), 404.
    let missing = object_id();
    let reply = get(
        &app,
        Some(&w.f.token),
        &format!("/api/annotations/CompoundProject/{missing}/download"),
    )
    .await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert_eq!(reply.error(), project_not_found(&missing));
    db.cleanup().await;
}

#[test]
fn play_header_parameter_matches_play_3_0_11() {
    // Expected values produced by play.core.utils.HttpHeaderParameterEncoding
    // from play_3-3.0.11.jar.
    assert_eq!(
        play_header_parameter("filename", "plain_nmls.zip"),
        "filename=\"plain_nmls.zip\""
    );
    assert_eq!(
        play_header_parameter("filename", "Proj ä_nmls.zip"),
        "filename=\"Proj ?_nmls.zip\"; filename*=utf-8''Proj%20%c3%a4_nmls.zip"
    );
    assert_eq!(
        play_header_parameter("filename", "a\"b\\c;d/e ~é€.zip"),
        "filename=\"a?b?c;d/e ~??.zip\"; filename*=utf-8''a%22b%5cc%3bd%2fe%20~%c3%a9%e2%82%ac.zip"
    );
    assert_eq!(
        play_header_parameter("filename", "x*y'z(%)!.zip"),
        "filename=\"x*y'z(?)!.zip\"; filename*=utf-8''x%2ay%27z%28%25%29!.zip"
    );
}
