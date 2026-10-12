#![allow(clippy::field_reassign_with_default)]
mod common;
use axum::{body::Body, http::Request};
use chrono::{Duration, Utc};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::MiscConfig,
    mail::{MailSender, RecordingMailer},
    router_with_misc,
};

struct Reply {
    status: u16,
    headers: axum::http::HeaderMap,
    body: Value,
}

async fn send(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> Reply {
    let mut request = Request::builder().uri(uri).method(method);
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let body = match body {
        Some(body) => {
            request = request.header("content-type", "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body: if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
        },
    }
}

fn app(db: &TestDb, misc: MiscConfig, mailer: &RecordingMailer) -> axum::Router {
    router_with_misc(
        AppState {
            pool: db.pool.clone(),
        },
        misc,
        MailSender::new(mailer.clone()),
    )
}

async fn create(app: &axum::Router, token: &str, body: Value) -> Reply {
    send(app, "POST", "/api/organizations", Some(token), Some(body)).await
}

async fn exec(db: &TestDb, sql: &str, id: &str) {
    sqlx::query(sql).bind(id).execute(&db.pool).await.unwrap();
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn operator_data_and_terms_of_service() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let mailer = RecordingMailer::default();
    let mut misc = MiscConfig::default();
    misc.operator_data = "Operated by **Test**".into();
    misc.terms_of_service.enabled = true;
    misc.terms_of_service.version = 2;
    misc.terms_of_service.url = "https://example.test/tos".into();
    let deadline = Utc::now() + Duration::days(3);
    misc.terms_of_service.acceptance_deadline = deadline;
    let app = app(&db, misc, &mailer);

    let reply = send(&app, "GET", "/api/operatorData", None, None).await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, json!("Operated by **Test**"));
    assert_eq!(reply.headers["cache-control"], "no-cache");
    let reply = send(&app, "GET", "/api/v12/termsOfService", None, None).await;
    assert_eq!(
        reply.body,
        json!({"version": 2, "enabled": true, "url": "https://example.test/tos"})
    );
    assert_eq!(reply.headers["cache-control"], "no-cache");

    let needed = "/api/termsOfService/acceptanceNeeded";
    assert_eq!(send(&app, "GET", needed, None, None).await.status, 401);
    let reply = send(&app, "GET", needed, Some(&member.token), None).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(
        reply.body,
        json!({
            "acceptanceNeeded": true,
            "acceptanceDeadline": deadline.timestamp_millis(),
            "acceptanceDeadlinePassed": false,
        })
    );

    let accept = "/api/termsOfService/accept?version=2";
    let reply = send(&app, "POST", accept, Some(&f.token), None).await;
    assert_eq!(reply.status, 400);
    assert_eq!(
        reply.body["messages"][0]["error"],
        "Only the organization owner can accept terms of service."
    );
    exec(
        &db,
        "UPDATE webknossos.users SET isOrganizationOwner = TRUE WHERE _id = $1",
        &f.user_id,
    )
    .await;
    let reply = send(
        &app,
        "POST",
        "/api/termsOfService/accept?version=1",
        Some(&f.token),
        None,
    )
    .await;
    assert_eq!(reply.status, 400);
    assert_eq!(
        reply.body["messages"][0]["error"],
        "Terms of service version mismatch. Current version is 2, received acceptance for 1."
    );
    assert_eq!(
        send(
            &app,
            "POST",
            "/api/termsOfService/accept",
            Some(&f.token),
            None
        )
        .await
        .status,
        400
    );
    let reply = send(&app, "POST", accept, Some(&f.token), None).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    let (version, accepted): (i32, bool) = sqlx::query_as(
        "SELECT lastTermsOfServiceAcceptanceVersion, lastTermsOfServiceAcceptanceTime IS NOT NULL FROM webknossos.organizations WHERE _id = $1",
    )
    .bind(&f.organization_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!((version, accepted), (2, true));
    let reply = send(&app, "GET", needed, Some(&member.token), None).await;
    assert_eq!(reply.body["acceptanceNeeded"], false);

    // Disabled terms of service cannot be accepted and are never needed.
    let disabled = self::app(&db, MiscConfig::default(), &mailer);
    let reply = send(
        &disabled,
        "POST",
        "/api/termsOfService/accept?version=1",
        Some(&f.token),
        None,
    )
    .await;
    assert_eq!(reply.status, 400);
    assert_eq!(
        reply.body["messages"][0]["error"],
        "Cannot accept terms of service, as it is not configured for this WEBKNOSSOS instance."
    );
    let reply = send(&disabled, "GET", needed, Some(&f.token), None).await;
    assert_eq!(reply.body["acceptanceNeeded"], false);
    assert_eq!(reply.body["acceptanceDeadlinePassed"], true);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn pricing_status_limits() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    db.seed_user(&object_id(), &f.organization_id, false).await;
    let mailer = RecordingMailer::default();
    let app = app(&db, MiscConfig::default(), &mailer);
    let status = "/api/pricing/status";
    let reply = send(&app, "GET", status, Some(&f.token), None).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(
        reply.body,
        json!({"pricingPlan": "Custom", "isExceeded": false, "isAlmostExceeded": false})
    );
    exec(
        &db,
        "UPDATE webknossos.organizations SET pricingPlan = 'Team', includedUsers = 2 WHERE _id = $1",
        &f.organization_id,
    )
    .await;
    let reply = send(&app, "GET", status, Some(&f.token), None).await;
    assert_eq!(
        reply.body,
        json!({"pricingPlan": "Team", "isExceeded": false, "isAlmostExceeded": true})
    );
    exec(
        &db,
        "UPDATE webknossos.organizations SET includedUsers = 1 WHERE _id = $1",
        &f.organization_id,
    )
    .await;
    assert_eq!(
        send(&app, "GET", status, Some(&f.token), None).await.body["isExceeded"],
        true
    );
    exec(
        &db,
        "UPDATE webknossos.organizations SET includedUsers = NULL, paidUntil = NOW() + INTERVAL '20 days' WHERE _id = $1",
        &f.organization_id,
    )
    .await;
    let reply = send(&app, "GET", status, Some(&f.token), None).await;
    assert_eq!(
        (&reply.body["isExceeded"], &reply.body["isAlmostExceeded"]),
        (&json!(false), &json!(true))
    );
    exec(
        &db,
        "UPDATE webknossos.organizations SET paidUntil = NOW() - INTERVAL '1 day' WHERE _id = $1",
        &f.organization_id,
    )
    .await;
    assert_eq!(
        send(&app, "GET", status, Some(&f.token), None).await.body["isExceeded"],
        true
    );
    assert_eq!(send(&app, "GET", status, None, None).await.status, 401);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn upgrade_request_validation_and_mail() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    exec(
        &db,
        "UPDATE webknossos.organizations SET pricingPlan = 'Personal', name = 'Acme' WHERE _id = $1",
        &f.organization_id,
    )
    .await;
    let mailer = RecordingMailer::default();
    let mut misc = MiscConfig::default();
    misc.support_email = "support@example.test".into();
    let app = app(&db, misc, &mailer);
    let path = "/api/pricing/upgradeRequest";
    let error = |reply: Reply| {
        assert_eq!(reply.status, 400, "{}", reply.body);
        reply.body["messages"][0]["error"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    assert_eq!(
        error(
            send(
                &app,
                "POST",
                path,
                Some(&member.token),
                Some(json!({"users": 1}))
            )
            .await
        ),
        "You do not have permission to request any changes to your organization WEBKNOSSOS plan. Please contact an organization admin."
    );
    assert_eq!(
        error(
            send(
                &app,
                "POST",
                path,
                Some(&f.token),
                Some(json!({"credits": 5}))
            )
            .await
        ),
        "You do not have permission to order WEBKNOSSOS credits for your organization. Please contact the organization owner."
    );
    assert_eq!(
        error(
            send(
                &app,
                "POST",
                path,
                Some(&f.token),
                Some(json!({"users": 0}))
            )
            .await
        ),
        "All requested amounts must be positive."
    );
    assert_eq!(
        error(
            send(
                &app,
                "POST",
                path,
                Some(&f.token),
                Some(json!({"users": 1, "note": "x".repeat(10001)}))
            )
            .await
        ),
        "The note of the upgrade request must not be longer than 10000 characters."
    );
    for plan in ["Team_Trial", "Custom", "Personal"] {
        assert_eq!(
            error(
                send(
                    &app,
                    "POST",
                    path,
                    Some(&f.token),
                    Some(json!({"plan": plan}))
                )
                .await
            ),
            "Only an upgrade to the Team or Power plan can be requested."
        );
    }
    assert_eq!(
        send(
            &app,
            "POST",
            path,
            Some(&f.token),
            Some(json!({"plan": "Gold"}))
        )
        .await
        .status,
        400
    );
    assert_eq!(
        error(
            send(
                &app,
                "POST",
                path,
                Some(&f.token),
                Some(json!({"aiAddon": true}))
            )
            .await
        ),
        "The AI Add-on is already active or requires at least the Team plan."
    );
    for body in [json!({}), json!({"aiAddon": false, "note": "only a note"})] {
        assert_eq!(
            error(send(&app, "POST", path, Some(&f.token), Some(body)).await),
            "The upgrade request does not contain any changes."
        );
    }
    assert!(mailer.take().is_empty());

    let reply = send(
        &app,
        "POST",
        path,
        Some(&f.token),
        Some(json!({"plan": "Power", "users": 2, "storageTB": 1, "aiAddon": true, "extendYears": 3, "note": "  call me  "})),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    let mails = mailer.take();
    assert_eq!(mails.len(), 1);
    let email = format!("{}@example.test", f.multi_user_id);
    assert_eq!(mails[0].subject, "WEBKNOSSOS Upgrade Request: Acme");
    assert_eq!(
        mails[0].recipients,
        vec!["support@example.test".to_owned(), email.clone()]
    );
    for line in [
        "Upgrade from Personal to Power plan",
        "2 additional users",
        "1 TB additional storage",
        "AI Add-on (Power AI)",
        "Plan extension by 3 years",
        "Requested by: Rust Test (",
        "<p>Note:</p>\n<p style=\"white-space: pre-wrap\">call me</p>",
    ] {
        assert!(
            mails[0].body_html.contains(line),
            "{line}: {}",
            mails[0].body_html
        );
    }

    // Owners may order credits; an active AI plan blocks the add-on.
    exec(
        &db,
        "UPDATE webknossos.users SET isOrganizationOwner = TRUE WHERE _id = $1",
        &f.user_id,
    )
    .await;
    exec(
        &db,
        "UPDATE webknossos.organizations SET pricingPlan = 'Team', aiPlan = 'Team_AI' WHERE _id = $1",
        &f.organization_id,
    )
    .await;
    assert_eq!(
        error(
            send(
                &app,
                "POST",
                path,
                Some(&f.token),
                Some(json!({"aiAddon": true}))
            )
            .await
        ),
        "The AI Add-on is already active or requires at least the Team plan."
    );
    let reply = send(
        &app,
        "POST",
        path,
        Some(&f.token),
        Some(json!({"credits": 1})),
    )
    .await;
    assert_eq!(reply.status, 200);
    assert!(
        mailer.take()[0]
            .body_html
            .contains("<li>1 WEBKNOSSOS credit</li>")
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn plan_updates_are_recorded_applied_and_listed() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let deactivated_admin = db.seed_user(&object_id(), &f.organization_id, true).await;
    exec(
        &db,
        "UPDATE webknossos.users SET isDeactivated = TRUE WHERE _id = $1",
        &deactivated_admin.user_id,
    )
    .await;
    let other = db.fixture().await;
    exec(
        &db,
        "UPDATE webknossos.multiUsers SET isSuperUser = TRUE WHERE _id = $1",
        &other.multi_user_id,
    )
    .await;
    exec(
        &db,
        "UPDATE webknossos.organizations SET pricingPlan = 'Personal', name = 'Acme', includedUsers = 1, aiPlan = 'Team_AI', created = '2025-01-01T00:00:00Z' WHERE _id = $1",
        &f.organization_id,
    )
    .await;
    let mailer = RecordingMailer::default();
    let app = app(&db, MiscConfig::default(), &mailer);
    let list = "/api/pricing/planUpdates";

    let reply = send(&app, "GET", list, Some(&member.token), None).await;
    assert_eq!(reply.status, 400);
    assert_eq!(
        reply.body["messages"][0]["error"],
        "Only organization admins can list plan updates."
    );
    let reply = send(&app, "GET", list, Some(&f.token), None).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(
        reply.body,
        json!([{
            "organizationId": f.organization_id,
            "description": "Organization created",
            "pricingPlan": "Personal",
            "aiPlan": "Team_AI",
            "includedUsers": 1,
            "created": 1735689600000i64,
        }])
    );

    let update = "/api/pricing/updatePlan";
    let body = json!({
        "organizationId": f.organization_id,
        "description": "Upgrade",
        "pricingPlan": "Power",
        "aiPlan": null,
        "paidUntil": 1798761600000i64,
        "includedStorageBytes": "50GB",
        "created": "2026-02-01T00:00:00Z",
    });
    let reply = send(&app, "POST", update, Some(&f.token), Some(body.clone())).await;
    assert_eq!(reply.status, 400);
    assert_eq!(
        reply.body["messages"][0]["error"],
        "This feature is currently only available for superusers."
    );
    let reply = send(
        &app,
        "POST",
        update,
        Some(&other.token),
        Some(json!({"organizationId": "missing", "pricingPlan": "Team"})),
    )
    .await;
    assert_eq!(reply.status, 404);
    assert_eq!(
        send(
            &app,
            "POST",
            update,
            Some(&other.token),
            Some(json!({"organizationId": f.organization_id, "includedUsers": "x"}))
        )
        .await
        .status,
        400
    );
    let reply = send(&app, "POST", update, Some(&other.token), Some(body)).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    let organization: (String, Option<String>, Option<i64>, Option<i32>, Option<i64>) =
        sqlx::query_as(
            "SELECT pricingPlan::text, aiPlan::text, (extract(epoch FROM paidUntil) * 1000)::bigint, includedUsers, includedStorage FROM webknossos.organizations WHERE _id = $1",
        )
        .bind(&f.organization_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        organization,
        (
            "Power".into(),
            None,
            Some(1798761600000),
            Some(1),
            Some(50_000_000_000)
        )
    );
    // Owner and active admins are notified about the gained features.
    let mails = mailer.take();
    assert_eq!(mails.len(), 1, "{mails:?}");
    assert_eq!(
        mails[0].recipients,
        vec![format!("{}@example.test", f.multi_user_id)]
    );
    assert_eq!(
        mails[0].subject,
        "WEBKNOSSOS Upgrade: Your organization is now on the Power plan"
    );
    assert!(mails[0].body_html.contains("Collaborative Annotation"));
    assert!(
        mails[0]
            .body_html
            .contains("Segmentation Proof-Reading Tool")
    );

    // A non-upgrade sends no mail; omitted fields stay unchanged.
    let reply = send(
        &app,
        "POST",
        update,
        Some(&other.token),
        Some(json!({"organizationId": f.organization_id, "pricingPlan": "Team", "includedUsers": null, "created": 1801440000000i64})),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert!(mailer.take().is_empty());
    let reply = send(&app, "GET", list, Some(&f.token), None).await;
    assert_eq!(
        reply.body,
        json!([
            {
                "organizationId": f.organization_id,
                "description": "Upgrade",
                "pricingPlan": "Power",
                "aiPlan": null,
                "paidUntil": 1798761600000i64,
                "includedStorageBytes": 50_000_000_000i64,
                "created": 1769904000000i64,
            },
            {
                "organizationId": f.organization_id,
                "pricingPlan": "Team",
                "includedUsers": null,
                "created": 1801440000000i64,
            }
        ])
    );
    let (users, storage): (Option<i32>, Option<i64>) = sqlx::query_as(
        "SELECT includedUsers, includedStorage FROM webknossos.organizations WHERE _id = $1",
    )
    .bind(&f.organization_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!((users, storage), (None, Some(50_000_000_000)));
    // Superusers list the plan updates of their own organization.
    let reply = send(&app, "GET", list, Some(&other.token), None).await;
    assert_eq!(reply.body[0]["organizationId"], other.organization_id);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn create_and_delete_organization() {
    let db = TestDb::new().await;
    let superuser = db.fixture().await;
    exec(
        &db,
        "UPDATE webknossos.multiUsers SET isSuperUser = TRUE WHERE _id = $1",
        &superuser.multi_user_id,
    )
    .await;
    let owner = db.fixture().await;
    let owner_email = format!("{}@example.test", owner.multi_user_id);
    let mailer = RecordingMailer::default();
    let mut misc = MiscConfig::default();
    misc.monthly_free_milli_credits = 1234;
    let app = app(&db, misc, &mailer);

    let body = json!({"organizationName": "Jürgen's Lab", "ownerEmail": owner_email});
    let reply = create(&app, &owner.token, body.clone()).await;
    assert_eq!(reply.status, 403);
    assert_eq!(
        reply.body["messages"][0]["error"],
        "You are not authorized to view or edit this resource."
    );
    let reply = create(
        &app,
        &superuser.token,
        json!({"organizationName": "X", "ownerEmail": "nobody@example.test"}),
    )
    .await;
    assert_eq!(reply.status, 400);
    assert_eq!(
        reply.body["messages"][0]["error"],
        "User could not be found or accessed."
    );
    let reply = create(
        &app,
        &superuser.token,
        json!({"organizationName": "日本", "ownerEmail": owner_email}),
    )
    .await;
    assert_eq!(reply.status, 400);
    assert_eq!(
        reply.body["messages"][0]["error"],
        "This organization id contains illegal characters. Please only use letters and numbers."
    );

    let reply = create(&app, &superuser.token, body.clone()).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.body, json!("Juergens_Lab"));
    assert!(
        reply.headers["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/plain")
    );
    let (plan, name, is_admin, is_owner, deactivated, teams, credits): (
        String,
        String,
        bool,
        bool,
        bool,
        i64,
        i64,
    ) = sqlx::query_as(
        r#"SELECT o.pricingPlan::text, o.name, u.isAdmin, u.isOrganizationOwner, u.isDeactivated,
             (SELECT COUNT(*) FROM webknossos.user_team_roles r JOIN webknossos.teams t ON t._id = r._team
               WHERE r._user = u._id AND t.isOrganizationTeam),
             (SELECT COALESCE(SUM(milli_credit_delta), 0) FROM webknossos.credit_transactions WHERE _organization = o._id)
           FROM webknossos.organizations o JOIN webknossos.users u ON u._organization = o._id
           WHERE o._id = 'Juergens_Lab' AND u._multiUser = $1"#,
    )
    .bind(&owner.multi_user_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        (
            plan.as_str(),
            name.as_str(),
            is_admin,
            is_owner,
            deactivated,
            teams,
            credits
        ),
        ("Custom", "Jürgen's Lab", true, true, false, 1, 1234)
    );
    let reply = create(&app, &superuser.token, body).await;
    assert_eq!(
        reply.body["messages"][0]["error"],
        "This id is already in use by a different organization and not available anymore. Please choose a different id."
    );
    // No active identity: nothing is created.
    exec(
        &db,
        "UPDATE webknossos.users SET isDeactivated = TRUE WHERE _multiUser = $1",
        &owner.multi_user_id,
    )
    .await;
    let reply = create(
        &app,
        &superuser.token,
        json!({"organization": "fresh", "organizationName": "Fresh", "ownerEmail": owner_email}),
    )
    .await;
    assert_eq!(reply.status, 404, "{}", reply.body);
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.organizations WHERE _id = 'fresh')",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert!(!exists);

    // Deletion: admins of the organization only.
    let target = db.fixture().await;
    let member = db
        .seed_user(&object_id(), &target.organization_id, false)
        .await;
    exec(
        &db,
        "UPDATE webknossos.multiUsers SET _lastLoggedInIdentity = (SELECT _id FROM webknossos.users WHERE _multiUser = $1 LIMIT 1) WHERE _id = $1",
        &member.multi_user_id,
    )
    .await;
    let path = format!("/api/organizations/{}", target.organization_id);
    let reply = send(&app, "DELETE", &path, Some(&member.token), None).await;
    assert_eq!(reply.status, 403);
    let reply = send(&app, "DELETE", &path, Some(&superuser.token), None).await;
    assert_eq!(reply.status, 403, "{}", reply.body);
    let reply = send(&app, "DELETE", &path, Some(&owner.token), None).await;
    assert_eq!(reply.status, 401);
    let unrelated = db.fixture().await;
    let reply = send(&app, "DELETE", &path, Some(&unrelated.token), None).await;
    assert_eq!(reply.status, 404);
    assert_eq!(
        reply.body["messages"][0]["error"],
        format!(
            "Organization “{}” could not be found or accessed.",
            target.organization_id
        )
    );
    let reply = send(&app, "DELETE", &path, Some(&target.token), None).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert!(reply.headers.get("set-cookie").is_none());
    let (org_deleted, users_deleted, token_deleted, last_identity): (
        bool,
        bool,
        bool,
        Option<String>,
    ) = sqlx::query_as(
        r#"SELECT o.isDeleted,
                 (SELECT bool_and(isDeleted) FROM webknossos.users WHERE _organization = o._id),
                 (SELECT isDeleted FROM webknossos.tokens WHERE value = $2),
                 (SELECT _lastLoggedInIdentity FROM webknossos.multiUsers WHERE _id = $3)
               FROM webknossos.organizations o WHERE o._id = $1"#,
    )
    .bind(&target.organization_id)
    .bind(&target.token)
    .bind(&member.multi_user_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        (org_deleted, users_deleted, token_deleted, last_identity),
        (true, true, true, None)
    );
    assert_eq!(
        send(
            &app,
            "GET",
            "/api/pricing/status",
            Some(&member.token),
            None
        )
        .await
        .status,
        401
    );
    let reply = send(&app, "DELETE", &path, Some(&superuser.token), None).await;
    assert_eq!(reply.status, 404);
    db.cleanup().await;
}
