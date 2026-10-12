mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Extension, Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState, ai_models,
    application_info::{MiscConfig, MiscState},
    dataset_options::UploadToPathsConfig,
    router,
    service_clients::{ServiceClientConfig, ServiceClients},
};

type Calls = Arc<Mutex<Vec<(String, String, Value)>>>;

async fn datastore(State(calls): State<Calls>, request: Request) -> Response {
    let method = request.method().to_string();
    let uri = request.uri().to_string();
    let is_base = request
        .uri()
        .path()
        .ends_with("getOneBaseDirForOrgaAbsolute");
    let bytes = to_bytes(request.into_body(), 1 << 20).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    calls.lock().unwrap().push((method, uri, body.clone()));
    if is_base {
        return Json(json!("s3://bucket/organization")).into_response();
    }
    match body["modelPath"].as_str() {
        Some("/invalid") => Json(json!({"factor": [1, 2], "unit": "nanometer"})).into_response(),
        Some("/failure") => (StatusCode::IM_A_TEAPOT, "private upstream details").into_response(),
        _ => Json(json!({"factor": [4, 5, 6], "unit": "micrometer"})).into_response(),
    }
}

async fn mock_store(db: &TestDb) -> (Calls, tokio::task::JoinHandle<()>) {
    let calls = Calls::default();
    let mock = Router::new().fallback(datastore).with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('store',$1,'http://public.invalid','private-store-key')")
        .bind(base).execute(&db.pool).await.unwrap();
    (calls, server)
}

fn app(db: &TestDb) -> Router {
    let config = UploadToPathsConfig {
        prefixes: vec!["/srv/wk".into(), "s3://bucket/wk".into()],
        ..UploadToPathsConfig::default()
    };
    let clients = ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".into(),
    })
    .unwrap();
    ai_models::router(true)
        .merge(ai_models::upload_router(true, config))
        .layer(Extension(MiscState::new(MiscConfig {
            jobs_enabled: true,
            ..MiscConfig::default()
        })))
        .layer(Extension(clients))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}

