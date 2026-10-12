mod common;

use std::sync::{Arc, Mutex};

use axum::{
    Extension, Json, Router,
    body::{Body, to_bytes},
    extract::{Request as ExtractRequest, State},
    http::Request,
    routing::get,
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::{MiscConfig, MiscState},
    job_submission,
    service_clients::{ServiceClientConfig, ServiceClients},
};

const COMMANDS: [&str; 8] = [
    "compute_mesh_file",
    "compute_segment_index_file",
    "export_tiff",
    "infer_mitochondria",
    "align_sections",
    "materialize_volume_annotation",
    "find_largest_segment_id",
    "render_animation",
];

type StoreRequests = Arc<Mutex<Vec<String>>>;

#[derive(sqlx::FromRow)]
struct RefundPair {
    refund_delta: i32,
    reservation_delta: i32,
    reservation_state: String,
    reservation_credit_state: String,
    reservation_job: Option<String>,
    refund_job: Option<String>,
}

async fn upstream() -> (String, StoreRequests, tokio::task::JoinHandle<()>) {
    let requests = StoreRequests::default();
    let service = Router::new()
        .route(
            "/data/getOrganizationBaseDirectory",
            get(
                |State(requests): State<StoreRequests>, request: ExtractRequest| async move {
                    requests.lock().unwrap().push(request.uri().to_string());
                    Json(json!("/srv/user-organization"))
                },
            ),
        )
        .with_state(requests.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, service).await.unwrap() });
    (base, requests, task)
}

fn app(db: &TestDb, enabled: bool) -> Router {
    let clients = ServiceClients::new(ServiceClientConfig {
        rpc_token: "submission-rpc-secret".into(),
        ..ServiceClientConfig::default()
    })
    .unwrap();
    job_submission::router(enabled)
        .layer(Extension(MiscState::new(MiscConfig {
            jobs_enabled: enabled,
            ..MiscConfig::default()
        })))
        .layer(Extension(clients))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}

