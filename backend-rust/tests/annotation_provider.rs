mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    body::to_bytes,
    extract::{Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use common::{TestDb, object_id};
use prost::Message;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use webknossos_backend::{
    annotation_access,
    annotation_provider::{
        ANNOTATION_NOT_FOUND, AccessContext, AnnotationDataSourceStore, AnnotationIdentifier,
        AnnotationLayer, AnnotationLayerType, AnnotationProvider, AnnotationType,
        CompoundAnnotation, FoxFailure, MERGE_FAILED_COMPOUND, MERGE_FAILED_IN_TRACINGSTORE,
        MULTIPLE_DATASETS, NO_ANNOTATIONS, PROJECT_NO_ANNOTATIONS, ProvidedAnnotation,
        ProviderError, RESOURCE_NOT_FOUND, TASK_NO_ANNOTATIONS, TASK_TYPE_NO_FINISHED_ANNOTATIONS,
        USER_NOT_AUTHENTICATED, dataset_not_usable, project_not_found, task_not_found,
        task_type_not_found,
    },
    auth::AuthUser,
    error::ApiError,
    id::ObjectId,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    service_clients::ServiceClientConfig,
    tracingstore_client::{TRACING_STORE_NOT_FOUND, TracingStoreClient},
};

const TOKEN: &str = "rpc-secret-for-provider-tests";

fn tracing_client() -> TracingStoreClient {
    TracingStoreClient::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(2),
        max_response_bytes: 64 * 1024,
        rpc_token: TOKEN.to_owned(),
    })
    .unwrap()
}

fn provider(pool: PgPool) -> AnnotationProvider {
    AnnotationProvider::new(pool, tracing_client())
}

const SAVED_TYPES: [&str; 5] = ["Task", "View", "Explorational", "TracingBase", "Orphan"];
const COMPOUND_TYPES: [&str; 3] = ["CompoundTask", "CompoundProject", "CompoundTaskType"];

/// A pool that can never connect: proves a code path performs no database access.
fn unreachable_pool() -> PgPool {
    PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(200))
        .connect_lazy("postgres://nobody@127.0.0.1:1/never")
        .unwrap()
}

fn user(id: &str, organization: &str, is_admin: bool) -> AuthUser {
    AuthUser {
        id: id.to_owned(),
        organization_id: organization.to_owned(),
        is_admin,
        is_dataset_manager: false,
        is_superuser: false,
    }
}

#[test]
fn annotation_types_parse_exactly_and_case_sensitively() {
    for typ in SAVED_TYPES.iter().chain(COMPOUND_TYPES.iter()) {
        let parsed: AnnotationType = typ.parse().unwrap();
        assert_eq!(parsed.as_str(), *typ);
        assert_eq!(parsed.to_string(), *typ);
        assert_eq!(parsed.is_compound(), COMPOUND_TYPES.contains(typ));
    }
    for invalid in [
        "task",
        "TASK",
        "explorational",
        "Compound",
        "compoundTask",
        " Task",
        "Task ",
        "",
        "Volume",
    ] {
        let error = invalid.parse::<AnnotationType>().unwrap_err();
        assert!(matches!(&error, ProviderError::InvalidType(t) if t == invalid));
        let api: ApiError = error.into();
        assert_eq!(api.status, StatusCode::BAD_REQUEST);
        assert_eq!(api.message, format!("Invalid AnnotationType: {invalid}"));
    }
    // Routes that map provider failures explicitly (`~> NOT_FOUND`) keep the message.
    let api = ProviderError::InvalidType("x".into()).into_api_error(StatusCode::NOT_FOUND);
    assert_eq!(
        (api.status, api.message.as_str()),
        (StatusCode::NOT_FOUND, "Invalid AnnotationType: x")
    );
    let api = ProviderError::NotFound.into_api_error(StatusCode::NOT_FOUND);
    assert_eq!(
        (api.status, api.message.as_str()),
        (StatusCode::NOT_FOUND, ANNOTATION_NOT_FOUND)
    );
}

#[test]
fn identifiers_build_the_annotation_store_cache_key() {
    let id = ObjectId::parse("ABCDEFABCDEFABCDEFABCDEF").unwrap();
    let identifier = AnnotationIdentifier::parse("CompoundTask", &id).unwrap();
    assert_eq!(identifier.annotation_type, AnnotationType::CompoundTask);
    assert_eq!(
        identifier.to_unique_string(),
        "CompoundTask__abcdefabcdefabcdefabcdef"
    );
    assert!(matches!(
        AnnotationIdentifier::parse("compoundtask", &id),
        Err(ProviderError::InvalidType(_))
    ));
}

#[test]
fn compound_annotations_are_built_from_the_merge_result() {
    let identifier = AnnotationIdentifier::parse("CompoundProject", &ObjectId::new()).unwrap();
    let dataset = ObjectId::new();
    let owner = ObjectId::new();
    let merged = AnnotationProto {
        description: String::new(),
        version: 0,
        annotation_layers: vec![
            AnnotationLayerProto {
                tracing_id: "s".into(),
                name: "Skeleton".into(),
                typ: AnnotationLayerTypeProto::Skeleton as i32,
            },
            AnnotationLayerProto {
                tracing_id: "v".into(),
                name: "Volume".into(),
                typ: AnnotationLayerTypeProto::Volume as i32,
            },
        ],
        earliest_accessible_version: 0,
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: None,
        user_states: Vec::new(),
    };
    let compound =
        CompoundAnnotation::from_merge(&identifier, dataset.clone(), owner.clone(), &merged);
    assert_eq!(compound.id, identifier.identifier);
    assert_eq!(compound.annotation_type, AnnotationType::CompoundProject);
    assert_eq!(
        compound.layers,
        vec![
            AnnotationLayer {
                tracing_id: "s".into(),
                typ: AnnotationLayerType::Skeleton,
                name: "Skeleton".into()
            },
            AnnotationLayer {
                tracing_id: "v".into(),
                typ: AnnotationLayerType::Volume,
                name: "Volume".into()
            },
        ]
    );
    let provided = ProvidedAnnotation::Compound(compound);
    assert_eq!(provided.owner_id(), owner.as_str());
    assert_eq!(provided.dataset_id(), dataset.as_str());
    assert_eq!(provided.visibility(), "Internal");
    assert_eq!(
        provided.annotation_type(),
        Some(AnnotationType::CompoundProject)
    );
    assert!(provided.saved().is_none());
}

