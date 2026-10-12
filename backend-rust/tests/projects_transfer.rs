mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, projects};

fn app(database: &TestDb) -> Router {
    projects::router().with_state(AppState {
        pool: database.pool.clone(),
    })
}

async fn transfer(app: &Router, project: &str, token: &str, body: Value) -> (StatusCode, String) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/projects/{project}/transferActiveTasks"))
                .header("x-auth-token", token)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

fn error(message: &str) -> String {
    json!({"messages": [{"error": message}]}).to_string()
}

async fn execute(database: &TestDb, sql: &str, binds: &[&str]) {
    let mut query = sqlx::query(sql);
    for bind in binds {
        query = query.bind(*bind);
    }
    query.execute(&database.pool).await.unwrap();
}

async fn owner(database: &TestDb, annotation: &str) -> String {
    sqlx::query_scalar("SELECT _user FROM webknossos.annotations WHERE _id = $1")
        .bind(annotation)
        .fetch_one(&database.pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn transfers_active_task_annotations_with_play_permissions() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let app = app(&database);
    let organization = admin.organization_id.as_str();
    let team = admin.team_id.as_str();
    let annotator = database.seed_user(&object_id(), organization, false).await;
    let transferee = database.seed_user(&object_id(), organization, false).await;
    let manager = database.seed_user(&object_id(), organization, false).await;
    for (user, is_manager) in [
        (&annotator.user_id, "false"),
        (&transferee.user_id, "false"),
        (&manager.user_id, "true"),
    ] {
        execute(&database, "INSERT INTO webknossos.user_team_roles (_user, _team, isTeamManager) VALUES ($1, $2, $3::BOOLEAN)", &[user, team, is_manager]).await;
    }
    let (dataset, project, other_project, task_type, task, other_task) = (
        object_id(),
        object_id(),
        object_id(),
        object_id(),
        object_id(),
        object_id(),
    );
    execute(&database, "INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('store','http://localhost:9000','https://data.example.test','key')", &[]).await;
    execute(&database, "INSERT INTO webknossos.datasets(_id,_dataStore,_organization,_folder,name,directoryName,sortingKey) SELECT $1,'store',_id,_rootFolder,'Dataset','directory',NOW() FROM webknossos.organizations WHERE _id=$2", &[&dataset, organization]).await;
    for (id, name) in [(&project, "Project"), (&other_project, "Other")] {
        execute(&database, "INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,$5)", &[id, organization, team, &admin.user_id, name]).await;
    }
    execute(&database, "INSERT INTO webknossos.taskTypes(_id,_organization,_team,summary,description,settings_branchPointsAllowed,settings_somaClickingAllowed) VALUES($1,$2,$3,'Type','',true,true)", &[&task_type, organization, team]).await;
    for (id, project) in [(&task, &project), (&other_task, &other_project)] {
        execute(&database, "INSERT INTO webknossos.tasks(_id,_project,_taskType,neededExperience_domain,neededExperience_value,totalInstances,pendingInstances,editPosition,editRotation) VALUES($1,$2,$3,'test',0,3,3,ROW(0,0,0)::webknossos.VECTOR3,ROW(0,0,0)::webknossos.VECTOR3)", &[id, project, &task_type]).await;
    }
    let (active, finished, other_active) = (object_id(), object_id(), object_id());
    for (id, task, state) in [
        (&active, &task, "Active"),
        (&finished, &task, "Finished"),
        (&other_active, &other_task, "Active"),
    ] {
        execute(&database, "INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,state) VALUES($1,$2,$3,$4,'Task',$5::webknossos.ANNOTATION_STATE)", &[id, &dataset, task, &annotator.user_id, state]).await;
    }
    let body = json!({"userId": transferee.user_id});

    let missing = object_id();
    assert_eq!(
        transfer(&app, &missing, &admin.token, body.clone()).await,
        (
            StatusCode::NOT_FOUND,
            error(&format!(
                "Project “{missing}” could not be found or accessed."
            ))
        )
    );
    // Team members who do not manage the project's team are rejected.
    assert_eq!(
        transfer(&app, &project, &annotator.token, body.clone()).await,
        (
            StatusCode::FORBIDDEN,
            error("You are not authorized to view or edit this resource.")
        )
    );
    // The transferee must be visible to the requester.
    let foreign = database.fixture().await;
    assert_eq!(
        transfer(
            &app,
            &project,
            &admin.token,
            json!({"userId": foreign.user_id})
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error(&format!(
                "User “{}” could not be found or accessed.",
                foreign.user_id
            ))
        )
    );
    assert_eq!(
        transfer(&app, &project, &admin.token, json!({"userId": "nope"}))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    // The transferee needs dataset access; nothing changes otherwise.
    assert_eq!(
        transfer(&app, &project, &manager.token, body.clone()).await,
        (
            StatusCode::BAD_REQUEST,
            error("Cannot transfer annotation to a user who has no access to the dataset.")
        )
    );
    assert_eq!(owner(&database, &active).await, annotator.user_id);

    execute(
        &database,
        "INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)",
        &[&dataset, team],
    )
    .await;
    assert_eq!(
        transfer(&app, &project, &manager.token, body.clone()).await,
        (StatusCode::OK, String::new())
    );
    assert_eq!(owner(&database, &active).await, transferee.user_id);
    assert_eq!(owner(&database, &finished).await, annotator.user_id);
    assert_eq!(owner(&database, &other_active).await, annotator.user_id);

    // Repeating the transfer is idempotent.
    assert_eq!(
        transfer(
            &app,
            &project,
            &admin.token,
            json!({"userId": transferee.user_id})
        )
        .await,
        (StatusCode::OK, String::new())
    );
    database.cleanup().await;
}
