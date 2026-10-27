//! NotificationEmailService through the real routes: who is notified when
//! datasets or annotations are shared with teams and when users' access
//! changes (the emails are sent in the background).
use crate::common;

use std::time::Duration;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    mail::{Mail, MailSender, RecordingMailer},
    router_with_mailer,
};

fn app(db: &TestDb, mailer: &RecordingMailer) -> Router {
    router_with_mailer(
        AppState::new(db.pool.clone()),
        MailSender::new(mailer.clone()),
    )
}

async fn patch(app: &Router, token: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(path)
                .header("x-auth-token", token)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// The mails sent so far, after giving the background tasks time to finish.
async fn settled_mails(mailer: &RecordingMailer) -> Vec<Mail> {
    let mut seen = usize::MAX;
    loop {
        tokio::time::sleep(Duration::from_millis(150)).await;
        let count = mailer.messages().len();
        if count == seen {
            return mailer.take();
        }
        seen = count;
    }
}

struct Member {
    id: String,
    token: String,
    email: String,
}

/// A user of the fixture organization in `team`, with the given flags.
async fn member(db: &TestDb, fixture: &Fixture, team: Option<&str>, flags: &str) -> Member {
    let id = object_id();
    let user = db.seed_user(&id, &fixture.organization_id, false).await;
    if !flags.is_empty() {
        sqlx::query(&format!(
            "UPDATE webknossos.users SET {flags} WHERE _id = $1"
        ))
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    if let Some(team) = team {
        add_to_team(db, &id, team, false).await;
    }
    let email: String = sqlx::query_scalar(
        "SELECT m.email FROM webknossos.users u JOIN webknossos.multiUsers m ON m._id = u._multiUser WHERE u._id = $1",
    )
    .bind(&id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    Member {
        id,
        token: user.token,
        email,
    }
}

async fn add_to_team(db: &TestDb, user: &str, team: &str, is_team_manager: bool) {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user, _team, isTeamManager) VALUES ($1, $2, $3)",
    )
    .bind(user)
    .bind(team)
    .bind(is_team_manager)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn team(db: &TestDb, fixture: &Fixture, name: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.teams (_id, _organization, name) VALUES ($1, $2, $3)")
        .bind(&id)
        .bind(&fixture.organization_id)
        .bind(name)
        .execute(&db.pool)
        .await
        .unwrap();
    id
}

async fn dataset(db: &TestDb, fixture: &Fixture) -> String {
    sqlx::query(
        "INSERT INTO webknossos.dataStores (name, url, publicUrl, key) \
         VALUES ('store', 'http://127.0.0.1:1', 'http://127.0.0.1:1', 'k') ON CONFLICT DO NOTHING",
    )
    .execute(&db.pool)
    .await
    .unwrap();
    let id = object_id();
    sqlx::query(
        "INSERT INTO webknossos.datasets (_id, _dataStore, _organization, _folder, name, directoryName, isUsable, voxelSizeFactor, sortingKey) \
         SELECT $1, 'store', _id, _rootFolder, 'Shared <data>', $1, true, ROW(1,1,1)::webknossos.VECTOR3, NOW() \
         FROM webknossos.organizations WHERE _id = $2",
    )
    .bind(&id)
    .bind(&fixture.organization_id)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn sharing_a_dataset_notifies_only_members_who_gain_access() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let mailer = RecordingMailer::default();
    let app = app(&db, &mailer);
    let team = fixture.team_id.clone();
    let other_team = self::team(&db, &fixture, "Other team").await;
    let dataset = dataset(&db, &fixture).await;

    let gains = member(&db, &fixture, Some(&team), "").await;
    add_to_team(&db, &gains.id, &other_team, false).await;
    // Dataset managers can already see every dataset of their organization.
    member(&db, &fixture, Some(&team), "isDatasetManager = TRUE").await;
    member(&db, &fixture, Some(&team), "isUnlisted = TRUE").await;
    member(&db, &fixture, Some(&team), "isDeactivated = TRUE").await;
    // The sharing admin is a member of the team, too.
    add_to_team(&db, &fixture.user_id, &team, true).await;

    let path = format!("/api/datasets/{dataset}/teams");
    let (status, _) = patch(&app, &fixture.token, &path, json!([team, other_team])).await;
    assert_eq!(status, StatusCode::OK);
    let mails = settled_mails(&mailer).await;
    assert_eq!(mails.len(), 1, "{mails:?}");
    let mail = &mails[0];
    assert_eq!(mail.recipients, [gains.email.as_str()]);
    assert_eq!(
        mail.subject,
        "WEBKNOSSOS | Rust Test shared the dataset Shared <data> with you"
    );
    assert!(mail.body_html.contains("Hi Rust Test,"));
    // The teams in the order they were added.
    assert!(
        mail.body_html
            .contains("gave\n  your teams <i>Test team, Other team</i>\n"),
        "{}",
        mail.body_html
    );
    assert!(
        mail.body_html
            .contains("access to the dataset <i>Shared &lt;data&gt;</i>.")
    );
    assert!(mail.body_html.contains(&format!(
        "href=\"http://localhost:9000/datasets/{dataset}/view\""
    )));

    // Unchanged teams announce nothing.
    let (status, _) = patch(&app, &fixture.token, &path, json!([team, other_team])).await;
    assert_eq!(status, StatusCode::OK);
    assert!(settled_mails(&mailer).await.is_empty());

    // Nobody gains access to a public dataset.
    let third_team = self::team(&db, &fixture, "Third team").await;
    member(&db, &fixture, Some(&third_team), "").await;
    sqlx::query("UPDATE webknossos.datasets SET isPublic = TRUE WHERE _id = $1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, _) = patch(&app, &fixture.token, &path, json!([third_team])).await;
    assert_eq!(status, StatusCode::OK);
    assert!(settled_mails(&mailer).await.is_empty());
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn sharing_an_annotation_notifies_members_who_can_see_its_dataset() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let mailer = RecordingMailer::default();
    let app = app(&db, &mailer);
    let dataset = dataset(&db, &fixture).await;
    let share_team = team(&db, &fixture, "Share team").await;
    let dataset_team = team(&db, &fixture, "Dataset team").await;
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset, _team) VALUES ($1, $2)")
        .bind(&dataset)
        .bind(&dataset_team)
        .execute(&db.pool)
        .await
        .unwrap();
    let owner = member(&db, &fixture, Some(&share_team), "").await;
    add_to_team(&db, &owner.id, &dataset_team, false).await;
    let with_access = member(&db, &fixture, Some(&share_team), "").await;
    add_to_team(&db, &with_access.id, &dataset_team, false).await;
    member(&db, &fixture, Some(&share_team), "").await;

    let annotation = object_id();
    sqlx::query(
        "INSERT INTO webknossos.annotations (_id, _dataset, _user, typ, visibility, state, name, description, tags) \
         VALUES ($1, $2, $3, 'Explorational', 'Internal', 'Active', '', '', '{}')",
    )
    .bind(&annotation)
    .bind(&dataset)
    .bind(&owner.id)
    .execute(&db.pool)
    .await
    .unwrap();

    let path = format!("/api/annotations/Explorational/{annotation}/sharedTeams");
    let (status, body) = patch(&app, &owner.token, &path, json!([share_team])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let mails = settled_mails(&mailer).await;
    assert_eq!(mails.len(), 1, "{mails:?}");
    let mail = &mails[0];
    assert_eq!(mail.recipients, [with_access.email.as_str()]);
    assert_eq!(
        mail.subject,
        "WEBKNOSSOS | Rust Test shared an annotation with you"
    );
    assert!(mail.body_html.contains(
        "shared the annotation <i>Unnamed annotation</i> of the dataset <i>Shared &lt;data&gt;</i> with\n  your team <i>Share team</i>."
    ));
    assert!(mail.body_html.contains(&format!(
        "href=\"http://localhost:9000/annotations/{annotation}\""
    )));

    // Removing and keeping teams announces nothing.
    let (status, _) = patch(&app, &owner.token, &path, json!([])).await;
    assert_eq!(status, StatusCode::OK);
    assert!(settled_mails(&mailer).await.is_empty());
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn access_changes_by_others_are_announced() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let mailer = RecordingMailer::default();
    let app = app(&db, &mailer);
    let new_team = team(&db, &fixture, "New team").await;
    let user = member(&db, &fixture, Some(&fixture.team_id), "").await;
    let path = format!("/api/users/{}", user.id);

    let (status, body) = patch(
        &app,
        &fixture.token,
        &path,
        json!({
            "isDatasetManager": true,
            "teams": [
                {"id": fixture.team_id, "isTeamManager": true},
                {"id": new_team, "isTeamManager": false}
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let mails = settled_mails(&mailer).await;
    assert_eq!(mails.len(), 1, "{mails:?}");
    let mail = &mails[0];
    assert_eq!(mail.recipients, [user.email.as_str()]);
    assert_eq!(
        mail.subject,
        "WEBKNOSSOS | Your access in Test organization has changed"
    );
    let changes = "<ul>\n  \n  <li>You are now a dataset manager.</li>\n  \n  \
        <li>You are now a team manager of the team Test team.</li>\n  \n  \
        <li>You were added to the team New team.</li>\n  \n</ul>";
    assert!(mail.body_html.contains(changes), "{}", mail.body_html);
    assert!(mail.body_html.contains(
        "Rust Test changed your access in the WEBKNOSSOS organization <i>Test organization</i>:"
    ));

    // Own changes and changes without effect on access are not announced.
    let (status, _) = patch(&app, &user.token, &path, json!({"firstName": "Renamed"})).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = patch(
        &app,
        &fixture.token,
        &path,
        json!({"experiences": {"a": 1}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(settled_mails(&mailer).await.is_empty());

    // Deactivating is not announced; the activation gets the activation mail
    // and follow-up changes within the hour are not announced separately.
    let (status, _) = patch(&app, &fixture.token, &path, json!({"isActive": false})).await;
    assert_eq!(status, StatusCode::OK);
    assert!(settled_mails(&mailer).await.is_empty());
    let (status, _) = patch(&app, &fixture.token, &path, json!({"isActive": true})).await;
    assert_eq!(status, StatusCode::OK);
    let mails = settled_mails(&mailer).await;
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].subject, "WEBKNOSSOS | Account activated");
    let (status, _) = patch(&app, &fixture.token, &path, json!({"isAdmin": true})).await;
    assert_eq!(status, StatusCode::OK);
    assert!(settled_mails(&mailer).await.is_empty());
    db.cleanup().await;
}
