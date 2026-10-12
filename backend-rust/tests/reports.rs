mod common;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::{Fixture, TestDb, UserFixture, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, router};

async fn get(app: &Router, token: &str, path: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .uri(path)
        .header("x-auth-token", token)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

struct World {
    db: TestDb,
    app: Router,
    admin: Fixture,
    member: UserFixture,
    novice: UserFixture,
    manager: UserFixture,
    outsider: UserFixture,
}

async fn join_team(db: &TestDb, user: &str, team: &str, manager: bool) {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user, _team, isTeamManager) VALUES ($1, $2, $3)",
    )
    .bind(user)
    .bind(team)
    .bind(manager)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn experience(db: &TestDb, user: &str, domain: &str, value: i32) {
    sqlx::query(
        "INSERT INTO webknossos.user_experiences (_user, domain, value) VALUES ($1, $2, $3)",
    )
    .bind(user)
    .bind(domain)
    .bind(value)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn project(db: &TestDb, f: &Fixture, name: &str, paused: bool, blacklisted: bool) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name,paused,isBlacklistedFromReport,priority) VALUES($1,$2,$3,$4,$5,$6,$7,42)")
        .bind(&id).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).bind(name).bind(paused).bind(blacklisted)
        .execute(&db.pool).await.unwrap();
    id
}

async fn task(
    db: &TestDb,
    project: &str,
    task_type: &str,
    domain: &str,
    value: i32,
    instances: i64,
    tracing_time: Option<i64>,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,tracingtime,editposition,editrotation) VALUES($1,$2,$3,$4,$5,$6,$6,$7,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)")
        .bind(&id).bind(project).bind(task_type).bind(domain).bind(value).bind(instances).bind(tracing_time)
        .execute(&db.pool).await.unwrap();
    id
}

async fn task_annotation(db: &TestDb, dataset: &str, task: &str, user: &str, state: &str) {
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,state) VALUES($1,$2,$3,$4,'Task',$5::webknossos.ANNOTATION_STATE)")
        .bind(object_id()).bind(dataset).bind(task).bind(user).bind(state)
        .execute(&db.pool).await.unwrap();
}

