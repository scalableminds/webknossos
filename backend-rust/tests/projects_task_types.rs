mod common;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::{Fixture, TestDb, object_id};
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
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-auth-token", token)
        .header("content-type", "application/json")
        .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
fn project(f: &Fixture, name: &str) -> Value {
    json!({"name":name,"team":f.team_id,"owner":f.user_id,"priority":100,"isBlacklistedFromReport":false})
}
fn task_type(f: &Fixture, summary: &str) -> Value {
    json!({"summary":summary,"description":"instructions","teamId":f.team_id,"settings":{"allowedModes":["orthogonal","flight"],"preferredMode":"orthogonal"},"recommendedConfiguration":{"zoom":2},"tracingType":"skeleton"})
}
async fn seed_dependencies(
    db: &TestDb,
    f: &Fixture,
    project: &str,
    task_type: &str,
) -> (String, String) {
    let dataset = object_id();
    let task = object_id();
    let annotation = object_id();
    sqlx::query("INSERT INTO webknossos.datastores(name,url,publicurl,key) VALUES('rust-test','http://localhost:9000','http://localhost:9000','key')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey) SELECT $1,'rust-test',_id,_rootfolder,'Test dataset','test',now() FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,tracingtime,editposition,editrotation) VALUES($1,$2,$3,'test',0,2,2,99,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)")
        .bind(&task).bind(project).bind(task_type).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ) VALUES($1,$2,$3,$4,'Task')")
        .bind(&annotation).bind(dataset).bind(&task).bind(&f.user_id).execute(&db.pool).await.unwrap();
    (task, annotation)
}
async fn assert_dependencies_deleted(db: &TestDb, task: &str, annotation: &str) {
    let deleted: bool=sqlx::query_scalar("SELECT t.isdeleted AND a.isdeleted FROM webknossos.tasks t JOIN webknossos.annotations a ON a._task=t._id WHERE t._id=$1 AND a._id=$2")
        .bind(task).bind(annotation).fetch_one(&db.pool).await.unwrap();
    assert!(deleted);
}

