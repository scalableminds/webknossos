//! PATCH edit, PATCH editLockedState and GET/PATCH sharedTeams of typed
//! annotations, against a real database and (for compound types) a mock
//! tracing store.
mod common;

use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use prost::Message;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    annotation_metadata::{
        ACCESSING_TEAM_FAILED, EDIT_FAILED, EDIT_NOT_ALLOWED, EDIT_SUCCESS,
        LOCK_EXPLORATIONALS_ONLY, LOCK_NOT_ALLOWED, LOCK_SUCCESS, NO_UPDATE_ACCESS, NOT_ALLOWED,
        SHARED_TEAMS_UPDATE_FAILED, invalid_object_id,
    },
    annotation_provider::{ANNOTATION_NOT_FOUND, RESTRICTIONS_NOT_FOUND},
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    router,
};

async fn send(
    app: &Router,
    method: Method,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("x-auth-token", token);
    let body = match body {
        Some(body) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn patch(app: &Router, token: &str, path: &str, body: Value) -> (StatusCode, Value) {
    send(app, Method::PATCH, token, path, Some(body)).await
}

async fn patch_empty(app: &Router, token: &str, path: &str) -> (StatusCode, Value) {
    send(app, Method::PATCH, token, path, None).await
}

async fn get(app: &Router, token: &str, path: &str) -> (StatusCode, Value) {
    send(app, Method::GET, token, path, None).await
}

fn error(message: &str) -> Value {
    json!({"messages":[{"error": message}]})
}

struct World {
    organization: String,
    team: String,
    other_team: String,
    foreign_team: String,
    deleted_team: String,
    dataset: String,
    admin_token: String,
    owner: String,
    owner_token: String,
    collaborator: String,
    collaborator_token: String,
    manager_token: String,
    foreign_token: String,
    /// Explorational, Private, Active, OwnerOnly.
    private: String,
    /// Explorational, Internal, Active, OwnerOnly, one skeleton layer.
    internal: String,
    /// Explorational, Internal, Active, Concurrent.
    concurrent: String,
    /// Explorational, Internal, Finished.
    finished: String,
    /// Explorational, Internal, Active, locked by owner.
    locked: String,
    /// Task, Private, Active (project team = `team`).
    task_annotation: String,
    deleted: String,
    task: String,
}

/// (typ, visibility, state, collaboration mode, locked, task, deleted)
type Row<'a> = (
    &'a str,
    &'a str,
    &'a str,
    &'a str,
    bool,
    Option<&'a str>,
    bool,
);

async fn insert_annotation(db: &TestDb, dataset: &str, owner: &str, row: Row<'_>) -> String {
    let (typ, visibility, state, mode, locked, task, deleted) = row;
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,collaborationMode,isLockedByOwner,isDeleted,name,description,tags,created,modified) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,$7::webknossos.ANNOTATION_STATE,$8::webknossos.ANNOTATION_COLLABORATION_MODE,$9,$10,'Original','Description',ARRAY['old'],TIMESTAMPTZ '2020-01-01T00:00:00Z',TIMESTAMPTZ '2020-01-02T00:00:00Z')")
        .bind(&id).bind(dataset).bind(task).bind(owner).bind(typ).bind(visibility).bind(state).bind(mode).bind(locked).bind(deleted)
        .execute(&db.pool).await.unwrap();
    id
}