#[tokio::test]
async fn invalid_types_fail_without_database_lookups_and_compound_types_reach_the_database() {
    let provider = provider(unreachable_pool());
    let requester = user(&object_id(), "org", false);
    let context = AccessContext::requester(Some(&requester));
    let id = ObjectId::new();
    let error = provider.provide(context, "view", &id).await.unwrap_err();
    assert!(matches!(error, ProviderError::InvalidType(_)), "{error}");
    for typ in COMPOUND_TYPES.iter().chain(SAVED_TYPES.iter()) {
        // Compound handlers read the parent under DAO access (no saved fallback).
        assert!(matches!(
            provider.provide(context, typ, &id).await,
            Err(ProviderError::Api(_))
        ));
        let identifier = AnnotationIdentifier::parse(typ, &id).unwrap();
        assert!(matches!(
            provider.restrictions_for(context, &identifier).await,
            Err(ProviderError::Api(_))
        ));
    }
}

#[test]
fn fox_chaining_and_status_rendering() {
    // Empty wrapped: plain failure without chain.
    let error = ProviderError::Empty.wrap(ANNOTATION_NOT_FOUND);
    assert!(
        matches!(&error, ProviderError::Failure(FoxFailure { message, chain, status: None })
        if message == ANNOTATION_NOT_FOUND && chain.is_empty())
    );
    // Unwrapped Empty renders like Play: 404 Msg.notFound.
    let api: ApiError = ProviderError::Empty.into();
    assert_eq!(
        (api.status, api.message.as_str()),
        (StatusCode::NOT_FOUND, RESOURCE_NOT_FOUND)
    );
    // A ParamFailure keeps its status through `?~>`; an explicit `~>` replaces it.
    let failure = ProviderError::Failure(FoxFailure {
        message: "inner".into(),
        chain: vec!["innermost".into()],
        status: Some(StatusCode::BAD_GATEWAY),
    })
    .wrap(MERGE_FAILED_COMPOUND)
    .wrap(ANNOTATION_NOT_FOUND);
    assert_eq!(
        failure.chain(),
        [MERGE_FAILED_COMPOUND, "inner", "innermost"]
    );
    assert_eq!(failure.to_string(), ANNOTATION_NOT_FOUND);
    let api = ProviderError::Failure(FoxFailure {
        message: "x".into(),
        chain: Vec::new(),
        status: Some(StatusCode::BAD_GATEWAY),
    })
    .into_api_error(StatusCode::NOT_FOUND);
    assert_eq!(api.status, StatusCode::NOT_FOUND);
    let api: ApiError = failure.into();
    assert_eq!(
        (api.status, api.message.as_str()),
        (StatusCode::BAD_GATEWAY, ANNOTATION_NOT_FOUND)
    );
    // Plain failures default to 400; infrastructure errors pass through.
    let api: ApiError = ProviderError::Empty.wrap("m").into();
    assert_eq!(
        (api.status, api.message.as_str()),
        (StatusCode::BAD_REQUEST, "m")
    );
    let api = ProviderError::Api(ApiError::internal()).wrap("m");
    assert!(matches!(api, ProviderError::Api(_)));
}

#[tokio::test]
async fn data_source_store_is_shared_between_clones_and_expires() {
    let store = AnnotationDataSourceStore::with_ttl(Duration::from_millis(150));
    let clone = store.clone();
    let (id, dataset) = (ObjectId::new(), ObjectId::new());
    store.store(id.clone(), json!({"id": {"name": "d"}}), dataset.clone());
    let found = clone.find(&id).unwrap();
    assert_eq!(found.dataset_id, dataset);
    assert_eq!(found.data_source["id"]["name"], "d");
    assert!(clone.find(&ObjectId::new()).is_none());
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(store.find(&id).is_none());
}

/// id, task, type, visibility, state, isDeleted
type AnnotationRow<'a> = (&'a str, Option<&'a str>, &'a str, &'a str, &'a str, bool);

struct Seed {
    organization: String,
    other_organization: String,
    owner: String,
    member: String,
    admin: String,
    foreign_admin: String,
    task_manager: String,
    explorational: String,
    task_annotation: String,
    public_annotation: String,
    internal_annotation: String,
    finished_annotation: String,
    deleted_annotation: String,
    task: String,
}

async fn seed(db: &TestDb) -> Seed {
    let f = db.fixture().await;
    let other_organization = format!("rust-test-other-{}", object_id());
    let owner = object_id();
    let member = object_id();
    let task_manager = object_id();
    let foreign_admin = object_id();
    db.seed_user(&owner, &f.organization_id, false).await;
    db.seed_user(&member, &f.organization_id, false).await;
    db.seed_user(&task_manager, &f.organization_id, false).await;
    db.seed_user(&foreign_admin, &other_organization, true)
        .await;
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,true)",
    )
    .bind(&task_manager)
    .bind(&f.team_id)
    .execute(&db.pool)
    .await
    .unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('provider','http://localhost:9000','https://data.example.test','k')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey) SELECT $1,'provider',_id,_rootfolder,'Dataset','directory',now() FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    let (project, task_type, task) = (object_id(), object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Provider-project')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Provider-type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation) VALUES($1,$2,$3,'test',0,1,1,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)")
        .bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    let ids: Vec<String> = (0..6).map(|_| object_id()).collect();
    let rows: [AnnotationRow; 6] = [
        (&ids[0], None, "Explorational", "Private", "Active", false),
        (&ids[1], Some(&task), "Task", "Private", "Active", false),
        (&ids[2], None, "Explorational", "Public", "Active", false),
        (&ids[3], None, "Explorational", "Internal", "Active", false),
        (&ids[4], None, "Explorational", "Private", "Finished", false),
        (&ids[5], None, "Explorational", "Public", "Active", true),
    ];
    for (id, task, typ, visibility, state, deleted) in rows {
        sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,isDeleted) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,$7::webknossos.ANNOTATION_STATE,$8)")
            .bind(id).bind(&dataset).bind(task).bind(&owner).bind(typ).bind(visibility).bind(state).bind(deleted)
            .execute(&db.pool).await.unwrap();
    }
    Seed {
        organization: f.organization_id,
        other_organization,
        owner,
        member,
        admin: f.user_id,
        foreign_admin,
        task_manager,
        explorational: ids[0].clone(),
        task_annotation: ids[1].clone(),
        public_annotation: ids[2].clone(),
        internal_annotation: ids[3].clone(),
        finished_annotation: ids[4].clone(),
        deleted_annotation: ids[5].clone(),
        task,
    }
}