async fn wait_for_lock(db: &TestDb, query_pattern: &str) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1)")
                .bind(query_pattern).fetch_one(&db.pool).await.unwrap();
            if waiting { break; }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }).await.expect("expected request to reach the database lock");
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn project_owner_details_obey_user_read_permissions() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let reader = db.seed_user(&object_id(), &f.organization_id, false).await;
    sqlx::query("INSERT INTO webknossos.user_team_roles (_user,_team) VALUES($1,$2)")
        .bind(&reader.user_id)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let (_, created) = request(
        &app,
        &f.token,
        "POST",
        "/api/projects",
        Some(project(&f, "Private-owner")),
    )
    .await;
    let id = created["id"].as_str().unwrap();
    let path = format!("/api/projects/{id}");
    let (status, visible) = request(&app, &reader.token, "GET", &path, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(visible["owner"], Value::Null);
    assert_eq!(
        request(&app, &reader.token, "GET", "/api/projects", None)
            .await
            .1[0]["owner"],
        Value::Null
    );
    assert_eq!(
        request(&app, &f.token, "GET", &path, None).await.1["owner"]["id"],
        f.user_id
    );
    // Being manager of the project's team is insufficient unless the owner
    // shares that team, just as UserDAO's read access requires.
    sqlx::query("UPDATE webknossos.user_team_roles SET isTeamManager=TRUE WHERE _user=$1")
        .bind(&reader.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &reader.token, "GET", &path, None).await.1["owner"],
        Value::Null
    );
    sqlx::query("INSERT INTO webknossos.user_team_roles (_user,_team) VALUES($1,$2)")
        .bind(&f.user_id)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &reader.token, "GET", &path, None).await.1["owner"]["id"],
        f.user_id
    );
    // The private representation must not affect the actual owner's deletion rights.
    sqlx::query("UPDATE webknossos.users SET isAdmin=FALSE WHERE _id=$1")
        .bind(&f.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, &f.token, "DELETE", &path, None).await.0,
        StatusCode::OK
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn project_and_type_creation_recheck_a_team_deleted_while_waiting() {
    let db = TestDb::new().await;
    for (route, table) in [
        ("/api/projects", "projects"),
        ("/api/taskTypes", "tasktypes"),
    ] {
        let f = db.fixture().await;
        let app = router(AppState {
            pool: db.pool.clone(),
        });
        let body = if table == "projects" {
            project(&f, "Blocked-project")
        } else {
            task_type(&f, "Blocked type")
        };
        let mut deleting = db.pool.begin().await.unwrap();
        sqlx::query("SELECT _id FROM webknossos.teams WHERE _id=$1 FOR UPDATE")
            .bind(&f.team_id)
            .execute(&mut *deleting)
            .await
            .unwrap();
        let token = f.token.clone();
        let creating =
            tokio::spawn(async move { request(&app, &token, "POST", route, Some(body)).await });
        wait_for_lock(&db, "%FROM webknossos.teams t%FOR SHARE%").await;
        sqlx::query("UPDATE webknossos.teams SET isDeleted=TRUE WHERE _id=$1")
            .bind(&f.team_id)
            .execute(&mut *deleting)
            .await
            .unwrap();
        deleting.commit().await.unwrap();
        assert_eq!(creating.await.unwrap().0, StatusCode::FORBIDDEN);
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM webknossos.{table} WHERE _team=$1"
        ))
        .bind(&f.team_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(count, 0);
    }
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn team_deletion_sees_references_committed_while_it_waited() {
    let db = TestDb::new().await;
    for (route, table) in [
        ("/api/projects", "projects"),
        ("/api/taskTypes", "tasktypes"),
    ] {
        let f = db.fixture().await;
        let app = router(AppState {
            pool: db.pool.clone(),
        });
        // Pause the actual INSERT after it has acquired its live-team lock.
        let trigger = format!(
            "CREATE FUNCTION webknossos.pause_{table}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(714123); RETURN NEW; END $$; CREATE TRIGGER pause_insert BEFORE INSERT ON webknossos.{table} FOR EACH ROW EXECUTE FUNCTION webknossos.pause_{table}();"
        );
        sqlx::raw_sql(&trigger).execute(&db.pool).await.unwrap();
        let mut gate = db.pool.acquire().await.unwrap();
        sqlx::query("SELECT pg_advisory_lock(714123)")
            .execute(&mut *gate)
            .await
            .unwrap();
        let body = if table == "projects" {
            project(&f, "Winning-project")
        } else {
            task_type(&f, "Winning type")
        };
        let create_app = app.clone();
        let create_token = f.token.clone();
        let creating = tokio::spawn(async move {
            request(&create_app, &create_token, "POST", route, Some(body)).await
        });
        wait_for_lock(&db, &format!("INSERT INTO webknossos.{table}%")).await;
        let delete_app = app.clone();
        let delete_token = f.token.clone();
        let path = format!("/api/teams/{}", f.team_id);
        let deleting = tokio::spawn(async move {
            request(&delete_app, &delete_token, "DELETE", &path, None).await
        });
        wait_for_lock(
            &db,
            "SELECT isOrganizationTeam FROM webknossos.teams%FOR UPDATE%",
        )
        .await;
        sqlx::query("SELECT pg_advisory_unlock(714123)")
            .execute(&mut *gate)
            .await
            .unwrap();
        drop(gate);
        let (status, value) = creating.await.unwrap();
        assert_eq!(status, StatusCode::OK, "{value}");
        let (status, value) = deleting.await.unwrap();
        assert_eq!(status, StatusCode::FORBIDDEN, "{value}");
        let deleted: bool =
            sqlx::query_scalar("SELECT isDeleted FROM webknossos.teams WHERE _id=$1")
                .bind(&f.team_id)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert!(!deleted);
    }
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn projects_crud_pause_status_and_transactional_cascade() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let (status, created) = request(
        &app,
        &f.token,
        "POST",
        "/api/projects",
        Some(project(&f, "Project-1")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let id = created["id"].as_str().unwrap();
    assert_eq!(created["teamName"], "Test team");
    assert_eq!(created["owner"]["id"], f.user_id);
    assert_eq!(created["owner"]["teams"], json!([]));
    assert_eq!(created["paused"], false);
    assert!(created["created"].is_i64());
    assert_eq!(created["expectedTime"], Value::Null);
    assert_eq!(
        request(
            &app,
            &f.token,
            "GET",
            "/api/projects/byName/Project-1",
            None
        )
        .await
        .1,
        created
    );
    assert_eq!(
        request(
            &app,
            &f.token,
            "POST",
            "/api/projects",
            Some(project(&f, "Project-1"))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(
            &app,
            &f.token,
            "POST",
            "/api/projects",
            Some(project(&f, "invalid name"))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut updated = project(&f, "ignored new name");
    updated["priority"] = json!(7);
    updated["paused"] = json!(true);
    updated["expectedTime"] = json!(500);
    let (status, value) = request(
        &app,
        &f.token,
        "PUT",
        &format!("/api/projects/{id}"),
        Some(updated),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["name"], "Project-1");
    assert_eq!(value["paused"], false);
    assert_eq!(value["priority"], 7);
    assert_eq!(value["expectedTime"], 500);
    assert_eq!(value["created"], created["created"]);
    assert_eq!(
        request(
            &app,
            &f.token,
            "PATCH",
            &format!("/api/projects/{id}/pause"),
            None
        )
        .await
        .1["paused"],
        true
    );
    assert_eq!(
        request(
            &app,
            &f.token,
            "PATCH",
            &format!("/api/projects/{id}/resume"),
            None
        )
        .await
        .1["paused"],
        false
    );
    let (_, tt) = request(
        &app,
        &f.token,
        "POST",
        "/api/taskTypes",
        Some(task_type(&f, "Type 1")),
    )
    .await;
    let (task, annotation) = seed_dependencies(&db, &f, id, tt["id"].as_str().unwrap()).await;
    let (_, status) = request(&app, &f.token, "GET", "/api/projects/withStatus", None).await;
    assert_eq!(status[0]["pendingInstances"], 1);
    assert_eq!(status[0]["tracingTime"], 99);
    let (code, increased) = request(
        &app,
        &f.token,
        "PATCH",
        &format!("/api/projects/{id}/incrementEachTasksInstances?delta=2"),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{increased}");
    assert_eq!(increased["pendingInstances"], 3);
    assert_eq!(
        request(
            &app,
            &f.token,
            "PATCH",
            &format!("/api/projects/{id}/incrementEachTasksInstances?delta=-1"),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (_, users) = request(
        &app,
        &f.token,
        "GET",
        &format!("/api/projects/{id}/usersWithActiveTasks"),
        None,
    )
    .await;
    assert_eq!(users[0]["activeTasks"], 1);
    let (_, projects) = request(
        &app,
        &f.token,
        "GET",
        &format!("/api/taskTypes/{}/projects", tt["id"].as_str().unwrap()),
        None,
    )
    .await;
    assert_eq!(projects[0]["id"], id);
    // Force the dependent write to fail, verifying no parent or annotation change
    // escapes the deletion transaction.
    sqlx::raw_sql("CREATE FUNCTION webknossos.fail_task_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.isdeleted THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_task_delete BEFORE UPDATE ON webknossos.tasks FOR EACH ROW EXECUTE FUNCTION webknossos.fail_task_delete();")
        .execute(&db.pool).await.unwrap();
    assert_eq!(
        request(
            &app,
            &f.token,
            "DELETE",
            &format!("/api/projects/{id}"),
            None
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        request(&app, &f.token, "GET", &format!("/api/projects/{id}"), None)
            .await
            .0,
        StatusCode::OK
    );
    let annotation_deleted: bool =
        sqlx::query_scalar("SELECT isdeleted FROM webknossos.annotations WHERE _id=$1")
            .bind(&annotation)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(!annotation_deleted);
    sqlx::query("DROP TRIGGER fail_task_delete ON webknossos.tasks")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &app,
            &f.token,
            "DELETE",
            &format!("/api/projects/{id}"),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_dependencies_deleted(&db, &task, &annotation).await;
    assert_eq!(
        request(&app, &f.token, "GET", &format!("/api/projects/{id}"), None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, &f.token, "GET", "/api/projects", None)
            .await
            .1,
        json!([])
    );
    assert_eq!(
        request(
            &app,
            &f.token,
            "POST",
            "/api/projects",
            Some(project(&f, "Project-1"))
        )
        .await
        .0,
        StatusCode::OK
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn task_types_crud_immutability_uniqueness_and_cascade() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let (status, created) = request(
        &app,
        &f.token,
        "POST",
        "/api/taskTypes",
        Some(task_type(&f, "Type 1")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let id = created["id"].as_str().unwrap();
    assert!(created.get("created").is_none());
    assert_eq!(created["settings"]["magRestrictions"], json!({}));
    assert_eq!(created["settings"]["volumeInterpolationAllowed"], true);
    assert_eq!(
        request(&app, &f.token, "GET", &format!("/api/taskTypes/{id}"), None)
            .await
            .1,
        created
    );
    assert_eq!(
        request(&app, &f.token, "GET", "/api/taskTypes", None)
            .await
            .1,
        json!([created])
    );
    assert_eq!(
        request(
            &app,
            &f.token,
            "POST",
            "/api/taskTypes",
            Some(task_type(&f, "Type 1"))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut changed = task_type(&f, "Type 2");
    changed["tracingType"] = json!("volume");
    assert_eq!(
        request(
            &app,
            &f.token,
            "PUT",
            &format!("/api/taskTypes/{id}"),
            Some(changed)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut changed = task_type(&f, "Type 2");
    changed["settings"]["magRestrictions"] = json!({"min":1});
    assert_eq!(
        request(
            &app,
            &f.token,
            "PUT",
            &format!("/api/taskTypes/{id}"),
            Some(changed)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut changed = task_type(&f, "Type 2");
    changed["settings"]["mergerMode"] = json!(true);
    let (status, value) = request(
        &app,
        &f.token,
        "PUT",
        &format!("/api/taskTypes/{id}"),
        Some(changed),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["summary"], "Type 2");
    assert_eq!(value["settings"]["mergerMode"], true);
    assert_eq!(value["messages"][0]["success"], "taskType.editSuccess");
    let (_, p) = request(
        &app,
        &f.token,
        "POST",
        "/api/projects",
        Some(project(&f, "Project-1")),
    )
    .await;
    let (task, annotation) = seed_dependencies(&db, &f, p["id"].as_str().unwrap(), id).await;
    assert_eq!(
        request(
            &app,
            &f.token,
            "DELETE",
            &format!("/api/taskTypes/{id}"),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_dependencies_deleted(&db, &task, &annotation).await;
    assert_eq!(
        request(&app, &f.token, "GET", &format!("/api/taskTypes/{id}"), None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &app,
            &f.token,
            "POST",
            "/api/taskTypes",
            Some(task_type(&f, "Type 2"))
        )
        .await
        .0,
        StatusCode::OK
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn team_member_manager_owner_and_organization_permissions() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let manager = db.seed_user(&object_id(), &f.organization_id, false).await;
    let outsider = db
        .seed_user(&object_id(), "other-rust-organization", true)
        .await;
    for (id, is_manager) in [(&member.user_id, false), (&manager.user_id, true)] {
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles(_user,_team,isteammanager) VALUES($1,$2,$3)",
        )
        .bind(id)
        .bind(&f.team_id)
        .bind(is_manager)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let (_, p) = request(
        &app,
        &f.token,
        "POST",
        "/api/projects",
        Some(project(&f, "Project-1")),
    )
    .await;
    let (_, tt) = request(
        &app,
        &f.token,
        "POST",
        "/api/taskTypes",
        Some(task_type(&f, "Type 1")),
    )
    .await;
    let project_path = format!("/api/projects/{}", p["id"].as_str().unwrap());
    let tt_path = format!("/api/taskTypes/{}", tt["id"].as_str().unwrap());
    assert_eq!(
        request(&app, &member.token, "GET", &project_path, None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &app,
            &member.token,
            "PUT",
            &project_path,
            Some(project(&f, "Project-1"))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&app, &member.token, "GET", &tt_path, None).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&app, &member.token, "GET", "/api/taskTypes", None)
            .await
            .1,
        json!([tt])
    );
    assert_eq!(
        request(&app, &manager.token, "GET", &tt_path, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, &manager.token, "DELETE", &project_path, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&app, &outsider.token, "GET", &project_path, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, &outsider.token, "GET", &tt_path, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, &outsider.token, "GET", "/api/projects", None)
            .await
            .1,
        json!([])
    );
    let mut transfer = project(&f, "Project-1");
    transfer["owner"] = json!(outsider.user_id);
    assert_eq!(
        request(&app, &f.token, "PUT", &project_path, Some(transfer))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    // Owners may read and delete a project even without team membership.
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let mut owner_project = project(&f, "Owner-project");
    owner_project["owner"] = json!(owner.user_id);
    let (_, p) = request(&app, &f.token, "POST", "/api/projects", Some(owner_project)).await;
    let owner_path = format!("/api/projects/{}", p["id"].as_str().unwrap());
    assert_eq!(
        request(&app, &owner.token, "GET", &owner_path, None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, &owner.token, "DELETE", &owner_path, None)
            .await
            .0,
        StatusCode::OK
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn simultaneous_duplicate_creations_are_serialized() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let (a, b) = tokio::join!(
        request(
            &app,
            &f.token,
            "POST",
            "/api/projects",
            Some(project(&f, "Project-1"))
        ),
        request(
            &app,
            &f.token,
            "POST",
            "/api/projects",
            Some(project(&f, "Project-1"))
        )
    );
    assert!(
        (a.0 == StatusCode::OK && b.0 == StatusCode::CONFLICT)
            || (b.0 == StatusCode::OK && a.0 == StatusCode::CONFLICT),
        "{a:?} {b:?}"
    );
    let (a, b) = tokio::join!(
        request(
            &app,
            &f.token,
            "POST",
            "/api/taskTypes",
            Some(task_type(&f, "Type 1"))
        ),
        request(
            &app,
            &f.token,
            "POST",
            "/api/taskTypes",
            Some(task_type(&f, "Type 1"))
        )
    );
    assert!(
        (a.0 == StatusCode::OK && b.0 == StatusCode::CONFLICT)
            || (b.0 == StatusCode::OK && a.0 == StatusCode::CONFLICT),
        "{a:?} {b:?}"
    );
    db.cleanup().await;
}
