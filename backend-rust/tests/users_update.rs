mod common;

use axum::{
    Extension, Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use common::{TestDb, UserFixture, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    browser_auth::BrowserAuthConfig,
    mail::{MailSender, RecordingMailer},
    users,
};

const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";

fn app(database: &TestDb, mailer: &RecordingMailer, wkorg: bool) -> Router {
    let config = BrowserAuthConfig {
        is_wkorg_instance: wkorg,
        ..BrowserAuthConfig::default()
    };
    users::router(true)
        .layer(Extension(MailSender::new(mailer.clone())))
        .layer(Extension(config))
        .with_state(AppState {
            pool: database.pool.clone(),
        })
}

async fn patch(app: &Router, id: &str, token: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/users/{id}"))
                .header("x-auth-token", token)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
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

async fn add_team(database: &TestDb, organization: &str, name: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.teams (_id, _organization, name) VALUES ($1, $2, $3)")
        .bind(&id)
        .bind(organization)
        .bind(name)
        .execute(&database.pool)
        .await
        .unwrap();
    id
}

async fn member(database: &TestDb, organization: &str) -> UserFixture {
    database.seed_user(&object_id(), organization, false).await
}

async fn scalar<T>(database: &TestDb, sql: &str, id: &str) -> T
where
    T: Send + Unpin + for<'r> sqlx::Decode<'r, sqlx::Postgres> + sqlx::Type<sqlx::Postgres>,
{
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(&database.pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn admin_updates_permissions_teams_experiences_and_names() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let mailer = RecordingMailer::default();
    let app = app(&database, &mailer, false);
    let user = member(&database, &admin.organization_id).await;
    let other_team = add_team(&database, &admin.organization_id, "Another team").await;
    add_role(&database, &user.user_id, &admin.team_id, false).await;
    let task_type = object_id();

    let (status, body) = patch(
        &app,
        &user.user_id,
        &admin.token,
        json!({
            "firstName": "  New ", "lastName": "Name ", "isDatasetManager": true,
            "teams": [
                {"id": admin.team_id, "name": "ignored", "isTeamManager": true},
                {"id": other_team, "isTeamManager": false}
            ],
            "experiences": {" proofreading ": 4},
            "lastTaskTypeId": task_type,
            "isEditable": false
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["id"], user.user_id);
    assert_eq!(body["firstName"], "New");
    assert_eq!(body["lastName"], "Name");
    assert_eq!(body["isDatasetManager"], true);
    assert_eq!(body["isAdmin"], false);
    assert_eq!(body["isActive"], true);
    assert_eq!(body["isEditable"], true);
    assert_eq!(body["experiences"], json!({"proofreading": 4}));
    assert_eq!(body["lastTaskTypeId"], task_type);
    assert_eq!(
        body["teams"],
        json!([
            {"id": other_team, "name": "Another team", "isTeamManager": false},
            {"id": admin.team_id, "name": "Test team", "isTeamManager": true}
        ])
    );
    assert!(body.get("password").is_none() && body.get("userConfiguration").is_none());
    let domain: i64 = scalar(&database, "SELECT COUNT(*) FROM webknossos.experienceDomains WHERE domain = 'proofreading' AND _organization = $1", &admin.organization_id).await;
    assert_eq!(domain, 1);

    // Omitted fields keep their values, and lastTaskTypeId cannot be cleared.
    let (status, body) = patch(
        &app,
        &user.user_id,
        &admin.token,
        json!({"lastTaskTypeId": null}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["lastTaskTypeId"], task_type);
    assert_eq!(body["experiences"], json!({"proofreading": 4}));
    assert_eq!(body["teams"].as_array().unwrap().len(), 2);

    // Unknown team: 404 before anything is written.
    let missing = object_id();
    let (status, body) = patch(
        &app,
        &user.user_id,
        &admin.token,
        json!({"teams": [{"id": missing, "isTeamManager": false}], "isAdmin": true}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        error(&format!("Team “{missing}” could not be found or accessed."))
    );
    let is_admin: bool = scalar(
        &database,
        "SELECT isAdmin FROM webknossos.users WHERE _id = $1",
        &user.user_id,
    )
    .await;
    assert!(!is_admin);

    // Users of other organizations are not readable.
    let foreign = database.fixture().await;
    let (status, body) = patch(&app, &foreign.user_id, &admin.token, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        error(&format!(
            "User “{}” could not be found or accessed.",
            foreign.user_id
        ))
    );

    // Only own names on wkorg instances.
    let wkorg = app_with_wkorg(&database, &mailer);
    let (status, body) = patch(
        &wkorg,
        &user.user_id,
        &admin.token,
        json!({"firstName": "Other"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error("On this webknossos instance, users may only change their own names.")
    );
    database.cleanup().await;
}

fn app_with_wkorg(database: &TestDb, mailer: &RecordingMailer) -> Router {
    app(database, mailer, true)
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn self_and_team_manager_rules() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let mailer = RecordingMailer::default();
    let app = app(&database, &mailer, false);
    let organization = &admin.organization_id;
    let manager = member(&database, organization).await;
    let user = member(&database, organization).await;
    let unmanaged = add_team(&database, organization, "Unmanaged").await;
    let managed_extra = add_team(&database, organization, "Managed extra").await;
    add_role(&database, &manager.user_id, &admin.team_id, true).await;
    add_role(&database, &manager.user_id, &managed_extra, true).await;
    add_role(&database, &user.user_id, &admin.team_id, false).await;
    add_role(&database, &user.user_id, &unmanaged, false).await;

    // Self: names allowed, privileged fields not.
    let (status, body) = patch(
        &app,
        &user.user_id,
        &user.token,
        json!({"firstName": "Self", "lastName": "Named"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        (body["firstName"].clone(), body["isEditable"].clone()),
        (json!("Self"), json!(false))
    );
    for change in [
        json!({"isAdmin": true}),
        json!({"isDatasetManager": true}),
        json!({"experiences": {"skill": 10}}),
        json!({"teams": [{"id": admin.team_id, "isTeamManager": true}]}),
    ] {
        let (status, body) = patch(&app, &user.user_id, &user.token, change).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(body, error(NOT_ALLOWED));
    }
    // An unchanged full object (teams in another order) is accepted.
    let (status, current) = patch(&app, &user.user_id, &user.token, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let mut full = current.clone();
    full["teams"].as_array_mut().unwrap().reverse();
    let (status, body) = patch(&app, &user.user_id, &user.token, full).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["teams"], current["teams"]);

    // Team manager: admin-only fields and names are rejected.
    let (status, body) = patch(
        &app,
        &user.user_id,
        &manager.token,
        json!({"isAdmin": true}),
    )
    .await;
    assert_eq!((status, body), (StatusCode::FORBIDDEN, error(NOT_ALLOWED)));
    let (status, body) = patch(
        &app,
        &user.user_id,
        &manager.token,
        json!({"isActive": false}),
    )
    .await;
    assert_eq!((status, body), (StatusCode::FORBIDDEN, error(NOT_ALLOWED)));
    let (status, body) = patch(
        &app,
        &user.user_id,
        &manager.token,
        json!({"lastName": "Renamed"}),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Only admins can change the names of other users.")
        )
    );
    let (status, body) = patch(
        &app,
        &user.user_id,
        &manager.token,
        json!({"email": "other@example.test"}),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(NOT_ALLOWED))
    );

    // Memberships of unmanaged teams are kept; managed ones follow the request.
    let (status, body) = patch(
        &app,
        &user.user_id,
        &manager.token,
        json!({
            "teams": [
                {"id": admin.team_id, "isTeamManager": false},
                {"id": managed_extra, "isTeamManager": true}
            ],
            "experiences": {"skill": 2}
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["teams"],
        json!([
            {"id": managed_extra, "name": "Managed extra", "isTeamManager": true},
            {"id": admin.team_id, "name": "Test team", "isTeamManager": false},
            {"id": unmanaged, "name": "Unmanaged", "isTeamManager": false}
        ])
    );
    assert_eq!(body["experiences"], json!({"skill": 2}));

    // Removing the user from all managed teams would end the manager's access:
    // rejected like Play's update-access check, and rolled back entirely.
    let (status, body) = patch(
        &app,
        &user.user_id,
        &manager.token,
        json!({"teams": [], "experiences": {}}),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error("No update access."))
    );
    let roles: i64 = scalar(
        &database,
        "SELECT COUNT(*) FROM webknossos.user_team_roles WHERE _user = $1",
        &user.user_id,
    )
    .await;
    assert_eq!(roles, 3);

    // Users without shared managed teams are not visible to the manager.
    let outsider = member(&database, organization).await;
    add_role(&database, &outsider.user_id, &unmanaged, false).await;
    let (status, _) = patch(&app, &outsider.user_id, &manager.token, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn email_change_requires_own_password_and_free_address() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let mailer = RecordingMailer::default();
    let app = app(&database, &mailer, false);
    let hash = bcrypt::hash("correct-password", 4).unwrap();
    sqlx::query("UPDATE webknossos.multiUsers SET passwordInfo_password = $2, isEmailVerified = TRUE WHERE _id = $1")
        .bind(&admin.multi_user_id).bind(hash).execute(&database.pool).await.unwrap();
    let other = member(&database, &admin.organization_id).await;
    let taken: String = scalar(
        &database,
        "SELECT email FROM webknossos.multiUsers WHERE _id = $1",
        &other.multi_user_id,
    )
    .await;
    let invalid = error("Incorrect email or password. Please try again.");
    for body in [
        json!({"email": "new@example.test"}),
        json!({"email": "new@example.test", "password": "wrong"}),
    ] {
        assert_eq!(
            patch(&app, &admin.user_id, &admin.token, body).await,
            (StatusCode::BAD_REQUEST, invalid.clone())
        );
    }
    assert_eq!(
        patch(
            &app,
            &admin.user_id,
            &admin.token,
            json!({"email": taken, "password": "correct-password"})
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error(
                "An account with this email address already exists. Please log in instead or use a different email."
            )
        )
    );
    // Admins cannot change other users' addresses.
    assert_eq!(
        patch(
            &app,
            &other.user_id,
            &admin.token,
            json!({"email": "x@example.test"})
        )
        .await,
        (StatusCode::BAD_REQUEST, error(NOT_ALLOWED))
    );
    let (status, body) = patch(
        &app,
        &admin.user_id,
        &admin.token,
        json!({"email": "new@example.test", "password": "correct-password"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["email"], "new@example.test");
    assert_eq!(body["isEmailVerified"], false);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn activation_and_deactivation_invariants() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let mailer = RecordingMailer::default();
    let app = app(&database, &mailer, false);
    let organization = admin.organization_id.clone();
    sqlx::query("UPDATE webknossos.users SET isOrganizationOwner = TRUE WHERE _id = $1")
        .bind(&admin.user_id)
        .execute(&database.pool)
        .await
        .unwrap();

    assert_eq!(
        patch(
            &app,
            &admin.user_id,
            &admin.token,
            json!({"isActive": false})
        )
        .await,
        (
            StatusCode::FORBIDDEN,
            error("You cannot deactivate yourself. Please contact an admin to do it for you.")
        )
    );
    assert_eq!(
        patch(
            &app,
            &admin.user_id,
            &admin.token,
            json!({"isAdmin": false})
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error(
                "This user is the last remaining admin in your organization. Cannot remove admin privileges from this account."
            )
        )
    );
    // A second admin may deactivate the owner only if another owner exists.
    let second = database.seed_user(&object_id(), &organization, true).await;
    assert_eq!(
        patch(
            &app,
            &admin.user_id,
            &second.token,
            json!({"isActive": false})
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error(
                "Cannot deactivate the organization owner. Please talk to the WEBKNOSSOS team to transfer organization ownership."
            )
        )
    );

    // Active task annotations block deactivation.
    let user = member(&database, &organization).await;
    let dataset = object_id();
    let project = object_id();
    let task_type = object_id();
    let task = object_id();
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('store','http://localhost:9000','https://data.example.test','key')").execute(&database.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_dataStore,_organization,_folder,name,directoryName,sortingKey) SELECT $1,'store',_id,_rootFolder,'Dataset','directory',NOW() FROM webknossos.organizations WHERE _id=$2").bind(&dataset).bind(&organization).execute(&database.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Project')").bind(&project).bind(&organization).bind(&admin.team_id).bind(&admin.user_id).execute(&database.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.taskTypes(_id,_organization,_team,summary,description,settings_branchPointsAllowed,settings_somaClickingAllowed) VALUES($1,$2,$3,'Type','',true,true)").bind(&task_type).bind(&organization).bind(&admin.team_id).execute(&database.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_taskType,neededExperience_domain,neededExperience_value,totalInstances,pendingInstances,editPosition,editRotation) VALUES($1,$2,$3,'test',0,1,1,ROW(0,0,0)::webknossos.VECTOR3,ROW(0,0,0)::webknossos.VECTOR3)").bind(&task).bind(&project).bind(&task_type).execute(&database.pool).await.unwrap();
    let annotation = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,state) VALUES($1,$2,$3,$4,'Task','Active')").bind(&annotation).bind(&dataset).bind(&task).bind(&user.user_id).execute(&database.pool).await.unwrap();
    assert_eq!(
        patch(
            &app,
            &user.user_id,
            &admin.token,
            json!({"isActive": false})
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error(&format!(
                "Cannot deactivate user with active tasks. Task ids are: {task}"
            ))
        )
    );
    sqlx::query("UPDATE webknossos.annotations SET state = 'Finished' WHERE _id = $1")
        .bind(&annotation)
        .execute(&database.pool)
        .await
        .unwrap();
    let (status, body) = patch(
        &app,
        &user.user_id,
        &admin.token,
        json!({"isActive": false}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["isActive"], false);
    assert!(mailer.take().is_empty());

    // Reactivation respects the organization’s user limit (2 active users now).
    sqlx::query("UPDATE webknossos.organizations SET includedUsers = 2 WHERE _id = $1")
        .bind(&organization)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        patch(&app, &user.user_id, &admin.token, json!({"isActive": true})).await,
        (
            StatusCode::BAD_REQUEST,
            error(
                "Cannot add new user to this organization because it would exceed the organization’s user limit. Please ask the organization owner to upgrade."
            )
        )
    );
    sqlx::query("UPDATE webknossos.organizations SET includedUsers = 3 WHERE _id = $1")
        .bind(&organization)
        .execute(&database.pool)
        .await
        .unwrap();
    let (status, body) = patch(&app, &user.user_id, &admin.token, json!({"isActive": true})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["isActive"], true);
    let mails = mailer.take();
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].subject, "WEBKNOSSOS | Account activated");
    assert_eq!(
        mails[0].recipients,
        vec![body["email"].as_str().unwrap().to_owned()]
    );

    // With a second admin, demotion succeeds.
    let (status, body) = patch(
        &app,
        &admin.user_id,
        &admin.token,
        json!({"isAdmin": false}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["isAdmin"], false);
    database.cleanup().await;
}
