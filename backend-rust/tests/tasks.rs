mod common;

use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use common::{Fixture, TestDb, UserFixture, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, router};

async fn request(
    app: &Router,
    token: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, HeaderMap, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("x-auth-token", token)
                .header("content-type", "application/json")
                .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, headers, serde_json::from_slice(&bytes).unwrap())
}
struct Tasks {
    project: String,
    task_type: String,
    dataset: String,
    task: String,
    base: String,
    script: String,
}
async fn seed(db: &TestDb, f: &Fixture) -> Tasks {
    let tasks = Tasks {
        project: object_id(),
        task_type: object_id(),
        dataset: object_id(),
        task: object_id(),
        base: object_id(),
        script: object_id(),
    };
    sqlx::query("INSERT INTO webknossos.datastores(name,url,publicurl,key) VALUES('task-tests','http://localhost:9000','http://localhost:9000','key')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey) SELECT $1,'task-tests',_id,_rootfolder,'Dataset','tasks',now() FROM webknossos.organizations WHERE _id=$2")
        .bind(&tasks.dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedteams(_dataset,_team) VALUES($1,$2)")
        .bind(&tasks.dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name,priority) VALUES($1,$2,$3,$4,'Project',100)")
        .bind(&tasks.project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_allowedmodes,settings_preferredmode,settings_branchpointsallowed,settings_somaclickingallowed,tracingtype) VALUES($1,$2,$3,'Type','Instructions',ARRAY['orthogonal']::webknossos.tasktype_modes[],'orthogonal',true,true,'skeleton')")
        .bind(&tasks.task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.scripts(_id,_owner,name,gist) VALUES($1,$2,'Script','https://example.test/script')")
        .bind(&tasks.script).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,_script,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,tracingtime,boundingbox,editposition,editrotation,creationinfo,created) VALUES($1,$2,$3,$4,'test',2,4,4,123,ROW(1,2,3,4,5,6)::webknossos.bounding_box,ROW(7,8,9)::webknossos.vector3,ROW(0.1,0.2,0.3)::webknossos.vector3,'import',TIMESTAMPTZ '2020-01-01T00:00:00Z')")
        .bind(&tasks.task).bind(&tasks.project).bind(&tasks.task_type).bind(&tasks.script).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,state) VALUES($1,$2,$3,$4,'TracingBase','Finished')")
        .bind(&tasks.base).bind(&tasks.dataset).bind(&tasks.task).bind(&f.user_id).execute(&db.pool).await.unwrap();
    tasks
}
async fn team_user(db: &TestDb, f: &Fixture, manager: bool) -> UserFixture {
    let user = db.seed_user(&object_id(), &f.organization_id, false).await;
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user,_team,isteammanager) VALUES($1,$2,$3)",
    )
    .bind(&user.user_id)
    .bind(&f.team_id)
    .bind(manager)
    .execute(&db.pool)
    .await
    .unwrap();
    user
}
async fn annotation(db: &TestDb, t: &Tasks, user: &str, state: &str, visibility: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,state,visibility) VALUES($1,$2,$3,$4,'Task',$5::webknossos.annotation_state,$6::webknossos.annotation_visibility)")
        .bind(&id).bind(&t.dataset).bind(&t.task).bind(user).bind(state).bind(visibility).execute(&db.pool).await.unwrap();
    id
}
fn update_parameters(t: &Tasks, pending: i32) -> Value {
    json!({"taskTypeId":t.task_type,"neededExperience":{"domain":"changed","value":99},"pendingInstances":pending,"projectName":"Changed","datasetId":t.dataset,"editPosition":[100,200,300],"editRotation":[0,0,0],"creationInfo":"changed"})
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn task_public_contract_preserves_annotation_dataset_and_script_access() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let t = seed(&db, &f).await;
    let member = team_user(&db, &f, false).await;
    let outsider = db.seed_user(&object_id(), &f.organization_id, false).await;
    annotation(&db, &t, &f.user_id, "Active", "Private").await;
    annotation(&db, &t, &f.user_id, "Finished", "Internal").await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let path = format!("/api/tasks/{}", t.task);
    let (status, _, value) = request(&app, &member.token, "GET", &path, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["id"], t.task);
    assert_eq!(value["projectId"], t.project);
    assert_eq!(value["projectName"], "Project");
    assert_eq!(value["team"], "Test team");
    assert_eq!(value["datasetId"], t.dataset);
    assert_eq!(value["datasetName"], "Dataset");
    assert_eq!(value["type"]["id"], t.task_type);
    assert_eq!(
        value["type"]["settings"]["allowedModes"],
        json!(["orthogonal"])
    );
    assert_eq!(value["script"]["id"], t.script);
    assert_eq!(
        value["script"]["owner"]["email"],
        format!("{}@example.test", f.multi_user_id)
    );
    assert_eq!(value["created"], 1577836800000_i64);
    assert_eq!(
        value["status"],
        json!({"pending":2,"active":0,"finished":2})
    );
    assert_eq!(
        value["boundingBox"],
        json!({"topLeft":[1,2,3],"width":4,"height":5,"depth":6})
    );
    assert_eq!(value["editPosition"], json!([7, 8, 9]));
    assert_eq!(value["editRotation"], json!([0.1, 0.2, 0.3]));
    assert_eq!(value["tracingTime"], 123);
    assert_eq!(value["creationInfo"], "import");
    assert!(value.get("totalInstances").is_none());
    assert_eq!(
        request(&app, &f.token, "GET", &path, None).await.2["status"],
        json!({"pending":2,"active":1,"finished":1})
    );
    assert_eq!(
        request(&app, &outsider.token, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.annotations SET visibility='Private' WHERE _id=$1")
        .bind(&t.base)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &member.token, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.annotations SET visibility='Internal' WHERE _id=$1")
        .bind(&t.base)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM webknossos.dataset_allowedteams WHERE _dataset=$1")
        .bind(&t.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &member.token, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.datasets SET ispublic=true WHERE _id=$1")
        .bind(&t.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.scripts SET isdeleted=true WHERE _id=$1")
        .bind(&t.script)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &member.token, "GET", &path, None).await.2["script"],
        Value::Null
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn task_lists_obey_management_filters_pagination_and_organization_domains() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let t = seed(&db, &f).await;
    let member = team_user(&db, &f, false).await;
    let manager = team_user(&db, &f, true).await;
    let foreign = db.fixture().await;
    annotation(&db, &t, &member.user_id, "Active", "Internal").await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    assert_eq!(
        request(
            &app,
            &member.token,
            "POST",
            "/api/tasks/list",
            Some(json!({}))
        )
        .await
        .2,
        json!([])
    );
    assert_eq!(
        request(
            &app,
            &manager.token,
            "POST",
            "/api/tasks/list",
            Some(json!({}))
        )
        .await
        .2[0]["id"],
        t.task
    );
    assert_eq!(
        request(
            &app,
            &foreign.token,
            "POST",
            "/api/tasks/list",
            Some(json!({}))
        )
        .await
        .2,
        json!([])
    );
    assert_eq!(
        request(
            &app,
            &manager.token,
            "POST",
            "/api/tasks/list",
            Some(json!({"ids":[]}))
        )
        .await
        .2,
        json!([])
    );
    assert_eq!(request(&app,&manager.token,"POST","/api/tasks/list",Some(json!({"project":t.project,"taskType":t.task_type,"ids":[t.task],"user":member.user_id,"random":true}))).await.2[0]["id"],t.task);
    assert_eq!(
        request(
            &app,
            &manager.token,
            "POST",
            "/api/tasks/list",
            Some(json!({"user":f.user_id}))
        )
        .await
        .2,
        json!([])
    );
    assert_eq!(
        request(
            &app,
            &manager.token,
            "GET",
            &format!("/api/taskTypes/{}/tasks", t.task_type),
            None
        )
        .await
        .2[0]["id"],
        t.task
    );
    assert_eq!(
        request(
            &app,
            &manager.token,
            "GET",
            &format!("/api/taskTypes/{}/tasks", object_id()),
            None
        )
        .await
        .2,
        json!([])
    );
    let path = format!(
        "/api/projects/{}/tasks?limit=1&pageNumber=0&includeTotalCount=true",
        t.project
    );
    let (status, headers, values) = request(&app, &manager.token, "GET", &path, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["X-Total-Count"], "1");
    // The handler must not acquire another connection while holding the only one.
    let single_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&db.connection_url())
        .await
        .unwrap();
    let single_app = router(AppState {
        pool: single_pool.clone(),
    });
    let single = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        request(&single_app, &manager.token, "GET", &path, None),
    )
    .await
    .expect("project task listing must work with one connection");
    assert_eq!(single.0, StatusCode::OK);
    single_pool.close().await;
    assert_eq!(values[0]["id"], t.task);
    assert_eq!(
        request(&app, &member.token, "GET", &path, None).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&app, &foreign.token, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &app,
            &manager.token,
            "GET",
            &format!("/api/projects/{}/tasks?limit=1&pageNumber=1", t.project),
            None
        )
        .await
        .2,
        json!([])
    );
    assert_eq!(
        request(
            &app,
            &manager.token,
            "GET",
            &format!("/api/projects/{}/tasks?limit=-1", t.project),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    sqlx::query("INSERT INTO webknossos.experiencedomains(domain,_organization) VALUES('test',$1),('foreign',$2)").bind(&f.organization_id).bind(&foreign.organization_id).execute(&db.pool).await.unwrap();
    assert_eq!(
        request(
            &app,
            &manager.token,
            "GET",
            "/api/tasks/experienceDomains",
            None
        )
        .await
        .2,
        json!(["test"])
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn task_updates_are_atomic_and_delete_cascades_through_counter_triggers() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let t = seed(&db, &f).await;
    let member = team_user(&db, &f, false).await;
    let manager = team_user(&db, &f, true).await;
    let active = annotation(&db, &t, &member.user_id, "Active", "Internal").await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let path = format!("/api/tasks/{}", t.task);
    assert_eq!(
        request(
            &app,
            &member.token,
            "PUT",
            &path,
            Some(update_parameters(&t, 6))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &app,
            &manager.token,
            "PUT",
            &path,
            Some(json!({"pendingInstances":6}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, _, value) = request(
        &app,
        &manager.token,
        "PUT",
        &path,
        Some(update_parameters(&t, 6)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value["status"],
        json!({"pending":6,"active":1,"finished":0})
    );
    assert_eq!(
        value["neededExperience"],
        json!({"domain":"test","value":2})
    );
    assert_eq!(value["projectName"], "Project");
    assert_eq!(value["editPosition"], json!([7, 8, 9]));
    assert_eq!(value["creationInfo"], "import");
    assert_eq!(value["messages"], json!([{"success":"task.editSuccess"}]));
    assert_eq!(
        request(
            &app,
            &manager.token,
            "PUT",
            &path,
            Some(update_parameters(&t, -1))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(&app, &manager.token, "GET", &path, None).await.2["status"]["pending"],
        6
    );
    // Concurrent absolute pending updates must preserve the consumed instance.
    let (first, second) = tokio::join!(
        request(
            &app,
            &manager.token,
            "PUT",
            &path,
            Some(update_parameters(&t, 5))
        ),
        request(
            &app,
            &manager.token,
            "PUT",
            &path,
            Some(update_parameters(&t, 8))
        )
    );
    assert_eq!(first.0, StatusCode::OK);
    assert_eq!(second.0, StatusCode::OK);
    let (total, pending): (i64, i64) =
        sqlx::query_as("SELECT totalinstances,pendinginstances FROM webknossos.tasks WHERE _id=$1")
            .bind(&t.task)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(total - pending, 1);
    assert!([5, 8].contains(&pending));
    assert_eq!(
        request(&app, &member.token, "DELETE", &path, None).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&app, &manager.token, "DELETE", &path, None).await.0,
        StatusCode::OK
    );
    let (deleted, pending_after): (bool, i64) =
        sqlx::query_as("SELECT isdeleted,pendinginstances FROM webknossos.tasks WHERE _id=$1")
            .bind(&t.task)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(deleted);
    assert_eq!(pending_after, pending + 1);
    for id in [t.base, active] {
        assert!(
            sqlx::query_scalar::<_, bool>(
                "SELECT isdeleted FROM webknossos.annotations WHERE _id=$1"
            )
            .bind(id)
            .fetch_one(&db.pool)
            .await
            .unwrap()
        );
    }
    assert_eq!(
        request(&app, &manager.token, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn task_peek_uses_experience_membership_priority_and_cancellation_rules() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let t = seed(&db, &f).await;
    let member = team_user(&db, &f, false).await;
    let manager = team_user(&db, &f, true).await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let path = "/api/user/tasks/peek";
    assert_eq!(
        request(&app, &member.token, "GET", path, None).await.0,
        StatusCode::BAD_REQUEST
    );
    sqlx::query("INSERT INTO webknossos.user_experiences(_user,domain,value) VALUES($1,'test',2),($2,'test',2),($3,'test',2)").bind(&member.user_id).bind(&manager.user_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    assert_eq!(
        request(&app, &f.token, "GET", path, None).await.0,
        StatusCode::BAD_REQUEST
    ); // Admin also needs team membership for peek.
    // peek serializes with GlobalAccessContext, even when base or dataset is private.
    sqlx::query("UPDATE webknossos.annotations SET visibility='Private' WHERE _id=$1")
        .bind(&t.base)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM webknossos.dataset_allowedteams WHERE _dataset=$1")
        .bind(&t.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM webknossos.annotations")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &member.token, "GET", path, None).await.2["id"],
        t.task
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM webknossos.annotations")
            .fetch_one(&db.pool)
            .await
            .unwrap(),
        before
    );
    annotation(&db, &t, &member.user_id, "Cancelled", "Internal").await;
    annotation(&db, &t, &manager.user_id, "Cancelled", "Internal").await;
    assert_eq!(
        request(&app, &member.token, "GET", path, None).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(&app, &manager.token, "GET", path, None).await.2["id"],
        t.task
    );
    sqlx::query("UPDATE webknossos.projects SET paused=true WHERE _id=$1")
        .bind(&t.project)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &manager.token, "GET", path, None).await.0,
        StatusCode::BAD_REQUEST
    );
    sqlx::query("UPDATE webknossos.projects SET paused=false WHERE _id=$1")
        .bind(&t.project)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.user_experiences SET value=1 WHERE _user=$1")
        .bind(&manager.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &manager.token, "GET", path, None).await.0,
        StatusCode::BAD_REQUEST
    );
    let foreign = db.fixture().await;
    let foreign_project = object_id();
    let foreign_task = object_id();
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name,priority) VALUES($1,$2,$3,$4,'Foreign',1000)")
        .bind(&foreign_project).bind(&foreign.organization_id).bind(&foreign.team_id).bind(&foreign.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation) VALUES($1,$2,$3,'test',1,1,1,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)")
        .bind(&foreign_task).bind(&foreign_project).bind(&t.task_type).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ) VALUES($1,$2,$3,$4,'TracingBase')")
        .bind(object_id()).bind(&t.dataset).bind(&foreign_task).bind(&foreign.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.user_team_roles(_user,_team) VALUES($1,$2)")
        .bind(&manager.user_id)
        .bind(&foreign.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &manager.token, "GET", path, None).await.0,
        StatusCode::BAD_REQUEST
    );
    db.cleanup().await;
}