fn oid(id: &str) -> ObjectId {
    ObjectId::parse(id).unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn saved_types_resolve_the_live_annotation_regardless_of_requested_type() {
    let db = TestDb::new().await;
    let s = seed(&db).await;
    let provider = provider(db.pool.clone());
    let owner = user(&s.owner, &s.organization, false);
    let context = AccessContext::requester(Some(&owner));
    for (annotation, actual) in [
        (&s.explorational, AnnotationType::Explorational),
        (&s.task_annotation, AnnotationType::Task),
    ] {
        for typ in SAVED_TYPES {
            let provided = provider
                .provide(context, typ, &oid(annotation))
                .await
                .unwrap();
            assert_eq!(provided.id(), annotation.as_str());
            assert_eq!(provided.owner_id(), s.owner);
            assert_eq!(provided.annotation_type(), Some(actual), "{typ}");
            assert!(matches!(provided, ProvidedAnnotation::Saved(_)));
        }
    }
    // Uppercase path IDs are normalized before lookup.
    let upper = ObjectId::parse(&s.explorational.to_ascii_uppercase()).unwrap();
    assert!(provider.provide(context, "View", &upper).await.is_ok());
    // A compound type never falls back to a saved lookup: the ID is a task
    // ID, and this owner cannot read the task (no role in its team).
    for id in [&s.explorational, &s.task] {
        let error = provider
            .provide(context, "CompoundTask", &oid(id))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), ANNOTATION_NOT_FOUND);
        assert_eq!(error.chain(), [task_not_found(id)]);
    }
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn saved_provider_applies_annotation_dao_read_access() {
    let db = TestDb::new().await;
    let s = seed(&db).await;
    let provider = provider(db.pool.clone());
    let owner = user(&s.owner, &s.organization, false);
    let member = user(&s.member, &s.organization, false);
    let admin = user(&s.admin, &s.organization, true);
    let foreign_admin = user(&s.foreign_admin, &s.other_organization, true);
    let task_manager = user(&s.task_manager, &s.organization, false);
    let cases: Vec<(&str, Option<&AuthUser>, &String, bool)> = vec![
        ("owner private", Some(&owner), &s.explorational, true),
        ("admin private", Some(&admin), &s.explorational, true),
        ("member private", Some(&member), &s.explorational, false),
        (
            "foreign admin private",
            Some(&foreign_admin),
            &s.explorational,
            false,
        ),
        // Team-manager status does not grant Private DAO read access.
        (
            "task manager private task",
            Some(&task_manager),
            &s.task_annotation,
            false,
        ),
        (
            "member internal",
            Some(&member),
            &s.internal_annotation,
            true,
        ),
        (
            "foreign internal",
            Some(&foreign_admin),
            &s.internal_annotation,
            false,
        ),
        ("anonymous internal", None, &s.internal_annotation, false),
        ("anonymous public", None, &s.public_annotation, true),
        (
            "foreign public",
            Some(&foreign_admin),
            &s.public_annotation,
            true,
        ),
        ("owner deleted", Some(&owner), &s.deleted_annotation, false),
    ];
    for (name, requester, annotation, allowed) in cases {
        let result = provider
            .provide(
                AccessContext::requester(requester),
                "Explorational",
                &oid(annotation),
            )
            .await;
        match (allowed, result) {
            (true, Ok(_)) => {}
            (false, Err(ProviderError::NotFound)) => {}
            (_, other) => panic!("{name}: unexpected {other:?}"),
        }
    }
    // GlobalAccessContext bypasses the read predicate but never soft deletion.
    let global = AccessContext::global(None);
    assert!(
        provider
            .provide(global, "Task", &oid(&s.explorational))
            .await
            .is_ok()
    );
    assert!(matches!(
        provider
            .provide(global, "Task", &oid(&s.deleted_annotation))
            .await,
        Err(ProviderError::NotFound)
    ));
    let missing = provider
        .provide(global, "Task", &ObjectId::new())
        .await
        .unwrap_err();
    let api: ApiError = missing.into();
    assert_eq!(
        (api.status, api.message.as_str()),
        (StatusCode::BAD_REQUEST, ANNOTATION_NOT_FOUND)
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn saved_restrictions_require_read_access_and_use_runtime_defaults() {
    let db = TestDb::new().await;
    let s = seed(&db).await;
    let provider = provider(db.pool.clone());
    let owner = user(&s.owner, &s.organization, false);
    let member = user(&s.member, &s.organization, false);
    let task_manager = user(&s.task_manager, &s.organization, false);
    let owner_context = AccessContext::requester(Some(&owner));

    for (annotation, update) in [(&s.explorational, true), (&s.finished_annotation, false)] {
        let identifier = AnnotationIdentifier::parse("View", &oid(annotation)).unwrap();
        let restrictions = provider
            .restrictions_for(owner_context, &identifier)
            .await
            .unwrap();
        let metadata = annotation_access::find(&db.pool, Some(&owner), annotation, false)
            .await
            .unwrap();
        assert_eq!(
            restrictions,
            annotation_access::restrictions(&metadata, Some(&owner))
        );
        assert!(restrictions.allow_access);
        assert_eq!(restrictions.allow_update, update);
        assert_eq!(restrictions.allow_finish, update);
    }

    // Internal annotation: a same-organization reader may access but not update (OwnerOnly).
    let identifier =
        AnnotationIdentifier::parse("Explorational", &oid(&s.internal_annotation)).unwrap();
    let restrictions = provider
        .restrictions_for(AccessContext::requester(Some(&member)), &identifier)
        .await
        .unwrap();
    assert!(restrictions.allow_access && restrictions.allow_download);
    assert!(!restrictions.allow_update && !restrictions.allow_finish);

    // The saved handler re-reads under DAO access: a task manager whose
    // runtime defaults would allow access still fails the private DAO read.
    let identifier = AnnotationIdentifier::parse("Task", &oid(&s.task_annotation)).unwrap();
    assert!(matches!(
        provider
            .restrictions_for(AccessContext::requester(Some(&task_manager)), &identifier)
            .await,
        Err(ProviderError::NotFound)
    ));
    let global = provider
        .restrictions_for(AccessContext::global(Some(&task_manager)), &identifier)
        .await
        .unwrap();
    assert!(global.allow_access && global.allow_finish && !global.allow_update);
    db.cleanup().await;
}

// ---------------------------------------------------------------------------
// Compound handlers against a real database and a mock tracing store.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Observed {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
}

type MockResponse = (StatusCode, Vec<u8>);

#[derive(Clone, Default)]
struct Mock {
    requests: Arc<Mutex<Vec<Observed>>>,
    response: Arc<Mutex<Option<MockResponse>>>,
}

impl Mock {
    fn requests(&self) -> Vec<Observed> {
        self.requests.lock().unwrap().clone()
    }
    fn respond(&self, status: StatusCode, body: Vec<u8>) {
        *self.response.lock().unwrap() = Some((status, body));
    }
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_owned();
    let query = url::form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes())
        .into_owned()
        .collect();
    let bytes = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    mock.requests.lock().unwrap().push(Observed {
        method,
        path,
        query,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    });
    let (status, body) = mock
        .response
        .lock()
        .unwrap()
        .clone()
        .unwrap_or((StatusCode::OK, merged_proto().encode_to_vec()));
    (
        status,
        [(header::CONTENT_TYPE, "application/x-protobuf")],
        body,
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

fn merged_proto() -> AnnotationProto {
    AnnotationProto {
        description: String::new(),
        version: 0,
        annotation_layers: vec![
            AnnotationLayerProto {
                tracing_id: "merged-skeleton".into(),
                name: "Skeleton".into(),
                typ: AnnotationLayerTypeProto::Skeleton as i32,
            },
            AnnotationLayerProto {
                tracing_id: "merged-volume".into(),
                name: "Volume".into(),
                typ: AnnotationLayerTypeProto::Volume as i32,
            },
        ],
        earliest_accessible_version: 0,
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: None,
        user_states: Vec::new(),
    }
}

fn query<'a>(observed: &'a Observed, key: &str) -> Vec<&'a str> {
    observed
        .query
        .iter()
        .filter(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
        .collect()
}

struct World {
    organization: String,
    other_organization: String,
    admin: String,
    manager: String,
    member: String,
    outsider: String,
    foreign_admin: String,
    annotator: String,
    annotator2: String,
    dataset: String,
    unusable_dataset: String,
    hidden_dataset: String,
    project: String,
    task_type: String,
    task_a: String,
    task_b: String,
    task_empty: String,
    edge_project: String,
    task_multi: String,
    task_unusable: String,
    task_hidden: String,
    a_finished: String,
    a_finished_private: String,
    a_active: String,
    b_finished: String,
    e_active: String,
}

async fn insert_dataset(db: &TestDb, organization: &str, name: &str, usable: bool) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'compound',_id,_rootfolder,$3,$3,now(),$4,CASE WHEN $4 THEN ROW(1,1,1)::webknossos.VECTOR3 END,CASE WHEN $4 THEN 'nanometer'::webknossos.LENGTH_UNIT END FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(organization).bind(name).bind(usable).execute(&db.pool).await.unwrap();
    id
}

