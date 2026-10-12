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

fn millis(iso: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(iso)
        .unwrap()
        .timestamp_millis()
}

fn error(body: &Value) -> &str {
    body["messages"][0]["error"].as_str().unwrap()
}

struct World {
    db: TestDb,
    app: Router,
    admin: Fixture,
    /// Non-manager member of the fixture team; owns all seeded annotations.
    member: UserFixture,
    /// Another plain member of the same team.
    peer: UserFixture,
    /// Manager of the fixture team.
    manager: UserFixture,
    /// Non-admin without any team.
    loner: UserFixture,
    project: String,
    task: String,
    task_type: String,
    task_annotation: String,
    explorational: String,
    unlayered: String,
    first_span: String,
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

async fn span(db: &TestDb, user: &str, annotation: &str, created: &str, time: i64) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.timespans (_id, _user, _annotation, time, created) VALUES ($1, $2, $3, $4, $5::timestamptz)")
        .bind(&id).bind(user).bind(annotation).bind(time).bind(created)
        .execute(&db.pool).await.unwrap();
    id
}

async fn annotation(db: &TestDb, dataset: &str, user: &str, task: Option<&str>) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations (_id, _dataset, _task, _user, typ) VALUES ($1, $2, $3, $4, $5::webknossos.ANNOTATION_TYPE)")
        .bind(&id).bind(dataset).bind(task).bind(user)
        .bind(if task.is_some() { "Task" } else { "Explorational" })
        .execute(&db.pool).await.unwrap();
    id
}

async fn world() -> World {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = admin.organization_id.clone();
    let member = db.seed_user(&object_id(), &org, false).await;
    let peer = db.seed_user(&object_id(), &org, false).await;
    let manager = db.seed_user(&object_id(), &org, false).await;
    let loner = db.seed_user(&object_id(), &org, false).await;
    join_team(&db, &member.user_id, &admin.team_id, false).await;
    join_team(&db, &peer.user_id, &admin.team_id, false).await;
    join_team(&db, &manager.user_id, &admin.team_id, true).await;

    let dataset = object_id();
    let project = object_id();
    let task_type = object_id();
    let task = object_id();
    sqlx::query("INSERT INTO webknossos.datastores(name,url,publicurl,key) VALUES('rust-test','http://localhost:9000','http://localhost:9000','key')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey) SELECT $1,'rust-test',_id,_rootfolder,'Time dataset','time',now() FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&org).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Time project')")
        .bind(&project).bind(&org).bind(&admin.team_id).bind(&admin.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.taskTypes(_id,_organization,_team,summary,description,settings_branchPointsAllowed,settings_somaClickingAllowed) VALUES($1,$2,$3,'Time type','d',TRUE,FALSE)")
        .bind(&task_type).bind(&org).bind(&admin.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation) VALUES($1,$2,$3,'test',0,2,2,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)")
        .bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    let task_annotation = annotation(&db, &dataset, &member.user_id, Some(&task)).await;
    let explorational = annotation(&db, &dataset, &member.user_id, None).await;
    let unlayered = annotation(&db, &dataset, &member.user_id, None).await;
    for (annotation, tracing, typ, name, stats) in [
        (
            &task_annotation,
            "skel-1",
            "Skeleton",
            "skeleton",
            json!({"treeCount": 2}),
        ),
        (
            &task_annotation,
            "vol-1",
            "Volume",
            "volume",
            json!({"segmentCount": 3}),
        ),
        (&explorational, "skel-2", "Skeleton", "skeleton", json!({})),
    ] {
        sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,$3::webknossos.ANNOTATION_LAYER_TYPE,$4,$5)")
            .bind(annotation).bind(tracing).bind(typ).bind(name).bind(stats)
            .execute(&db.pool).await.unwrap();
    }
    let m = &member.user_id;
    let first_span = span(&db, m, &task_annotation, "2024-01-15T10:00:00.123Z", 90_500).await;
    span(&db, m, &task_annotation, "2024-01-20T00:00:00Z", 1_000).await;
    span(&db, m, &explorational, "2024-03-01T23:59:59Z", 60_000).await;
    span(&db, m, &unlayered, "2024-02-10T00:00:00Z", 2_000).await;
    // Zero-length spans count toward logged time but not span reports.
    span(&db, m, &task_annotation, "2024-03-02T00:00:00Z", 0).await;
    span(&db, m, &explorational, "2023-12-31T23:59:59Z", 5_999).await;
    let deleted = span(&db, m, &explorational, "2024-01-16T00:00:00Z", 77_000).await;
    sqlx::query("UPDATE webknossos.timespans SET isDeleted = TRUE WHERE _id = $1")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    World {
        db,
        app,
        admin,
        member,
        peer,
        manager,
        loner,
        project,
        task,
        task_type,
        task_annotation,
        explorational,
        unlayered,
        first_span,
    }
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn logged_time_sums_months_and_requires_editability() {
    let w = world().await;
    let path = format!("/api/users/{}/loggedTime", w.member.user_id);
    let expected = json!({"loggedTime": [
        {"paymentInterval": {"month": 12, "year": 2023}, "durationInSeconds": 5},
        {"paymentInterval": {"month": 1, "year": 2024}, "durationInSeconds": 91},
        {"paymentInterval": {"month": 2, "year": 2024}, "durationInSeconds": 2},
        {"paymentInterval": {"month": 3, "year": 2024}, "durationInSeconds": 60},
    ]});
    assert_eq!(
        get(&w.app, &w.admin.token, &path).await,
        (StatusCode::OK, expected.clone())
    );
    assert_eq!(
        get(&w.app, &w.manager.token, &path).await,
        (StatusCode::OK, expected)
    );
    // Team members cannot edit themselves unless they manage one of their teams.
    let (status, body) = get(&w.app, &w.member.token, &path).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        error(&body),
        "You are not authorized to view or edit this resource."
    );
    // Users without teams are editable by anyone who can read them.
    let loner_path = format!("/api/users/{}/loggedTime", w.loner.user_id);
    assert_eq!(
        get(&w.app, &w.loner.token, &loner_path).await,
        (StatusCode::OK, json!({"loggedTime": []}))
    );
    let (status, body) = get(&w.app, &w.peer.token, &path).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        error(&body),
        format!(
            "User “{}” could not be found or accessed.",
            w.member.user_id
        )
    );
    let outsider = w.db.fixture().await;
    assert_eq!(
        get(&w.app, &outsider.token, &path).await.0,
        StatusCode::NOT_FOUND
    );
    w.db.cleanup().await;
}

