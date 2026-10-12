//! Registration, organization creation, invitations and joining.
mod browser_auth_support;
mod common;

use axum::http::{Method, StatusCode, header};
use browser_auth_support::{
    app, config, error, make_superuser, messages, seed_organization_team, send, set_password,
    sign_up,
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use webknossos_backend::{browser_auth::BrowserAuthConfig, mail::RecordingMailer};

const EMAIL_TAKEN: &str = "An account with this email address already exists. Please log in instead or use a different email.";
const INVALID_FIRST: &str = "Please check your first name for any special characters.";
const INVALID_LAST: &str = "Please check your last name for any special characters.";

async fn count(database: &TestDb, sql: &str, value: &str) -> i64 {
    sqlx::query_scalar(sql)
        .bind(value)
        .fetch_one(&database.pool)
        .await
        .unwrap()
}

#[derive(sqlx::FromRow, Debug)]
struct Account {
    user_id: String,
    first_name: String,
    last_name: String,
    hasher: String,
    password: String,
    is_deactivated: bool,
    is_admin: bool,
    is_dataset_manager: bool,
    is_organization_owner: bool,
    is_email_verified: bool,
    organization: String,
}

async fn account(database: &TestDb, email: &str) -> Account {
    sqlx::query_as(
        r#"SELECT u._id AS user_id, m.firstName AS first_name, m.lastName AS last_name,
             m.passwordInfo_hasher::text AS hasher, m.passwordInfo_password AS password,
             u.isDeactivated AS is_deactivated, u.isAdmin AS is_admin,
             u.isDatasetManager AS is_dataset_manager, u.isOrganizationOwner AS is_organization_owner,
             m.isEmailVerified AS is_email_verified, u._organization AS organization
           FROM webknossos.multiUsers m JOIN webknossos.users u ON u._multiUser = m._id
           WHERE m.email = $1 ORDER BY u.created LIMIT 1"#,
    )
    .bind(email)
    .fetch_one(&database.pool)
    .await
    .unwrap()
}

async fn teams_of(database: &TestDb, user_id: &str) -> Vec<(String, bool)> {
    sqlx::query_as(
        "SELECT _team, isTeamManager FROM webknossos.user_team_roles WHERE _user = $1 ORDER BY _team",
    )
    .bind(user_id)
    .fetch_all(&database.pool)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn registration_validates_and_creates_accounts_atomically() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let org_team = seed_organization_team(&database, &fixture.organization_id).await;
    sqlx::query("UPDATE webknossos.organizations SET newUserMailingList = 'admins@example.test' WHERE _id = $1")
        .bind(&fixture.organization_id).execute(&database.pool).await.unwrap();
    set_password(&database, &fixture.multi_user_id, "taken@example.test").await;
    let mailer = RecordingMailer::default();
    let app = app(&database, config(), &mailer);
    let register = |body: Value| {
        send(
            &app,
            Method::POST,
            "/api/auth/register",
            None,
            None,
            Some(body),
        )
    };

    // Form errors never echo submitted values.
    let mut mismatch = sign_up("new@example.test", "A", "B", json!({}));
    mismatch["password"]["password2"] = json!("different-password");
    let response = register(mismatch).await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert!(
        response
            .body
            .to_string()
            .contains("The two passwords do not match.")
    );
    assert!(!response.body.to_string().contains("different-password"));
    let mut short = sign_up("new@example.test", "A", "B", json!({}));
    short["password"] = json!({"password1": "short", "password2": "short"});
    assert_eq!(register(short).await.status, StatusCode::BAD_REQUEST);
    let mut missing = sign_up("new@example.test", "A", "B", json!({}));
    missing.as_object_mut().unwrap().remove("organization");
    assert_eq!(register(missing).await.status, StatusCode::BAD_REQUEST);

    // Honeypot submissions are rejected with an empty 400.
    let response = register(sign_up(
        "bot@example.test",
        "A",
        "B",
        json!({"referral": "x"}),
    ))
    .await;
    assert_eq!(
        (response.status, response.body),
        (StatusCode::BAD_REQUEST, Value::Null)
    );

    // Name/email errors are listed in Play's order: email, last, first.
    let response = register(sign_up("TAKEN@example.test", "!!!", "???", json!({}))).await;
    assert_eq!(
        response.body,
        messages(&[EMAIL_TAKEN, INVALID_LAST, INVALID_FIRST])
    );
    let response = register(sign_up("other@example.test", "!!!", "Fine", json!({}))).await;
    assert_eq!(response.body, messages(&[INVALID_FIRST]));

    // Registration to the only organization: normalized names, lowercased
    // email, inactive account, organization team, verification key, mails.
    let response = register(sign_up(
        "New.User@Example.test",
        "Jürgen",
        "Größe",
        json!({}),
    ))
    .await;
    assert_eq!(
        (response.status, &response.body),
        (StatusCode::OK, &Value::Null)
    );
    let created = account(&database, "new.user@example.test").await;
    assert_eq!(
        (created.first_name.as_str(), created.last_name.as_str()),
        ("Juergen", "Groesse")
    );
    assert_eq!(created.organization, fixture.organization_id);
    assert!(created.is_deactivated && !created.is_admin && !created.is_email_verified);
    assert_eq!(created.hasher, "SCrypt");
    assert!(
        webknossos_backend::browser_auth::verify_password(
            "secret-password".into(),
            "SCrypt",
            created.password.clone()
        )
        .await
    );
    assert_eq!(
        teams_of(&database, &created.user_id).await,
        vec![(org_team.clone(), false)]
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM webknossos.emailVerificationKeys WHERE email = $1",
            "new.user@example.test"
        )
        .await,
        1
    );
    let subjects: Vec<String> = mailer.take().into_iter().map(|m| m.subject).collect();
    assert_eq!(subjects[0], "Verify Your Email at WEBKNOSSOS");
    assert_eq!(subjects[1], "Welcome to WEBKNOSSOS");
    assert!(subjects[2].starts_with("WEBKNOSSOS | A new user (Juergen Groesse, new.user@example.test) registered on http://localhost:9000 for Test organization"));

    // Auto-verify organizations activate new accounts.
    sqlx::query("UPDATE webknossos.organizations SET enableAutoVerify = TRUE WHERE _id = $1")
        .bind(&fixture.organization_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        register(sign_up("auto@example.test", "Auto", "User", json!({})))
            .await
            .status,
        StatusCode::OK
    );
    assert!(!account(&database, "auto@example.test").await.is_deactivated);

    // User limits are enforced (inactive/unlisted users excluded).
    sqlx::query("UPDATE webknossos.organizations SET includedUsers = 2 WHERE _id = $1")
        .bind(&fixture.organization_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let response = register(sign_up("limit@example.test", "Lim", "It", json!({}))).await;
    assert_eq!(
        response.body,
        error(
            "Cannot add new user to this organization because it would exceed the organization’s user limit. Please ask the organization owner to upgrade."
        )
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM webknossos.multiUsers WHERE email = $1",
            "limit@example.test"
        )
        .await,
        0
    );
    sqlx::query("UPDATE webknossos.organizations SET includedUsers = NULL WHERE _id = $1")
        .bind(&fixture.organization_id)
        .execute(&database.pool)
        .await
        .unwrap();

    // Without an invite, registration needs the default-organization feature
    // and exactly one organization.
    let closed = app_with(
        &database,
        BrowserAuthConfig {
            register_to_default_orga_enabled: false,
            ..config()
        },
        &mailer,
    );
    let response = send(
        &closed,
        Method::POST,
        "/api/auth/register",
        None,
        None,
        Some(sign_up(
            "closed@example.test",
            "A",
            "B",
            json!({"inviteToken": "unknown"}),
        )),
    )
    .await;
    assert_eq!(
        response.body,
        error("Registration without invite is not enabled for this WEBKNOSSOS instance.")
    );
    database.seed_user(&object_id(), "second-org", true).await;
    let response = register(sign_up("ambiguous@example.test", "A", "B", json!({}))).await;
    assert_eq!(
        response.body,
        error(
            "Registration without invite is not allowed for instances with multiple organizations."
        )
    );
    database.cleanup().await;
}