async fn world() -> World {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = admin.organization_id.clone();
    let member = db.seed_user(&object_id(), &org, false).await;
    let novice = db.seed_user(&object_id(), &org, false).await;
    let manager = db.seed_user(&object_id(), &org, false).await;
    let unlisted = db.seed_user(&object_id(), &org, false).await;
    let deactivated = db.seed_user(&object_id(), &org, false).await;
    let outsider = db.seed_user(&object_id(), &org, false).await;
    for (user, is_manager) in [
        (&admin.user_id, false),
        (&member.user_id, false),
        (&novice.user_id, false),
        (&manager.user_id, true),
        (&unlisted.user_id, false),
        (&deactivated.user_id, false),
    ] {
        join_team(&db, user, &admin.team_id, is_manager).await;
    }
    for user in [
        &admin.user_id,
        &member.user_id,
        &manager.user_id,
        &unlisted.user_id,
        &deactivated.user_id,
    ] {
        experience(&db, user, "test", 1).await;
    }
    sqlx::query("UPDATE webknossos.users SET isUnlisted = TRUE WHERE _id = $1")
        .bind(&unlisted.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.users SET isDeactivated = TRUE WHERE _id = $1")
        .bind(&deactivated.user_id)
        .execute(&db.pool)
        .await
        .unwrap();

    let dataset = object_id();
    let task_type = object_id();
    sqlx::query("INSERT INTO webknossos.datastores(name,url,publicurl,key) VALUES('rust-test','http://localhost:9000','http://localhost:9000','key')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey) SELECT $1,'rust-test',_id,_rootfolder,'Report dataset','report',now() FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&org).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.taskTypes(_id,_organization,_team,summary,description,settings_branchPointsAllowed,settings_somaClickingAllowed) VALUES($1,$2,$3,'Report type','d',TRUE,FALSE)")
        .bind(&task_type).bind(&org).bind(&admin.team_id).execute(&db.pool).await.unwrap();

    let active = project(&db, &admin, "Active project", false, false).await;
    let t1 = task(&db, &active, &task_type, "test", 0, 3, Some(99)).await;
    task(&db, &active, &task_type, "test", 1, 1, None).await;
    task_annotation(&db, &dataset, &t1, &member.user_id, "Active").await;
    // Paused and untouched: hidden from progress and available tasks.
    let paused = project(&db, &admin, "Paused project", true, false).await;
    task(&db, &paused, &task_type, "test", 0, 1, None).await;
    // Blacklisting only affects the progress report.
    let blacklisted = project(&db, &admin, "Blacklisted project", false, true).await;
    task(&db, &blacklisted, &task_type, "test", 0, 1, None).await;
    // No team member has the needed experience.
    let expert = project(&db, &admin, "Expert project", false, false).await;
    task(&db, &expert, &task_type, "expert", 0, 1, None).await;
    // Finished long ago vs. recently.
    let old = project(&db, &admin, "Old project", false, false).await;
    let old_task = task(&db, &old, &task_type, "test", 0, 1, Some(5)).await;
    task_annotation(&db, &dataset, &old_task, &admin.user_id, "Finished").await;
    sqlx::query(
        "UPDATE webknossos.annotations SET modified = NOW() - INTERVAL '40 days' WHERE _task = $1",
    )
    .bind(&old_task)
    .execute(&db.pool)
    .await
    .unwrap();
    let recent = project(&db, &admin, "Recent project", false, false).await;
    let recent_task = task(&db, &recent, &task_type, "test", 1, 1, Some(7)).await;
    task_annotation(&db, &dataset, &recent_task, &admin.user_id, "Finished").await;

    let app = router(AppState {
        pool: db.pool.clone(),
    });
    World {
        db,
        app,
        admin,
        member,
        novice,
        manager,
        outsider,
    }
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn project_progress_report_lists_relevant_team_projects() {
    let w = world().await;
    let path = format!("/api/teams/{}/projectProgressReport", w.admin.team_id);
    let (status, body) = get(&w.app, &w.admin.token, &path).await;
    assert_eq!(status, StatusCode::OK);
    let mut entries = body.as_array().unwrap().clone();
    entries.sort_by(|a, b| a["projectName"].as_str().cmp(&b["projectName"].as_str()));
    assert_eq!(
        Value::Array(entries),
        json!([
            {"projectName": "Active project", "paused": false, "priority": 42, "totalTasks": 2,
             "totalInstances": 4, "pendingInstances": 3, "finishedInstances": 0,
             "activeInstances": 1, "billedMilliseconds": 99},
            {"projectName": "Recent project", "paused": false, "priority": 42, "totalTasks": 1,
             "totalInstances": 1, "pendingInstances": 0, "finishedInstances": 1,
             "activeInstances": 0, "billedMilliseconds": 7},
        ])
    );
    // Team members may read the report; other users cannot see the team.
    assert_eq!(get(&w.app, &w.member.token, &path).await.0, StatusCode::OK);
    let (status, body) = get(&w.app, &w.outsider.token, &path).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body["messages"][0]["error"],
        format!("Team “{}” could not be found or accessed.", w.admin.team_id)
    );
    let foreign = w.db.fixture().await;
    assert_eq!(
        get(&w.app, &foreign.token, &path).await.0,
        StatusCode::NOT_FOUND
    );
    // Without any experienced members no project qualifies.
    let empty_team = object_id();
    sqlx::query("INSERT INTO webknossos.teams (_id, _organization, name) VALUES ($1, $2, 'Empty')")
        .bind(&empty_team)
        .bind(&w.admin.organization_id)
        .execute(&w.db.pool)
        .await
        .unwrap();
    assert_eq!(
        get(
            &w.app,
            &w.admin.token,
            &format!("/api/teams/{empty_team}/projectProgressReport")
        )
        .await,
        (StatusCode::OK, json!([]))
    );
    w.db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn available_tasks_report_counts_tasks_for_plain_members() {
    let w = world().await;
    let path = format!("/api/teams/{}/availableTasksReport", w.admin.team_id);
    let (status, body) = get(&w.app, &w.admin.token, &path).await;
    assert_eq!(status, StatusCode::OK);
    // Tasks the member already annotates, paused projects and tasks without
    // pending instances are not available; blacklisting does not matter here.
    let member_entry = json!({
        "id": w.member.user_id, "user": "Rust Test", "totalAvailableTasks": 2,
        "availableTasksByProjects": {
            "Active project/test: 1": 1,
            "Blacklisted project/test: 0": 1,
        },
    });
    let novice_entry = json!({
        "id": w.novice.user_id, "user": "Rust Test", "totalAvailableTasks": 0,
        "availableTasksByProjects": {},
    });
    let mut expected = vec![member_entry.clone(), novice_entry];
    expected.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    // Admins, team managers, unlisted and deactivated members are left out.
    assert_eq!(body, Value::Array(expected.clone()));
    assert_eq!(
        get(&w.app, &w.manager.token, &path).await,
        (StatusCode::OK, Value::Array(expected))
    );
    // Plain members only list themselves.
    assert_eq!(
        get(&w.app, &w.member.token, &path).await,
        (StatusCode::OK, json!([member_entry]))
    );
    assert_eq!(
        get(&w.app, &w.outsider.token, &path).await.0,
        StatusCode::NOT_FOUND
    );
    w.db.cleanup().await;
}
