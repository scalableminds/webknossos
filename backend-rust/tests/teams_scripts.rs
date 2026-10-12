mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, scripts, teams};

fn app(database: &TestDb) -> Router {
    Router::new()
        .merge(teams::router())
        .merge(scripts::router())
        .with_state(AppState {
            pool: database.pool.clone(),
        })
}

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let body = body.map(|body| body.to_string()).unwrap_or_default();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("x-auth-token", token)
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, value)
}

async fn seed_project(database: &TestDb, fixture: &Fixture) -> String {
    let project = object_id();
    sqlx::query("INSERT INTO webknossos.projects (_id, _organization, _team, _owner, name) VALUES ($1, $2, $3, $4, 'Project')")
        .bind(&project).bind(&fixture.organization_id).bind(&fixture.team_id).bind(&fixture.user_id)
        .execute(&database.pool).await.unwrap();
    project
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn team_visibility_and_script_creation_follow_membership_and_organization() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let other_org = database.fixture().await;
    let member_id = object_id();
    database
        .seed_user(&member_id, &admin.organization_id, false)
        .await;
    let token = database.seed_token(&member_id, "Authentication").await;
    let router = app(&database);

    let (status, visible) = request(&router, "GET", "/teams", &token, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(visible, json!([]));
    sqlx::query("INSERT INTO webknossos.user_team_roles (_user, _team) VALUES ($1, $2), ($1, $3)")
        .bind(&member_id)
        .bind(&admin.team_id)
        .bind(&other_org.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let (_, visible) = request(&router, "GET", "/teams", &token, None).await;
    assert_eq!(visible.as_array().unwrap().len(), 1);
    assert_eq!(visible[0]["id"], admin.team_id);
    let (_, editable) = request(&router, "GET", "/teams?isEditable=true", &token, None).await;
    assert_eq!(editable, json!([]));
    assert_eq!(
        request(
            &router,
            "POST",
            "/teams",
            &token,
            Some(json!({"name": "Forbidden"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let script =
        json!({"name": "Script", "gist": "https://gist.github.com/test", "owner": member_id});
    assert_eq!(
        request(&router, "POST", "/scripts", &token, Some(script.clone()))
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    // A foreign team's manager flag must not confer management rights in this organization.
    sqlx::query("UPDATE webknossos.user_team_roles SET isTeamManager = TRUE WHERE _user = $1 AND _team = $2")
        .bind(&member_id).bind(&other_org.team_id).execute(&database.pool).await.unwrap();
    assert_eq!(
        request(&router, "POST", "/scripts", &token, Some(script.clone()))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE webknossos.user_team_roles SET isTeamManager = TRUE WHERE _user = $1 AND _team = $2")
        .bind(&member_id).bind(&admin.team_id).execute(&database.pool).await.unwrap();
    let (_, editable) = request(&router, "GET", "/teams?isEditable=true", &token, None).await;
    assert_eq!(editable.as_array().unwrap().len(), 1);
    assert_eq!(
        request(&router, "POST", "/scripts", &token, Some(script))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &router,
            "DELETE",
            &format!("/teams/{}", admin.team_id),
            &token,
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &router,
            "DELETE",
            &format!("/teams/{}", other_org.team_id),
            &admin.token,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, created) = request(
        &router,
        "POST",
        "/teams",
        &admin.token,
        Some(json!({"name": "New team"})),
    )
    .await;
    assert_eq!(
        created["messages"][0]["success"],
        "Team was successfully created."
    );
    assert_eq!(created["organization"], admin.organization_id);
    assert_eq!(
        request(
            &router,
            "POST",
            "/teams",
            &admin.token,
            Some(json!({"name": "New team"}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "GET",
            "/teams?isEditable=bogus",
            &admin.token,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn team_delete_checks_live_references_and_atomically_cleans_all_memberships() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let router = app(&database);
    let path = format!("/teams/{}", fixture.team_id);
    sqlx::query("UPDATE webknossos.teams SET isOrganizationTeam = TRUE WHERE _id = $1")
        .bind(&fixture.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&router, "DELETE", &path, &fixture.token, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE webknossos.teams SET isOrganizationTeam = FALSE WHERE _id = $1")
        .bind(&fixture.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let project = seed_project(&database, &fixture).await;
    assert_eq!(
        request(&router, "DELETE", &path, &fixture.token, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE webknossos.projects SET isDeleted = TRUE WHERE _id = $1")
        .bind(project)
        .execute(&database.pool)
        .await
        .unwrap();
    let task_type = object_id();
    sqlx::query("INSERT INTO webknossos.taskTypes (_id, _organization, _team, summary, description, settings_branchPointsAllowed, settings_somaClickingAllowed) VALUES ($1, $2, $3, 'Type', '', TRUE, TRUE)")
        .bind(&task_type).bind(&fixture.organization_id).bind(&fixture.team_id).execute(&database.pool).await.unwrap();
    assert_eq!(
        request(&router, "DELETE", &path, &fixture.token, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE webknossos.taskTypes SET isDeleted = TRUE WHERE _id = $1")
        .bind(task_type)
        .execute(&database.pool)
        .await
        .unwrap();

    let root: String =
        sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations WHERE _id = $1")
            .bind(&fixture.organization_id)
            .fetch_one(&database.pool)
            .await
            .unwrap();
    let invite = object_id();
    sqlx::query("INSERT INTO webknossos.invites (_id, tokenValue, _organization, autoActivate, expirationDateTime) VALUES ($1, 'test', $2, FALSE, NOW() + INTERVAL '1 hour')")
        .bind(&invite).bind(&fixture.organization_id).execute(&database.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.invite_team_roles (_invite, _team) VALUES ($1, $2)")
        .bind(invite)
        .bind(&fixture.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.user_team_roles (_user, _team) VALUES ($1, $2)")
        .bind(&fixture.user_id)
        .bind(&fixture.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.folder_allowedTeams (_folder, _team) VALUES ($1, $2)")
        .bind(&root)
        .bind(&fixture.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.dataStores (name, url, publicUrl, key) VALUES ('test', 'http://store.test', 'http://store.test', 'test')")
        .execute(&database.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id, _dataStore, _organization, _folder, name, directoryName, sortingKey) VALUES ($1, 'test', $2, $3, 'Dataset', 'Dataset', NOW())")
        .bind(&dataset).bind(&fixture.organization_id).bind(root).execute(&database.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset, _team) VALUES ($1, $2)")
        .bind(&dataset)
        .bind(&fixture.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let annotation = object_id();
    sqlx::query("INSERT INTO webknossos.annotations (_id, _dataset, _user, typ) VALUES ($1, $2, $3, 'Explorational')")
        .bind(&annotation).bind(dataset).bind(&fixture.user_id).execute(&database.pool).await.unwrap();
    sqlx::query(
        "INSERT INTO webknossos.annotation_sharedTeams (_annotation, _team) VALUES ($1, $2)",
    )
    .bind(annotation)
    .bind(&fixture.team_id)
    .execute(&database.pool)
    .await
    .unwrap();

    // Fail the last cleanup operation to verify all previous mutations roll back.
    sqlx::raw_sql("CREATE FUNCTION webknossos.reject_team_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test cleanup failure'; END $$; CREATE TRIGGER reject_team_cleanup BEFORE DELETE ON webknossos.folder_allowedTeams FOR EACH ROW EXECUTE FUNCTION webknossos.reject_team_cleanup();")
        .execute(&database.pool).await.unwrap();
    assert_eq!(
        request(&router, "DELETE", &path, &fixture.token, None)
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let deleted: bool = sqlx::query_scalar("SELECT isDeleted FROM webknossos.teams WHERE _id = $1")
        .bind(&fixture.team_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
    assert!(!deleted);
    for table in [
        "user_team_roles",
        "invite_team_roles",
        "annotation_sharedTeams",
        "dataset_allowedTeams",
        "folder_allowedTeams",
    ] {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM webknossos.{table} WHERE _team = $1"
        ))
        .bind(&fixture.team_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(count, 1, "{table} should roll back");
    }
    sqlx::query("DROP TRIGGER reject_team_cleanup ON webknossos.folder_allowedTeams")
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&router, "DELETE", &path, &fixture.token, None)
            .await
            .0,
        StatusCode::OK
    );
    for table in [
        "user_team_roles",
        "invite_team_roles",
        "annotation_sharedTeams",
        "dataset_allowedTeams",
        "folder_allowedTeams",
    ] {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM webknossos.{table} WHERE _team = $1"
        ))
        .bind(&fixture.team_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(count, 0, "{table} should be cleaned");
    }
    assert_eq!(
        request(&router, "DELETE", &path, &fixture.token, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    // Name suffixing allows recreating the original team name.
    assert_eq!(
        request(
            &router,
            "POST",
            "/teams",
            &fixture.token,
            Some(json!({"name": "Test team"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn script_transfer_and_task_cleanup_are_owner_scoped_and_transactional() {
    let database = TestDb::new().await;
    let owner = database.fixture().await;
    let foreign = database.fixture().await;
    let recipient_id = object_id();
    database
        .seed_user(&recipient_id, &owner.organization_id, false)
        .await;
    let recipient_token = database.seed_token(&recipient_id, "Authentication").await;
    sqlx::query("INSERT INTO webknossos.user_team_roles (_user, _team, isTeamManager) VALUES ($1, $2, TRUE)")
        .bind(&owner.user_id).bind(&owner.team_id).execute(&database.pool).await.unwrap();
    let router = app(&database);
    let parameters = json!({"name": "Script", "gist": "https://gist.github.com/test", "owner": owner.user_id.to_uppercase()});
    let (status, created) = request(
        &router,
        "POST",
        "/scripts",
        &owner.token,
        Some(parameters.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(created["owner"]["firstName"], "Rust");
    assert_eq!(created["owner"]["isAnonymous"], false);
    assert_eq!(created["owner"]["isActive"], true);
    assert_eq!(created["owner"]["teams"][0]["isTeamManager"], true);
    let id = created["id"].as_str().unwrap();
    let path = format!("/scripts/readable-prefix-{}", id.to_uppercase());
    assert_eq!(
        request(&router, "GET", &path, &foreign.token, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&router, "GET", "/scripts", &foreign.token, None)
            .await
            .1,
        json!([])
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &path,
            &recipient_token,
            Some(parameters.clone())
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&router, "DELETE", &path, &recipient_token, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let foreign_transfer =
        json!({"name": "Script", "gist": "https://gist.github.com/test", "owner": foreign.user_id});
    assert_eq!(
        request(&router, "PUT", &path, &owner.token, Some(foreign_transfer))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "POST",
            "/scripts",
            &owner.token,
            Some(
                json!({"name": "a", "gist": "https://gist.github.com/test", "owner": owner.user_id})
            )
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let transfer = json!({"name": "Renamed", "gist": "https://gist.github.com/updated", "owner": recipient_id});
    let (status, transferred) = request(&router, "PUT", &path, &owner.token, Some(transfer)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(transferred["owner"]["id"], recipient_id);
    assert_eq!(
        request(&router, "DELETE", &path, &owner.token, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    let project = seed_project(&database, &owner).await;
    let task = object_id();
    sqlx::query("INSERT INTO webknossos.tasks (_id, _project, _script, _taskType, neededExperience_domain, neededExperience_value, totalInstances, pendingInstances, editPosition, editRotation, isDeleted) VALUES ($1, $2, $3, $4, 'test', 1, 1, 1, (0,0,0)::webknossos.VECTOR3, (0,0,0)::webknossos.VECTOR3, TRUE)")
        .bind(&task).bind(project).bind(id).bind(object_id()).execute(&database.pool).await.unwrap();
    sqlx::raw_sql("CREATE FUNCTION webknossos.reject_script_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test cleanup failure'; END $$; CREATE TRIGGER reject_script_cleanup BEFORE UPDATE ON webknossos.tasks FOR EACH ROW EXECUTE FUNCTION webknossos.reject_script_cleanup();")
        .execute(&database.pool).await.unwrap();
    assert_eq!(
        request(&router, "DELETE", &path, &recipient_token, None)
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        request(&router, "GET", &path, &recipient_token, None)
            .await
            .0,
        StatusCode::OK
    );
    let attached: Option<String> =
        sqlx::query_scalar("SELECT _script FROM webknossos.tasks WHERE _id = $1")
            .bind(&task)
            .fetch_one(&database.pool)
            .await
            .unwrap();
    assert_eq!(attached.as_deref(), Some(id));
    sqlx::query("DROP TRIGGER reject_script_cleanup ON webknossos.tasks")
        .execute(&database.pool)
        .await
        .unwrap();
    let (status, body) = request(&router, "DELETE", &path, &recipient_token, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, Value::Null);
    let attached: Option<String> =
        sqlx::query_scalar("SELECT _script FROM webknossos.tasks WHERE _id = $1")
            .bind(task)
            .fetch_one(&database.pool)
            .await
            .unwrap();
    assert_eq!(attached, None);
    assert_eq!(
        request(&router, "GET", &path, &recipient_token, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    database.cleanup().await;
}
