mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, users};

fn app(database: &TestDb, email_verification: bool) -> Router {
    users::router(email_verification).with_state(AppState {
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
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("x-auth-token", token)
                .header("content-type", "application/json")
                .body(Body::from(
                    body.map(|value| value.to_string()).unwrap_or_default(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn add_role(database: &TestDb, user: &str, team: &str, manager: bool) {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user, _team, isTeamManager) VALUES ($1, $2, $3)",
    )
    .bind(user)
    .bind(team)
    .bind(manager)
    .execute(&database.pool)
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn current_user_response_matches_public_fields_without_private_account_data() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    add_role(&database, &fixture.user_id, &fixture.team_id, true).await;
    sqlx::query("INSERT INTO webknossos.user_experiences (_user, domain, value) VALUES ($1, 'proofreading', 3)")
        .bind(&fixture.user_id).execute(&database.pool).await.unwrap();
    sqlx::query(
        "UPDATE webknossos.users SET lastActivity = NOW() - INTERVAL '1 hour' WHERE _id = $1",
    )
    .bind(&fixture.user_id)
    .execute(&database.pool)
    .await
    .unwrap();
    let (status, user) = request(&app(&database, true), "GET", "/user", &fixture.token, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(user["id"], fixture.user_id);
    assert_eq!(user["organization"], fixture.organization_id);
    for path_id in [
        fixture.user_id.to_uppercase(),
        format!("readable-user-{}", fixture.user_id.to_uppercase()),
    ] {
        let (status, found) = request(
            &app(&database, true),
            "GET",
            &format!("/users/{path_id}"),
            &fixture.token,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(found["id"], fixture.user_id);
    }
    assert_eq!(user["experiences"], json!({"proofreading": 3}));
    assert_eq!(
        user["teams"],
        json!([{"id": fixture.team_id, "name": "Test team", "isTeamManager": true}])
    );
    assert!(user["created"].is_i64() && user["lastActivity"].is_i64());
    assert_eq!(user["isEmailVerified"], false);
    for private in [
        "passwordInfo_password",
        "password",
        "token",
        "userConfiguration",
        "_multiUser",
    ] {
        assert!(user.get(private).is_none());
    }
    let updated_activity: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT lastActivity FROM webknossos.users WHERE _id = $1")
            .bind(&fixture.user_id)
            .fetch_one(&database.pool)
            .await
            .unwrap();
    assert!(updated_activity.timestamp_millis() > user["lastActivity"].as_i64().unwrap());
    assert_eq!(
        request(&app(&database, false), "GET", "/user", &fixture.token, None)
            .await
            .1["isEmailVerified"],
        true
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn read_access_requires_admin_or_shared_managed_team_and_editability() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let foreign = database.fixture().await;
    let member = database
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    let manager = database
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    add_role(&database, &member.user_id, &admin.team_id, false).await;
    add_role(&database, &manager.user_id, &admin.team_id, true).await;
    let router = app(&database, true);
    // A foreign team role can remain after an identity changes organization.
    add_role(&database, &foreign.user_id, &foreign.team_id, false).await;
    add_role(&database, &manager.user_id, &foreign.team_id, true).await;
    let foreign_path = format!("/users/{}", foreign.user_id);
    assert_eq!(
        request(&router, "GET", &foreign_path, &manager.token, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("{foreign_path}/taskTypeId"),
            &manager.token,
            Some(json!({"lastTaskTypeId": object_id()}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let path = format!("/users/{}", member.user_id);
    assert_eq!(
        request(&router, "GET", &path, &admin.token, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(&router, "GET", &path, &manager.token, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(&router, "GET", &path, &member.token, None).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&router, "GET", &path, &foreign.token, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&router, "GET", "/user", &member.token, None)
            .await
            .0,
        StatusCode::OK
    );
    let stranger = database
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    assert_eq!(
        request(&router, "GET", &path, &stranger.token, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.teams SET isDeleted = TRUE WHERE _id = $1")
        .bind(&admin.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&router, "GET", &path, &manager.token, None).await.0,
        StatusCode::NOT_FOUND
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn user_list_filters_respect_privacy_and_do_not_grant_superuser_admin_access() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let hidden = database
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    let manager = database
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    let member = database
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    add_role(&database, &manager.user_id, &admin.team_id, true).await;
    add_role(&database, &member.user_id, &admin.team_id, false).await;
    sqlx::query("UPDATE webknossos.users SET isUnlisted = TRUE WHERE _id = $1")
        .bind(&hidden.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let foreign = database.fixture().await;
    let router = app(&database, true);
    let (status, list) = request(&router, "GET", "/users", &admin.token, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 3);
    assert_eq!(
        request(&router, "GET", "/users?isAdmin=true", &admin.token, None)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        request(
            &router,
            "GET",
            "/users?isTeamManagerOrAdmin=true",
            &admin.token,
            None
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        2
    );
    assert_eq!(
        request(
            &router,
            "GET",
            "/users?isTeamManagerOrAdmin=false",
            &admin.token,
            None
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        1
    );
    assert_eq!(
        request(
            &router,
            "GET",
            "/users?isEditable=true",
            &member.token,
            None
        )
        .await
        .1,
        json!([])
    );
    assert_eq!(
        request(
            &router,
            "GET",
            "/users?isEditable=false",
            &member.token,
            None
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        1
    );
    assert_eq!(
        request(&router, "GET", "/users?isAdmin=invalid", &admin.token, None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser = TRUE WHERE _id = $1")
        .bind(&admin.multi_user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&router, "GET", "/users", &admin.token, None)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        request(
            &router,
            "GET",
            &format!("/users/{}", foreign.user_id),
            &admin.token,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.users SET isDeleted = TRUE WHERE _id = $1")
        .bind(&hidden.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&router, "GET", "/users", &admin.token, None)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        3
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn narrow_settings_preserve_self_only_rules_and_null_task_type() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let member = database
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    add_role(&database, &member.user_id, &admin.team_id, false).await;
    let router = app(&database, true);
    let theme_path = format!("/users/{}/selectedTheme", member.user_id);
    let experience_path = format!("/users/{}/novelUserExperienceInfos", member.user_id);
    let task_type_path = format!("/users/{}/taskTypeId", member.user_id);
    assert_eq!(
        request(
            &router,
            "PUT",
            &theme_path,
            &admin.token,
            Some(json!("dark"))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &experience_path,
            &admin.token,
            Some(json!({"seen": true}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &theme_path,
            &member.token,
            Some(json!("dark"))
        )
        .await
        .1["selectedTheme"],
        "dark"
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &theme_path,
            &member.token,
            Some(json!("unknown"))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &experience_path,
            &member.token,
            Some(json!([]))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &experience_path,
            &member.token,
            Some(json!({"seen": true}))
        )
        .await
        .1["novelUserExperienceInfos"],
        json!({"seen": true})
    );
    let task_type = object_id();
    assert_eq!(
        request(
            &router,
            "PUT",
            &task_type_path,
            &member.token,
            Some(json!({"lastTaskTypeId": task_type}))
        )
        .await
        .1["lastTaskTypeId"],
        task_type
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &task_type_path,
            &member.token,
            Some(json!({"lastTaskTypeId": null}))
        )
        .await
        .1["lastTaskTypeId"],
        Value::Null
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &task_type_path,
            &member.token,
            Some(json!({"lastTaskTypeId": "invalid"}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(&router, "GET", "/users/invalid", &admin.token, None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    database.cleanup().await;
}