async fn insert_task(db: &TestDb, project: &str, task_type: &str, bbox: bool) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation,boundingbox) VALUES($1,$2,$3,'test',0,10,10,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3,CASE WHEN $4 THEN ROW(1,2,3,10,20,30)::webknossos.BOUNDING_BOX END)")
        .bind(&id).bind(project).bind(task_type).bind(bbox).execute(&db.pool).await.unwrap();
    id
}

/// Insert a Task annotation; `minute` orders `created`.
async fn insert_annotation(
    db: &TestDb,
    task: &str,
    dataset: &str,
    owner: &str,
    visibility: &str,
    state: &str,
    minute: i32,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,created) VALUES($1,$2,$3,$4,'Task',$5::webknossos.ANNOTATION_VISIBILITY,$6::webknossos.ANNOTATION_STATE,TIMESTAMPTZ '2020-01-01' + make_interval(mins => $7))")
        .bind(&id).bind(dataset).bind(task).bind(owner).bind(visibility).bind(state).bind(minute)
        .execute(&db.pool).await.unwrap();
    id
}

async fn world(db: &TestDb, tracing_store_url: &str) -> World {
    let f = db.fixture().await;
    let other_organization = format!("rust-test-other-{}", object_id());
    let [
        manager,
        member,
        outsider,
        foreign_admin,
        annotator,
        annotator2,
    ] = std::array::from_fn(|_| object_id());
    for id in [&manager, &member, &outsider, &annotator, &annotator2] {
        db.seed_user(id, &f.organization_id, false).await;
    }
    db.seed_user(&foreign_admin, &other_organization, true)
        .await;
    for (user, manages) in [(&manager, true), (&member, false)] {
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,$3)",
        )
        .bind(user)
        .bind(&f.team_id)
        .bind(manages)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('compound','http://localhost:9000','https://data.example.test','k')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('compound-ts',$1,'https://tracing.example.test','k')")
        .bind(tracing_store_url).execute(&db.pool).await.unwrap();
    let dataset = insert_dataset(db, &f.organization_id, "main", true).await;
    let other_dataset = insert_dataset(db, &f.organization_id, "other", true).await;
    let unusable_dataset = insert_dataset(db, &f.organization_id, "unusable", false).await;
    let hidden_dataset = insert_dataset(db, &f.organization_id, "hidden", true).await;
    for shared in [&dataset, &other_dataset, &unusable_dataset] {
        sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
            .bind(shared)
            .bind(&f.team_id)
            .execute(&db.pool)
            .await
            .unwrap();
    }
    let (project, edge_project, task_type, edge_task_type) =
        (object_id(), object_id(), object_id(), object_id());
    for (id, name) in [
        (&project, "Compound-main"),
        (&edge_project, "Compound-edge"),
    ] {
        sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,$5)")
            .bind(id).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).bind(name).execute(&db.pool).await.unwrap();
    }
    for (id, summary) in [
        (&task_type, "Compound-main"),
        (&edge_task_type, "Compound-edge"),
    ] {
        sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,$4,'',true,true)")
            .bind(id).bind(&f.organization_id).bind(&f.team_id).bind(summary).execute(&db.pool).await.unwrap();
    }
    let task_a = insert_task(db, &project, &task_type, true).await;
    let task_b = insert_task(db, &project, &task_type, false).await;
    let task_empty = insert_task(db, &project, &task_type, true).await;
    let task_multi = insert_task(db, &edge_project, &edge_task_type, false).await;
    let task_unusable = insert_task(db, &edge_project, &edge_task_type, false).await;
    let task_hidden = insert_task(db, &edge_project, &edge_task_type, false).await;
    let a_finished =
        insert_annotation(db, &task_a, &dataset, &annotator, "Internal", "Finished", 1).await;
    let a_finished_private =
        insert_annotation(db, &task_a, &dataset, &annotator2, "Private", "Finished", 2).await;
    let a_active =
        insert_annotation(db, &task_a, &dataset, &annotator, "Internal", "Active", 3).await;
    // Cancelled and deleted instances are never merged nor boxed.
    insert_annotation(
        db,
        &task_a,
        &dataset,
        &annotator,
        "Internal",
        "Cancelled",
        4,
    )
    .await;
    let deleted =
        insert_annotation(db, &task_a, &dataset, &annotator, "Internal", "Finished", 5).await;
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=true WHERE _id=$1")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    let b_finished = insert_annotation(
        db,
        &task_b,
        &dataset,
        &annotator2,
        "Internal",
        "Finished",
        6,
    )
    .await;
    let e_active = insert_annotation(
        db,
        &task_empty,
        &dataset,
        &annotator,
        "Internal",
        "Active",
        7,
    )
    .await;
    insert_annotation(
        db,
        &task_multi,
        &dataset,
        &annotator,
        "Internal",
        "Finished",
        8,
    )
    .await;
    insert_annotation(
        db,
        &task_multi,
        &other_dataset,
        &annotator,
        "Internal",
        "Finished",
        9,
    )
    .await;
    insert_annotation(
        db,
        &task_unusable,
        &unusable_dataset,
        &annotator,
        "Internal",
        "Finished",
        10,
    )
    .await;
    insert_annotation(
        db,
        &task_hidden,
        &hidden_dataset,
        &annotator,
        "Internal",
        "Finished",
        11,
    )
    .await;
    World {
        organization: f.organization_id,
        other_organization,
        admin: f.user_id,
        manager,
        member,
        outsider,
        foreign_admin,
        annotator,
        annotator2,
        dataset,
        unusable_dataset,
        hidden_dataset,
        project,
        task_type,
        task_a,
        task_b,
        task_empty,
        edge_project,
        task_multi,
        task_unusable,
        task_hidden,
        a_finished,
        a_finished_private,
        a_active,
        b_finished,
        e_active,
    }
}

