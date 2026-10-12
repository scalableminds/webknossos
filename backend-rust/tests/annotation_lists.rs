mod common;
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use common::{Fixture, TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, router};
async fn request(app: &Router, token: &str, path: &str) -> (StatusCode, HeaderMap, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .header("x-auth-token", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, headers, serde_json::from_slice(&bytes).unwrap())
}
async fn dataset(db: &TestDb, f: &Fixture) -> String {
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datastores(name,url,publicurl,key) VALUES('annotation-lists','http://localhost:9000','https://data.example.test','private-datastore-key')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingstores(name,url,publicurl,key) VALUES('tracing','http://localhost:9001','https://tracing.example.test','private-tracing-key')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey) SELECT $1,'annotation-lists',_id,_rootfolder,'Dataset name','directory',now() FROM webknossos.organizations WHERE _id=$2").bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    dataset
}
async fn annotation(
    db: &TestDb,
    dataset: &str,
    user: &str,
    id: &str,
    state: &str,
    visibility: &str,
    layers: bool,
) {
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,state,visibility,name,description,tags,created,modified) VALUES($1,$2,$3,'Explorational',$4::webknossos.annotation_state,$5::webknossos.annotation_visibility,'Annotation','Description',ARRAY['tag','Dataset name'],TIMESTAMPTZ '2020-01-01T00:00:00Z',TIMESTAMPTZ '2020-01-02T00:00:00Z')")
        .bind(id).bind(dataset).bind(user).bind(state).bind(visibility).execute(&db.pool).await.unwrap();
    if layers {
        sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{\"treeCount\":2}'::jsonb)").bind(id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    }
}
async fn member(db: &TestDb, f: &Fixture, manager: bool) -> common::UserFixture {
    let user = db.seed_user(&object_id(), &f.organization_id, false).await;
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,$3)",
    )
    .bind(&user.user_id)
    .bind(&f.team_id)
    .bind(manager)
    .execute(&db.pool)
    .await
    .unwrap();
    user
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compact_annotations_preserve_privacy_order_state_count_and_shared_dataset_access() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dataset = dataset(&db, &f).await;
    let owner = member(&db, &f, false).await;
    let peer = member(&db, &f, false).await;
    let active = "100000000000000000000001";
    let finished = "100000000000000000000002";
    let no_layers = "100000000000000000000003";
    annotation(
        &db,
        &dataset,
        &owner.user_id,
        active,
        "Active",
        "Private",
        true,
    )
    .await;
    annotation(
        &db,
        &dataset,
        &owner.user_id,
        finished,
        "Finished",
        "Internal",
        true,
    )
    .await;
    annotation(
        &db,
        &dataset,
        &owner.user_id,
        no_layers,
        "Active",
        "Internal",
        false,
    )
    .await;
    let public = "100000000000000000000004";
    annotation(&db, &dataset, &f.user_id, public, "Active", "Public", true).await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let (status, headers, values) = request(
        &app,
        &owner.token,
        "/api/user/annotations?limit=1&includeTotalCount=true",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{values}");
    assert_eq!(headers["X-Total-Count"], "3");
    assert_eq!(values[0]["id"], finished);
    let value = &values[0];
    assert_eq!(
        value["owner"],
        json!({"id":owner.user_id,"firstName":"Rust","lastName":"Test"})
    );
    assert!(value.get("user").is_none());
    assert!(value.get("task").is_none());
    assert!(value.get("restrictions").is_none());
    assert!(value.get("dataStore").is_none());
    assert_eq!(value["tracingTime"], 0);
    assert_eq!(value["created"], 1577836800000_i64);
    assert_eq!(value["modified"], 1577923200000_i64);
    assert_eq!(value["tags"], json!(["Dataset name", "tag"]));
    assert_eq!(
        value["annotationLayers"][0]["stats"],
        json!({"treeCount":2})
    );
    assert_eq!(value["dataSetName"], "Dataset name");
    assert_eq!(value["organization"], f.organization_id);
    assert_eq!(
        request(
            &app,
            &owner.token,
            "/api/user/annotations?limit=1&pageNumber=1"
        )
        .await
        .2[0]["id"],
        active
    );
    assert_eq!(
        request(
            &app,
            &owner.token,
            "/api/user/annotations?isFinished=false&includeTotalCount=true"
        )
        .await
        .1["X-Total-Count"],
        "2"
    );
    assert_eq!(
        request(&app, &owner.token, "/api/user/annotations?isFinished=true")
            .await
            .2[0]["id"],
        finished
    );
    assert_eq!(
        request(
            &app,
            &peer.token,
            "/api/annotations/readable?includeTotalCount=true"
        )
        .await
        .2,
        json!([])
    ); // Public alone does not make an annotation listable.
    sqlx::query(
        "INSERT INTO webknossos.annotation_sharedTeams(_annotation,_team) VALUES($1,$3),($2,$3)",
    )
    .bind(finished)
    .bind(active)
    .bind(&f.team_id)
    .execute(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        request(&app, &peer.token, "/api/annotations/readable")
            .await
            .2,
        json!([])
    ); // Sharing also requires dataset access.
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (_, headers, shared) = request(
        &app,
        &peer.token,
        "/api/annotations/readable?includeTotalCount=true",
    )
    .await;
    assert_eq!(headers["X-Total-Count"], "1");
    assert_eq!(shared[0]["id"], finished);
    assert_eq!(
        shared[0]["teams"][0],
        json!({"id":f.team_id,"name":"Test team","organizationId":f.organization_id})
    );
    assert_eq!(
        request(
            &app,
            &peer.token,
            &format!("/api/annotations/readable?datasetId={}", object_id())
        )
        .await
        .2,
        json!([])
    );
    sqlx::query("INSERT INTO webknossos.annotation_contributors(_annotation,_user) VALUES($1,$2)")
        .bind(public)
        .bind(&peer.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &peer.token, "/api/annotations/readable")
            .await
            .2
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        request(&app, &peer.token, "/api/user/annotations").await.2,
        json!([])
    ); // The own route has its own owner filter.
    assert_eq!(
        request(
            &app,
            &owner.token,
            &format!("/api/user/annotations?datasetId={}", object_id())
        )
        .await
        .2
        .as_array()
        .unwrap()
        .len(),
        2
    ); // Unsupported extra query parameters are ignored.
    assert_eq!(
        request(&app, &owner.token, "/api/user/annotations?limit=-1")
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn other_user_annotations_require_user_edit_access_and_annotation_read_access() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dataset = dataset(&db, &f).await;
    let owner = member(&db, &f, false).await;
    let manager = member(&db, &f, true).await;
    let outsider = db.seed_user(&object_id(), &f.organization_id, false).await;
    let foreign = db.fixture().await;
    annotation(
        &db,
        &dataset,
        &owner.user_id,
        "200000000000000000000001",
        "Active",
        "Private",
        true,
    )
    .await;
    annotation(
        &db,
        &dataset,
        &owner.user_id,
        "200000000000000000000002",
        "Active",
        "Internal",
        true,
    )
    .await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let path = format!(
        "/api/users/{}/annotations?includeTotalCount=true",
        owner.user_id
    );
    assert_eq!(
        request(&app, &outsider.token, &path).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, &foreign.token, &path).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, &owner.token, &path).await.0,
        StatusCode::FORBIDDEN
    ); // self plus membership is not UserService.isEditableBy.
    let (status, headers, values) = request(&app, &manager.token, &path).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["X-Total-Count"], "1");
    assert_eq!(values[0]["visibility"], "Internal");
    assert_eq!(values[0]["owner"].as_object().unwrap().len(), 3);
    assert_eq!(
        request(&app, &f.token, &path)
            .await
            .2
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        request(
            &app,
            &manager.token,
            &format!("/api/users/{}/tasks", owner.user_id)
        )
        .await
        .2,
        json!([])
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn task_annotation_lists_emit_complete_database_contract_and_respect_route_permissions() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dataset = dataset(&db, &f).await;
    let owner = member(&db, &f, false).await;
    let manager = member(&db, &f, true).await;
    let contributor = member(&db, &f, false).await;
    let project = object_id();
    let task_type = object_id();
    let task = object_id();
    let base = object_id();
    let active = "300000000000000000000001";
    let finished = "300000000000000000000002";
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Project')").bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Type','Instructions',true,true)").bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation) VALUES($1,$2,$3,'test',0,3,3,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)").bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ) VALUES($1,$2,$3,$4,'TracingBase')").bind(&base).bind(&dataset).bind(&task).bind(&f.user_id).execute(&db.pool).await.unwrap();
    for (id, state) in [(active, "Active"), (finished, "Finished")] {
        sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,state,visibility,name,tags) VALUES($1,$2,$3,$4,'Task',$5::webknossos.annotation_state,'Internal','Task annotation',ARRAY['tag'])").bind(id).bind(&dataset).bind(&task).bind(&owner.user_id).bind(state).execute(&db.pool).await.unwrap();
        sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{\"treeCount\":1}'::jsonb)").bind(id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    }
    sqlx::query("INSERT INTO webknossos.user_annotationViewConfigurations(_annotation,_user,viewConfiguration) VALUES($1,$2,'{\"zoom\":1}'::jsonb),($1,$3,'{\"zoom\":2}'::jsonb)").bind(active).bind(&owner.user_id).bind(&manager.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_contributors(_annotation,_user) VALUES($1,$2)")
        .bind(active)
        .bind(&contributor.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let foreign = db.fixture().await;
    let deleted_team = object_id();
    sqlx::query("INSERT INTO webknossos.teams(_id,_organization,name,isDeleted) VALUES($1,$2,'Deleted-team',true)").bind(&deleted_team).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    for user in [&owner.user_id, &contributor.user_id] {
        sqlx::query("INSERT INTO webknossos.user_team_roles(_user,_team) VALUES($1,$2),($1,$3)")
            .bind(user)
            .bind(&foreign.team_id)
            .bind(&deleted_team)
            .execute(&db.pool)
            .await
            .unwrap();
    }
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let (status, headers, values) = request(
        &app,
        &owner.token,
        "/api/user/tasks?limit=1&includeTotalCount=true",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{values}");
    assert_eq!(headers["X-Total-Count"], "2");
    assert_eq!(values[0]["id"], finished);
    let (_, _, values) = request(&app, &owner.token, "/api/user/tasks?isFinished=false").await;
    let value = &values[0];
    assert_eq!(value["id"], active);
    assert_eq!(value["task"]["id"], task);
    assert_eq!(
        value["task"]["status"],
        json!({"pending":1,"active":1,"finished":1})
    );
    assert_eq!(value["task"]["datasetId"], dataset);
    assert_eq!(value["owner"]["id"], owner.user_id);
    assert_eq!(value["owner"], value["user"]);
    assert_eq!(value["owner"]["teams"].as_array().unwrap().len(), 1);
    assert_eq!(value["owner"]["teams"][0]["id"], f.team_id);
    assert_eq!(
        value["contributors"][0]["teams"].as_array().unwrap().len(),
        1
    );
    assert_eq!(value["contributors"][0]["teams"][0]["id"], f.team_id);
    assert!(value["owner"]["email"].is_string());
    assert_eq!(value["contributors"][0]["id"], contributor.user_id);
    assert_eq!(value["viewConfiguration"], json!({"zoom":1}));
    assert_eq!(
        value["restrictions"],
        json!({"allowAccess":true,"allowUpdate":true,"allowFinish":true,"allowDownload":true})
    );
    assert_eq!(
        value["dataStore"],
        json!({"name":"annotation-lists","url":"https://data.example.test","allowsUpload":true,"jobsEnabled":false,"jobsSupportedByAvailableWorkers":[]})
    );
    assert_eq!(
        value["tracingStore"],
        json!({"name":"tracing","url":"https://tracing.example.test"})
    );
    assert!(value["tracingTime"].is_null());
    assert!(!value.to_string().contains("private-datastore-key"));
    let path = format!("/api/tasks/{task}/annotations");
    assert_eq!(
        request(&app, &owner.token, &path).await.0,
        StatusCode::FORBIDDEN
    );
    let (status, _, values) = request(&app, &manager.token, &path).await;
    assert_eq!(status, StatusCode::OK, "{values}");
    assert_eq!(values.as_array().unwrap().len(), 2);
    let value = values
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["id"] == active)
        .unwrap();
    assert_eq!(value["viewConfiguration"], json!({"zoom":2}));
    assert_eq!(value["restrictions"]["allowUpdate"], false);
    assert_eq!(value["restrictions"]["allowFinish"], true);
    sqlx::query("UPDATE webknossos.annotations SET visibility='Private' WHERE _id=$1")
        .bind(active)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &manager.token, &path)
            .await
            .2
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        request(&app, &f.token, &path)
            .await
            .2
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let user_path = format!(
        "/api/users/{}/tasks?isFinished=false&includeTotalCount=true",
        owner.user_id
    );
    assert_eq!(request(&app, &manager.token, &user_path).await.2, json!([]));
    assert_eq!(request(&app, &f.token, &user_path).await.2[0]["id"], active);
    db.cleanup().await;
}