async fn send(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (u16, Value) {
    let mut request = axum::http::Request::builder().method(method).uri(path);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let body = if let Some(body) = body {
        request = request.header("content-type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

async fn seed_model(
    db: &TestDb,
    organization: Option<&str>,
    name: &str,
    path: Option<&str>,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.aiModels (_id,_organization,_dataStore,name,path,category,created) VALUES ($1,$2,'store',$3,$4,'em_neurons',to_timestamp(1000))")
        .bind(&id).bind(organization).bind(name).bind(path).execute(&db.pool).await.unwrap();
    id
}

async fn share(db: &TestDb, model: &str, organization: &str) {
    sqlx::query(
        "INSERT INTO webknossos.aiModel_organizations (_aiModel,_organization) VALUES ($1,$2)",
    )
    .bind(model)
    .bind(organization)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn seed_job(db: &TestDb, owner: &str, state: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs,state,created) VALUES ($1,$2,'store','infer_neurons',$3,$4::webknossos.JOB_STATE,to_timestamp(1000))")
        .bind(&id).bind(owner).bind(json!({"dataset_name": "test", "webknossos_token": "private-job-token"})).bind(state).execute(&db.pool).await.unwrap();
    id
}

async fn seed_inference(
    db: &TestDb,
    organization: &str,
    job: &str,
    model: Option<&str>,
    dataset: Option<&str>,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.aiInferences (_id,_organization,_inferenceJob,_aiModel,_newDataset,boundingBox,newSegmentationLayerName,maskAnnotationLayerName,created) VALUES ($1,$2,$3,$4,$5,ROW(0,0,0,10,20,30)::webknossos.BOUNDING_BOX,'segmentation','mask',to_timestamp(1000))")
        .bind(&id).bind(organization).bind(job).bind(model).bind(dataset).execute(&db.pool).await.unwrap();
    id
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn model_read_scopes_pretrained_datastore_and_serialization() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let member = db
        .seed_user(&object_id(), &owner.organization_id, false)
        .await;
    let foreign = db.fixture().await;
    let (calls, server) = mock_store(&db).await;
    let owned = seed_model(
        &db,
        Some(&owner.organization_id),
        "owned",
        Some("s3://bucket/a/../model"),
    )
    .await;
    let shared = seed_model(
        &db,
        Some(&foreign.organization_id),
        "shared",
        Some("/shared"),
    )
    .await;
    share(&db, &shared, &owner.organization_id).await;
    let private = seed_model(
        &db,
        Some(&foreign.organization_id),
        "private",
        Some("/private"),
    )
    .await;
    let super_only = seed_model(&db, Some(&owner.organization_id), "super", Some("/super")).await;
    sqlx::query("UPDATE webknossos.aiModels SET isSuperUserOnly=TRUE WHERE _id=$1")
        .bind(&super_only)
        .execute(&db.pool)
        .await
        .unwrap();
    let pretrained = "576500000000000000000001";
    sqlx::query("INSERT INTO webknossos.aiModels (_id,_dataStore,name,isPretrained) VALUES ($1,'store','pretrained',TRUE)").bind(pretrained).execute(&db.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.aiModels SET _user=$1 WHERE _id=$2")
        .bind(&owner.user_id)
        .bind(&owned)
        .execute(&db.pool)
        .await
        .unwrap();
    let app = app(&db);
    assert_eq!(send(&app, "GET", "/aiModels", None, None).await.0, 401);
    let (status, values) = send(&app, "GET", "/aiModels", Some(&member.token), None).await;
    assert_eq!(status, 200);
    let ids: Vec<&str> = values
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap())
        .collect();
    assert!(
        ids.contains(&owned.as_str())
            && ids.contains(&shared.as_str())
            && ids.contains(&pretrained)
    );
    assert!(!ids.contains(&private.as_str()) && !ids.contains(&super_only.as_str()));
    let (_, model) = send(
        &app,
        "GET",
        &format!("/aiModels/{owned}"),
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(model["path"], "s3://bucket/model");
    assert_eq!(model["created"], 1000000);
    assert_eq!(model["category"], "em_neurons");
    assert_eq!(
        model["sharedOrganizationIds"],
        json!([owner.organization_id])
    );
    assert_eq!(model["user"], Value::Null); // Ordinary members cannot read the other user's compact record.
    assert_eq!(model["isUsable"], true);
    assert_eq!(model["dataStore"]["url"], "http://public.invalid");
    assert!(!model.to_string().contains("private-store-key"));
    let (_, model) = send(
        &app,
        "GET",
        &format!("/aiModels/{owned}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(model["user"]["id"], owner.user_id);
    let (status, prefixed) = send(
        &app,
        "GET",
        &format!("/aiModels/display-name-{}", owned.to_uppercase()),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(prefixed, model);
    let (_, model) = send(
        &app,
        "GET",
        &format!("/aiModels/{shared}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(model["sharedOrganizationIds"], Value::Null);
    assert_eq!(model["isOwnedByUsersOrganization"], false);
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/{private}"),
            Some(&owner.token),
            None
        )
        .await,
        (404, error("Could not find requested AI model."))
    );
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=TRUE WHERE _id=$1")
        .bind(&owner.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/{super_only}"),
            Some(&owner.token),
            None
        )
        .await
        .0,
        200
    );
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/{private}"),
            Some(&owner.token),
            None
        )
        .await
        .0,
        404
    ); // Superusers still need model ownership/sharing.
    sqlx::query("UPDATE webknossos.dataStores SET onlyAllowedOrganization=$1 WHERE name='store'")
        .bind(&foreign.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/{owned}"),
            Some(&owner.token),
            None
        )
        .await
        .0,
        404
    );
    assert!(calls.lock().unwrap().is_empty());
    // Verify the parent router mounts the routes with API prefix (including jobs disabled).
    let full = router(AppState {
        pool: db.pool.clone(),
    });
    assert_eq!(send(&full, "GET", "/api/aiModels", None, None).await.0, 401);
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn model_update_preserves_hidden_sharing_and_rolls_back_failed_sharing() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let hidden = db.fixture().await;
    let visible = db.fixture().await;
    let (_calls, server) = mock_store(&db).await;
    // The same account may access a second organization; its share can be removed.
    sqlx::query("UPDATE webknossos.users SET _multiUser=$1 WHERE _id=$2")
        .bind(&owner.multi_user_id)
        .bind(&visible.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let model = seed_model(
        &db,
        Some(&owner.organization_id),
        "original",
        Some("/model"),
    )
    .await;
    share(&db, &model, &hidden.organization_id).await;
    share(&db, &model, &visible.organization_id).await;
    let app = app(&db);
    let (_, before) = send(
        &app,
        "GET",
        &format!("/aiModels/{model}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert!(
        before["sharedOrganizationIds"]
            .as_array()
            .unwrap()
            .contains(&json!(visible.organization_id))
    );
    assert!(
        !before["sharedOrganizationIds"]
            .as_array()
            .unwrap()
            .contains(&json!(hidden.organization_id))
    );
    let (status, updated) = send(
        &app,
        "PUT",
        &format!("/aiModels/{model}"),
        Some(&owner.token),
        Some(json!({"name": "renamed", "comment": "new", "sharedOrganizationIds": []})),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(updated["name"], "renamed");
    assert_eq!(updated["comment"], "new");
    assert_eq!(
        updated["sharedOrganizationIds"],
        json!([owner.organization_id])
    );
    let shares: Vec<String> = sqlx::query_scalar("SELECT _organization FROM webknossos.aiModel_organizations WHERE _aiModel=$1 ORDER BY _organization").bind(&model).fetch_all(&db.pool).await.unwrap();
    assert_eq!(shares.len(), 2);
    assert!(shares.contains(&owner.organization_id) && shares.contains(&hidden.organization_id));
    assert_eq!(
        send(
            &app,
            "PUT",
            &format!("/aiModels/{model}"),
            Some(&hidden.token),
            Some(json!({"name": "stolen"}))
        )
        .await,
        (
            400,
            error("Only the owner of the AI model can perform this change.")
        )
    );
    let result = send(
        &app,
        "PUT",
        &format!("/aiModels/{model}"),
        Some(&owner.token),
        Some(json!({"name": "must rollback", "sharedOrganizationIds": ["missing-organization"]})),
    )
    .await;
    assert_eq!(
        result,
        (
            400,
            error("Could not update the organizations that may access the AI model.")
        )
    );
    let (_, unchanged) = send(
        &app,
        "GET",
        &format!("/aiModels/{model}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(unchanged["name"], "renamed");
    assert_eq!(unchanged["comment"], "new");
    // Omitted sharing leaves all existing shares, but omitted optional comment clears it.
    assert_eq!(
        send(
            &app,
            "PUT",
            &format!("/aiModels/{model}"),
            Some(&owner.token),
            Some(json!({"name": "renamed"}))
        )
        .await
        .0,
        200
    );
    let name_comment: (String, Option<String>) =
        sqlx::query_as("SELECT name,comment FROM webknossos.aiModels WHERE _id=$1")
            .bind(&model)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(name_comment, ("renamed".into(), None));
    let current: Vec<String> = sqlx::query_scalar("SELECT _organization FROM webknossos.aiModel_organizations WHERE _aiModel=$1 ORDER BY _organization").bind(&model).fetch_all(&db.pool).await.unwrap();
    assert_eq!(shares, current);
    let duplicate = seed_model(
        &db,
        Some(&owner.organization_id),
        "duplicate",
        Some("/duplicate"),
    )
    .await;
    assert_eq!(
        send(
            &app,
            "PUT",
            &format!("/aiModels/{model}"),
            Some(&owner.token),
            Some(json!({"name": "duplicate"}))
        )
        .await,
        (400, error("Could not update AI model’s name and comment."))
    );
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/{duplicate}"),
            Some(&owner.token),
            None
        )
        .await
        .0,
        200
    );
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn model_delete_checks_all_live_inferences_and_soft_deletes_shared_models() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let other = db.fixture().await;
    let (_calls, server) = mock_store(&db).await;
    let model = seed_model(
        &db,
        Some(&owner.organization_id),
        "referenced",
        Some("/model"),
    )
    .await;
    let job = seed_job(&db, &other.user_id, "SUCCESS").await;
    let inference = seed_inference(&db, &other.organization_id, &job, Some(&model), None).await;
    let app = app(&db);
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("/aiModels/{model}"),
            Some(&owner.token),
            None
        )
        .await,
        (
            400,
            error("Cannot delete AI models that are referenced by existing inferences.")
        )
    );
    sqlx::query("UPDATE webknossos.aiInferences SET isDeleted=TRUE WHERE _id=$1")
        .bind(&inference)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("/aiModels/{model}"),
            Some(&other.token),
            None
        )
        .await
        .0,
        404
    );
    share(&db, &model, &other.organization_id).await;
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("/aiModels/{model}"),
            Some(&other.token),
            None
        )
        .await,
        (200, Value::Null)
    );
    let deleted: bool =
        sqlx::query_scalar("SELECT isDeleted FROM webknossos.aiModels WHERE _id=$1")
            .bind(&model)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(deleted);
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/{model}"),
            Some(&owner.token),
            None
        )
        .await
        .0,
        404
    );
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("/aiModels/{model}"),
            Some(&owner.token),
            None
        )
        .await
        .0,
        404
    );
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn voxel_size_uses_pretrained_values_and_real_authenticated_datastore_requests() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let (calls, server) = mock_store(&db).await;
    let app = app(&db);
    let explicit = seed_model(
        &db,
        Some(&owner.organization_id),
        "explicit",
        Some("/model/../model"),
    )
    .await;
    let fallback = seed_model(&db, Some(&owner.organization_id), "fallback", None).await;
    for id in [&explicit, &fallback] {
        assert_eq!(
            send(
                &app,
                "GET",
                &format!("/aiModels/{id}/voxelSize"),
                Some(&owner.token),
                None
            )
            .await,
            (
                200,
                json!({"factor": [4.0, 5.0, 6.0], "unit": "micrometer"})
            )
        );
    }
    let (_, fallback_json) = send(
        &app,
        "GET",
        &format!("/aiModels/{fallback}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(
        fallback_json["path"],
        format!("s3://bucket/organization/.aiModels/{fallback}")
    );
    let recorded = calls.lock().unwrap().clone();
    assert_eq!(recorded.len(), 4);
    assert_eq!(recorded[0].0, "POST");
    assert_eq!(
        recorded[0].1,
        "/data/aiModels/effectiveVoxelSize?token=rpc-secret"
    );
    assert_eq!(recorded[0].2, json!({"modelPath": "/model"}));
    assert_eq!(recorded[1].0, "GET");
    assert!(recorded[1].1.contains("organizationId="));
    assert!(recorded[1].1.contains("token=rpc-secret"));
    assert_eq!(
        recorded[2].2,
        json!({"modelPath": format!("s3://bucket/organization/.aiModels/{fallback}")})
    );
    let pretrained = "576500000000000000000003";
    sqlx::query("INSERT INTO webknossos.aiModels (_id,_dataStore,name,isPretrained) VALUES ($1,'store','pretrained',TRUE)").bind(pretrained).execute(&db.pool).await.unwrap();
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/{pretrained}/voxelSize"),
            Some(&owner.token),
            None
        )
        .await,
        (
            200,
            json!({"factor": [179.84, 179.84, 224.0], "unit": "nanometer"})
        )
    );
    assert_eq!(calls.lock().unwrap().len(), 4);
    let (_, pretrained_json) = send(
        &app,
        "GET",
        &format!("/aiModels/{pretrained}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(pretrained_json["path"], Value::Null);
    let unknown = seed_model(&db, None, "unknown pretrained", None).await;
    sqlx::query("UPDATE webknossos.aiModels SET isPretrained=TRUE WHERE _id=$1")
        .bind(&unknown)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/{unknown}/voxelSize"),
            Some(&owner.token),
            None
        )
        .await,
        (
            400,
            error("No voxel size known for pretrained model 'unknown pretrained'")
        )
    );
    for (name, path, status, message) in [
        (
            "invalid",
            "/invalid",
            502,
            "Service returned an invalid JSON response.",
        ),
        (
            "failure",
            "/failure",
            418,
            "Service returned an unsuccessful status.",
        ),
    ] {
        let model = seed_model(&db, Some(&owner.organization_id), name, Some(path)).await;
        assert_eq!(
            send(
                &app,
                "GET",
                &format!("/aiModels/{model}/voxelSize"),
                Some(&owner.token),
                None
            )
            .await,
            (status, error(message))
        );
    }
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn inference_lists_reads_and_requires_readable_dependencies() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let member = db
        .seed_user(&object_id(), &owner.organization_id, false)
        .await;
    let other = db.fixture().await;
    let (_calls, server) = mock_store(&db).await;
    let model = seed_model(&db, Some(&owner.organization_id), "model", Some("/model")).await;
    let job = seed_job(&db, &owner.user_id, "SUCCESS").await;
    let inference = seed_inference(&db, &owner.organization_id, &job, Some(&model), None).await;
    let app = app(&db);
    assert_eq!(
        send(&app, "GET", "/aiModels/inferences", None, None)
            .await
            .0,
        401
    );
    let (status, values) = send(
        &app,
        "GET",
        "/aiModels/inferences",
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(values.as_array().unwrap().len(), 1);
    let (status, value) = send(
        &app,
        "GET",
        &format!("/aiModels/inferences/{inference}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(values[0], value);
    assert_eq!(value["created"], 1000000);
    assert_eq!(value["newSegmentationLayerName"], "segmentation");
    assert_eq!(value["maskAnnotationLayerName"], "mask");
    assert_eq!(value["aiModel"]["id"], model);
    assert_eq!(value["inferenceJob"]["id"], job);
    assert_eq!(value["user"]["id"], owner.user_id);
    assert_eq!(value["newDataset"], Value::Null);
    assert!(!value.to_string().contains("private-job-token"));
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/inferences/{inference}"),
            Some(&other.token),
            None
        )
        .await,
        (404, error("Could not find requested AI inference."))
    );
    assert_eq!(
        send(
            &app,
            "GET",
            "/aiModels/inferences",
            Some(&other.token),
            None
        )
        .await,
        (200, json!([]))
    );
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/inferences/{inference}"),
            Some(&member.token),
            None
        )
        .await
        .0,
        404
    ); // Same org is insufficient for reading someone else's job.
    sqlx::query("UPDATE webknossos.aiModels SET _trainingJob=$1 WHERE _id=$2")
        .bind(&job)
        .bind(&model)
        .execute(&db.pool)
        .await
        .unwrap();
    let (_, model_json) = send(
        &app,
        "GET",
        &format!("/aiModels/{model}"),
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(model_json["trainingJob"], Value::Null);
    assert_eq!(model_json["isUsable"], true); // Hidden training jobs do not block usability.
    sqlx::query("UPDATE webknossos.jobs SET state='FAILURE' WHERE _id=$1")
        .bind(&job)
        .execute(&db.pool)
        .await
        .unwrap();
    let (_, model_json) = send(
        &app,
        "GET",
        &format!("/aiModels/{model}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(model_json["isUsable"], false);
    sqlx::query("UPDATE webknossos.jobs SET manualState='SUCCESS' WHERE _id=$1")
        .bind(&job)
        .execute(&db.pool)
        .await
        .unwrap();
    let (_, model_json) = send(
        &app,
        "GET",
        &format!("/aiModels/{model}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(model_json["isUsable"], true);
    sqlx::query("UPDATE webknossos.aiModels SET uploadToPathIsPending=TRUE WHERE _id=$1")
        .bind(&model)
        .execute(&db.pool)
        .await
        .unwrap();
    let (_, model_json) = send(
        &app,
        "GET",
        &format!("/aiModels/{model}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(model_json["isUsable"], false);
    // Optional dataset becomes mandatory to read when set, even for an inference owner.
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_organization,_dataStore,_folder,name,directoryName,sortingKey) SELECT $1,_id,'store',_rootFolder,'output','output',NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&other.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.aiInferences SET _newDataset=$1 WHERE _id=$2")
        .bind(&dataset)
        .bind(&inference)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/inferences/{inference}"),
            Some(&owner.token),
            None
        )
        .await
        .0,
        404
    );
    sqlx::query("UPDATE webknossos.datasets SET isPublic=TRUE WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, value) = send(
        &app,
        "GET",
        &format!("/aiModels/inferences/{inference}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(value["newDataset"]["id"], dataset);
    sqlx::query("UPDATE webknossos.aiModels SET isDeleted=TRUE WHERE _id=$1")
        .bind(&model)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/aiModels/inferences/{inference}"),
            Some(&owner.token),
            None
        )
        .await
        .0,
        404
    );
    assert_eq!(
        send(
            &app,
            "GET",
            "/aiModels/inferences",
            Some(&owner.token),
            None
        )
        .await
        .0,
        404
    );
    sqlx::query("UPDATE webknossos.aiInferences SET isDeleted=TRUE WHERE _id=$1")
        .bind(&inference)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        send(
            &app,
            "GET",
            "/aiModels/inferences",
            Some(&owner.token),
            None
        )
        .await,
        (200, json!([]))
    );
    server.abort();
    db.cleanup().await;
}

async fn model_row(
    db: &TestDb,
    id: &str,
) -> (Option<String>, bool, String, Option<String>, Option<String>) {
    sqlx::query_as("SELECT path, uploadToPathIsPending, name, comment, category::text FROM webknossos.aiModels WHERE _id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reserve_new_model_upload_to_path_and_finish() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let foreign = db.fixture().await;
    let (calls, server) = mock_store(&db).await;
    let app = app(&db);
    let org = owner.organization_id.clone();
    let reserve = |token: &str, body: Value| {
        let (app, token) = (app.clone(), token.to_owned());
        async move {
            send(
                &app,
                "POST",
                "/aiModels/reserveUploadToPath",
                Some(&token),
                Some(body),
            )
            .await
        }
    };
    let models = || async {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM webknossos.aiModels")
            .fetch_one(&db.pool)
            .await
            .unwrap()
    };
    let body = json!({"dataStoreName": "store", "name": "uploaded", "comment": "c", "category": "em_nuclei"});
    assert_eq!(
        send(
            &app,
            "POST",
            "/aiModels/reserveUploadToPath",
            None,
            Some(body.clone())
        )
        .await
        .0,
        401
    );

    let (status, model) = reserve(&owner.token, body.clone()).await;
    assert_eq!(status, 200, "{model}");
    let id = model["id"].as_str().unwrap().to_owned();
    assert_eq!(model["path"], format!("/srv/wk/{org}/.aiModels/{id}"));
    assert_eq!(model["name"], "uploaded");
    assert_eq!(model["comment"], "c");
    assert_eq!(model["category"], "em_nuclei");
    assert_eq!(model["isUsable"], false);
    assert_eq!(model["isOwnedByUsersOrganization"], true);
    assert_eq!(model["sharedOrganizationIds"], json!([org]));
    assert_eq!(model["user"]["id"], owner.user_id);
    assert_eq!(model["trainingJob"], Value::Null);
    let (path, pending, ..) = model_row(&db, &id).await;
    assert_eq!(path.unwrap(), format!("/srv/wk/{org}/.aiModels/{id}"));
    assert!(pending);
    let (shares, owner_user, store): (i64, Option<String>, String) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM webknossos.aiModel_organizations WHERE _aiModel=$1), _user, _dataStore FROM webknossos.aiModels WHERE _id=$1",
    )
    .bind(&id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        (shares, owner_user.as_deref(), store.as_str()),
        (0, Some(owner.user_id.as_str()), "store")
    );

    // A requested prefix must be one of the configured ones.
    let (status, second) = reserve(
        &owner.token,
        json!({"dataStoreName": "store", "name": "second", "pathPrefix": "s3://bucket/wk"}),
    )
    .await;
    assert_eq!(status, 200);
    let second_id = second["id"].as_str().unwrap();
    assert_eq!(
        second["path"],
        format!("s3://bucket/wk/{org}/.aiModels/{second_id}")
    );
    assert_eq!(second["category"], Value::Null);
    let count = models().await;
    let no_prefix = error("Could not determine a configured path prefix that matches the request.");
    assert_eq!(
        reserve(
            &owner.token,
            json!({"dataStoreName": "store", "name": "third", "pathPrefix": "/elsewhere"})
        )
        .await,
        (400, no_prefix)
    );
    let invalid = error("Invalid JSON request body.");
    for body in [
        json!({"dataStoreName": "store", "name": "third", "category": "em_unknown"}),
        json!({"dataStoreName": "store", "name": "third", "pathPrefix": "a|zip|zip"}),
        json!({"dataStoreName": "store", "name": "third", "existingAiModelId": "abc"}),
        json!({"dataStoreName": "store"}),
    ] {
        assert_eq!(reserve(&owner.token, body).await, (400, invalid.clone()));
    }
    assert_eq!(
        reserve(
            &owner.token,
            json!({"dataStoreName": "missing", "name": "third"})
        )
        .await,
        (400, error("Data store could not be found or accessed."))
    );
    assert_eq!(models().await, count);

    // Names readable by the user are taken, also of other organizations; soft-deleted
    // models of the own organization still block the name (unique constraint).
    let taken = |name: &str| {
        error(&format!(
            "An AI model with the name “{name}” already exists. Please choose a different name."
        ))
    };
    assert_eq!(
        reserve(
            &owner.token,
            json!({"dataStoreName": "store", "name": "uploaded"})
        )
        .await,
        (400, taken("uploaded"))
    );
    let foreign_shared =
        seed_model(&db, Some(&foreign.organization_id), "foreign-shared", None).await;
    share(&db, &foreign_shared, &org).await;
    seed_model(&db, Some(&foreign.organization_id), "foreign-private", None).await;
    let deleted = seed_model(&db, Some(&org), "deleted", None).await;
    sqlx::query("UPDATE webknossos.aiModels SET isDeleted=TRUE WHERE _id=$1")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    let count = models().await;
    for name in ["foreign-shared", "deleted"] {
        assert_eq!(
            reserve(
                &owner.token,
                json!({"dataStoreName": "store", "name": name})
            )
            .await,
            (400, taken(name))
        );
    }
    assert_eq!(models().await, count);
    let (status, _) = reserve(
        &owner.token,
        json!({"dataStoreName": "store", "name": "foreign-private"}),
    )
    .await;
    assert_eq!(status, 200);

    // Finishing: read access, then pending, then organization.
    let finish = |token: &str, id: &str| {
        let (app, token, path) = (
            app.clone(),
            token.to_owned(),
            format!("/aiModels/{id}/finishUploadToPath"),
        );
        async move { send(&app, "POST", &path, Some(&token), None).await }
    };
    assert_eq!(
        finish(&foreign.token, &id).await,
        (
            404,
            error("Could not find or access the requested resource.")
        )
    );
    share(&db, &id, &foreign.organization_id).await;
    assert_eq!(
        finish(&foreign.token, &id).await,
        (
            403,
            error("Cannot finish upload to path for AI models of other organizations.")
        )
    );
    assert_eq!(
        finish(&owner.token, &format!("display-{}", id.to_uppercase())).await,
        (200, Value::Null)
    );
    assert!(!model_row(&db, &id).await.1);
    let (_, read) = send(
        &app,
        "GET",
        &format!("/aiModels/{id}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(read["isUsable"], true);
    assert_eq!(
        finish(&owner.token, &id).await,
        (
            400,
            error(
                "Cannot finish upload to path for AI model that is not currently marked as pending."
            )
        )
    );
    assert_eq!(
        send(
            &app,
            "POST",
            &format!("/aiModels/{id}/finishUploadToPath"),
            None,
            None
        )
        .await
        .0,
        401
    );

    // The datastore must be accessible by the user's organization.
    sqlx::query("UPDATE webknossos.dataStores SET onlyAllowedOrganization=$1 WHERE name='store'")
        .bind(&foreign.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        reserve(
            &owner.token,
            json!({"dataStoreName": "store", "name": "restricted"})
        )
        .await,
        (400, error("Data store could not be found or accessed."))
    );
    assert!(calls.lock().unwrap().is_empty());
    let full = router(AppState {
        pool: db.pool.clone(),
    });
    assert_eq!(
        send(
            &full,
            "POST",
            "/api/aiModels/reserveUploadToPath",
            None,
            Some(body)
        )
        .await
        .0,
        401
    );
    assert_eq!(
        send(
            &full,
            "POST",
            &format!("/api/aiModels/{id}/finishUploadToPath"),
            None,
            None
        )
        .await
        .0,
        401
    );
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reserve_upload_to_path_for_pending_trained_model() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let foreign = db.fixture().await;
    let (calls, server) = mock_store(&db).await;
    let app = app(&db);
    let org = owner.organization_id.clone();
    let trained = seed_model(&db, Some(&org), "trained", None).await;
    let job = seed_job(&db, &owner.user_id, "SUCCESS").await;
    sqlx::query("UPDATE webknossos.aiModels SET uploadToPathIsPending=TRUE, _trainingJob=$2, comment='old' WHERE _id=$1")
        .bind(&trained)
        .bind(&job)
        .execute(&db.pool)
        .await
        .unwrap();
    let other = seed_model(&db, Some(&org), "other", Some("/other")).await;
    let reserve = |token: &str, body: Value| {
        let (app, token) = (app.clone(), token.to_owned());
        async move {
            send(
                &app,
                "POST",
                "/aiModels/reserveUploadToPath",
                Some(&token),
                Some(body),
            )
            .await
        }
    };
    let body = |id: &str, name: &str| {
        json!({"existingAiModelId": id, "dataStoreName": "store", "name": name,
               "category": "em_nuclei", "pathPrefix": "s3://bucket/wk"})
    };

    // Renaming onto another model's name fails atomically (path unchanged).
    assert_eq!(
        reserve(&owner.token, body(&trained, "other")).await,
        (
            400,
            error(
                "An AI model with the name “other” already exists. Please choose a different name."
            )
        )
    );
    assert_eq!(model_row(&db, &trained).await.0, None);
    let mut no_prefix = body(&trained, "renamed");
    no_prefix["pathPrefix"] = json!("/elsewhere");
    assert_eq!(
        reserve(&owner.token, no_prefix).await,
        (
            400,
            error("Could not determine a configured path prefix that matches the request.")
        )
    );
    assert_eq!(
        reserve(&foreign.token, body(&trained, "renamed")).await,
        (
            404,
            error("Could not find or access the requested resource.")
        )
    );
    assert_eq!(
        reserve(&owner.token, body(&object_id(), "renamed")).await,
        (
            404,
            error("Could not find or access the requested resource.")
        )
    );
    share(&db, &trained, &foreign.organization_id).await;
    assert_eq!(
        reserve(&foreign.token, body(&trained, "renamed")).await,
        (
            403,
            error("Cannot publish AI model to a different organization than it was reserved for.")
        )
    );
    assert_eq!(
        model_row(&db, &trained).await,
        (
            None,
            true,
            "trained".into(),
            Some("old".into()),
            Some("em_neurons".into())
        )
    );

    // Uppercase JSON ids are normalized; the category is kept, the comment cleared.
    let mut uppercase = body(&trained.to_uppercase(), "renamed");
    uppercase.as_object_mut().unwrap().remove("comment");
    let (status, model) = reserve(&owner.token, uppercase).await;
    assert_eq!(status, 200, "{model}");
    let expected_path = format!("s3://bucket/wk/{org}/.aiModels/{trained}");
    assert_eq!(model["id"], trained);
    assert_eq!(model["path"], expected_path);
    assert_eq!(model["name"], "renamed");
    assert_eq!(model["comment"], Value::Null);
    assert_eq!(model["category"], "em_neurons");
    assert_eq!(model["isUsable"], false);
    assert_eq!(model["trainingJob"]["id"], job);
    assert_eq!(
        model_row(&db, &trained).await,
        (
            Some(expected_path),
            true,
            "renamed".into(),
            None,
            Some("em_neurons".into())
        )
    );
    // Reserving again for a still-pending model is allowed (regenerates the same path).
    assert_eq!(
        reserve(&owner.token, body(&trained, "renamed")).await.0,
        200
    );
    assert_eq!(
        reserve(&owner.token, body(&other, "other")).await,
        (
            400,
            error(
                "Cannot reserve upload to path for AI model that is not currently marked as pending."
            )
        )
    );
    let (status, _) = send(
        &app,
        "POST",
        &format!("/aiModels/{trained}/finishUploadToPath"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(status, 200);
    let (_, read) = send(
        &app,
        "GET",
        &format!("/aiModels/{trained}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(read["isUsable"], true);
    assert_eq!(
        reserve(&owner.token, body(&trained, "renamed")).await.0,
        400
    );
    assert!(calls.lock().unwrap().is_empty());
    server.abort();
    db.cleanup().await;
}

const TRAIN_COMMANDS: [&str; 2] = ["train_neuron_model", "train_instance_model"];

/// Worker for `store`, an AI plan for the organization, and a usable dataset
/// (two layers) with two annotations of `owner`. Returns (dataset, [annotations]).
async fn seed_training(db: &TestDb, organization: &str, owner: &str) -> (String, [String; 2]) {
    sqlx::query("INSERT INTO webknossos.workers (_id,_dataStore,key,supportedJobCommands) VALUES ($1,'store',$2,$3)")
        .bind(object_id()).bind(object_id()).bind(TRAIN_COMMANDS.to_vec()).execute(&db.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.organizations SET aiPlan='Team_AI' WHERE _id=$1")
        .bind(organization)
        .execute(&db.pool)
        .await
        .unwrap();
    let dataset = seed_dataset(db, organization).await;
    let annotations = [object_id(), object_id()];
    for annotation in &annotations {
        sqlx::query("INSERT INTO webknossos.annotations (_id,_dataset,_user,typ) VALUES ($1,$2,$3,'Explorational')")
            .bind(annotation).bind(&dataset).bind(owner).execute(&db.pool).await.unwrap();
    }
    (dataset, annotations)
}

async fn seed_dataset(db: &TestDb, organization: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,voxelSizeFactor,sortingKey) SELECT $1,'store',_id,_rootFolder,$1,$1,true,ROW(1,1,1)::webknossos.VECTOR3,NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(organization).execute(&db.pool).await.unwrap();
    for (layer, category, bbox) in [
        ("color", "color", "ROW(0,0,0,100,200,300)"),
        ("segmentation", "segmentation", "ROW(10,10,10,200,100,50)"),
    ] {
        sqlx::query(&format!("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox) VALUES ($1,$2,$3::webknossos.DATASET_LAYER_CATEGORY,'uint8',{bbox}::webknossos.BOUNDING_BOX)"))
            .bind(&id).bind(layer).bind(category).execute(&db.pool).await.unwrap();
    }
    id
}

fn training_annotation(id: &str, mag: [i32; 3]) -> Value {
    json!({"annotationId": id, "colorLayerName": "color", "segmentationLayerName": "segmentation", "mag": mag})
}

/// (jobs, credit transactions, AI models incl. deleted, training annotation links).
async fn training_counts(db: &TestDb) -> (i64, i64, i64, i64) {
    sqlx::query_as("SELECT (SELECT COUNT(*) FROM webknossos.jobs), (SELECT COUNT(*) FROM webknossos.credit_transactions), (SELECT COUNT(*) FROM webknossos.aiModels), (SELECT COUNT(*) FROM webknossos.aiModel_trainingAnnotations)")
        .fetch_one(&db.pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn training_submits_paid_job_and_pending_model_atomically() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let (calls, server) = mock_store(&db).await;
    let app = app(&db);
    let org = owner.organization_id.clone();
    let (_, [first, second]) = seed_training(&db, &org, &owner.user_id).await;

    let body = json!({
        "trainingAnnotations": [
            training_annotation(&first.to_uppercase(), [1, 1, 1]),
            training_annotation(&second, [2, 2, 1]),
        ],
        "name": "neuron model",
        "aiModelCategory": "em_neurons",
        "comment": "trained",
        "workflowYaml": "steps: []",
        "customConfiguration": {"epochs": 3, "nested": {"a": [1]}},
        "instanceDiameterNm": "ignored by the neuron route",
    });
    assert_eq!(
        send(
            &app,
            "POST",
            "/aiModels/runNeuronModelTraining",
            None,
            Some(body.clone())
        )
        .await
        .0,
        401
    );
    let (status, model) = send(
        &app,
        "POST",
        "/aiModels/runNeuronModelTraining",
        Some(&owner.token),
        Some(body),
    )
    .await;
    assert_eq!(status, 200, "{model}");
    let id = model["id"].as_str().unwrap().to_owned();
    let job_id = model["trainingJob"]["id"].as_str().unwrap().to_owned();
    assert_eq!(model["name"], "neuron model");
    assert_eq!(model["comment"], "trained");
    assert_eq!(model["category"], "em_neurons");
    assert_eq!(model["isUsable"], false);
    assert_eq!(model["isOwnedByUsersOrganization"], true);
    assert_eq!(model["isPretrained"], false);
    assert_eq!(model["isSuperUserOnly"], false);
    // Scala serializes the in-memory model, whose shared organizations are empty.
    assert_eq!(model["sharedOrganizationIds"], json!([]));
    assert_eq!(model["user"]["id"], owner.user_id);
    assert_eq!(model["trainingJob"]["command"], "train_neuron_model");
    assert_eq!(model["trainingJob"]["state"], "PENDING");
    assert_eq!(model["dataStore"]["name"], "store");
    assert_eq!(
        model["path"],
        format!("s3://bucket/organization/.aiModels/{id}")
    );
    assert!(model["created"].as_i64().unwrap() > 0);
    {
        let calls = calls.lock().unwrap();
        let (method, uri, _) = calls.last().unwrap();
        assert_eq!(method, "GET");
        assert!(
            uri.starts_with("/data/datasets/getOneBaseDirForOrgaAbsolute?"),
            "{uri}"
        );
        assert!(uri.contains(&format!("organizationId={org}")), "{uri}");
    }

    let (command, args, owner_id, store, state): (String, Value, String, String, String) = sqlx::query_as(
        "SELECT command, commandArgs, _owner, TRIM(_dataStore), state::text FROM webknossos.jobs WHERE _id=$1",
    )
    .bind(&job_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        (
            command.as_str(),
            owner_id.as_str(),
            store.as_str(),
            state.as_str()
        ),
        (
            "train_neuron_model",
            owner.user_id.as_str(),
            "store",
            "PENDING"
        )
    );
    assert_eq!(
        args,
        json!({
            "training_annotations": [
                {"annotationId": first, "colorLayerName": "color", "segmentationLayerName": "segmentation", "mag": [1, 1, 1]},
                {"annotationId": second, "colorLayerName": "color", "segmentationLayerName": "segmentation", "mag": [2, 2, 1]},
            ],
            "organization_id": org,
            "model_id": id,
            "model_name": "neuron model",
            "custom_configuration": {"epochs": 3, "nested": {"a": [1]}},
        })
    );
    let (delta, comment, paid_job, transaction_state, credit_state): (i32, String, Option<String>, String, String) =
        sqlx::query_as("SELECT milli_credit_delta, comment, _paid_job, transaction_state::text, credit_state::text FROM webknossos.credit_transactions WHERE _organization=$1")
            .bind(&org).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        (
            delta,
            comment,
            paid_job,
            transaction_state.as_str(),
            credit_state.as_str()
        ),
        (
            0,
            format!("AI training for neuron model {id}"),
            Some(job_id.clone()),
            "Pending",
            "Pending"
        )
    );
    let (path, pending, name, model_comment, category) = model_row(&db, &id).await;
    assert_eq!(
        (
            path,
            pending,
            name.as_str(),
            model_comment.as_deref(),
            category.as_deref()
        ),
        (
            None,
            true,
            "neuron model",
            Some("trained"),
            Some("em_neurons")
        )
    );
    let (training_job, user_id, model_org, store): (Option<String>, Option<String>, Option<String>, String) =
        sqlx::query_as("SELECT _trainingJob, _user, _organization, _dataStore FROM webknossos.aiModels WHERE _id=$1")
            .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        (training_job, user_id, model_org, store.as_str()),
        (
            Some(job_id.clone()),
            Some(owner.user_id.clone()),
            Some(org.clone()),
            "store"
        )
    );
    let mut linked: Vec<String> = sqlx::query_scalar(
        "SELECT _annotation FROM webknossos.aiModel_trainingAnnotations WHERE _aiModel=$1",
    )
    .bind(&id)
    .fetch_all(&db.pool)
    .await
    .unwrap();
    linked.sort();
    let mut expected = vec![first.clone(), second.clone()];
    expected.sort();
    assert_eq!(linked, expected);
    // Re-read from the database, the owning organization is shared.
    let (status, reread) = send(
        &app,
        "GET",
        &format!("/aiModels/{id}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(reread["sharedOrganizationIds"], json!([org]));
    assert_eq!(reread["trainingJob"]["id"], job_id);

    // Instance training: diameter (Double) and absent custom configuration.
    for (name, diameter, expected_diameter) in [
        ("instance model", json!(50), json!(50.0)),
        ("instance model 2", Value::Null, Value::Null),
    ] {
        let (status, model) = send(
            &app,
            "POST",
            "/aiModels/runInstanceModelTraining",
            Some(&owner.token),
            Some(json!({
                "trainingAnnotations": [training_annotation(&second, [1, 1, 1])],
                "name": name,
                "instanceDiameterNm": diameter,
            })),
        )
        .await;
        assert_eq!(status, 200, "{model}");
        let id = model["id"].as_str().unwrap();
        assert_eq!(model["category"], Value::Null);
        assert_eq!(model["comment"], Value::Null);
        assert_eq!(model["trainingJob"]["command"], "train_instance_model");
        let (args, comment): (Value, String) = sqlx::query_as(
            "SELECT j.commandArgs, c.comment FROM webknossos.jobs j JOIN webknossos.credit_transactions c ON c._paid_job=j._id WHERE j._id=$1",
        )
        .bind(model["trainingJob"]["id"].as_str().unwrap())
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(comment, format!("AI training for instance model {id}"));
        assert_eq!(
            args,
            json!({
                "training_annotations": [{"annotationId": second, "colorLayerName": "color", "segmentationLayerName": "segmentation", "mag": [1, 1, 1]}],
                "organization_id": org,
                "model_id": id,
                "model_name": name,
                "instance_diameter_nm": expected_diameter,
                "custom_configuration": null,
            })
        );
    }
    assert_eq!(training_counts(&db).await, (3, 3, 3, 4));
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn training_validation_order_permissions_and_rollback() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let member = db
        .seed_user(&object_id(), &owner.organization_id, false)
        .await;
    let foreign = db.fixture().await;
    let (_calls, server) = mock_store(&db).await;
    let app = app(&db);
    let org = owner.organization_id.clone();
    let (dataset, [first, second]) = seed_training(&db, &org, &owner.user_id).await;
    let neuron = |token: &str, body: Value| {
        let (app, token) = (app.clone(), token.to_owned());
        async move {
            send(
                &app,
                "POST",
                "/aiModels/runNeuronModelTraining",
                Some(&token),
                Some(body),
            )
            .await
        }
    };
    let instance = |token: &str, body: Value| {
        let (app, token) = (app.clone(), token.to_owned());
        async move {
            send(
                &app,
                "POST",
                "/aiModels/runInstanceModelTraining",
                Some(&token),
                Some(body),
            )
            .await
        }
    };
    let body = |annotations: Vec<Value>, name: &str| json!({"trainingAnnotations": annotations, "name": name});
    let valid = || body(vec![training_annotation(&first, [1, 1, 1])], "model");
    let not_found = (
        404,
        error("Could not find or access the requested resource."),
    );

    // Body binding.
    let invalid = (400, error("Invalid JSON request body."));
    for bad in [
        json!({"trainingAnnotations": [training_annotation(&first, [1, 1, 1])], "name": "m", "aiModelCategory": "em_unknown"}),
        json!({"trainingAnnotations": [training_annotation("abc", [1, 1, 1])], "name": "m"}),
        json!({"trainingAnnotations": [{"annotationId": first, "colorLayerName": "c", "segmentationLayerName": "s", "mag": [1, 1]}], "name": "m"}),
        json!({"trainingAnnotations": [], "name": "m", "customConfiguration": [1]}),
        json!({"name": "m"}),
    ] {
        assert_eq!(neuron(&owner.token, bad.clone()).await, invalid.clone());
        assert_eq!(instance(&owner.token, bad).await, invalid.clone());
    }
    let mut bad_diameter = valid();
    bad_diameter["instanceDiameterNm"] = json!("x");
    assert_eq!(instance(&owner.token, bad_diameter).await, invalid.clone());

    // AI plan unless superuser.
    sqlx::query("UPDATE webknossos.organizations SET aiPlan=NULL WHERE _id=$1")
        .bind(&org)
        .execute(&db.pool)
        .await
        .unwrap();
    let no_plan = (
        400,
        error("Only organizations with an AI plan can start this job."),
    );
    assert_eq!(
        neuron(&owner.token, body(vec![], "m")).await,
        no_plan.clone()
    );
    assert_eq!(instance(&owner.token, valid()).await, no_plan);
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=TRUE WHERE _id=$1")
        .bind(&owner.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let zero = (
        400,
        error("Need at least one training annotation for model training."),
    );
    assert_eq!(neuron(&owner.token, body(vec![], "m")).await, zero);
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=FALSE WHERE _id=$1")
        .bind(&owner.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.organizations SET aiPlan='Power_AI' WHERE _id=$1")
        .bind(&org)
        .execute(&db.pool)
        .await
        .unwrap();

    // A workflow without annotations has no first annotation (empty Fox).
    assert_eq!(
        instance(
            &owner.token,
            json!({"trainingAnnotations": [], "name": "m", "workflowYaml": "w"})
        )
        .await,
        not_found.clone()
    );
    // First annotation missing or unreadable.
    assert_eq!(
        neuron(
            &owner.token,
            body(vec![training_annotation(&object_id(), [1, 1, 1])], "m")
        )
        .await,
        not_found.clone()
    );
    let private = object_id();
    sqlx::query("INSERT INTO webknossos.annotations (_id,_dataset,_user,typ,visibility) VALUES ($1,$2,$3,'Explorational','Private')")
        .bind(&private).bind(&dataset).bind(&owner.user_id).execute(&db.pool).await.unwrap();
    assert_eq!(
        neuron(
            &member.token,
            body(vec![training_annotation(&private, [1, 1, 1])], "m")
        )
        .await,
        not_found.clone()
    );
    // Dataset of another organization: unreadable is empty, readable is 403.
    let foreign_dataset = seed_dataset(&db, &foreign.organization_id).await;
    let foreign_annotation = object_id();
    sqlx::query("INSERT INTO webknossos.annotations (_id,_dataset,_user,typ,visibility) VALUES ($1,$2,$3,'Explorational','Public')")
        .bind(&foreign_annotation).bind(&foreign_dataset).bind(&foreign.user_id).execute(&db.pool).await.unwrap();
    let foreign_body = body(
        vec![training_annotation(&foreign_annotation, [1, 1, 1])],
        "m",
    );
    assert_eq!(
        neuron(&owner.token, foreign_body.clone()).await,
        not_found.clone()
    );
    sqlx::query("UPDATE webknossos.datasets SET isPublic=TRUE WHERE _id=$1")
        .bind(&foreign_dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        neuron(&owner.token, foreign_body).await,
        (
            403,
            error("Training AI models is only allowed for datasets of your own organization.")
        )
    );

    // Unusable dataset: the cause is chained.
    sqlx::query("UPDATE webknossos.datasets SET isUsable=FALSE WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, response) = neuron(&owner.token, valid()).await;
    assert_eq!(status, 400);
    assert_eq!(
        response["messages"][0]["error"],
        "Dataset has no bounding box. Please make sure this dataset is imported correctly."
    );
    assert!(
        response["messages"][1]["chain"]
            .as_str()
            .unwrap()
            .ends_with(&format!(
                "Dataset “{dataset}” is not imported or incomplete."
            )),
        "{response}"
    );
    sqlx::query("UPDATE webknossos.datasets SET isUsable=TRUE WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();

    // Datastore not accessible to the organization.
    sqlx::query("UPDATE webknossos.dataStores SET onlyAllowedOrganization=$1 WHERE name='store'")
        .bind(&foreign.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        neuron(&owner.token, valid()).await,
        (400, error("Data store could not be found or accessed."))
    );
    sqlx::query("UPDATE webknossos.dataStores SET onlyAllowedOrganization=NULL WHERE name='store'")
        .execute(&db.pool)
        .await
        .unwrap();

    // Any further training annotation must be readable.
    assert_eq!(
        neuron(
            &owner.token,
            body(
                vec![
                    training_annotation(&first, [1, 1, 1]),
                    training_annotation(&object_id(), [1, 1, 1])
                ],
                "m"
            )
        )
        .await,
        (400, error("Annotation could not be found or accessed."))
    );

    // Names of soft-deleted models of the organization are taken, too.
    let deleted = seed_model(&db, Some(&org), "deleted", None).await;
    sqlx::query("UPDATE webknossos.aiModels SET isDeleted=TRUE WHERE _id=$1")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    seed_model(&db, Some(&foreign.organization_id), "foreign name", None).await;
    let taken = (
        400,
        error(
            "An AI model with the name “deleted” already exists. Please choose a different name.",
        ),
    );
    assert_eq!(
        neuron(
            &owner.token,
            body(vec![training_annotation(&first, [1, 1, 1])], "deleted")
        )
        .await,
        taken
    );
    let before = training_counts(&db).await;
    assert_eq!(before, (0, 0, 2, 0));

    // Paid-job permission: wrapped by submitFailed, nothing reserved.
    // (the member reads the internal annotation and the now public dataset)
    sqlx::query("UPDATE webknossos.datasets SET isPublic=TRUE WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, response) = neuron(&member.token, valid()).await;
    assert_eq!(status, 400, "{response}");
    assert_eq!(
        response["messages"][0]["error"],
        "Could not start the AI model training job."
    );
    assert!(response["messages"][1]["chain"].as_str().unwrap().ends_with(
        "Starting paid jobs is only allowed for Administrators, Dataset Managers or Team Managers."
    ));
    assert_eq!(training_counts(&db).await, before);

    // No worker for the command: the reservation/refund audit pair commits, no model.
    sqlx::query("UPDATE webknossos.workers SET supportedJobCommands=ARRAY['train_neuron_model']")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, response) = instance(&owner.token, valid()).await;
    assert_eq!(status, 400, "{response}");
    assert_eq!(
        response["messages"][0]["error"],
        "Could not start the AI model training job."
    );
    assert!(
        response["messages"][1]["chain"]
            .as_str()
            .unwrap()
            .ends_with("] Could not submit job."),
        "{response}"
    );
    assert_eq!(training_counts(&db).await, (0, 2, 2, 0));
    let states: Vec<(String, String)> = sqlx::query_as("SELECT transaction_state::text, credit_state::text FROM webknossos.credit_transactions ORDER BY credit_state")
        .fetch_all(&db.pool).await.unwrap();
    assert_eq!(
        states,
        [
            ("Complete".into(), "Refunded".into()),
            ("Complete".into(), "Refunding".into())
        ]
    );

    // A failing model insert (duplicate training annotation) rolls back the job
    // and the reservation together with the model.
    let (status, _) = neuron(
        &owner.token,
        body(
            vec![
                training_annotation(&first, [1, 1, 1]),
                training_annotation(&first, [2, 2, 2]),
            ],
            "dup",
        ),
    )
    .await;
    assert_eq!(status, 409);
    assert_eq!(training_counts(&db).await, (0, 2, 2, 0));
    // The model name is still free, and a valid request succeeds.
    let (status, model) = neuron(
        &owner.token,
        body(
            vec![
                training_annotation(&first, [1, 1, 1]),
                training_annotation(&second, [1, 1, 1]),
            ],
            "dup",
        ),
    )
    .await;
    assert_eq!(status, 200, "{model}");
    assert_eq!(training_counts(&db).await, (1, 3, 3, 2));
    server.abort();
    db.cleanup().await;
}

const INFER_COMMANDS: [&str; 2] = ["infer_neurons", "infer_instances"];

/// Worker for `store`, 5000 milli credits, a usable dataset with voxel size
/// 1 µm whose color layer has mags 1-1-1, 2-2-1, 4-4-2, 8-8-4 (the
/// segmentation layer has none), and an annotation. Returns (dataset, annotation).
async fn seed_inference_setup(db: &TestDb, organization: &str, owner: &str) -> (String, String) {
    sqlx::query("INSERT INTO webknossos.workers (_id,_dataStore,key,supportedJobCommands) VALUES ($1,'store',$2,$3)")
        .bind(object_id()).bind(object_id()).bind(INFER_COMMANDS.to_vec()).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.credit_transactions (_id,_organization,milli_credit_delta,comment,transaction_state,credit_state) VALUES ($1,$2,5000,'test grant','Complete','AddCredits')")
        .bind(object_id()).bind(organization).execute(&db.pool).await.unwrap();
    let dataset = seed_dataset(db, organization).await;
    sqlx::query("UPDATE webknossos.datasets SET voxelSizeUnit='micrometer' WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    for [x, y, z] in [[1, 1, 1], [2, 2, 1], [4, 4, 2], [8, 8, 4]] {
        sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag) VALUES ($1,'color',ROW($2,$3,$4)::webknossos.VECTOR3)")
            .bind(&dataset).bind(f64::from(x)).bind(f64::from(y)).bind(f64::from(z)).execute(&db.pool).await.unwrap();
    }
    // A pending upload is not part of the data source.
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,uploadIsPending) VALUES ($1,'color',ROW(3,3,3)::webknossos.VECTOR3,TRUE)")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    let annotation = object_id();
    sqlx::query("INSERT INTO webknossos.annotations (_id,_dataset,_user,typ) VALUES ($1,$2,$3,'Explorational')")
        .bind(&annotation).bind(&dataset).bind(owner).execute(&db.pool).await.unwrap();
    (dataset, annotation)
}

/// (_organization, _aiModel, _newDataset, _annotation, _inferenceJob,
/// boundingBox, maskAnnotationLayerName, isDeleted) of an aiInferences row.
type InferenceRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    String,
    Option<String>,
    bool,
);

/// (jobs, credit transactions, AI inferences incl. deleted).
async fn inference_counts(db: &TestDb) -> (i64, i64, i64) {
    sqlx::query_as("SELECT (SELECT COUNT(*) FROM webknossos.jobs), (SELECT COUNT(*) FROM webknossos.credit_transactions), (SELECT COUNT(*) FROM webknossos.aiInferences)")
        .fetch_one(&db.pool).await.unwrap()
}

/// (command, commandArgs) of a job and (delta, comment, paid job) of its reservation.
async fn inference_job(db: &TestDb, job: &str) -> (String, Value, i32, String) {
    sqlx::query_as("SELECT j.command, j.commandArgs, c.milli_credit_delta, c.comment FROM webknossos.jobs j JOIN webknossos.credit_transactions c ON c._paid_job=j._id WHERE j._id=$1")
        .bind(job).fetch_one(&db.pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn inference_submits_paid_job_with_target_mag_cost_and_inference_atomically() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let foreign = db.fixture().await;
    let (calls, server) = mock_store(&db).await;
    let app = app(&db);
    let org = owner.organization_id.clone();
    let (dataset, annotation) = seed_inference_setup(&db, &org, &owner.user_id).await;
    // The datastore reports 4 µm for the model: on a 1 µm dataset mag 4-4-2
    // matches best (only the x component counts).
    let own_model = seed_model(&db, Some(&org), "own", Some("/models/own")).await;

    let body = json!({
        "datasetId": dataset.to_uppercase(),
        "aiModelId": own_model.to_uppercase(),
        "colorLayerName": "color",
        "boundingBox": "0, 0,0,4000,4000,4000",
        "annotationId": annotation.to_uppercase(),
        "maskAnnotationLayerName": "mask",
        "newDatasetName": "new_dataset-1.0",
        "workflowYaml": "ignored",
        "seedGeneratorDistanceThreshold": 3.5,
        "evalUseSparseTracing": true,
        "evalMaxEdgeLength": 12,
        "customConfiguration": {"a": {"b": [1]}},
    });
    assert_eq!(
        send(
            &app,
            "POST",
            "/aiModels/inferences/runNeuronModelInference",
            None,
            Some(body.clone())
        )
        .await
        .0,
        401
    );
    let (status, inference) = send(
        &app,
        "POST",
        "/aiModels/inferences/runNeuronModelInference",
        Some(&owner.token),
        Some(body),
    )
    .await;
    assert_eq!(status, 200, "{inference}");
    let id = inference["id"].as_str().unwrap().to_owned();
    let job_id = inference["inferenceJob"]["id"].as_str().unwrap().to_owned();
    assert_eq!(inference["newSegmentationLayerName"], "segmentation");
    assert_eq!(inference["maskAnnotationLayerName"], "mask");
    assert_eq!(inference["newDataset"], Value::Null);
    assert_eq!(inference["aiModel"]["id"], own_model);
    assert_eq!(inference["aiModel"]["path"], "/models/own");
    assert_eq!(inference["user"]["id"], owner.user_id);
    assert_eq!(inference["dataStore"]["name"], "store");
    assert_eq!(inference["inferenceJob"]["command"], "infer_neurons");
    assert_eq!(inference["inferenceJob"]["state"], "PENDING");
    assert!(inference["created"].as_i64().unwrap() > 0);
    {
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0],
            (
                "POST".to_owned(),
                "/data/aiModels/effectiveVoxelSize?token=rpc-secret".to_owned(),
                json!({"modelPath": "/models/own"})
            )
        );
    }
    let (command, args, delta, comment) = inference_job(&db, &job_id).await;
    assert_eq!(command, "infer_neurons");
    assert_eq!(
        args,
        json!({
            "dataset_id": dataset,
            "organization_id": org,
            "dataset_name": dataset,
            "layer_name": "color",
            "bbox": "0,0,0,4000,4000,4000",
            "model_id": own_model,
            "model_organization_id": org,
            "annotation_id": annotation,
            "dataset_directory_name": dataset,
            "new_dataset_name": "new_dataset-1.0",
            "do_split_merger_evaluation": false,
            "eval_use_sparse_tracing": true,
            "eval_max_edge_length": 12.0,
            "eval_sparse_tube_threshold_nm": null,
            "eval_min_merger_path_length_nm": null,
            "custom_configuration": {"a": {"b": [1]}},
        })
    );
    // 1000×1000×2000 voxels in mag 4-4-2 at 1000 milli credits per GVx.
    assert_eq!(delta, -2000);
    assert_eq!(
        comment,
        format!("AI custom neuron segmentation with model {own_model} for dataset {dataset}")
    );
    let row: InferenceRow =
        sqlx::query_as("SELECT _organization, _aiModel, _newDataset, _annotation, _inferenceJob, boundingBox::text, maskAnnotationLayerName, isDeleted FROM webknossos.aiInferences WHERE _id=$1")
            .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        row,
        (
            org.clone(),
            Some(own_model.clone()),
            None,
            Some(annotation.clone()),
            job_id.clone(),
            "(0,0,0,4000,4000,4000)".to_owned(),
            Some("mask".to_owned()),
            false
        )
    );
    // The response equals a later read.
    let (status, reread) = send(
        &app,
        "GET",
        &format!("/aiModels/inferences/{id}"),
        Some(&owner.token),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(reread, inference);

    // Instance inference with a model shared by another organization (fallback
    // path on the datastore); the model's owner is passed on.
    let shared_model = seed_model(&db, Some(&foreign.organization_id), "shared", None).await;
    share(&db, &shared_model, &org).await;
    calls.lock().unwrap().clear();
    let (status, inference) = send(
        &app,
        "POST",
        "/aiModels/inferences/runInstanceModelInference",
        Some(&owner.token),
        Some(json!({
            "datasetId": dataset,
            "aiModelId": shared_model,
            "colorLayerName": "color",
            "boundingBox": "10,20,30,40,40,40",
            "annotationId": annotation,
            "newDatasetName": "instances",
            "seedGeneratorDistanceThreshold": 3.5,
            "doSplitMergerEvaluation": true,
        })),
    )
    .await;
    assert_eq!(status, 200, "{inference}");
    assert_eq!(inference["aiModel"]["id"], shared_model);
    assert_eq!(inference["aiModel"]["isOwnedByUsersOrganization"], false);
    assert_eq!(inference["maskAnnotationLayerName"], Value::Null);
    assert_eq!(inference["inferenceJob"]["command"], "infer_instances");
    {
        let calls = calls.lock().unwrap();
        let effective: Vec<_> = calls
            .iter()
            .filter(|(method, _, _)| method == "POST")
            .collect();
        assert_eq!(
            effective[0].2,
            json!({"modelPath": format!("s3://bucket/organization/.aiModels/{shared_model}")})
        );
    }
    let (command, args, delta, comment) =
        inference_job(&db, inference["inferenceJob"]["id"].as_str().unwrap()).await;
    assert_eq!(command, "infer_instances");
    assert_eq!(
        args,
        json!({
            "dataset_id": dataset,
            "organization_id": org,
            "dataset_name": dataset,
            "layer_name": "color",
            "bbox": "10,20,30,40,40,40",
            "model_id": shared_model,
            "model_organization_id": foreign.organization_id,
            "dataset_directory_name": dataset,
            "new_dataset_name": "instances",
            "seed_generator_distance_threshold": 3.5,
            "custom_configuration": null,
        })
    );
    assert_eq!(delta, -1);
    assert_eq!(
        comment,
        format!("AI custom instance segmentation with model {shared_model} for dataset {dataset}")
    );
    let annotation_link: Option<String> =
        sqlx::query_scalar("SELECT _annotation FROM webknossos.aiInferences WHERE _id=$1")
            .bind(inference["id"].as_str().unwrap())
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(annotation_link, Some(annotation.clone()));

    // A pretrained model (another datastore is fine) uses its fixed voxel size
    // (7.96 nm → mag 1-1-1) without datastore requests.
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('other','http://other.invalid','http://other.invalid','other-key')")
        .execute(&db.pool).await.unwrap();
    let pretrained = "576500000000000000000001";
    sqlx::query("INSERT INTO webknossos.aiModels (_id,_organization,_dataStore,name,isPretrained) VALUES ($1,NULL,'other','pretrained',TRUE)")
        .bind(pretrained).execute(&db.pool).await.unwrap();
    calls.lock().unwrap().clear();
    let (status, inference) = send(
        &app,
        "POST",
        "/aiModels/inferences/runNeuronModelInference",
        Some(&owner.token),
        Some(json!({
            "datasetId": dataset,
            "aiModelId": pretrained,
            "colorLayerName": "color",
            "boundingBox": "0,0,0,1000,1000,1000",
            "newDatasetName": "pretrained",
            "doSplitMergerEvaluation": true,
        })),
    )
    .await;
    assert_eq!(status, 200, "{inference}");
    assert!(calls.lock().unwrap().is_empty());
    assert_eq!(inference["aiModel"]["isPretrained"], true);
    assert_eq!(inference["aiModel"]["path"], Value::Null);
    let (_, args, delta, _) =
        inference_job(&db, inference["inferenceJob"]["id"].as_str().unwrap()).await;
    assert_eq!(args["model_organization_id"], Value::Null);
    assert_eq!(args["annotation_id"], Value::Null);
    assert_eq!(args["do_split_merger_evaluation"], true);
    assert_eq!(args["custom_configuration"], Value::Null);
    // 1 GVx in mag 1-1-1.
    assert_eq!(delta, -1000);
    assert_eq!(inference_counts(&db).await, (3, 4, 3));
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn inference_validation_order_permissions_and_rollback() {
    let db = TestDb::new().await;
    let owner = db.fixture().await;
    let member = db
        .seed_user(&object_id(), &owner.organization_id, false)
        .await;
    let foreign = db.fixture().await;
    let (_calls, server) = mock_store(&db).await;
    let app = app(&db);
    let org = owner.organization_id.clone();
    let (dataset, annotation) = seed_inference_setup(&db, &org, &owner.user_id).await;
    let model = seed_model(&db, Some(&org), "model", Some("/models/m")).await;
    let neuron = |token: &str, body: Value| {
        let (app, token) = (app.clone(), token.to_owned());
        async move {
            send(
                &app,
                "POST",
                "/aiModels/inferences/runNeuronModelInference",
                Some(&token),
                Some(body),
            )
            .await
        }
    };
    let instance = |token: &str, body: Value| {
        let (app, token) = (app.clone(), token.to_owned());
        async move {
            send(
                &app,
                "POST",
                "/aiModels/inferences/runInstanceModelInference",
                Some(&token),
                Some(body),
            )
            .await
        }
    };
    let valid = || {
        json!({
            "datasetId": dataset,
            "aiModelId": model,
            "colorLayerName": "color",
            "boundingBox": "0,0,0,100,100,100",
            "newDatasetName": "result",
        })
    };
    let with = |key: &str, value: Value| {
        let mut body = valid();
        body[key] = value;
        body
    };
    let not_found = (
        404,
        error("Could not find or access the requested resource."),
    );

    // Body binding.
    let invalid = (400, error("Invalid JSON request body."));
    let mut missing = valid();
    missing.as_object_mut().unwrap().remove("newDatasetName");
    for bad in [
        missing,
        with("datasetId", json!("abc")),
        with("aiModelId", json!(5)),
        with("annotationId", json!("xyz")),
        with("seedGeneratorDistanceThreshold", json!("x")),
        with("doSplitMergerEvaluation", json!("yes")),
        with("customConfiguration", json!([1])),
    ] {
        assert_eq!(neuron(&owner.token, bad.clone()).await, invalid.clone());
        assert_eq!(instance(&owner.token, bad).await, invalid.clone());
    }

    // Unknown or unreadable dataset, then a readable dataset of another organization.
    assert_eq!(
        neuron(&owner.token, with("datasetId", json!(object_id()))).await,
        not_found.clone()
    );
    let foreign_dataset = seed_dataset(&db, &foreign.organization_id).await;
    assert_eq!(
        neuron(&owner.token, with("datasetId", json!(foreign_dataset))).await,
        not_found.clone()
    );
    sqlx::query("UPDATE webknossos.datasets SET isPublic=TRUE WHERE _id=$1")
        .bind(&foreign_dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        instance(&owner.token, with("datasetId", json!(foreign_dataset))).await,
        (
            403,
            error("Running AI models is only allowed for datasets of your own organization.")
        )
    );

    // Model: unknown, unshared foreign, superuser-only, missing; datastore mismatch.
    let model_not_found = (400, error("Could not find requested AI model."));
    assert_eq!(
        neuron(&owner.token, with("aiModelId", json!(object_id()))).await,
        model_not_found.clone()
    );
    let foreign_model = seed_model(&db, Some(&foreign.organization_id), "f", None).await;
    assert_eq!(
        neuron(&owner.token, with("aiModelId", json!(foreign_model))).await,
        model_not_found.clone()
    );
    let super_only = seed_model(&db, Some(&org), "super", None).await;
    sqlx::query("UPDATE webknossos.aiModels SET isSuperUserOnly=TRUE WHERE _id=$1")
        .bind(&super_only)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        instance(&owner.token, with("aiModelId", json!(super_only))).await,
        model_not_found
    );
    assert_eq!(
        neuron(&owner.token, with("aiModelId", Value::Null)).await,
        (400, error("aiModel.required"))
    );
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('other','http://other.invalid','http://other.invalid','other-key')")
        .execute(&db.pool).await.unwrap();
    let other_store_model = seed_model(&db, Some(&org), "other store", None).await;
    sqlx::query("UPDATE webknossos.aiModels SET _dataStore='other' WHERE _id=$1")
        .bind(&other_store_model)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        neuron(&owner.token, with("aiModelId", json!(other_store_model))).await,
        (
            400,
            error("Cannot use AI model on a dataset on a different data store.")
        )
    );

    // Data source and layer.
    assert_eq!(
        neuron(&owner.token, with("colorLayerName", json!("missing"))).await,
        (400, error("Could not find layer “missing” in dataset."))
    );
    sqlx::query("UPDATE webknossos.datasets SET isUsable=FALSE WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        neuron(&owner.token, valid()).await,
        (
            400,
            error(&format!(
                "Dataset “{dataset}” is not imported or incomplete."
            ))
        )
    );
    sqlx::query("UPDATE webknossos.datasets SET isUsable=TRUE WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();

    // Datastore not accessible to the organization.
    sqlx::query("UPDATE webknossos.dataStores SET onlyAllowedOrganization=$1 WHERE name='store'")
        .bind(&foreign.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        neuron(&owner.token, valid()).await,
        (400, error("Data store could not be found or accessed."))
    );
    sqlx::query("UPDATE webknossos.dataStores SET onlyAllowedOrganization=NULL WHERE name='store'")
        .execute(&db.pool)
        .await
        .unwrap();

    // New dataset name, then the bounding box literal (empty Fox).
    assert_eq!(
        neuron(&owner.token, with("newDatasetName", json!(".hidden"))).await,
        (
            400,
            error("Dataset name is invalid. Please use a name that does not start with a dot.")
        )
    );
    assert_eq!(
        instance(&owner.token, with("boundingBox", json!("1,2,3"))).await,
        not_found.clone()
    );

    // Target mag: unknown pretrained voxel size, upstream failure, no mags.
    let unknown_pretrained = object_id();
    sqlx::query("INSERT INTO webknossos.aiModels (_id,_organization,_dataStore,name,isPretrained) VALUES ($1,NULL,'other','unknown pretrained',TRUE)")
        .bind(&unknown_pretrained).execute(&db.pool).await.unwrap();
    assert_eq!(
        neuron(&owner.token, with("aiModelId", json!(unknown_pretrained))).await,
        (
            400,
            error("No voxel size known for pretrained model 'unknown pretrained'")
        )
    );
    let failing = seed_model(&db, Some(&org), "failing", Some("/failure")).await;
    assert_eq!(
        neuron(&owner.token, with("aiModelId", json!(failing))).await,
        (418, error("Service returned an unsuccessful status."))
    );
    assert_eq!(
        instance(&owner.token, with("colorLayerName", json!("segmentation"))).await,
        (400, error("Data layer does not contain any mags."))
    );
    assert_eq!(inference_counts(&db).await, (0, 1, 0));

    // Paid-job permission: wrapped by submitFailed, nothing reserved.
    sqlx::query("UPDATE webknossos.datasets SET isPublic=TRUE WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, response) = neuron(&member.token, valid()).await;
    assert_eq!(status, 400, "{response}");
    assert_eq!(
        response["messages"][0]["error"],
        "Could not start the AI inference job."
    );
    assert!(response["messages"][1]["chain"].as_str().unwrap().ends_with(
        "Starting paid jobs is only allowed for Administrators, Dataset Managers or Team Managers."
    ));
    // Not enough credits for the target-mag volume (64 GVx in mag 1-1-1 of the
    // pretrained model would cost 64000).
    sqlx::query("INSERT INTO webknossos.aiModels (_id,_organization,_dataStore,name,isPretrained) VALUES ('576500000000000000000002',NULL,'other','pretrained',TRUE)")
        .execute(&db.pool).await.unwrap();
    let mut expensive = with("aiModelId", json!("576500000000000000000002"));
    expensive["boundingBox"] = json!("0,0,0,4000,4000,4000");
    let (status, response) = neuron(&owner.token, expensive).await;
    assert_eq!(status, 400, "{response}");
    assert_eq!(
        response["messages"][0]["error"],
        "Could not start the AI inference job."
    );
    assert!(
        response["messages"][1]["chain"]
            .as_str()
            .unwrap()
            .ends_with(
                "Your organization does not have enough WEBKNOSSOS credits to run this job."
            ),
        "{response}"
    );
    assert_eq!(inference_counts(&db).await, (0, 1, 0));

    // No worker for the command: the reservation/refund audit pair commits, no inference.
    sqlx::query("UPDATE webknossos.workers SET supportedJobCommands=ARRAY['infer_neurons']")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, response) = instance(&owner.token, valid()).await;
    assert_eq!(status, 400, "{response}");
    assert_eq!(
        response["messages"][0]["error"],
        "Could not start the AI inference job."
    );
    assert!(
        response["messages"][1]["chain"]
            .as_str()
            .unwrap()
            .ends_with("] Could not submit job."),
        "{response}"
    );
    assert_eq!(inference_counts(&db).await, (0, 3, 0));

    // A failing inference insert (unknown annotation) rolls back the job and
    // the reservation together with the inference.
    let (status, _) = neuron(&owner.token, with("annotationId", json!(object_id()))).await;
    assert_eq!(status, 409);
    assert_eq!(inference_counts(&db).await, (0, 3, 0));
    let (status, inference) = neuron(&owner.token, with("annotationId", json!(annotation))).await;
    assert_eq!(status, 200, "{inference}");
    assert_eq!(inference_counts(&db).await, (1, 4, 1));
    server.abort();
    db.cleanup().await;
}