fn task_box(annotation: &str, task: &str) -> Value {
    json!({
        "id": 0,
        "name": format!("Task bounding box of instance {annotation} of task {task}"),
        "boundingBox": {"topLeft": [1, 2, 3], "width": 10, "height": 20, "depth": 30},
    })
}

/// Boxes are ordered by task ID, then annotation ID.
fn sorted_boxes(mut boxes: Vec<(&String, &String)>) -> Value {
    boxes.sort_by(|a, b| (a.1, a.0).cmp(&(b.1, b.0)));
    Value::Array(boxes.into_iter().map(|(a, t)| task_box(a, t)).collect())
}

fn assert_merge_request(
    observed: &Observed,
    parent: &str,
    requester: &str,
    annotations: &[&String],
    owners: &[&String],
    boxes: Value,
) {
    assert_eq!(observed.method, "POST");
    assert_eq!(observed.path, "/tracings/annotation/mergedFromIds");
    assert_eq!(query(observed, "token"), [TOKEN]);
    assert_eq!(query(observed, "toTemporaryStore"), ["true"]);
    assert_eq!(query(observed, "newAnnotationId"), [parent]);
    assert_eq!(query(observed, "requestingUserId"), [requester]);
    assert_eq!(query(observed, "remapSegmentIds"), ["true"]);
    assert_eq!(
        observed.body,
        json!({"annotationIds": annotations, "ownerIds": owners, "additionalBoundingBoxes": boxes})
    );
}

fn assert_failure(error: &ProviderError, chain: &[&str], status: StatusCode) {
    assert_eq!(error.to_string(), ANNOTATION_NOT_FOUND, "{error:?}");
    assert_eq!(error.chain(), chain, "{error:?}");
    let api: ApiError = match error {
        ProviderError::Failure(failure) => ProviderError::Failure(failure.clone()).into(),
        other => panic!("unexpected {other:?}"),
    };
    assert_eq!(api.status, status);
    assert_eq!(api.message, ANNOTATION_NOT_FOUND);
}

