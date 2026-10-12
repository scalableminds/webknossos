mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, folders};

fn app(database: &TestDb) -> Router {
    folders::router().with_state(AppState {
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
                .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    )
}

async fn create(app: &Router, parent: &str, name: &str, token: &str) -> Value {
    let parent = parent.to_uppercase();
    let query =
        serde_urlencoded::to_string([("parentId", parent.as_str()), ("name", name)]).unwrap();
    let (status, folder) = request(
        app,
        "POST",
        &format!("/folders/create?{query}"),
        token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{folder}");
    folder
}

async fn root_id(database: &TestDb, organization: &str) -> String {
    sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations WHERE _id = $1")
        .bind(organization)
        .fetch_one(&database.pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn folder_hierarchy_moves_roots_nonempty_delete_and_atomic_mutations() {
    let database = TestDb::new().await;
    let user = database.fixture().await;
    let other = database.fixture().await;
    let router = app(&database);
    let root = root_id(&database, &user.organization_id).await;
    let foreign_root = root_id(&database, &other.organization_id).await;
    let (_, root_json) = request(&router, "GET", "/folders/root", &user.token, None).await;
    assert_eq!(root_json["id"], root);
    assert!(root_json["created"].is_i64());
    assert_eq!(
        request(
            &router,
            "GET",
            &format!("/folders/{foreign_root}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let a = create(&router, &root, "A", &user.token).await;
    let a = a["id"].as_str().unwrap().to_owned();
    let b = create(&router, &root, "B", &user.token).await;
    let b = b["id"].as_str().unwrap().to_owned();
    let child = create(&router, &a, "Child 💡", &user.token).await;
    let child = child["id"].as_str().unwrap().to_owned();
    assert_eq!(
        request(
            &router,
            "DELETE",
            &format!("/folders/{root}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{root}/move?newParentId={b}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "DELETE",
            &format!("/folders/{a}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{a}/move?newParentId={child}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{a}/move?newParentId={a}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{a}/move?newParentId={foreign_root}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    // A failed closure insertion must roll back both create and the old paths of move.
    sqlx::raw_sql("CREATE FUNCTION webknossos.fail_folder_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test folder failure'; END $$; CREATE TRIGGER fail_paths_insert BEFORE INSERT ON webknossos.folder_paths FOR EACH ROW EXECUTE FUNCTION webknossos.fail_folder_change();")
        .execute(&database.pool).await.unwrap();
    assert_eq!(
        request(
            &router,
            "POST",
            &format!("/folders/create?parentId={root}&name=Failed"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let failed_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.folders WHERE name = 'Failed'")
            .fetch_one(&database.pool)
            .await
            .unwrap();
    assert_eq!(failed_count, 0);
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{a}/move?newParentId={b}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let parent: String = sqlx::query_scalar(
        "SELECT _ancestor FROM webknossos.folder_paths WHERE _descendant = $1 AND depth = 1",
    )
    .bind(&a)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(parent, root);
    sqlx::query("DROP TRIGGER fail_paths_insert ON webknossos.folder_paths")
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{a}/move?newParentId={b}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let depth: i32 = sqlx::query_scalar(
        "SELECT depth FROM webknossos.folder_paths WHERE _ancestor = $1 AND _descendant = $2",
    )
    .bind(&root)
    .bind(&child)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(depth, 3);
    let (_, tree) = request(&router, "GET", "/folders/tree", &user.token, None).await;
    assert_eq!(tree.as_array().unwrap().len(), 4);
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|f| f["id"] == a)
            .unwrap()["parent"],
        b
    );

    sqlx::query("INSERT INTO webknossos.folder_allowedTeams (_folder, _team) VALUES ($1, $2)")
        .bind(&a)
        .bind(&user.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    sqlx::query("CREATE TRIGGER fail_folder_update BEFORE UPDATE ON webknossos.folders FOR EACH ROW EXECUTE FUNCTION webknossos.fail_folder_change()")
        .execute(&database.pool).await.unwrap();
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{a}"),
            &user.token,
            Some(json!({"name":"Renamed", "metadata":[], "allowedTeams":[]}))
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let grants: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.folder_allowedTeams WHERE _folder = $1",
    )
    .bind(&a)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(grants, 1);
    sqlx::query("DROP TRIGGER fail_folder_update ON webknossos.folders")
        .execute(&database.pool)
        .await
        .unwrap();
    sqlx::query("CREATE TRIGGER fail_paths_delete BEFORE DELETE ON webknossos.folder_paths FOR EACH ROW EXECUTE FUNCTION webknossos.fail_folder_change()")
        .execute(&database.pool).await.unwrap();
    assert_eq!(
        request(
            &router,
            "DELETE",
            &format!("/folders/{child}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        request(
            &router,
            "GET",
            &format!("/folders/{child}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query("DROP TRIGGER fail_paths_delete ON webknossos.folder_paths")
        .execute(&database.pool)
        .await
        .unwrap();

    // Even an admin cannot delete a folder holding a live dataset.
    sqlx::query("INSERT INTO webknossos.dataStores (name, url, publicUrl, key) VALUES ('test', 'http://store.test', 'http://store.test', 'test')")
        .execute(&database.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id, _dataStore, _organization, _folder, name, directoryName, sortingKey) VALUES ($1, 'test', $2, $3, 'Dataset', 'Dataset', NOW())")
        .bind(&dataset).bind(&user.organization_id).bind(&child).execute(&database.pool).await.unwrap();
    assert_eq!(
        request(
            &router,
            "DELETE",
            &format!("/folders/{child}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    sqlx::query("UPDATE webknossos.datasets SET isDeleted = TRUE WHERE _id = $1")
        .bind(dataset)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &router,
            "DELETE",
            &format!("/folders/{child}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &router,
            "GET",
            &format!("/folders/{child}"),
            &user.token,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn inherited_folder_access_and_grant_updates_preserve_unmanaged_teams() {
    let database = TestDb::new().await;
    let admin = database.fixture().await;
    let foreign = database.fixture().await;
    let member_id = object_id();
    database
        .seed_user(&member_id, &admin.organization_id, false)
        .await;
    let token = database.seed_token(&member_id, "Authentication").await;
    let router = app(&database);
    let root = root_id(&database, &admin.organization_id).await;
    let grant = create(&router, &root, "Grant", &admin.token).await;
    let grant = grant["id"].as_str().unwrap().to_owned();
    let child = create(&router, &grant, "Child", &admin.token).await;
    let child = child["id"].as_str().unwrap().to_owned();
    let hidden = create(&router, &root, "Hidden", &admin.token).await;
    let hidden = hidden["id"].as_str().unwrap().to_owned();
    sqlx::query("INSERT INTO webknossos.user_team_roles (_user, _team) VALUES ($1, $2)")
        .bind(&member_id)
        .bind(&admin.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.folder_allowedTeams (_folder, _team) VALUES ($1, $2)")
        .bind(&grant)
        .bind(&admin.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let (_, child_json) = request(&router, "GET", &format!("/folders/{child}"), &token, None).await;
    assert_eq!(child_json["allowedTeams"], json!([]));
    assert_eq!(child_json["allowedTeamsCumulative"][0]["id"], admin.team_id);
    assert_eq!(child_json["isEditable"], false);
    let (_, breadcrumb) = request(&router, "GET", "/folders/root", &token, None).await;
    assert_eq!(breadcrumb["id"], root);
    assert_eq!(breadcrumb["isEditable"], false);
    assert_eq!(
        request(&router, "GET", &format!("/folders/{hidden}"), &token, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let params =
        json!({"name":"Edited", "metadata":[{"key":"hello", "value":"world"}], "allowedTeams":[]});
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{child}"),
            &token,
            Some(params.clone())
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &router,
            "DELETE",
            &format!("/folders/{child}"),
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
            "POST",
            &format!("/folders/create?parentId={grant}&name=Forbidden"),
            &token,
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (_, tree) = request(&router, "GET", "/folders/tree", &token, None).await;
    assert_eq!(tree.as_array().unwrap().len(), 3);
    // Dataset shares and public datasets expose their breadcrumbs, but confer no edit rights.
    sqlx::query("INSERT INTO webknossos.dataStores (name, url, publicUrl, key) VALUES ('test', 'http://store.test', 'http://store.test', 'test')")
        .execute(&database.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id, _dataStore, _organization, _folder, name, directoryName, sortingKey, isPublic) VALUES ($1, 'test', $2, $3, 'Dataset', 'Dataset', NOW(), TRUE)")
        .bind(&dataset).bind(&admin.organization_id).bind(&hidden).execute(&database.pool).await.unwrap();
    let (status, breadcrumb) =
        request(&router, "GET", &format!("/folders/{hidden}"), &token, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(breadcrumb["isEditable"], false);
    sqlx::query("UPDATE webknossos.datasets SET isPublic = FALSE WHERE _id = $1")
        .bind(&dataset)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&router, "GET", &format!("/folders/{hidden}"), &token, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset, _team) VALUES ($1, $2)")
        .bind(dataset)
        .bind(&admin.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&router, "GET", &format!("/folders/{hidden}"), &token, None)
            .await
            .0,
        StatusCode::OK
    );
    sqlx::query("UPDATE webknossos.user_team_roles SET isTeamManager = TRUE WHERE _user = $1 AND _team = $2")
        .bind(&member_id).bind(&admin.team_id).execute(&database.pool).await.unwrap();
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{child}"),
            &token,
            Some(params)
        )
        .await
        .0,
        StatusCode::OK
    );
    let unmanaged = object_id();
    sqlx::query(
        "INSERT INTO webknossos.teams (_id, _organization, name) VALUES ($1, $2, 'Unmanaged')",
    )
    .bind(&unmanaged)
    .bind(&admin.organization_id)
    .execute(&database.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO webknossos.folder_allowedTeams (_folder, _team) VALUES ($1, $2), ($1, $3)",
    )
    .bind(&child)
    .bind(&unmanaged)
    .bind(&admin.team_id)
    .execute(&database.pool)
    .await
    .unwrap();
    let (_, updated) = request(
        &router,
        "PUT",
        &format!("/folders/{child}"),
        &token,
        Some(json!({"name":"Updated", "metadata":[], "allowedTeams":[foreign.team_id]})),
    )
    .await;
    assert_eq!(updated["allowedTeams"], json!([]));
    let actual: Vec<String> =
        sqlx::query_scalar("SELECT _team FROM webknossos.folder_allowedTeams WHERE _folder = $1")
            .bind(&child)
            .fetch_all(&database.pool)
            .await
            .unwrap();
    assert_eq!(actual, vec![unmanaged.clone()]);
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{child}"),
            &token,
            Some(
                json!({"name":"Invalid", "metadata":[{"key":"a"},{"key":"a"}], "allowedTeams":[]})
            )
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "PUT",
            &format!("/folders/{child}"),
            &token,
            Some(json!({"name":"a/b", "metadata":[], "allowedTeams":[]}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    // Dataset managers can edit every folder, and change grants to teams of which they are members.
    sqlx::query("UPDATE webknossos.users SET isDatasetManager = TRUE WHERE _id = $1")
        .bind(&member_id)
        .execute(&database.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.user_team_roles SET isTeamManager = FALSE WHERE _user = $1")
        .bind(&member_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let (status, _) = request(
        &router,
        "PUT",
        &format!("/folders/{hidden}"),
        &token,
        Some(json!({"name":"Manager", "metadata":[], "allowedTeams":[admin.team_id]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.folder_allowedTeams WHERE _folder = $1 AND _team = $2",
    )
    .bind(hidden)
    .bind(&admin.team_id)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
    database.cleanup().await;
}