async fn add_role(db: &TestDb, user: &str, team: &str, manager: bool) {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,$3)",
    )
    .bind(user)
    .bind(team)
    .bind(manager)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn insert_team(db: &TestDb, organization: &str, name: &str, deleted: bool) -> String {
    let id = object_id();
    sqlx::query(
        "INSERT INTO webknossos.teams(_id,_organization,name,isDeleted) VALUES($1,$2,$3,$4)",
    )
    .bind(&id)
    .bind(organization)
    .bind(name)
    .bind(deleted)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

async fn world(db: &TestDb, tracing_store_url: &str) -> World {
    let f = db.fixture().await;
    let foreign_organization = format!("rust-test-foreign-{}", object_id());
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let collaborator = db.seed_user(&object_id(), &f.organization_id, false).await;
    let manager = db.seed_user(&object_id(), &f.organization_id, false).await;
    let foreign = db
        .seed_user(&object_id(), &foreign_organization, true)
        .await;
    add_role(db, &owner.user_id, &f.team_id, false).await;
    add_role(db, &collaborator.user_id, &f.team_id, false).await;
    add_role(db, &manager.user_id, &f.team_id, true).await;
    let other_team = insert_team(db, &f.organization_id, "Other team", false).await;
    let deleted_team = insert_team(db, &f.organization_id, "Deleted team", true).await;
    add_role(db, &owner.user_id, &deleted_team, false).await;
    let foreign_team = insert_team(db, &foreign_organization, "Foreign team", false).await;
    // A stale foreign role must not broaden team read access.
    add_role(db, &owner.user_id, &foreign_team, false).await;

    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('metadata','http://localhost:9000','https://data.example.test','k')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('metadata-ts',$1,'https://tracing.example.test','k')")
        .bind(tracing_store_url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'metadata',_id,_rootfolder,'Dataset','directory',now(),true,ROW(1,1,1)::webknossos.VECTOR3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (project, task_type, task) = (object_id(), object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Metadata-project')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Metadata-type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation,boundingbox) VALUES($1,$2,$3,'test',0,10,10,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3,ROW(1,2,3,10,20,30)::webknossos.BOUNDING_BOX)")
        .bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();

    let o = owner.user_id.as_str();
    let d = dataset.as_str();
    let private = insert_annotation(
        db,
        d,
        o,
        (
            "Explorational",
            "Private",
            "Active",
            "OwnerOnly",
            false,
            None,
            false,
        ),
    )
    .await;
    let internal = insert_annotation(
        db,
        d,
        o,
        (
            "Explorational",
            "Internal",
            "Active",
            "OwnerOnly",
            false,
            None,
            false,
        ),
    )
    .await;
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{}'::jsonb)")
        .bind(&internal).bind(format!("tracing-{internal}")).execute(&db.pool).await.unwrap();
    let concurrent = insert_annotation(
        db,
        d,
        o,
        (
            "Explorational",
            "Internal",
            "Active",
            "Concurrent",
            false,
            None,
            false,
        ),
    )
    .await;
    let finished = insert_annotation(
        db,
        d,
        o,
        (
            "Explorational",
            "Internal",
            "Finished",
            "OwnerOnly",
            false,
            None,
            false,
        ),
    )
    .await;
    let locked = insert_annotation(
        db,
        d,
        o,
        (
            "Explorational",
            "Internal",
            "Active",
            "OwnerOnly",
            true,
            None,
            false,
        ),
    )
    .await;
    let task_annotation = insert_annotation(
        db,
        d,
        o,
        (
            "Task",
            "Private",
            "Active",
            "OwnerOnly",
            false,
            Some(&task),
            false,
        ),
    )
    .await;
    let deleted = insert_annotation(
        db,
        d,
        o,
        (
            "Explorational",
            "Internal",
            "Active",
            "OwnerOnly",
            false,
            None,
            true,
        ),
    )
    .await;
    World {
        organization: f.organization_id,
        team: f.team_id,
        other_team,
        foreign_team,
        deleted_team,
        dataset,
        admin_token: f.token,
        owner: owner.user_id,
        owner_token: owner.token,
        collaborator: collaborator.user_id,
        collaborator_token: collaborator.token,
        manager_token: manager.token,
        foreign_token: foreign.token,
        private,
        internal,
        concurrent,
        finished,
        locked,
        task_annotation,
        deleted,
        task,
    }
}

fn app(db: &TestDb) -> Router {
    router(AppState {
        pool: db.pool.clone(),
    })
}

#[derive(sqlx::FromRow, Debug, PartialEq)]
struct Snapshot {
    name: String,
    visibility: String,
    tags: Vec<String>,
    is_locked_by_owner: bool,
    modified: chrono::DateTime<chrono::Utc>,
}

async fn snapshot(db: &TestDb, id: &str) -> Snapshot {
    sqlx::query_as("SELECT name,visibility::text AS visibility,tags,isLockedByOwner AS is_locked_by_owner,modified FROM webknossos.annotations WHERE _id=$1")
        .bind(id)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

async fn shared_rows(db: &TestDb, id: &str) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT _team FROM webknossos.annotation_sharedTeams WHERE _annotation=$1 ORDER BY _team",
    )
    .bind(id)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

async fn share(db: &TestDb, annotation: &str, teams: &[&str]) {
    for team in teams {
        sqlx::query(
            "INSERT INTO webknossos.annotation_sharedTeams(_annotation,_team) VALUES($1,$2)",
        )
        .bind(annotation)
        .bind(team)
        .execute(&db.pool)
        .await
        .unwrap();
    }
}

async fn view_configuration(db: &TestDb, annotation: &str, user: &str) -> Option<Value> {
    sqlx::query_scalar("SELECT viewConfiguration FROM webknossos.user_annotationViewConfigurations WHERE _annotation=$1 AND _user=$2")
        .bind(annotation)
        .bind(user)
        .fetch_optional(&db.pool)
        .await
        .unwrap()
}

fn sorted(mut ids: Vec<String>) -> Vec<String> {
    ids.sort();
    ids
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn edit_checks_provider_restrictions_and_runtime_gate_in_order() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    let success = json!({"messages":[{"success": EDIT_SUCCESS}]});
    let name = json!({"name": "Renamed"});

    // Invalid type and provider failures are explicitly 404.
    let (status, body) = patch(
        &app,
        &w.owner_token,
        &format!("/api/annotations/view/{}/edit", w.internal),
        name.clone(),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error("Invalid AnnotationType: view"))
    );
    for (token, id) in [
        (&w.owner_token, object_id()),
        (&w.owner_token, w.deleted.clone()),
        // Provider read gate first: a same-organization member cannot read Private.
        (&w.collaborator_token, w.private.clone()),
        // Team managers have no Private DAO read access.
        (&w.manager_token, w.task_annotation.clone()),
        (&w.foreign_token, w.internal.clone()),
    ] {
        let (status, body) = patch(
            &app,
            token,
            &format!("/api/annotations/Explorational/{id}/edit"),
            name.clone(),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
        );
    }

    // Runtime gate: finished, owner-locked, OwnerOnly for collaborators and
    // admins (DAO write access does not grant runtime update).
    for (token, id) in [
        (&w.owner_token, &w.finished),
        (&w.owner_token, &w.locked),
        (&w.collaborator_token, &w.internal),
        (&w.admin_token, &w.private),
        (&w.admin_token, &w.internal),
    ] {
        let before = snapshot(&db, id).await;
        let (status, body) = patch(
            &app,
            token,
            &format!("/api/annotations/Explorational/{id}/edit"),
            name.clone(),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::FORBIDDEN, error(EDIT_NOT_ALLOWED)),
            "{id}"
        );
        assert_eq!(snapshot(&db, id).await, before);
    }

    // Saved type aliases resolve the live row; path IDs may be prefixed/uppercase.
    for typ in ["View", "Task", "Orphan", "TracingBase", "Explorational"] {
        let (status, body) = patch(
            &app,
            &w.owner_token,
            &format!(
                "/api/annotations/{typ}/name-{}/edit",
                w.internal.to_ascii_uppercase()
            ),
            json!({"name": format!("Renamed {typ}")}),
        )
        .await;
        assert_eq!((status, &body), (StatusCode::OK, &success), "{typ}");
        assert_eq!(
            snapshot(&db, &w.internal).await.name,
            format!("Renamed {typ}")
        );
    }

    // Empty and all-null edits are no-ops; unknown fields are ignored.
    let before = snapshot(&db, &w.internal).await;
    for body in [
        json!({}),
        json!({"name":null,"visibility":null,"tags":null,"viewConfiguration":null,"description":"ignored"}),
    ] {
        let (status, response) = patch(
            &app,
            &w.owner_token,
            &format!("/api/annotations/Explorational/{}/edit", w.internal),
            body,
        )
        .await;
        assert_eq!((status, &response), (StatusCode::OK, &success));
    }
    assert_eq!(snapshot(&db, &w.internal).await, before);
    assert!(
        view_configuration(&db, &w.internal, &w.owner)
            .await
            .is_none()
    );

    // Invalid bodies fail before any provider work.
    for body in [
        json!({"visibility": "private"}),
        json!({"tags": "tag"}),
        json!({"viewConfiguration": [1]}),
        json!([]),
    ] {
        let (status, _) = patch(
            &app,
            &w.owner_token,
            &format!("/api/annotations/Explorational/{}/edit", w.internal),
            body,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    // Owner sets every field; tags are stored as supplied (duplicates kept),
    // modified is untouched, the view configuration is requester-specific.
    let (status, body) = patch(
        &app,
        &w.owner_token,
        &format!("/api/annotations/Explorational/{}/edit", w.internal),
        json!({"name":"","visibility":"Public","tags":["b","a","b"],"viewConfiguration":{"zoom":2}}),
    )
    .await;
    assert_eq!((status, body), (StatusCode::OK, success.clone()));
    let after = snapshot(&db, &w.internal).await;
    assert_eq!(
        (
            after.name.as_str(),
            after.visibility.as_str(),
            after.tags.clone()
        ),
        ("", "Public", vec!["b".into(), "a".into(), "b".into()])
    );
    assert_eq!(after.modified, before.modified);
    assert_eq!(
        view_configuration(&db, &w.internal, &w.owner).await,
        Some(json!({"zoom":2}))
    );
    // UPSERT on (annotation, user).
    patch(
        &app,
        &w.owner_token,
        &format!("/api/annotations/Explorational/{}/edit", w.internal),
        json!({"viewConfiguration":{"zoom":3}}),
    )
    .await;
    assert_eq!(
        view_configuration(&db, &w.internal, &w.owner).await,
        Some(json!({"zoom":3}))
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn edit_separates_runtime_update_from_dao_update_access_and_clears_teams_atomically() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    let path = format!("/api/annotations/Explorational/{}/edit", w.concurrent);
    share(&db, &w.concurrent, &[&w.team, &w.other_team]).await;

    // A Concurrent collaborator passes the runtime gate: view configuration
    // alone needs no DAO update access.
    let (status, _) = patch(
        &app,
        &w.collaborator_token,
        &path,
        json!({"viewConfiguration":{"mine":true}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        view_configuration(&db, &w.concurrent, &w.collaborator).await,
        Some(json!({"mine":true}))
    );

    // DAO-protected fields fail with 400 and roll back the whole edit.
    let before = snapshot(&db, &w.concurrent).await;
    for (body, message) in [
        (
            json!({"name":"x","viewConfiguration":{"mine":false}}),
            EDIT_FAILED,
        ),
        (json!({"tags":[]}), EDIT_FAILED),
        (json!({"visibility":"Public"}), EDIT_FAILED),
        // Private first clears shared teams, whose DAO failure is unwrapped.
        (
            json!({"visibility":"Private","viewConfiguration":{"mine":false}}),
            NO_UPDATE_ACCESS,
        ),
    ] {
        let (status, response) = patch(&app, &w.collaborator_token, &path, body).await;
        assert_eq!(
            (status, response),
            (StatusCode::BAD_REQUEST, error(message))
        );
    }
    assert_eq!(snapshot(&db, &w.concurrent).await, before);
    assert_eq!(
        view_configuration(&db, &w.concurrent, &w.collaborator).await,
        Some(json!({"mine":true}))
    );
    assert_eq!(shared_rows(&db, &w.concurrent).await.len(), 2);

    // Owner sets Private: teams cleared together with the visibility change.
    let (status, _) = patch(
        &app,
        &w.owner_token,
        &path,
        json!({"visibility":"Private","name":"Private now"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(shared_rows(&db, &w.concurrent).await.is_empty());
    let after = snapshot(&db, &w.concurrent).await;
    assert_eq!(
        (after.visibility.as_str(), after.name.as_str()),
        ("Private", "Private now")
    );

    // Non-Private visibility keeps sharing rows.
    share(&db, &w.internal, &[&w.team]).await;
    let (status, _) = patch(
        &app,
        &w.owner_token,
        &format!("/api/annotations/Explorational/{}/edit", w.internal),
        json!({"visibility":"Public"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(shared_rows(&db, &w.internal).await, vec![w.team.clone()]);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn lock_requires_owner_and_actual_explorational_type_and_returns_public_json() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    let lock = |typ: &str, id: &str, value: &str| {
        format!("/api/annotations/{typ}/{id}/editLockedState?isLockedByOwner={value}")
    };

    // Query binding.
    let (status, body) = patch_empty(
        &app,
        &w.owner_token,
        &format!(
            "/api/annotations/Explorational/{}/editLockedState",
            w.internal
        ),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Missing parameter: isLockedByOwner")
        )
    );
    let (status, _) = patch_empty(
        &app,
        &w.owner_token,
        &lock("Explorational", &w.internal, "yes"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Provider failures default to 400 here.
    for (token, id) in [
        (&w.owner_token, object_id()),
        (&w.collaborator_token, w.private.clone()),
    ] {
        let (status, body) = patch_empty(&app, token, &lock("Explorational", &id, "true")).await;
        assert_eq!(
            (status, body),
            (StatusCode::BAD_REQUEST, error(ANNOTATION_NOT_FOUND))
        );
    }
    let (status, body) = patch_empty(
        &app,
        &w.owner_token,
        &lock("explorational", &w.internal, "true"),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Invalid AnnotationType: explorational")
        )
    );
    // Owner check before type check; admins with DAO access are not owners.
    let (status, body) = patch_empty(
        &app,
        &w.admin_token,
        &lock("Explorational", &w.private, "true"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(LOCK_NOT_ALLOWED))
    );
    // The ACTUAL type decides, not the path type.
    let (status, body) = patch_empty(
        &app,
        &w.owner_token,
        &lock("Explorational", &w.task_annotation, "true"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(LOCK_EXPLORATIONALS_ONLY))
    );
    assert!(!snapshot(&db, &w.task_annotation).await.is_locked_by_owner);

    // Finished explorationals resolved through a `Task` path can be locked;
    // modified stays unchanged. `1` binds as true.
    let before = snapshot(&db, &w.finished).await;
    let (status, body) = patch_empty(&app, &w.owner_token, &lock("Task", &w.finished, "1")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["messages"], json!([{"success": LOCK_SUCCESS}]));
    assert_eq!(body["id"], w.finished);
    assert_eq!(body["isLockedByOwner"], true);
    assert_eq!(body["typ"], "Explorational");
    assert_eq!(body["state"], "Finished");
    assert_eq!(body["owner"]["id"], w.owner);
    assert_eq!(body["dataStore"]["name"], "metadata");
    assert_eq!(body["tracingStore"]["name"], "metadata-ts");
    assert_eq!(body["created"], 1577836800000_i64);
    assert_eq!(body["modified"], 1577923200000_i64);
    assert_eq!(body["restrictions"]["allowUpdate"], false);
    let after = snapshot(&db, &w.finished).await;
    assert!(after.is_locked_by_owner);
    assert_eq!(after.modified, before.modified);

    // Already locked annotations can be unlocked; restrictions reflect it.
    let (status, body) = patch_empty(&app, &w.owner_token, &lock("View", &w.locked, "false")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["isLockedByOwner"], false);
    assert_eq!(body["restrictions"]["allowUpdate"], true);
    assert!(!snapshot(&db, &w.locked).await.is_locked_by_owner);
    // Locking the internal one also reports the teams/settings of publicWrites.
    share(&db, &w.internal, &[&w.team]).await;
    let (status, body) = patch_empty(
        &app,
        &w.owner_token,
        &lock("Explorational", &w.internal, "true"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["teams"][0]["id"], w.team);
    assert_eq!(
        body["settings"]["allowedModes"],
        json!(["orthogonal", "flight"])
    );
    assert_eq!(body["datasetId"], w.dataset);
    assert_eq!(body["organization"], w.organization);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn shared_teams_get_requires_owner_and_filters_readable_teams() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    share(
        &db,
        &w.internal,
        &[&w.team, &w.other_team, &w.foreign_team, &w.deleted_team],
    )
    .await;
    let path = |typ: &str, id: &str| format!("/api/annotations/{typ}/{id}/sharedTeams");

    // Only live teams of the owner's organization the owner is a member of
    // (stale foreign role and deleted team excluded); exact shape.
    let (status, body) = get(&app, &w.owner_token, &path("View", &w.internal)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!([{"id": w.team, "name": "Test team", "organization": w.organization, "isOrganizationTeam": false}])
    );
    // Private annotations and finished/locked ones have no extra gate for GET.
    let (status, body) = get(&app, &w.owner_token, &path("Explorational", &w.private)).await;
    assert_eq!((status, body), (StatusCode::OK, json!([])));

    // Readers who are not the owner: 403; unreadable: provider 400.
    for token in [&w.collaborator_token, &w.admin_token] {
        let (status, body) = get(&app, token, &path("Explorational", &w.internal)).await;
        assert_eq!((status, body), (StatusCode::FORBIDDEN, error(NOT_ALLOWED)));
    }
    let (status, body) = get(
        &app,
        &w.collaborator_token,
        &path("Explorational", &w.private),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(ANNOTATION_NOT_FOUND))
    );
    let (status, body) = get(&app, &w.owner_token, &path("Bogus", &w.internal)).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Invalid AnnotationType: Bogus")
        )
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn shared_teams_patch_validates_every_team_then_replaces_atomically() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db);
    let path = |typ: &str, id: &str| format!("/api/annotations/{typ}/{id}/sharedTeams");
    share(&db, &w.internal, &[&w.team]).await;
    let initial = shared_rows(&db, &w.internal).await;

    // Owner + non-Private required (403).
    for (token, id) in [
        (&w.owner_token, &w.private),
        (&w.admin_token, &w.internal),
        (&w.collaborator_token, &w.internal),
    ] {
        let (status, body) = patch(
            &app,
            token,
            &path("Explorational", id),
            json!([w.team.clone()]),
        )
        .await;
        assert_eq!((status, body), (StatusCode::FORBIDDEN, error(NOT_ALLOWED)));
    }
    // Body must be a bare array of strings.
    for body in [json!({"teams":[w.team.clone()]}), json!([1])] {
        let (status, _) = patch(
            &app,
            &w.owner_token,
            &path("Explorational", &w.internal),
            body,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    // Team IDs use ObjectId.fromString: no human-readable prefixes.
    for literal in [format!("team-{}", w.team), "abc".to_owned()] {
        let (status, body) = patch(
            &app,
            &w.owner_token,
            &path("Explorational", &w.internal),
            json!([w.team.clone(), literal.clone()]),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::BAD_REQUEST, error(&invalid_object_id(&literal)))
        );
    }
    // Unreadable (non-member), foreign, deleted and missing teams fail before any mutation.
    for team in [
        w.other_team.clone(),
        w.foreign_team.clone(),
        w.deleted_team.clone(),
        object_id(),
    ] {
        let (status, body) = patch(
            &app,
            &w.owner_token,
            &path("Explorational", &w.internal),
            json!([w.team.clone(), team]),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::BAD_REQUEST, error(ACCESSING_TEAM_FAILED))
        );
        assert_eq!(shared_rows(&db, &w.internal).await, initial);
    }
    // Duplicates are rejected by the primary key and roll back.
    let (status, body) = patch(
        &app,
        &w.owner_token,
        &path("Explorational", &w.internal),
        json!([w.team.clone(), w.team.to_ascii_uppercase()]),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(SHARED_TEAMS_UPDATE_FAILED))
    );
    assert_eq!(shared_rows(&db, &w.internal).await, initial);

    // Owner on a finished annotation (no state/lock gate), uppercase IDs
    // normalized and echoed in input order. Admins may share any team of
    // their organization; owners need membership.
    add_role(&db, &w.owner, &w.other_team, false).await;
    let before = snapshot(&db, &w.finished).await;
    let (status, body) = patch(
        &app,
        &w.owner_token,
        &path("Task", &w.finished),
        json!([w.other_team.to_ascii_uppercase(), w.team.clone()]),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::OK,
            json!([w.other_team.clone(), w.team.clone()])
        )
    );
    assert_eq!(
        shared_rows(&db, &w.finished).await,
        sorted(vec![w.other_team.clone(), w.team.clone()])
    );
    assert_eq!(snapshot(&db, &w.finished).await, before);
    // Replacement and clearing.
    let (status, body) = patch(
        &app,
        &w.owner_token,
        &path("Explorational", &w.finished),
        json!([w.team.clone()]),
    )
    .await;
    assert_eq!((status, body), (StatusCode::OK, json!([w.team.clone()])));
    assert_eq!(shared_rows(&db, &w.finished).await, vec![w.team.clone()]);
    let (status, body) = patch(
        &app,
        &w.owner_token,
        &path("Explorational", &w.finished),
        json!([]),
    )
    .await;
    assert_eq!((status, body), (StatusCode::OK, json!([])));
    assert!(shared_rows(&db, &w.finished).await.is_empty());
    db.cleanup().await;
}

// ---------------------------------------------------------------------------
// Compound types through a mock tracing store.
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct Mock {
    merges: Arc<Mutex<usize>>,
    status: Arc<Mutex<Option<StatusCode>>>,
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let _ = to_bytes(request.into_body(), 1024 * 1024).await;
    if path.ends_with("/mergedFromIds") {
        *mock.merges.lock().unwrap() += 1;
    }
    if let Some(status) = *mock.status.lock().unwrap() {
        return (status, "upstream failure").into_response();
    }
    let merged = AnnotationProto {
        description: String::new(),
        version: 0,
        annotation_layers: vec![AnnotationLayerProto {
            tracing_id: "merged-skeleton".into(),
            name: "Skeleton".into(),
            typ: AnnotationLayerTypeProto::Skeleton as i32,
        }],
        earliest_accessible_version: 0,
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: None,
        user_states: Vec::new(),
    };
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/x-protobuf")],
        merged.encode_to_vec(),
    )
        .into_response()
}

async fn mock_tracing_store() -> (String, Mock) {
    let mock = Mock::default();
    let router = Router::new()
        .route("/{*path}", any(mock_handler))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}"), mock)
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_types_resolve_through_the_merge_cache_and_never_write() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    // One finished, Internal task instance so CompoundTask can merge.
    let annotator = db.seed_user(&object_id(), &w.organization, false).await;
    let instance = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state) VALUES($1,$2,$3,$4,'Task','Internal','Finished')")
        .bind(&instance).bind(&w.dataset).bind(&w.task).bind(&annotator.user_id)
        .execute(&db.pool).await.unwrap();
    let app = app(&db);
    let path = |suffix: &str| format!("/api/annotations/CompoundTask/{}/{suffix}", w.task);
    let merges = || *mock.merges.lock().unwrap();

    // Edit: the provider merges (cold cache, admin becomes owner), then the
    // compound restrictions reject the update with 403.
    let (status, body) = patch(&app, &w.admin_token, &path("edit"), json!({"name":"x"})).await;
    assert_eq!(
        (status, body),
        (StatusCode::FORBIDDEN, error(EDIT_NOT_ALLOWED))
    );
    assert_eq!(merges(), 1);
    // Lock: cached owner passes, the actual Compound type fails; no re-merge.
    let (status, body) = patch_empty(
        &app,
        &w.admin_token,
        &format!("{}?isLockedByOwner=true", path("editLockedState")),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(LOCK_EXPLORATIONALS_ONLY))
    );
    // sharedTeams GET for the cached owner: readable rows for the synthetic id.
    let (status, body) = get(&app, &w.admin_token, &path("sharedTeams")).await;
    assert_eq!((status, body), (StatusCode::OK, json!([])));
    // sharedTeams PATCH passes owner + Internal visibility and team
    // validation, then fails AnnotationDAO update access (no persisted row).
    let (status, body) = patch(
        &app,
        &w.admin_token,
        &path("sharedTeams"),
        json!([w.team.clone()]),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(NO_UPDATE_ACCESS))
    );
    let (status, body) = patch(
        &app,
        &w.admin_token,
        &path("sharedTeams"),
        json!([w.other_team.clone()]),
    )
    .await;
    // Admins read every team of their organization.
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(NO_UPDATE_ACCESS))
    );
    assert!(shared_rows(&db, &w.task).await.is_empty());
    assert_eq!(merges(), 1);

    // Another requester on the warm cache is not the owner.
    let (status, body) = patch_empty(
        &app,
        &w.manager_token,
        &format!("{}?isLockedByOwner=false", path("editLockedState")),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(LOCK_NOT_ALLOWED))
    );
    let (status, body) = get(&app, &w.manager_token, &path("sharedTeams")).await;
    assert_eq!((status, body), (StatusCode::FORBIDDEN, error(NOT_ALLOWED)));
    // Edit for a team manager still runs provide (cache hit) then 403.
    let (status, body) = patch(&app, &w.manager_token, &path("edit"), json!({})).await;
    assert_eq!(
        (status, body),
        (StatusCode::FORBIDDEN, error(EDIT_NOT_ALLOWED))
    );
    assert_eq!(merges(), 1);

    // Restriction failures map to 404 with the restrictions message: an
    // unrelated member can read the cached compound but the CompoundTask
    // restriction handler cannot read the task.
    let outsider = db.seed_user(&object_id(), &w.organization, false).await;
    let (status, body) = patch(&app, &outsider.token, &path("edit"), json!({})).await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(RESTRICTIONS_NOT_FOUND))
    );

    // Upstream merge failures: edit maps them to 404, the other routes keep
    // the upstream status; failures are not cached.
    *mock.status.lock().unwrap() = Some(StatusCode::INTERNAL_SERVER_ERROR);
    let task_type: String =
        sqlx::query_scalar("SELECT _tasktype FROM webknossos.tasks WHERE _id=$1")
            .bind(&w.task)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    let type_path =
        |suffix: &str| format!("/api/annotations/CompoundTaskType/{task_type}/{suffix}");
    let (status, body) = patch(&app, &w.admin_token, &type_path("edit"), json!({})).await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
    );
    let (status, body) = get(&app, &w.admin_token, &type_path("sharedTeams")).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            error(ANNOTATION_NOT_FOUND)
        )
    );
    assert_eq!(merges(), 3);
    *mock.status.lock().unwrap() = None;
    let (status, body) = get(&app, &w.admin_token, &type_path("sharedTeams")).await;
    assert_eq!((status, body), (StatusCode::OK, json!([])));
    assert_eq!(merges(), 4);
    db.cleanup().await;
}