fn expected_layers() -> Vec<AnnotationLayer> {
    vec![
        AnnotationLayer {
            tracing_id: "merged-skeleton".into(),
            typ: AnnotationLayerType::Skeleton,
            name: "Skeleton".into(),
        },
        AnnotationLayer {
            tracing_id: "merged-volume".into(),
            typ: AnnotationLayerType::Volume,
            name: "Volume".into(),
        },
    ]
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_task_merges_readable_finished_annotations_and_caches_the_result() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let provider = provider(db.pool.clone());
    let manager = user(&w.manager, &w.organization, false);
    let admin = user(&w.admin, &w.organization, true);

    let provided = provider
        .provide(
            AccessContext::requester(Some(&manager)),
            "CompoundTask",
            &oid(&w.task_a),
        )
        .await
        .unwrap();
    let compound = provided.compound().unwrap().clone();
    assert_eq!(compound.id.as_str(), w.task_a);
    assert_eq!(compound.dataset_id.as_str(), w.dataset);
    assert_eq!(compound.owner_id.as_str(), w.manager);
    assert_eq!(compound.annotation_type, AnnotationType::CompoundTask);
    assert_eq!(compound.layers, expected_layers());
    assert_eq!(
        provided.annotation_type(),
        Some(AnnotationType::CompoundTask)
    );
    assert_eq!(provided.visibility(), "Internal");
    assert!(provided.saved().is_none());

    // The private finished instance is not readable by a non-admin manager;
    // boxes cover every readable non-cancelled instance (also active ones).
    let requests = mock.requests();
    assert_eq!(requests.len(), 1);
    assert_merge_request(
        &requests[0],
        &w.task_a,
        &w.manager,
        &[&w.a_finished],
        &[&w.annotator],
        sorted_boxes(vec![(&w.a_finished, &w.task_a), (&w.a_active, &w.task_a)]),
    );

    // The usable data source is registered under the task ID.
    let source = provider.data_sources().find(&oid(&w.task_a)).unwrap();
    assert_eq!(source.dataset_id.as_str(), w.dataset);
    assert_eq!(
        source.data_source["id"],
        json!({"name": "main", "team": w.organization})
    );
    assert_eq!(source.data_source["dataLayers"], json!([]));
    assert!(source.data_source["scale"].is_object());

    // Cache hit: no handler run, no merge, owner unchanged — even for a
    // requester (admin) who would see a different instance set.
    let cached = provider
        .provide(
            AccessContext::requester(Some(&admin)),
            "CompoundTask",
            &oid(&w.task_a),
        )
        .await
        .unwrap();
    assert_eq!(cached.compound(), Some(&compound));
    assert_eq!(cached.owner_id(), w.manager);
    assert_eq!(mock.requests().len(), 1);
    // A clone shares the cache (Extension clones per request).
    let clone = provider.clone();
    assert_eq!(clone.find_in_cache(&oid(&w.task_a)), Some(compound.clone()));
    assert_eq!(
        clone.find_cached_by_tracing_id("merged-volume"),
        Some(compound.clone())
    );
    assert!(clone.find_cached_by_tracing_id("unknown").is_none());

    // The key includes the type: CompoundProject with a task ID is a miss
    // (and fails: no such project).
    let error = provider
        .provide(
            AccessContext::requester(Some(&admin)),
            "CompoundProject",
            &oid(&w.task_a),
        )
        .await
        .unwrap_err();
    assert_failure(
        &error,
        &[project_not_found(&w.task_a).as_str()],
        StatusCode::BAD_REQUEST,
    );

    // removeFromCache forces a fresh merge with the new requester as owner;
    // an admin reads the private instance too.
    provider
        .remove_from_cache(&AnnotationIdentifier::parse("CompoundTask", &oid(&w.task_a)).unwrap());
    let fresh = provider
        .provide(
            AccessContext::requester(Some(&admin)),
            "CompoundTask",
            &oid(&w.task_a),
        )
        .await
        .unwrap();
    assert_eq!(fresh.owner_id(), w.admin);
    let requests = mock.requests();
    assert_eq!(requests.len(), 2);
    assert_merge_request(
        &requests[1],
        &w.task_a,
        &w.admin,
        &[&w.a_finished, &w.a_finished_private],
        &[&w.annotator, &w.annotator2],
        sorted_boxes(vec![
            (&w.a_finished, &w.task_a),
            (&w.a_finished_private, &w.task_a),
            (&w.a_active, &w.task_a),
        ]),
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_task_failures_carry_exact_scala_messages_and_are_not_cached() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let provider = provider(db.pool.clone());
    let manager = user(&w.manager, &w.organization, false);
    let outsider = user(&w.outsider, &w.organization, false);
    let foreign_admin = user(&w.foreign_admin, &w.other_organization, true);
    let as_manager = AccessContext::requester(Some(&manager));
    let provide = |context, id: &String| {
        let provider = provider.clone();
        let id = oid(id);
        async move {
            provider
                .provide(context, "CompoundTask", &id)
                .await
                .unwrap_err()
        }
    };

    // Task read access: no team role, foreign organization, unknown id.
    let missing = ObjectId::new().to_string();
    for (context, id) in [
        (AccessContext::requester(Some(&outsider)), &w.task_a),
        (AccessContext::requester(Some(&foreign_admin)), &w.task_a),
        (AccessContext::requester(None), &w.task_a),
        (as_manager, &missing),
    ] {
        let error = provide(context, id).await;
        assert_failure(
            &error,
            &[task_not_found(id).as_str()],
            StatusCode::BAD_REQUEST,
        );
    }
    // Only active instances.
    let error = provide(as_manager, &w.task_empty).await;
    assert_failure(
        &error,
        &[TASK_NO_ANNOTATIONS, NO_ANNOTATIONS],
        StatusCode::BAD_REQUEST,
    );
    // Finished instances on two datasets.
    let error = provide(as_manager, &w.task_multi).await;
    assert_failure(&error, &[MULTIPLE_DATASETS], StatusCode::BAD_REQUEST);
    // Requester required (after the annotation checks), even with global access.
    let error = provide(AccessContext::global(None), &w.task_a).await;
    assert_failure(&error, &[USER_NOT_AUTHENTICATED], StatusCode::BAD_REQUEST);
    // Dataset must be usable.
    let error = provide(as_manager, &w.task_unusable).await;
    assert_failure(
        &error,
        &[dataset_not_usable(&w.unusable_dataset).as_str()],
        StatusCode::BAD_REQUEST,
    );
    assert!(
        provider
            .data_sources()
            .find(&oid(&w.task_unusable))
            .is_none()
    );
    // Merger reads the dataset under the requester's access: the source is
    // registered first, then the merge fails without an RPC.
    let error = provide(as_manager, &w.task_hidden).await;
    assert_failure(
        &error,
        &[MERGE_FAILED_COMPOUND, MERGE_FAILED_IN_TRACINGSTORE],
        StatusCode::BAD_REQUEST,
    );
    assert_eq!(
        provider
            .data_sources()
            .find(&oid(&w.task_hidden))
            .unwrap()
            .dataset_id
            .as_str(),
        w.hidden_dataset
    );
    assert!(mock.requests().is_empty());

    // Upstream status is kept (ParamFailure); route `~> NOT_FOUND` replaces it.
    mock.respond(
        StatusCode::INTERNAL_SERVER_ERROR,
        b"secret upstream body".to_vec(),
    );
    let error = provide(as_manager, &w.task_a).await;
    assert_failure(
        &error,
        &[
            MERGE_FAILED_COMPOUND,
            MERGE_FAILED_IN_TRACINGSTORE,
            "Service returned an unsuccessful status.",
        ],
        StatusCode::INTERNAL_SERVER_ERROR,
    );
    assert!(!format!("{error:?}").contains("secret"));
    assert_eq!(
        error.into_api_error(StatusCode::NOT_FOUND).status,
        StatusCode::NOT_FOUND
    );
    // Invalid protobuf is a plain failure (400).
    mock.respond(StatusCode::OK, b"\xff\xff not protobuf".to_vec());
    let error = provide(as_manager, &w.task_a).await;
    assert_failure(
        &error,
        &[
            MERGE_FAILED_COMPOUND,
            MERGE_FAILED_IN_TRACINGSTORE,
            "Tracing store returned invalid Protocol Buffer data.",
        ],
        StatusCode::BAD_REQUEST,
    );
    assert_eq!(mock.requests().len(), 2);
    assert!(provider.find_in_cache(&oid(&w.task_a)).is_none());

    // No live tracing store.
    sqlx::query("UPDATE webknossos.tracingStores SET isDeleted=true")
        .execute(&db.pool)
        .await
        .unwrap();
    let error = provide(as_manager, &w.task_a).await;
    assert_failure(
        &error,
        &[
            MERGE_FAILED_COMPOUND,
            MERGE_FAILED_IN_TRACINGSTORE,
            TRACING_STORE_NOT_FOUND,
        ],
        StatusCode::BAD_REQUEST,
    );
    sqlx::query("UPDATE webknossos.tracingStores SET isDeleted=false")
        .execute(&db.pool)
        .await
        .unwrap();

    // Failures were not cached: a later success merges again.
    mock.respond(StatusCode::OK, merged_proto().encode_to_vec());
    assert!(
        provider
            .provide(as_manager, "CompoundTask", &oid(&w.task_a))
            .await
            .is_ok()
    );
    assert_eq!(mock.requests().len(), 3);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_project_requires_team_management_and_merges_all_finished_annotations() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let provider = provider(db.pool.clone());
    let manager = user(&w.manager, &w.organization, false);
    let member = user(&w.member, &w.organization, false);
    let outsider = user(&w.outsider, &w.organization, false);

    // Project readable via team role, but not a team manager: assertTrue → Empty.
    let error = provider
        .provide(
            AccessContext::requester(Some(&member)),
            "CompoundProject",
            &oid(&w.project),
        )
        .await
        .unwrap_err();
    assert_failure(&error, &[], StatusCode::BAD_REQUEST);
    for context in [
        AccessContext::requester(Some(&outsider)),
        AccessContext::requester(None),
    ] {
        let error = provider
            .provide(context, "CompoundProject", &oid(&w.project))
            .await
            .unwrap_err();
        assert_failure(
            &error,
            &[project_not_found(&w.project).as_str()],
            StatusCode::BAD_REQUEST,
        );
    }
    let error = provider
        .provide(
            AccessContext::global(None),
            "CompoundProject",
            &oid(&w.project),
        )
        .await
        .unwrap_err();
    assert_failure(&error, &[USER_NOT_AUTHENTICATED], StatusCode::BAD_REQUEST);
    let error = provider
        .provide(
            AccessContext::requester(Some(&manager)),
            "CompoundProject",
            &oid(&w.edge_project),
        )
        .await
        .unwrap_err();
    assert_failure(&error, &[MULTIPLE_DATASETS], StatusCode::BAD_REQUEST);
    assert!(mock.requests().is_empty());

    // All live finished Task annotations of the project, without the
    // annotation read predicate (the private instance is included).
    let provided = provider
        .provide(
            AccessContext::requester(Some(&manager)),
            "CompoundProject",
            &oid(&w.project),
        )
        .await
        .unwrap();
    assert_eq!(
        provided.annotation_type(),
        Some(AnnotationType::CompoundProject)
    );
    assert_eq!(provided.owner_id(), w.manager);
    let requests = mock.requests();
    assert_eq!(requests.len(), 1);
    assert_merge_request(
        &requests[0],
        &w.project,
        &w.manager,
        &[&w.a_finished, &w.a_finished_private, &w.b_finished],
        &[&w.annotator, &w.annotator2, &w.annotator2],
        sorted_boxes(vec![
            (&w.a_finished, &w.task_a),
            (&w.a_finished_private, &w.task_a),
        ]),
    );
    assert_eq!(
        provider
            .data_sources()
            .find(&oid(&w.project))
            .unwrap()
            .dataset_id
            .as_str(),
        w.dataset
    );

    // A project without finished annotations.
    sqlx::query("UPDATE webknossos.annotations SET state='Active' WHERE _task IN ($1,$2)")
        .bind(&w.task_a)
        .bind(&w.task_b)
        .execute(&db.pool)
        .await
        .unwrap();
    provider.remove_from_cache(
        &AnnotationIdentifier::parse("CompoundProject", &oid(&w.project)).unwrap(),
    );
    let error = provider
        .provide(
            AccessContext::requester(Some(&manager)),
            "CompoundProject",
            &oid(&w.project),
        )
        .await
        .unwrap_err();
    assert_failure(
        &error,
        &[PROJECT_NO_ANNOTATIONS, NO_ANNOTATIONS],
        StatusCode::BAD_REQUEST,
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_task_type_merges_tasks_listed_under_the_manager_grant() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let provider = provider(db.pool.clone());
    let manager = user(&w.manager, &w.organization, false);
    let member = user(&w.member, &w.organization, false);
    let outsider = user(&w.outsider, &w.organization, false);

    let error = provider
        .provide(
            AccessContext::requester(Some(&outsider)),
            "CompoundTaskType",
            &oid(&w.task_type),
        )
        .await
        .unwrap_err();
    assert_failure(
        &error,
        &[task_type_not_found(&w.task_type).as_str()],
        StatusCode::BAD_REQUEST,
    );
    // A member reads the task type, but listing tasks needs team management.
    let error = provider
        .provide(
            AccessContext::requester(Some(&member)),
            "CompoundTaskType",
            &oid(&w.task_type),
        )
        .await
        .unwrap_err();
    assert_failure(
        &error,
        &[TASK_TYPE_NO_FINISHED_ANNOTATIONS, NO_ANNOTATIONS],
        StatusCode::BAD_REQUEST,
    );
    assert!(mock.requests().is_empty());

    let provided = provider
        .provide(
            AccessContext::requester(Some(&manager)),
            "CompoundTaskType",
            &oid(&w.task_type),
        )
        .await
        .unwrap();
    assert_eq!(
        provided.annotation_type(),
        Some(AnnotationType::CompoundTaskType)
    );
    let requests = mock.requests();
    assert_eq!(requests.len(), 1);
    // Tasks in ID order; per task, readable non-cancelled instances.
    let mut finished = [
        (&w.task_a, &w.a_finished, &w.annotator),
        (&w.task_b, &w.b_finished, &w.annotator2),
    ];
    finished.sort();
    let annotations: Vec<&String> = finished.iter().map(|(_, a, _)| *a).collect();
    let owners: Vec<&String> = finished.iter().map(|(_, _, o)| *o).collect();
    assert_merge_request(
        &requests[0],
        &w.task_type,
        &w.manager,
        &annotations,
        &owners,
        sorted_boxes(vec![
            (&w.a_finished, &w.task_a),
            (&w.a_active, &w.task_a),
            (&w.e_active, &w.task_empty),
        ]),
    );
    assert!(provider.data_sources().find(&oid(&w.task_type)).is_some());
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_cache_expires_and_the_next_requester_becomes_owner() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let provider = AnnotationProvider::with_compound_cache_ttl(
        db.pool.clone(),
        tracing_client(),
        Duration::from_millis(300),
    );
    let manager = user(&w.manager, &w.organization, false);
    let admin = user(&w.admin, &w.organization, true);
    let first = provider
        .provide(
            AccessContext::requester(Some(&manager)),
            "CompoundTask",
            &oid(&w.task_b),
        )
        .await
        .unwrap();
    let hit = provider
        .provide(
            AccessContext::requester(Some(&admin)),
            "CompoundTask",
            &oid(&w.task_b),
        )
        .await
        .unwrap();
    assert_eq!(hit.owner_id(), w.manager);
    assert_eq!(hit.compound(), first.compound());
    assert_eq!(mock.requests().len(), 1);
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(provider.find_in_cache(&oid(&w.task_b)).is_none());
    let fresh = provider
        .provide(
            AccessContext::requester(Some(&admin)),
            "CompoundTask",
            &oid(&w.task_b),
        )
        .await
        .unwrap();
    assert_eq!(fresh.owner_id(), w.admin);
    assert_eq!(mock.requests().len(), 2);
    assert_eq!(
        query(&mock.requests()[1], "requestingUserId"),
        [w.admin.as_str()]
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_restrictions_allow_only_parent_team_managers_and_admins_to_access() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let provider = provider(db.pool.clone());
    let manager = user(&w.manager, &w.organization, false);
    let member = user(&w.member, &w.organization, false);
    let admin = user(&w.admin, &w.organization, true);
    let outsider = user(&w.outsider, &w.organization, false);
    let foreign_admin = user(&w.foreign_admin, &w.other_organization, true);
    let parents = [
        ("CompoundTask", &w.task_a),
        ("CompoundProject", &w.project),
        ("CompoundTaskType", &w.task_type),
    ];
    for (typ, id) in parents {
        let identifier = AnnotationIdentifier::parse(typ, &oid(id)).unwrap();
        for (requester, global, allowed) in [
            (Some(&manager), false, true),
            (Some(&admin), false, true),
            (Some(&member), false, false),
            (None, true, false),
            (Some(&foreign_admin), true, false),
        ] {
            let context = AccessContext { requester, global };
            let restrictions = provider
                .restrictions_for(context, &identifier)
                .await
                .unwrap();
            assert_eq!(
                restrictions.allow_access,
                allowed,
                "{typ} {:?}",
                requester.map(|u| &u.id)
            );
            assert_eq!(restrictions.allow_download, allowed);
            assert!(!restrictions.allow_update && !restrictions.allow_update_with_mutex);
            assert!(!restrictions.allow_finish && !restrictions.allow_finish_soft);
        }
    }
    // Parent DAO read failures.
    let outsider_context = AccessContext::requester(Some(&outsider));
    let check = |typ: &str, id: &str| AnnotationIdentifier::parse(typ, &oid(id)).unwrap();
    let error = provider
        .restrictions_for(outsider_context, &check("CompoundTask", &w.task_a))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), task_not_found(&w.task_a));
    let error = provider
        .restrictions_for(outsider_context, &check("CompoundProject", &w.project))
        .await
        .unwrap_err();
    assert!(matches!(error, ProviderError::Empty));
    let error = provider
        .restrictions_for(outsider_context, &check("CompoundTaskType", &w.task_type))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), task_type_not_found(&w.task_type));
    // A task whose project was deleted: Msg.Project.notFound.
    sqlx::query("UPDATE webknossos.projects SET isDeleted=true WHERE _id=$1")
        .bind(&w.edge_project)
        .execute(&db.pool)
        .await
        .unwrap();
    let error = provider
        .restrictions_for(
            AccessContext::requester(Some(&manager)),
            &check("CompoundTask", &w.task_multi),
        )
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), project_not_found(&w.edge_project));
    // Restrictions never merge or populate the cache.
    assert!(mock.requests().is_empty());
    assert!(provider.find_in_cache(&oid(&w.task_a)).is_none());
    db.cleanup().await;
}