async fn request(
    app: &Router,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (u16, Value) {
    let mut request = Request::builder().method("POST").uri(uri);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let body = match body {
        Some(body) => {
            request = request.header("content-type", "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

async fn seed(db: &TestDb, fixture: &Fixture, url: &str) -> String {
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('submit-store',$1,$1,'store-secret')")
        .bind(url).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.workers (_id,_dataStore,key,supportedJobCommands) VALUES ($1,'submit-store','worker-secret',$2)")
        .bind(object_id()).bind(COMMANDS.to_vec()).execute(&db.pool).await.unwrap();
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,voxelSizeFactor,sortingKey) SELECT $1,'submit-store',_id,_rootFolder,'Input Dataset','input_directory',true,ROW(1,1,1)::webknossos.VECTOR3,NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox) VALUES ($1,'segmentation','segmentation','uint32',ROW(0,0,0,1000,1000,1000)::webknossos.BOUNDING_BOX)")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag) VALUES ($1,'segmentation',ROW(2,2,2)::webknossos.VECTOR3)")
        .bind(&id).execute(&db.pool).await.unwrap();
    id
}

async fn grant(db: &TestDb, organization: &str, credits: i32) {
    sqlx::query("INSERT INTO webknossos.credit_transactions (_id,_organization,milli_credit_delta,comment,transaction_state,credit_state) VALUES ($1,$2,$3,'test grant','Complete','AddCredits')")
        .bind(object_id()).bind(organization).bind(credits).execute(&db.pool).await.unwrap();
}

async fn counts(db: &TestDb) -> (i64, i64, i64) {
    sqlx::query_as("SELECT (SELECT count(*) FROM webknossos.jobs), (SELECT count(*) FROM webknossos.credit_transactions), (SELECT COALESCE(sum(milli_credit_delta),0)::bigint FROM webknossos.credit_transactions)")
        .fetch_one(&db.pool).await.unwrap()
}

fn animation() -> Value {
    json!({
        "layerName":"segmentation", "boundingBox":{"topLeft":[0,1,2],"width":10,"height":20,"depth":30},
        "includeWatermark":true, "meshes":[{"segmentId":7}], "movieResolution":"SD",
        "movieDuration":"SHORT", "cameraPosition":"STATIC_XY", "magForTextures":[2,2,2],
        "includeSkeletons":false, "hideImageData":false, "saveBlenderFile":false
    })
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn all_eight_routes_submit_pending_jobs_with_contract_arguments_and_costs() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let (base, store_requests, server) = upstream().await;
    let id = seed(&db, &fixture, &base).await;
    grant(&db, &fixture.organization_id, 1000).await;
    sqlx::query("INSERT INTO webknossos.dataset_layer_additionalAxes (_dataset,layerName,name,lowerBound,upperBound,index) VALUES ($1,'segmentation','t',5,15,4)")
        .bind(&id).execute(&db.pool).await.unwrap();
    let annotation_id = object_id();
    let coordinate =
        url::form_urlencoded::byte_serialize(br#"[{"name":"t","value":8}]"#).collect::<String>();
    let application = app(&db, true);
    let runs = [
        (
            format!(
                "/jobs/run/computeMeshFile/Input-{id}?layerName=segmentation&mag=2&agglomerateView=agg"
            ),
            None,
            "compute_mesh_file",
        ),
        (
            format!("/jobs/run/computeSegmentIndexFile/{id}?layerName=segmentation"),
            None,
            "compute_segment_index_file",
        ),
        (
            format!(
                "/jobs/run/exportTiff/{id}?bbox=0,1,2,10,20,30&layerName=segmentation&mag=2&exportFormat=ozx&additionalCoordinates={coordinate}"
            ),
            None,
            "export_tiff",
        ),
        (
            format!(
                "/jobs/run/inferMitochondria/{id}?layerName=segmentation&bbox=0,0,0,1000,1000,1000&newDatasetName=Output"
            ),
            None,
            "infer_mitochondria",
        ),
        (
            format!("/jobs/run/alignSections/{id}"),
            Some(
                json!({"layerName":"segmentation","newDatasetName":"Aligned","annotationId":annotation_id,"customConfiguration":{"key":true},"fineAlignmentMaxJumpSize":3}),
            ),
            "align_sections",
        ),
        (
            format!(
                "/jobs/run/materializeVolumeAnnotation/{id}?fallbackLayerName=segmentation&annotationId={annotation_id}&annotationType=Explorational&newDatasetName=Merged&outputSegmentationLayerName=merged&mergeSegments=true&includesEditableMapping=true&boundingBox=0,0,0,10,10,10"
            ),
            None,
            "materialize_volume_annotation",
        ),
        (
            format!("/jobs/run/findLargestSegmentId/{id}?layerName=segmentation"),
            None,
            "find_largest_segment_id",
        ),
        (
            format!("/jobs/run/renderAnimation/{id}"),
            Some(animation()),
            "render_animation",
        ),
    ];
    let mut responses = Vec::new();
    for (uri, body, command) in runs {
        let (status, response) = request(&application, &uri, Some(&fixture.token), body).await;
        assert_eq!(status, 200, "{command}: {response}");
        assert_eq!(response["command"], command);
        assert_eq!(response["state"], "PENDING");
        assert_eq!(response["organizationId"], fixture.organization_id);
        assert_eq!(response["args"]["dataset_id"], id);
        assert_eq!(
            response["args"]["dataset_directory_name"],
            "input_directory"
        );
        assert!(response["created"].as_i64().unwrap() > 1_000_000_000_000);
        assert!(!response.to_string().contains("secret"));
        let stored: Value =
            sqlx::query_scalar("SELECT commandArgs FROM webknossos.jobs WHERE _id=$1")
                .bind(response["id"].as_str().unwrap())
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(stored, response["args"]);
        responses.push(response);
    }
    assert_eq!(responses[0]["args"]["mag"], "2");
    assert_eq!(responses[0]["args"]["agglomerate_view"], "agg");
    assert_eq!(
        responses[1]["args"]["segmentation_layer_name"],
        "segmentation"
    );
    assert_eq!(
        responses[2]["args"]["nd_bbox"],
        json!({"topLeft":[0,1,2],"width":10,"height":20,"depth":30,"additionalAxes":[{"name":"t","bounds":[8,9],"index":1}],"axisOrder":{"x":2,"y":3,"z":4}})
    );
    assert_eq!(
        responses[2]["args"]["user_organization_base_directory"],
        "/srv/user-organization"
    );
    assert!(
        responses[2]["args"]["export_file_name"]
            .as_str()
            .unwrap()
            .ends_with("__Input Dataset__segmentation.ozx")
    );
    assert_eq!(responses[3]["costInMilliCredits"], 125);
    assert_eq!(responses[4]["costInMilliCredits"], 63);
    assert_eq!(responses[4]["args"]["annotation_id"], annotation_id);
    assert_eq!(
        responses[4]["args"]["custom_configuration"],
        json!({"key":true})
    );
    assert_eq!(responses[5]["args"]["use_zarr_streaming"], true);
    assert_eq!(
        responses[5]["args"]["organization_base_directory"],
        "/srv/user-organization"
    );
    assert_eq!(responses[7]["args"]["bounding_box"], "0,1,2,10,20,30");
    assert_eq!(responses[7]["args"]["mag_for_textures"], json!([2, 2, 2]));
    assert_eq!(counts(&db).await, (8, 3, 812));
    let reservations: Vec<(i32, String, String, Option<String>)> = sqlx::query_as("SELECT milli_credit_delta, transaction_state::text, credit_state::text, _paid_job FROM webknossos.credit_transactions WHERE milli_credit_delta < 0 ORDER BY milli_credit_delta")
        .fetch_all(&db.pool).await.unwrap();
    assert_eq!(
        reservations,
        vec![
            (
                -125,
                "Pending".into(),
                "Pending".into(),
                responses[3]["id"].as_str().map(str::to_owned)
            ),
            (
                -63,
                "Pending".into(),
                "Pending".into(),
                responses[4]["id"].as_str().map(str::to_owned)
            )
        ]
    );
    let requests = store_requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 3);
    for uri in requests {
        let parsed = url::Url::parse(&format!("http://upstream{uri}")).unwrap();
        let query: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(query["organizationId"], fixture.organization_id);
        assert_eq!(query["requireLocal"], "true");
        assert_eq!(query["requireAllowsUpload"], "false");
        assert_eq!(query["token"], "submission-rpc-secret");
    }
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn failed_paid_submission_refunds_expected_failures_and_rolls_back_database_errors() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed(&db, &fixture, "http://unused.invalid").await;
    let uri = format!(
        "/jobs/run/inferMitochondria/{id}?layerName=segmentation&bbox=0,0,0,1000,1000,1000&newDatasetName=Output"
    );
    let application = app(&db, true);
    let (status, body) = request(&application, &uri, Some(&fixture.token), None).await;
    assert_eq!(status, 400, "{body}");
    assert!(body.to_string().contains("credits"));
    assert_eq!(counts(&db).await, (0, 0, 0));
    grant(&db, &fixture.organization_id, 200).await;
    sqlx::query("UPDATE webknossos.datasets SET isPublic=true WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.users SET isAdmin=false WHERE _id=$1")
        .bind(&fixture.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = request(&application, &uri, Some(&fixture.token), None).await;
    assert_eq!(status, 400, "{body}");
    assert!(
        body.to_string()
            .contains("Administrators, Dataset Managers or Team Managers")
    );
    assert_eq!(counts(&db).await, (0, 1, 200));
    sqlx::query("UPDATE webknossos.users SET isDatasetManager=true WHERE _id=$1")
        .bind(&fixture.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    for (index, sql) in [
        "UPDATE webknossos.workers SET isDeleted=true",
        "UPDATE webknossos.workers SET isDeleted=false, supportedJobCommands=ARRAY['compute_mesh_file']",
    ].into_iter().enumerate() {
        sqlx::query(sql).execute(&db.pool).await.unwrap();
        let (status, body) = request(&application, &uri, Some(&fixture.token), None).await;
        assert_eq!(status, 400, "{body}");
        assert!(body.to_string().contains("Could not submit job."));
        assert_eq!(counts(&db).await, (0, 3 + index as i64 * 2, 200));
    }
    sqlx::query("UPDATE webknossos.workers SET supportedJobCommands=ARRAY['infer_mitochondria']")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = request(&app(&db, false), &uri, Some(&fixture.token), None).await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(counts(&db).await, (0, 7, 200));
    let refunds: Vec<RefundPair> = sqlx::query_as(
        "SELECT r.milli_credit_delta AS refund_delta,p.milli_credit_delta AS reservation_delta,p.transaction_state::text AS reservation_state,p.credit_state::text AS reservation_credit_state,p._paid_job AS reservation_job,r._paid_job AS refund_job FROM webknossos.credit_transactions r JOIN webknossos.credit_transactions p ON p._id=r._related_transaction WHERE r.credit_state='Refunding'",
    ).fetch_all(&db.pool).await.unwrap();
    assert_eq!(refunds.len(), 3);
    for refund in refunds {
        assert_eq!(refund.refund_delta, 125);
        assert_eq!(refund.reservation_delta, -125);
        assert_eq!(refund.reservation_state, "Complete");
        assert_eq!(refund.reservation_credit_state, "Refunded");
        assert!(refund.reservation_job.is_none());
        assert!(refund.refund_job.is_none());
    }
    let comments_match: bool = sqlx::query_scalar("SELECT bool_and(comment = 'Refund for transaction ' || _related_transaction || '.') FROM webknossos.credit_transactions WHERE credit_state='Refunding'")
        .fetch_one(&db.pool).await.unwrap();
    assert!(comments_match);
    // A job insert constraint error is unexpected; its preceding reservation must roll back.
    sqlx::raw_sql("CREATE FUNCTION webknossos.reject_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test insertion failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER reject_test_job BEFORE INSERT ON webknossos.jobs FOR EACH ROW EXECUTE FUNCTION webknossos.reject_test_job();")
        .execute(&db.pool).await.unwrap();
    let (status, body) = request(&application, &uri, Some(&fixture.token), None).await;
    assert_eq!(status, 400, "{body}");
    assert!(!body.to_string().contains("test insertion failure"));
    assert_eq!(counts(&db).await, (0, 7, 200));
    sqlx::query("DROP TRIGGER reject_test_job ON webknossos.jobs")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = request(&application, &uri, Some(&fixture.token), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(counts(&db).await, (1, 8, 75));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn storage_limit_applies_to_writing_jobs_and_counts_mags_and_attachments() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed(&db, &fixture, "http://unused.invalid").await;
    grant(&db, &fixture.organization_id, 200).await;
    sqlx::query("UPDATE webknossos.organizations SET includedStorage=100 WHERE _id=$1")
        .bind(&fixture.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedStorage_mags (_dataset,layerName,mag,path,_organization,usedStorageBytes) VALUES ($1,'segmentation',ROW(2,2,2)::webknossos.VECTOR3,'mag',$2,50)")
        .bind(&id).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) VALUES ($1,'segmentation','mesh','mesh','mesh','hdf5')")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedStorage_attachments (_dataset,layerName,name,path,type,_organization,usedStorageBytes) VALUES ($1,'segmentation','mesh','mesh','mesh',$2,51)")
        .bind(&id).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    let application = app(&db, true);
    for uri in [
        format!("/jobs/run/computeMeshFile/{id}?layerName=segmentation&mag=2"),
        format!(
            "/jobs/run/inferMitochondria/{id}?layerName=segmentation&bbox=0,0,0,1000,1000,1000&newDatasetName=Output"
        ),
    ] {
        let (status, body) = request(&application, &uri, Some(&fixture.token), None).await;
        assert_eq!(status, 403, "{body}");
        assert!(body.to_string().contains("storage quota"));
        assert_eq!(counts(&db).await, (0, 1, 200));
    }
    let uri = format!("/jobs/run/findLargestSegmentId/{id}?layerName=segmentation");
    assert_eq!(
        request(&application, &uri, Some(&fixture.token), None)
            .await
            .0,
        200
    );
    sqlx::query("UPDATE webknossos.organization_usedStorage_attachments SET usedStorageBytes=50")
        .execute(&db.pool)
        .await
        .unwrap();
    let uri = format!("/jobs/run/computeMeshFile/{id}?layerName=segmentation&mag=2");
    let (status, body) = request(&application, &uri, Some(&fixture.token), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(counts(&db).await, (2, 1, 200));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn concurrent_paid_jobs_cannot_overspend_the_organization_balance() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed(&db, &fixture, "http://unused.invalid").await;
    grant(&db, &fixture.organization_id, 125).await;
    let application = app(&db, true);
    let uri = format!(
        "/jobs/run/inferMitochondria/{id}?layerName=segmentation&bbox=0,0,0,1000,1000,1000&newDatasetName=Output"
    );
    let (first, second) = tokio::join!(
        request(&application, &uri, Some(&fixture.token), None),
        request(&application, &uri, Some(&fixture.token), None)
    );
    assert_eq!(
        usize::from(first.0 == 200) + usize::from(second.0 == 200),
        1,
        "{first:?}, {second:?}"
    );
    assert!([400, 409].contains(&if first.0 == 200 { second.0 } else { first.0 }));
    assert_eq!(counts(&db).await, (1, 2, 0));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn access_body_and_plan_validation_precede_submission_and_remote_calls() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let (base, store_requests, server) = upstream().await;
    let id = seed(&db, &fixture, &base).await;
    sqlx::query("UPDATE webknossos.organizations SET pricingPlan='Personal' WHERE _id=$1")
        .bind(&fixture.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let application = app(&db, true);
    let uri = format!("/jobs/run/computeMeshFile/{id}?layerName=segmentation&mag=2");
    assert_eq!(request(&application, &uri, None, None).await.0, 401);
    let stranger = db
        .seed_user(&object_id(), "another-organization", true)
        .await;
    assert_eq!(
        request(&application, &uri, Some(&stranger.token), None)
            .await
            .0,
        404
    );
    sqlx::query("UPDATE webknossos.datasets SET isPublic=true WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&application, &uri, Some(&stranger.token), None)
            .await
            .0,
        403
    );
    let invalid_layer = format!("/jobs/run/computeSegmentIndexFile/{id}?layerName=invalid%2Flayer");
    assert_eq!(
        request(&application, &invalid_layer, Some(&fixture.token), None)
            .await
            .0,
        400
    );
    let uri = format!("/jobs/run/alignSections/{id}");
    assert_eq!(
        request(
            &application,
            &uri,
            None,
            Some(json!({"layerName":"segmentation"}))
        )
        .await
        .0,
        400
    );
    let uri = format!("/jobs/run/exportTiff/{id}?bbox=0,0,0,10,10,10&exportFormat=invalid");
    assert_eq!(
        request(&application, &uri, Some(&fixture.token), None)
            .await
            .0,
        400
    );
    let uri = format!("/jobs/run/exportTiff/{id}?bbox=0,0,0,10,10,10&mag=0&exportFormat=ozx");
    assert_eq!(
        request(&application, &uri, Some(&fixture.token), None)
            .await
            .0,
        400
    );
    let uri = format!("/jobs/run/renderAnimation/{id}");
    for (field, value, status) in [
        ("includeWatermark", json!(false), 400),
        ("movieResolution", json!("HD"), 400),
        ("saveBlenderFile", json!(true), 403),
    ] {
        let mut body = animation();
        body[field] = value;
        let response = request(&application, &uri, Some(&fixture.token), Some(body)).await;
        assert_eq!(response.0, status, "{response:?}");
    }
    assert_eq!(counts(&db).await, (0, 0, 0));
    assert!(store_requests.lock().unwrap().is_empty());
    // Export and animation may read accessible public datasets of another organization.
    let export_uri = format!("/jobs/run/exportTiff/{id}?bbox=0,0,0,10,10,10&exportFormat=ome_tiff");
    let response = request(&application, &export_uri, Some(&stranger.token), None).await;
    assert_eq!(response.0, 200, "{response:?}");
    assert_eq!(response.1["organizationId"], stranger.organization_id);
    assert_eq!(
        response.1["args"]["organization_id"],
        fixture.organization_id
    );
    let remote_uri = store_requests.lock().unwrap()[0].clone();
    assert!(remote_uri.contains("organizationId=another-organization"));
    server.abort();
    db.cleanup().await;
}