fn query(start: &str, end: &str, types: &str, states: &str) -> String {
    format!(
        "start={}&end={}&annotationTypes={types}&annotationStates={states}",
        millis(start),
        millis(end)
    )
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn spans_filter_by_range_type_state_and_project() {
    let w = world().await;
    let base = format!("/api/time/user/{}/spans", w.member.user_id);
    let all = query(
        "2024-01-01T00:00:00Z",
        "2024-03-02T00:00:00Z",
        "Task,Explorational",
        "Active,Finished",
    );
    let (status, body) = get(&w.app, &w.member.token, &format!("{base}?{all}")).await;
    assert_eq!(status, StatusCode::OK);
    let spans = body.as_array().unwrap();
    assert_eq!(spans.len(), 4, "{body}");
    let first = spans
        .iter()
        .find(|s| s["timeSpanId"] == w.first_span.as_str())
        .unwrap();
    let email: String = sqlx::query_scalar("SELECT email FROM webknossos.multiUsers WHERE _id=$1")
        .bind(&w.member.multi_user_id)
        .fetch_one(&w.db.pool)
        .await
        .unwrap();
    assert_eq!(
        first,
        &json!({
            "userId": w.member.user_id, "userEmail": email,
            "datasetOrganization": w.admin.organization_id, "datasetName": "Time dataset",
            "annotationId": w.task_annotation, "annotationState": "Active",
            "taskId": w.task, "projectName": "Time project", "taskTypeId": w.task_type,
            "taskTypeSummary": "Time type", "timeSpanId": w.first_span,
            "timeSpanCreated": millis("2024-01-15T10:00:00.123Z"), "timeSpanTimeMillis": 90_500,
        })
    );
    let explorational = spans
        .iter()
        .find(|s| s["annotationId"] == w.explorational.as_str())
        .unwrap();
    assert_eq!(explorational["taskId"], Value::Null);
    assert_eq!(explorational["projectName"], Value::Null);
    assert_eq!(explorational["taskTypeSummary"], Value::Null);

    let by_project = get(
        &w.app,
        &w.member.token,
        &format!("{base}?{all}&projectIds={}", w.project.to_uppercase()),
    )
    .await
    .1;
    assert_eq!(by_project.as_array().unwrap().len(), 2);
    assert!(
        by_project
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["taskId"] == w.task.as_str())
    );
    let explorational_only = query(
        "2024-01-01T00:00:00Z",
        "2024-03-02T00:00:00Z",
        "Explorational",
        "Active",
    );
    assert_eq!(
        get(
            &w.app,
            &w.member.token,
            &format!("{base}?{explorational_only}")
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        2
    );
    let finished = query(
        "2024-01-01T00:00:00Z",
        "2024-03-02T00:00:00Z",
        "Task",
        "Finished",
    );
    assert_eq!(
        get(&w.app, &w.member.token, &format!("{base}?{finished}")).await,
        (StatusCode::OK, json!([]))
    );
    let no_types = query("2024-01-01T00:00:00Z", "2024-03-02T00:00:00Z", "", "Active");
    assert_eq!(
        get(&w.app, &w.member.token, &format!("{base}?{no_types}")).await,
        (StatusCode::OK, json!([]))
    );
    // End is exclusive.
    let narrow = query(
        "2024-01-15T10:00:00.123Z",
        "2024-01-20T00:00:00Z",
        "Task",
        "Active",
    );
    let narrow = get(&w.app, &w.member.token, &format!("{base}?{narrow}"))
        .await
        .1;
    assert_eq!(narrow.as_array().unwrap().len(), 1);
    assert_eq!(narrow[0]["timeSpanId"], w.first_span.as_str());

    for (types, states, message) in [
        ("Task,Bogus", "Active", "Invalid annotation type."),
        ("Task", "Bogus", "Invalid annotation state."),
    ] {
        let params = query(
            "2024-01-01T00:00:00Z",
            "2024-03-02T00:00:00Z",
            types,
            states,
        );
        let (status, body) = get(&w.app, &w.member.token, &format!("{base}?{params}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(error(&body), message);
    }
    let (status, body) = get(
        &w.app,
        &w.member.token,
        &format!("{base}?{all}&projectIds=nope"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "The supplied resource id “nope” is not a valid ObjectId."
    );
    assert_eq!(
        get(
            &w.app,
            &w.member.token,
            &format!("{base}?end=1&annotationTypes=Task&annotationStates=Active")
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    // Permissions: managers and admins may read, peers cannot see the user.
    assert_eq!(
        get(&w.app, &w.manager.token, &format!("{base}?{all}"))
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        get(&w.app, &w.admin.token, &format!("{base}?{all}"))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        get(&w.app, &w.peer.token, &format!("{base}?{all}")).await.0,
        StatusCode::NOT_FOUND
    );
    let loner = format!("/api/time/user/{}/spans?{all}", w.loner.user_id);
    assert_eq!(
        get(&w.app, &w.loner.token, &loner).await,
        (StatusCode::OK, json!([]))
    );
    w.db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn summed_by_annotation_groups_and_attaches_layer_statistics() {
    let w = world().await;
    let base = format!("/api/time/user/{}/summedByAnnotation", w.member.user_id);
    let all = query(
        "2023-01-01T00:00:00Z",
        "2025-01-01T00:00:00Z",
        "Task,Explorational",
        "Active",
    );
    let (status, body) = get(&w.app, &w.member.token, &format!("{base}?{all}")).await;
    assert_eq!(status, StatusCode::OK);
    let mut expected = vec![
        json!({"annotation": w.task_annotation, "task": w.task, "projectName": "Time project",
            "timeMillis": 91_500,
            "annotationLayerStats": {"skel-1": {"treeCount": 2}, "vol-1": {"segmentCount": 3}}}),
        // The unlayered annotation is dropped by the inner layer join.
        json!({"annotation": w.explorational, "task": null, "projectName": null,
            "timeMillis": 65_999, "annotationLayerStats": {"skel-2": {}}}),
    ];
    expected.sort_by(|a, b| a["annotation"].as_str().cmp(&b["annotation"].as_str()));
    assert_eq!(body, Value::Array(expected));
    assert!(!body.to_string().contains(&w.unlayered));
    let by_project = get(
        &w.app,
        &w.member.token,
        &format!("{base}?{all}&projectIds={}", w.project),
    )
    .await
    .1;
    assert_eq!(by_project.as_array().unwrap().len(), 1);
    assert_eq!(by_project[0]["annotation"], w.task_annotation.as_str());
    let no_types = query("2023-01-01T00:00:00Z", "2025-01-01T00:00:00Z", "", "Active");
    assert_eq!(
        get(&w.app, &w.member.token, &format!("{base}?{no_types}")).await,
        (StatusCode::OK, json!([]))
    );
    assert_eq!(
        get(&w.app, &w.peer.token, &format!("{base}?{all}")).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&w.app, &w.manager.token, &format!("{base}?{all}"))
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        2
    );
    w.db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn overview_sums_listable_users_and_validates_filters() {
    let w = world().await;
    let all = query(
        "2023-01-01T00:00:00Z",
        "2025-01-01T00:00:00Z",
        "Task,Explorational",
        "Active",
    );
    // The admin logs time on an explorational of their own.
    let dataset: String =
        sqlx::query_scalar("SELECT _dataset FROM webknossos.annotations WHERE _id=$1")
            .bind(&w.explorational)
            .fetch_one(&w.db.pool)
            .await
            .unwrap();
    let admin_annotation = annotation(&w.db, &dataset, &w.admin.user_id, None).await;
    span(
        &w.db,
        &w.admin.user_id,
        &admin_annotation,
        "2024-05-01T00:00:00Z",
        4_000,
    )
    .await;
    let user_json = |id: &str| json!({"id": id, "firstName": "Rust", "lastName": "Test"});
    let entry = |body: &Value, id: &str| {
        body.as_array()
            .unwrap()
            .iter()
            .find(|e| e["user"]["id"] == id)
            .cloned()
    };

    let (status, body) = get(&w.app, &w.admin.token, &format!("/api/time/overview?{all}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 2, "{body}");
    let member = entry(&body, &w.member.user_id).unwrap();
    assert_eq!(member["timeMillis"], 91_500 + 65_999 + 2_000);
    assert_eq!(member["annotationCount"], 3);
    let mut member_user = member["user"].clone();
    member_user.as_object_mut().unwrap().remove("email");
    assert_eq!(member_user, user_json(&w.member.user_id));
    assert!(
        member["user"]["email"]
            .as_str()
            .unwrap()
            .ends_with("@example.test")
    );
    assert_eq!(entry(&body, &w.admin.user_id).unwrap()["timeMillis"], 4_000);

    // Team filter: members of the other team plus the organization's admins.
    let other_team = object_id();
    sqlx::query("INSERT INTO webknossos.teams (_id, _organization, name) VALUES ($1, $2, 'Other')")
        .bind(&other_team)
        .bind(&w.admin.organization_id)
        .execute(&w.db.pool)
        .await
        .unwrap();
    let body = get(
        &w.app,
        &w.admin.token,
        &format!("/api/time/overview?{all}&teamIds={other_team}"),
    )
    .await
    .1;
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert!(entry(&body, &w.admin.user_id).is_some());
    let body = get(
        &w.app,
        &w.admin.token,
        &format!("/api/time/overview?{all}&teamIds={}", w.admin.team_id),
    )
    .await
    .1;
    assert_eq!(body.as_array().unwrap().len(), 2);
    let tasks_only = query(
        "2023-01-01T00:00:00Z",
        "2025-01-01T00:00:00Z",
        "Task",
        "Active",
    );
    let body = get(
        &w.app,
        &w.admin.token,
        &format!("/api/time/overview?{tasks_only}&projectIds={}", w.project),
    )
    .await
    .1;
    assert_eq!(
        body,
        json!([{"user": entry(&body, &w.member.user_id).unwrap()["user"], "timeMillis": 91_500, "annotationCount": 1}])
    );

    // Non-admins see only themselves (admins are not listable for them).
    let body = get(
        &w.app,
        &w.member.token,
        &format!("/api/time/overview?{all}"),
    )
    .await
    .1;
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert!(entry(&body, &w.member.user_id).is_some());
    let body = get(
        &w.app,
        &w.manager.token,
        &format!("/api/time/overview?{all}"),
    )
    .await
    .1;
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert!(entry(&body, &w.member.user_id).is_some());
    // Unlisted users are hidden from non-superusers.
    sqlx::query("UPDATE webknossos.users SET isUnlisted = TRUE WHERE _id = $1")
        .bind(&w.member.user_id)
        .execute(&w.db.pool)
        .await
        .unwrap();
    let body = get(&w.app, &w.admin.token, &format!("/api/time/overview?{all}"))
        .await
        .1;
    assert!(entry(&body, &w.member.user_id).is_none());
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser = TRUE WHERE _id = $1")
        .bind(&w.admin.multi_user_id)
        .execute(&w.db.pool)
        .await
        .unwrap();
    let body = get(&w.app, &w.admin.token, &format!("/api/time/overview?{all}"))
        .await
        .1;
    assert!(entry(&body, &w.member.user_id).is_some());

    for (params, message) in [
        (
            query("2023-01-01T00:00:00Z", "2025-01-01T00:00:00Z", "", "Active"),
            "No annotation types specified.",
        ),
        (
            query(
                "2023-01-01T00:00:00Z",
                "2025-01-01T00:00:00Z",
                "Task,View",
                "Active",
            ),
            "One of the selected annotation types is not supported for time tracking.",
        ),
        (
            query(
                "2023-01-01T00:00:00Z",
                "2025-01-01T00:00:00Z",
                "Nope",
                "Active",
            ),
            "Invalid annotation type.",
        ),
        (
            query(
                "2023-01-01T00:00:00Z",
                "2025-01-01T00:00:00Z",
                "Task",
                "Nope",
            ),
            "Invalid annotation state.",
        ),
        (format!("{all}&teamIds=bad"), "Invalid team ids."),
        (
            format!("{all}&projectIds=bad"),
            "The supplied resource id “bad” is not a valid ObjectId.",
        ),
    ] {
        let (status, body) = get(
            &w.app,
            &w.admin.token,
            &format!("/api/time/overview?{params}"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{params}");
        assert_eq!(error(&body), message);
    }
    w.db.cleanup().await;
}