fn app_with(
    database: &TestDb,
    config: BrowserAuthConfig,
    mailer: &RecordingMailer,
) -> axum::Router {
    app(database, config, mailer)
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn invites_are_permission_checked_mailed_and_consumed_once() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let org_team = seed_organization_team(&database, &fixture.organization_id).await;
    sqlx::query(
        "UPDATE webknossos.multiUsers SET firstName = 'Ada', lastName = 'Admin' WHERE _id = $1",
    )
    .bind(&fixture.multi_user_id)
    .execute(&database.pool)
    .await
    .unwrap();
    let member = database
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let mailer = RecordingMailer::default();
    let app = app(&database, config(), &mailer);
    let invite_body = |is_admin: bool| {
        json!({
            "recipients": ["one@example.test", "two@example.test"],
            "autoActivate": true, "isAdmin": is_admin, "isDatasetManager": false,
            "teamMemberships": [{"id": fixture.team_id, "name": "Test team", "isTeamManager": true}],
        })
    };

    let response = send(
        &app,
        Method::POST,
        "/api/auth/sendInvites",
        None,
        Some(&member.token),
        Some(invite_body(false)),
    )
    .await;
    assert_eq!(
        response.body,
        error("Can only send invites with team roles for teams you manage.")
    );
    let mut promote = invite_body(true);
    promote["teamMemberships"] = json!([]);
    let response = send(
        &app,
        Method::POST,
        "/api/auth/sendInvites",
        None,
        Some(&member.token),
        Some(promote),
    )
    .await;
    assert_eq!(
        response.body,
        error("Only admins can send invites that promote new users to admin or dataset manager.")
    );
    assert_eq!(
        send(
            &app,
            Method::POST,
            "/api/auth/sendInvites",
            None,
            None,
            Some(invite_body(false))
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );

    let response = send(
        &app,
        Method::POST,
        "/api/auth/sendInvites",
        None,
        Some(&fixture.token),
        Some(invite_body(true)),
    )
    .await;
    assert_eq!(
        (response.status, &response.body),
        (StatusCode::OK, &Value::Null)
    );
    let invites: Vec<(String, String, bool, bool, i64)> = sqlx::query_as(
        r#"SELECT _id, tokenValue, autoActivate, isAdmin,
             ROUND(EXTRACT(EPOCH FROM (expirationDateTime - created)))::bigint
           FROM webknossos.invites WHERE _organization = $1 ORDER BY tokenValue"#,
    )
    .bind(&fixture.organization_id)
    .fetch_all(&database.pool)
    .await
    .unwrap();
    assert_eq!(invites.len(), 2);
    assert!(
        invites
            .iter()
            .all(|i| i.2 && i.3 && i.4 == 14 * 86_400 && i.1.len() == 22)
    );
    let mails = mailer.take();
    assert_eq!(mails.len(), 2);
    assert_eq!(
        mails[0].subject,
        "Ada Admin invited you to join their WEBKNOSSOS organization at http://localhost:9000"
    );
    let token = invites
        .iter()
        .map(|i| i.1.clone())
        .find(|t| {
            mails[0]
                .body_html
                .contains(&format!("http://localhost:9000/invite/{t}"))
        })
        .expect("invite link");

    // Registering with the invite uses its roles and activation and consumes it,
    // even with a second organization present.
    database.seed_user(&object_id(), "second-org", true).await;
    let response = send(
        &app,
        Method::POST,
        "/api/auth/register",
        None,
        None,
        Some(sign_up(
            "invited@example.test",
            "In",
            "Vited",
            json!({"inviteToken": token}),
        )),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    let invited = account(&database, "invited@example.test").await;
    assert!(!invited.is_deactivated && invited.is_admin);
    assert_eq!(
        teams_of(&database, &invited.user_id).await,
        vec![(fixture.team_id.clone(), true)]
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM webknossos.invites WHERE tokenValue = $1 AND isDeleted",
            &token
        )
        .await,
        1
    );
    let reused = send(
        &app,
        Method::POST,
        "/api/auth/register",
        None,
        None,
        Some(sign_up(
            "again@example.test",
            "A",
            "B",
            json!({"inviteToken": token}),
        )),
    )
    .await;
    assert_eq!(
        reused.body,
        error(
            "Registration without invite is not allowed for instances with multiple organizations."
        )
    );

    // An existing account joins another organization through an invite.
    let outsider = database.seed_user(&object_id(), "second-org", false).await;
    sqlx::query("UPDATE webknossos.users SET userConfiguration = '{\"theme\":1}' WHERE _id = $1")
        .bind(&outsider.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let other = invites
        .iter()
        .map(|i| i.1.clone())
        .find(|t| *t != token)
        .unwrap();
    let path = format!("/api/auth/joinOrganization/{other}");
    assert_eq!(
        send(
            &app,
            Method::POST,
            "/api/auth/joinOrganization/unknown",
            None,
            Some(&outsider.token),
            None
        )
        .await
        .body,
        error("This invite token is invalid.")
    );
    let joined = send(&app, Method::POST, &path, None, Some(&outsider.token), None).await;
    assert_eq!(
        (joined.status, &joined.body),
        (StatusCode::OK, &Value::Null)
    );
    let (new_user, configuration, is_admin, deactivated): (String, Value, bool, bool) = sqlx::query_as(
        "SELECT _id, userConfiguration, isAdmin, isDeactivated FROM webknossos.users WHERE _multiUser = $1 AND _organization = $2")
        .bind(&outsider.multi_user_id).bind(&fixture.organization_id).fetch_one(&database.pool).await.unwrap();
    assert_eq!(
        (configuration, is_admin, deactivated),
        (json!({"theme":1}), true, false)
    );
    assert_eq!(
        teams_of(&database, &new_user).await,
        vec![(fixture.team_id.clone(), true)]
    );
    assert_eq!(
        send(&app, Method::POST, &path, None, Some(&outsider.token), None)
            .await
            .body,
        error("This invite token is invalid.")
    );

    // Already-member accounts are rejected before consuming an invite.
    let response = send(
        &app,
        Method::POST,
        "/api/auth/sendInvites",
        None,
        Some(&fixture.token),
        Some(
            json!({"recipients": ["x@example.test"], "autoActivate": false, "isAdmin": false,
            "isDatasetManager": false, "teamMemberships": []}),
        ),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    let third: String = sqlx::query_scalar(
        "SELECT tokenValue FROM webknossos.invites WHERE NOT isDeleted AND NOT isAdmin",
    )
    .fetch_one(&database.pool)
    .await
    .unwrap();
    let response = send(
        &app,
        Method::POST,
        &format!("/api/auth/joinOrganization/{third}"),
        None,
        Some(&outsider.token),
        None,
    )
    .await;
    assert_eq!(
        response.body,
        error("Your account is already associated with the selected organization.")
    );
    // Without invite team roles the organization team is not implied.
    let _ = org_team;
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn organization_creation_and_superuser_account_administration() {
    let database = TestDb::new().await;
    let mailer = RecordingMailer::default();
    let tos = BrowserAuthConfig {
        terms_of_service_enabled: true,
        terms_of_service_version: 2,
        new_organization_mailing_list: "orgs@example.test".into(),
        ..config()
    };
    let app = app(&database, tos, &mailer);
    let body = |email: &str, extra: Value| {
        let mut body = sign_up(
            email,
            "Owner",
            "Person",
            json!({"organization": "", "organizationName": "Lab Ünï 1"}),
        );
        for (key, value) in extra.as_object().unwrap() {
            body[key] = value.clone();
        }
        body
    };

    // Terms of service must be accepted with the current version; failures
    // roll back the whole creation.
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createOrganizationWithAdmin",
        None,
        None,
        Some(body("owner@example.test", json!({}))),
    )
    .await;
    assert_eq!(response.body, error("Terms of service must be accepted."));
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createOrganizationWithAdmin",
        None,
        None,
        Some(body(
            "owner@example.test",
            json!({"acceptedTermsOfService": 1}),
        )),
    )
    .await;
    assert_eq!(
        response.body,
        error(
            "Terms of service version mismatch. Current version is 2, received acceptance for 1."
        )
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM webknossos.organizations WHERE name = $1",
            "Lab Ünï 1"
        )
        .await,
        0
    );

    // The first organization may be created anonymously.
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createOrganizationWithAdmin",
        None,
        None,
        Some(body(
            "Owner@Example.test",
            json!({"acceptedTermsOfService": 2}),
        )),
    )
    .await;
    assert_eq!(
        (response.status, &response.body),
        (StatusCode::OK, &Value::Null)
    );
    let owner = account(&database, "owner@example.test").await;
    assert_eq!(owner.organization, "Lab_Ueni_1");
    assert!(
        owner.is_admin
            && owner.is_organization_owner
            && !owner.is_deactivated
            && !owner.is_dataset_manager
    );
    let (name, plan, tos_version, folder_name, depth): (String, String, i32, String, i32) = sqlx::query_as(
        r#"SELECT o.name, o.pricingPlan::text, o.lastTermsOfServiceAcceptanceVersion, f.name, p.depth
           FROM webknossos.organizations o JOIN webknossos.folders f ON f._id = o._rootFolder
           JOIN webknossos.folder_paths p ON p._ancestor = f._id AND p._descendant = f._id WHERE o._id = $1"#)
        .bind(&owner.organization).fetch_one(&database.pool).await.unwrap();
    assert_eq!(
        (
            name.as_str(),
            plan.as_str(),
            tos_version,
            folder_name.as_str(),
            depth
        ),
        ("Lab Ünï 1", "Custom", 2, "Datasets", 0)
    );
    let org_team: String =
        sqlx::query_scalar("SELECT _id FROM webknossos.organizationTeams WHERE _organization = $1")
            .bind(&owner.organization)
            .fetch_one(&database.pool)
            .await
            .unwrap();
    assert_eq!(
        teams_of(&database, &owner.user_id).await,
        vec![(org_team, false)]
    );
    let subjects: Vec<String> = mailer.take().into_iter().map(|m| m.subject).collect();
    assert_eq!(
        subjects,
        vec![
            "Verify Your Email at WEBKNOSSOS".to_owned(),
            "WEBKNOSSOS | New Organization created on ".to_owned()
        ]
    );

    // Further organizations require a superuser (or a wkorg instance).
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createOrganizationWithAdmin",
        None,
        None,
        Some(body(
            "second@example.test",
            json!({"acceptedTermsOfService": 2, "organization": "second"}),
        )),
    )
    .await;
    assert_eq!(
        response.body,
        error("You do not have permission to create a new organization.")
    );
    let superuser = database
        .seed_user(&object_id(), &owner.organization, true)
        .await;
    make_superuser(&database, &superuser.multi_user_id).await;
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createOrganizationWithAdmin",
        None,
        Some(&superuser.token),
        Some(body(
            "second@example.test",
            json!({"acceptedTermsOfService": 2, "organization": "Lab Ünï 1"}),
        )),
    )
    .await;
    assert_eq!(response.body, error("Could not create a new organization."));
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createOrganizationWithAdmin",
        None,
        Some(&superuser.token),
        Some(body(
            "second@example.test",
            json!({"acceptedTermsOfService": 2, "organization": "my second"}),
        )),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(
        account(&database, "second@example.test").await.organization,
        "my_second"
    );

    // createOrganizationWithExistingUser
    let regular = database
        .seed_user(&object_id(), &owner.organization, false)
        .await;
    let payload = json!({"userId": regular.user_id, "newOrganizationName": "Extra Org"});
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createOrganizationWithExistingUser",
        None,
        Some(&regular.token),
        Some(payload.clone()),
    )
    .await;
    assert_eq!(
        response.body,
        error("This feature is currently only available for superusers.")
    );
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createOrganizationWithExistingUser",
        None,
        Some(&superuser.token),
        Some(payload),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.headers[header::CONTENT_TYPE], "application/json");
    let new_org = response.body.as_str().unwrap().to_owned();
    assert!(new_org.len() == 16 && new_org.bytes().all(|b| b.is_ascii_hexdigit()));
    let (admin, owner_flag, active): (bool, bool, bool) = sqlx::query_as(
        "SELECT isAdmin, isOrganizationOwner, NOT isDeactivated FROM webknossos.users WHERE _multiUser = $1 AND _organization = $2")
        .bind(&regular.multi_user_id).bind(&new_org).fetch_one(&database.pool).await.unwrap();
    assert!(admin && owner_flag && active);

    // createUserInOrganization
    let path = format!("/api/auth/createUserInOrganization/{new_org}");
    let payload = json!({"firstName": "Sso", "lastName": "Only", "email": "SSO@example.test"});
    let response = send(
        &app,
        Method::POST,
        &path,
        None,
        Some(&regular.token),
        Some(payload.clone()),
    )
    .await;
    assert_eq!(
        (response.status, &response.body),
        (
            StatusCode::FORBIDDEN,
            &error("You are not authorized to view or edit this resource.")
        )
    );
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createUserInOrganization/missing",
        None,
        Some(&superuser.token),
        Some(payload.clone()),
    )
    .await;
    assert_eq!(
        response.body,
        error("Organization “missing” could not be found or accessed.")
    );
    let response = send(
        &app,
        Method::POST,
        &path,
        None,
        Some(&superuser.token),
        Some(payload.clone()),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    assert!(
        response.headers[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/plain")
    );
    let sso = account(&database, "sso@example.test").await;
    assert_eq!(response.body, Value::String(sso.user_id.clone()));
    assert_eq!(
        (
            sso.hasher.as_str(),
            sso.password.as_str(),
            sso.is_deactivated
        ),
        ("Empty", "", true)
    );
    let response = send(
        &app,
        Method::POST,
        &path,
        None,
        Some(&superuser.token),
        Some(payload),
    )
    .await;
    assert_eq!(response.body, messages(&[EMAIL_TAKEN]));

    // organizations/:id/addUser
    let add_path = format!("/api/organizations/{new_org}/addUser");
    let email = json!("second@example.test");
    assert_eq!(
        send(
            &app,
            Method::POST,
            &add_path,
            None,
            Some(&regular.token),
            Some(email.clone())
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            &app,
            Method::POST,
            "/api/organizations/missing/addUser",
            None,
            Some(&superuser.token),
            Some(email.clone())
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
    let response = send(
        &app,
        Method::POST,
        &add_path,
        None,
        Some(&superuser.token),
        Some(email),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    let (admin, active): (bool, bool) =
        sqlx::query_as("SELECT isAdmin, NOT isDeactivated FROM webknossos.users WHERE _id = $1")
            .bind(response.body.as_str().unwrap())
            .fetch_one(&database.pool)
            .await
            .unwrap();
    assert!(!admin && active);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn concurrent_registrations_with_the_same_email_create_one_account() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    seed_organization_team(&database, &fixture.organization_id).await;
    set_password(&database, &fixture.multi_user_id, "admin@example.test").await;
    let mailer = RecordingMailer::default();
    let app = app(&database, config(), &mailer);
    let body = sign_up("race@example.test", "Race", "Condition", json!({}));
    let (first, second) = tokio::join!(
        send(
            &app,
            Method::POST,
            "/api/auth/register",
            None,
            None,
            Some(body.clone())
        ),
        send(
            &app,
            Method::POST,
            "/api/auth/register",
            None,
            None,
            Some(body)
        ),
    );
    let mut statuses = [first.status, second.status];
    statuses.sort();
    assert_eq!(statuses[0], StatusCode::OK);
    assert_ne!(statuses[1], StatusCode::OK);
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM webknossos.multiUsers WHERE email = $1",
            "race@example.test"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM webknossos.emailVerificationKeys WHERE email = $1",
            "race@example.test"
        )
        .await,
        1
    );
    database.cleanup().await;
}
