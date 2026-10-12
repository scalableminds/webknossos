mod common;

use axum::{
    Extension, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{StatusCode, header},
    response::IntoResponse,
    routing::post,
};
use common::{TestDb, object_id};
use prost::Message;
use serde_json::{Value, json};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    annotation_provider::{AccessContext, AnnotationIdentifier, AnnotationProvider},
    auth::AuthUser,
    id::ObjectId,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    remote_tracingstore_reads,
    service_clients::ServiceClientConfig,
    tracingstore_client::TracingStoreClient,
};

fn provider(db: &TestDb) -> AnnotationProvider {
    AnnotationProvider::new(
        db.pool.clone(),
        TracingStoreClient::new(ServiceClientConfig {
            request_timeout: Duration::from_secs(5),
            connect_timeout: Duration::from_secs(2),
            max_response_bytes: 65536,
            rpc_token: "internal-rpc-token".into(),
        })
        .unwrap(),
    )
}
fn app(db: &TestDb, provider: &AnnotationProvider) -> Router {
    remote_tracingstore_reads::router()
        .layer(Extension(provider.clone()))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}
async fn setup() -> (TestDb, AnnotationProvider, Router) {
    let db = TestDb::new().await;
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES ('tracing','http://tracing.invalid','http://public-tracing.invalid','service-key')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES ('data','http://data.internal','http://data.public','data-secret')").execute(&db.pool).await.unwrap();
    let provider = provider(&db);
    let app = app(&db, &provider);
    (db, provider, app)
}
async fn call(app: &Router, uri: &str) -> (StatusCode, String, Value) {
    let response = app
        .clone()
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!(String::from_utf8(bytes.to_vec()).unwrap()));
    (status, content_type, value)
}
async fn answer(app: &Router, uri: &str) -> (StatusCode, Value) {
    let (status, _, body) = call(app, uri).await;
    (status, body)
}
fn query(route: &str, field: &str, value: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("key", "service-key")
        .append_pair(field, value)
        .finish();
    format!("/tracingstores/informational-name/{route}?{query}")
}
fn source_path(route: &str, id: &str) -> String {
    format!("/tracingstores/informational-name/{route}/{id}?key=service-key")
}
fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}
async fn dataset(db: &TestDb, org: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_dataStore,_organization,_folder,name,directoryName,sortingKey,isUsable,voxelSizeFactor) SELECT $1,'data',_id,_rootFolder,'Display name','directory',NOW(),TRUE,ROW(1,2,3)::webknossos.VECTOR3 FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(org).execute(&db.pool).await.unwrap();
    id
}
async fn annotation(db: &TestDb, dataset: &str, user: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,visibility) VALUES ($1,$2,$3,'Explorational','Private')")
        .bind(&id).bind(dataset).bind(user).execute(&db.pool).await.unwrap();
    id
}
async fn layer(db: &TestDb, annotation: &str, tracing: &str) {
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES ($1,$2,'Skeleton','Skeleton','{}')")
        .bind(annotation).bind(tracing).execute(&db.pool).await.unwrap();
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn service_authentication_binding_and_arbitrary_tracing_ids() {
    let (db, _, app) = setup().await;
    let dummy = query("annotationId", "tracingId", "dummyTracingId");
    assert_eq!(
        answer(&app, &dummy).await,
        (StatusCode::OK, json!("000000000000000000000000"))
    );
    let (status, content_type, body) = call(&app, &dummy.replace("service-key", "wrong")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(content_type, "text/plain; charset=utf-8");
    assert_eq!(body, json!("Tracing store could not be found or accessed."));
    assert_eq!(
        answer(&app, &dummy.replace("key=service-key&", "")).await.0,
        StatusCode::BAD_REQUEST
    );
    for tracing in [
        "not-an-object-id",
        "DummyTracingId",
        "name with spaces/?'",
        "",
    ] {
        assert_eq!(
            answer(&app, &query("annotationId", "tracingId", tracing)).await,
            (
                StatusCode::BAD_REQUEST,
                error(&format!("No annotation for tracing {tracing}"))
            )
        );
    }
    let id = object_id();
    for route in ["dataSource", "datasetId"] {
        assert_eq!(
            answer(
                &app,
                &query(route, "annotationId", &format!("prefix-{id}"))
                    .replace("service-key", "wrong")
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            answer(&app, &query(route, "annotationId", &id.to_uppercase())).await,
            (
                StatusCode::BAD_REQUEST,
                error("Annotation could not be found or accessed.")
            )
        );
    }
    for route in ["dataStoreUri", "datasources"] {
        assert_eq!(
            answer(
                &app,
                &source_path(route, "bad").replace("service-key", "wrong")
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            answer(
                &app,
                &source_path(route, &format!("readable-prefix-{}", id.to_uppercase()))
            )
            .await,
            (
                StatusCode::NOT_FOUND,
                error(&format!("Dataset “{id}” could not be found or accessed."))
            )
        );
    }
    sqlx::query("UPDATE webknossos.tracingStores SET isDeleted=TRUE")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        answer(&app, &dummy).await,
        (
            StatusCode::FORBIDDEN,
            json!("Tracing store could not be found or accessed.")
        )
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn saved_annotations_sources_real_paths_credentials_and_dataset_failures() {
    let (db, _, app) = setup().await;
    let owner = db.fixture().await;
    let dataset = dataset(&db, &owner.organization_id).await;
    let annotation = annotation(&db, &dataset, &owner.user_id).await;
    layer(&db, &annotation, "arbitrary-saved-tracing").await;
    sqlx::query("INSERT INTO webknossos.dataset_layers(_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,'seg','segmentation','uint32',ROW(0,0,0,10,20,30)::webknossos.BOUNDING_BOX,'zarr3')").bind(&dataset).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags(_dataset,dataLayerName,mag,path,realPath,credentialId) VALUES ($1,'seg',ROW(1,1,1)::webknossos.VECTOR3,'s3://stored/mag','s3://resolved/mag','mag-credential')").bind(&dataset).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments(_dataset,layerName,name,path,realPath,type,dataFormat,credentialId) VALUES ($1,'seg','mesh','s3://stored/mesh','s3://resolved/mesh','mesh','hdf5','attachment-credential')").bind(&dataset).execute(&db.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.dataStores SET onlyAllowedOrganization='unrelated-org'")
        .execute(&db.pool)
        .await
        .unwrap();
    let source = answer(
        &app,
        &query("dataSource", "annotationId", &annotation.to_uppercase()),
    )
    .await;
    assert_eq!(source.0, StatusCode::OK);
    assert_eq!(
        source.1["id"],
        json!({"name": "directory", "team": owner.organization_id})
    );
    assert_eq!(source.1["scale"]["factor"], json!([1, 2, 3]));
    assert_eq!(
        source.1["dataLayers"][0]["mags"][0]["path"],
        "s3://resolved/mag"
    );
    assert_eq!(
        source.1["dataLayers"][0]["mags"][0]["credentialId"],
        "mag-credential"
    );
    assert_eq!(
        source.1["dataLayers"][0]["attachments"]["meshes"][0]["path"],
        "s3://resolved/mesh"
    );
    assert_eq!(
        source.1["dataLayers"][0]["attachments"]["meshes"][0]["credentialId"],
        "attachment-credential"
    );
    assert!(!source.1.to_string().contains("data-secret"));
    assert_eq!(
        answer(
            &app,
            &source_path(
                "datasources",
                &format!("directory-{}", dataset.to_uppercase())
            )
        )
        .await,
        source
    );
    assert_eq!(
        answer(&app, &source_path("dataStoreUri", &dataset)).await,
        (StatusCode::OK, json!("http://data.internal"))
    );
    for state in ["Finished", "Cancelled"] {
        sqlx::query(
            "UPDATE webknossos.annotations SET state=$2::webknossos.ANNOTATION_STATE WHERE _id=$1",
        )
        .bind(&annotation)
        .bind(state)
        .execute(&db.pool)
        .await
        .unwrap();
        assert_eq!(
            answer(&app, &query("datasetId", "annotationId", &annotation)).await,
            (StatusCode::OK, json!(dataset))
        );
        assert_eq!(
            answer(
                &app,
                &query("annotationId", "tracingId", "arbitrary-saved-tracing")
            )
            .await,
            (StatusCode::OK, json!(annotation))
        );
    }
    sqlx::query("UPDATE webknossos.datasets SET voxelSizeFactor=NULL WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    for uri in [
        query("dataSource", "annotationId", &annotation),
        source_path("datasources", &dataset),
    ] {
        assert_eq!(
            answer(&app, &uri).await,
            (
                StatusCode::BAD_REQUEST,
                error("Dataset is marked as usable but has no voxel size.")
            )
        );
    }
    assert_eq!(
        answer(&app, &query("datasetId", "annotationId", &annotation))
            .await
            .0,
        StatusCode::OK
    );
    sqlx::query("UPDATE webknossos.datasets SET isUsable=FALSE,status='Unusable' WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let expected =
        json!({"id":{"name":"directory", "team":owner.organization_id}, "status":"Unusable"});
    assert_eq!(
        answer(&app, &source_path("datasources", &dataset)).await,
        (StatusCode::OK, expected.clone())
    );
    sqlx::query("UPDATE webknossos.datasets SET voxelSizeFactor=ROW(4,5,6)::webknossos.VECTOR3 WHERE _id=$1").bind(&dataset).execute(&db.pool).await.unwrap();
    let unusable = answer(&app, &source_path("datasources", &dataset)).await.1;
    assert_eq!(unusable["scale"]["factor"], json!([4, 5, 6]));
    assert!(unusable.get("dataLayers").is_none());
    sqlx::query("UPDATE webknossos.dataStores SET isDeleted=TRUE")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        answer(&app, &source_path("dataStoreUri", &dataset)).await,
        (
            StatusCode::BAD_REQUEST,
            error("Data store could not be found or accessed.")
        )
    );
    sqlx::query("UPDATE webknossos.datasets SET isDeleted=TRUE WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    for route in ["dataSource", "datasetId"] {
        assert_eq!(
            answer(&app, &query(route, "annotationId", &annotation)).await,
            (
                StatusCode::BAD_REQUEST,
                error(&format!(
                    "Dataset “{dataset}” for annotation “{annotation}” does not exist or could not be accessed."
                ))
            )
        );
    }
    for route in ["dataStoreUri", "datasources"] {
        assert_eq!(
            answer(&app, &source_path(route, &dataset)).await,
            (
                StatusCode::NOT_FOUND,
                error(&format!(
                    "Dataset “{dataset}” could not be found or accessed."
                ))
            )
        );
    }
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=TRUE WHERE _id=$1")
        .bind(&annotation)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        answer(&app, &query("dataSource", "annotationId", &annotation)).await,
        (
            StatusCode::BAD_REQUEST,
            error("Annotation could not be found or accessed.")
        )
    );
    assert_eq!(
        answer(
            &app,
            &query("annotationId", "tracingId", "arbitrary-saved-tracing")
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error("No annotation for tracing arbitrary-saved-tracing")
        )
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn temporary_sources_are_verbatim_and_precede_persisted_annotations() {
    let (db, provider, app) = setup().await;
    let owner = db.fixture().await;
    let dataset = dataset(&db, &owner.organization_id).await;
    let saved = annotation(&db, &dataset, &owner.user_id).await;
    let absent = object_id();
    let temporary_dataset = ObjectId::new();
    let source = json!({"id":{"name":"temporary", "team":"temporary-org"},"dataLayers":[{"credentialId":"cred","path":"s3://resolved/temporary"}],"scale":{"factor":[1,2,3],"unit":"nanometer"}});
    for id in [&saved, &absent] {
        provider.data_sources().store(
            ObjectId::parse(id).unwrap(),
            source.clone(),
            temporary_dataset.clone(),
        );
        assert_eq!(
            answer(&app, &query("dataSource", "annotationId", id)).await,
            (StatusCode::OK, source.clone())
        );
        assert_eq!(
            answer(&app, &query("datasetId", "annotationId", id)).await,
            (StatusCode::OK, json!(temporary_dataset))
        );
    }
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=TRUE")
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.datasets SET isDeleted=TRUE")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        answer(&app, &query("dataSource", "annotationId", &saved)).await,
        (StatusCode::OK, source)
    );
    assert_eq!(
        answer(
            &app,
            &query("dataSource", "annotationId", &saved).replace("service-key", "wrong")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    db.cleanup().await;
}

async fn merge(State(count): State<Arc<AtomicUsize>>, request: Request) -> impl IntoResponse {
    assert!(
        request
            .uri()
            .query()
            .unwrap()
            .contains("token=internal-rpc-token")
    );
    count.fetch_add(1, Ordering::SeqCst);
    let body = to_bytes(request.into_body(), 1 << 20).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap()["annotationIds"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let proto = AnnotationProto {
        description: String::new(),
        version: 0,
        annotation_layers: vec![AnnotationLayerProto {
            tracing_id: "merged-tracing".into(),
            name: "Skeleton".into(),
            typ: AnnotationLayerTypeProto::Skeleton as i32,
        }],
        earliest_accessible_version: 0,
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: None,
        user_states: vec![],
    };
    (
        [(header::CONTENT_TYPE, "application/x-protobuf")],
        proto.encode_to_vec(),
    )
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn genuine_compound_merge_cache_saved_precedence_and_invalidation() {
    let (db, provider, app) = setup().await;
    let owner = db.fixture().await;
    let dataset = dataset(&db, &owner.organization_id).await;
    let count = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(
        axum::serve(
            listener,
            Router::new()
                .route("/tracings/annotation/mergedFromIds", post(merge))
                .with_state(count.clone()),
        )
        .into_future(),
    );
    sqlx::query("UPDATE webknossos.tracingStores SET url=$1 WHERE name='tracing'")
        .bind(format!("http://{address}"))
        .execute(&db.pool)
        .await
        .unwrap();
    let project = object_id();
    let task_type = object_id();
    let task = object_id();
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES ($1,$2,$3,$4,'Read compound')").bind(&project).bind(&owner.organization_id).bind(&owner.team_id).bind(&owner.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.taskTypes(_id,_organization,_team,summary,description,settings_branchPointsAllowed,settings_somaClickingAllowed) VALUES ($1,$2,$3,'Read compound','',TRUE,TRUE)").bind(&task_type).bind(&owner.organization_id).bind(&owner.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_taskType,neededExperience_domain,neededExperience_value,totalInstances,pendingInstances,editPosition,editRotation) VALUES ($1,$2,$3,'test',0,1,1,ROW(0,0,0)::webknossos.VECTOR3,ROW(0,0,0)::webknossos.VECTOR3)").bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    let finished = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,state,visibility) VALUES ($1,$2,$3,$4,'Task','Finished','Private')").bind(&finished).bind(&dataset).bind(&task).bind(&owner.user_id).execute(&db.pool).await.unwrap();
    layer(&db, &finished, "finished-tracing").await;
    let user = AuthUser {
        id: owner.user_id.clone(),
        organization_id: owner.organization_id.clone(),
        is_admin: true,
        is_dataset_manager: false,
        is_superuser: false,
    };
    let identifier =
        AnnotationIdentifier::parse("CompoundProject", &ObjectId::parse(&project).unwrap())
            .unwrap();
    let compound = provider
        .provide_identifier(AccessContext::requester(Some(&user)), &identifier)
        .await
        .unwrap();
    assert_eq!(compound.id(), project);
    let uri = query("annotationId", "tracingId", "merged-tracing");
    assert_eq!(answer(&app, &uri).await, (StatusCode::OK, json!(project)));
    assert_eq!(
        answer(&app, &query("datasetId", "annotationId", &project)).await,
        (StatusCode::OK, json!(dataset))
    );
    assert_eq!(
        answer(&app, &query("dataSource", "annotationId", &project))
            .await
            .0,
        StatusCode::OK
    );
    let saved = annotation(&db, &dataset, &owner.user_id).await;
    layer(&db, &saved, "merged-tracing").await;
    assert_eq!(answer(&app, &uri).await, (StatusCode::OK, json!(saved)));
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=TRUE WHERE _id=$1")
        .bind(&saved)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(answer(&app, &uri).await, (StatusCode::OK, json!(project)));
    // The fresh test database alone gains a value unknown to the Scala parser.
    // A newly inserted saved row that fails parsing must fall back to cache.
    sqlx::query("ALTER TYPE webknossos.ANNOTATION_TYPE ADD VALUE 'UnknownTestType'")
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM webknossos.annotation_layers WHERE _annotation=$1")
        .bind(&saved)
        .execute(&db.pool)
        .await
        .unwrap();
    let unparseable = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,visibility) VALUES ($1,$2,$3,'UnknownTestType','Private')")
        .bind(&unparseable).bind(&dataset).bind(&owner.user_id).execute(&db.pool).await.unwrap();
    layer(&db, &unparseable, "merged-tracing").await;
    assert_eq!(answer(&app, &uri).await, (StatusCode::OK, json!(project)));
    provider.remove_from_cache(&identifier);
    assert_eq!(
        answer(&app, &uri).await,
        (
            StatusCode::BAD_REQUEST,
            error("No annotation for tracing merged-tracing")
        )
    );
    assert_eq!(
        count.load(Ordering::SeqCst),
        1,
        "tracing lookup must never rerun a merge"
    );
    server.abort();
    db.cleanup().await;
}
