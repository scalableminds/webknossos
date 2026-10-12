mod common;
use axum::{body::Body, http::Request};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, router};

async fn request(app: &axum::Router, method: &str, uri: &str, token: Option<&str>) -> (u16, Value) {
    let mut request = Request::builder().uri(uri).method(method);
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    )
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

async fn make_superuser(db: &TestDb, multi_user: &str) {
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=TRUE WHERE _id=$1")
        .bind(multi_user)
        .execute(&db.pool)
        .await
        .unwrap();
}

async fn transactions(db: &TestDb, organization: &str) -> Vec<Value> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object('id',_id,'related',_related_transaction,'delta',milli_credit_delta,
          'comment',comment,'transactionState',transaction_state,'creditState',credit_state,
          'expires',floor(extract(epoch FROM expiration_date)*1000)::bigint)
          FROM webknossos.credit_transactions WHERE _organization=$1 ORDER BY created_at, _id"#,
    )
    .bind(organization)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn seed_transaction(
    db: &TestDb,
    organization: &str,
    delta: i32,
    transaction_state: &str,
    credit_state: &str,
    paid_job: Option<&str>,
    created_ago_days: i32,
    expired: bool,
) -> String {
    let id = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id,_organization,_paid_job,milli_credit_delta,comment,transaction_state,credit_state,expiration_date,created_at,updated_at)
          VALUES ($1,$2,$3,$4,'seeded',$5::webknossos.credit_transaction_state,$6::webknossos.credit_state,
            CASE WHEN $8 THEN NOW() - INTERVAL '1 day' ELSE NULL END,
            NOW() - make_interval(days => $7), NOW() - make_interval(days => $7))"#,
    )
    .bind(&id)
    .bind(organization)
    .bind(paid_job)
    .bind(delta)
    .bind(transaction_state)
    .bind(credit_state)
    .bind(created_ago_days)
    .bind(expired)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn add_credits_validation_and_permissions() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let org = &f.organization_id;
    let add = |query: String| format!("/api/creditTransactions/addCredits?{query}");
    let base = format!("organizationId={org}&creditAmount=5&moneySpent=12.50&currency=EUR");
    assert_eq!(request(&app, "POST", &add(base.clone()), None).await.0, 401);
    assert_eq!(
        request(&app, "POST", &add(base.clone()), Some(&f.token)).await,
        (
            400,
            error("Only super users can add credits to an organization")
        )
    );
    // Required query parameters are bound before authentication.
    assert_eq!(
        request(&app, "POST", &add("creditAmount=5".into()), None)
            .await
            .0,
        400
    );
    make_superuser(&db, &f.multi_user_id).await;
    let cases = [
        (
            "organizationId=missing-org&creditAmount=5&moneySpent=1&currency=EUR".to_owned(),
            400,
            error("Organization “missing-org” could not be found or accessed."),
        ),
        (
            format!("organizationId={org}&creditAmount=5&moneySpent=abc&currency=EUR"),
            400,
            error("moneySpent abc is not a valid decimal"),
        ),
        (
            format!("organizationId={org}&creditAmount=5&moneySpent=-1&currency=EUR"),
            400,
            error("moneySpent must be a positive number"),
        ),
        (
            format!("organizationId={org}&creditAmount=0&moneySpent=1&currency=EUR"),
            400,
            error("creditAmount must be a positive number"),
        ),
        (
            format!("{base}&expiresAt=not-a-date"),
            404,
            error("Could not find or access the requested resource."),
        ),
        (
            format!("{base}&expiresAt=1000"),
            400,
            error("Expiration date must be in the future"),
        ),
    ];
    for (query, status, body) in cases {
        assert_eq!(
            request(&app, "POST", &add(query.clone()), Some(&f.token)).await,
            (status, body),
            "{query}"
        );
    }
    assert!(transactions(&db, org).await.is_empty());
    assert_eq!(
        request(&app, "POST", &add(base.clone()), Some(&f.token)).await,
        (200, Value::Null)
    );
    let expires = chrono::Utc::now().timestamp_millis() + 86_400_000;
    assert_eq!(
        request(
            &app,
            "POST",
            &add(format!("{base}&comment=Custom%20grant&expiresAt={expires}")),
            Some(&f.token)
        )
        .await
        .0,
        200
    );
    let rows = transactions(&db, org).await;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["delta"], 5000);
    assert_eq!(rows[0]["comment"], "Adding 5 credits for 12.50 EUR.");
    assert_eq!(rows[0]["transactionState"], "Complete");
    assert_eq!(rows[0]["creditState"], "AddCredits");
    assert_eq!(rows[0]["expires"], Value::Null);
    assert_eq!(rows[1]["comment"], "Custom grant");
    assert_eq!(rows[1]["expires"], expires);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn list_serializes_paid_jobs_and_refund_flow() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let org = &f.organization_id;
    let member = db.seed_user(&object_id(), org, false).await;
    let other = db.fixture().await;
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('store','http://store','http://store','key')")
        .execute(&db.pool).await.unwrap();
    let job = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs,state,manualState,returnValue,created,started)
          VALUES ($1,$2,'store','infer_nuclei','{"dataset_name":"ds","webknossos_token":"secret","user_auth_token":"secret"}',
            'STARTED','SUCCESS','0123456789ABCDEF01234567',to_timestamp(1000),to_timestamp(2000))"#,
    )
    .bind(&job)
    .bind(&f.user_id)
    .execute(&db.pool)
    .await
    .unwrap();
    let grant = seed_transaction(&db, org, 10_000, "Complete", "AddCredits", None, 3, false).await;
    let spend = seed_transaction(&db, org, -1500, "Pending", "Pending", Some(&job), 2, false).await;
    let manual = seed_transaction(&db, org, -500, "Pending", "Pending", None, 1, false).await;
    seed_transaction(
        &db,
        &other.organization_id,
        100,
        "Complete",
        "AddCredits",
        None,
        1,
        false,
    )
    .await;

    assert_eq!(
        request(&app, "GET", "/api/creditTransactions", None)
            .await
            .0,
        401
    );
    assert_eq!(
        request(&app, "GET", "/api/creditTransactions", Some(&member.token)).await,
        (
            400,
            error("Only organization admins can list credit transactions.")
        )
    );
    let (status, list) = request(&app, "GET", "/api/creditTransactions", Some(&f.token)).await;
    assert_eq!(status, 200, "{list}");
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0]["id"], grant.as_str());
    assert_eq!(
        list[0]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>(),
        [
            "id",
            "organization_id",
            "relatedTransaction",
            "paidJob",
            "creditChange",
            "comment",
            "transactionState",
            "creditState",
            "expirationDate",
            "createdAt",
            "updatedAt"
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    );
    assert_eq!(list[0]["organization_id"], org.as_str());
    assert_eq!(list[0]["relatedTransaction"], Value::Null);
    assert_eq!(list[0]["paidJob"], Value::Null);
    assert_eq!(list[0]["creditChange"], 10_000);
    assert_eq!(list[0]["expirationDate"], Value::Null);
    assert!(list[0]["createdAt"].is_i64());
    assert_eq!(list[1]["id"], spend.as_str());
    assert_eq!(
        list[1]["paidJob"],
        json!({
            "id": job,
            "command": "infer_nuclei",
            "organizationId": org,
            "ownerFirstName": "Rust",
            "ownerLastName": "Test",
            "ownerEmail": format!("{}@example.test", f.multi_user_id),
            "args": {"dataset_name": "ds"},
            "state": "SUCCESS",
            "returnValue": "0123456789ABCDEF01234567",
            "resultLink": "/datasets/0123456789abcdef01234567/view",
            "created": 1_000_000,
            "started": 2_000_000,
            "costInMilliCredits": 1500
        })
    );

    // Refund: superuser only, organization must match, pending only.
    let refund = |id: &str, organization: &str| {
        format!("/api/creditTransactions/{id}?organizationId={organization}")
    };
    assert_eq!(
        request(&app, "PATCH", &refund(&spend, org), Some(&f.token)).await,
        (400, error("Only super users can manually refund credits"))
    );
    make_superuser(&db, &other.multi_user_id).await;
    assert_eq!(
        request(
            &app,
            "PATCH",
            &refund(&spend, &other.organization_id),
            Some(&other.token)
        )
        .await,
        (400, error("Transaction is not for this organization"))
    );
    assert_eq!(
        request(
            &app,
            "PATCH",
            &refund(&object_id(), org),
            Some(&other.token)
        )
        .await,
        (
            404,
            error("Could not find or access the requested resource.")
        )
    );
    assert_eq!(
        request(&app, "PATCH", &refund(&grant, org), Some(&other.token)).await,
        (400, error("Can only refund pending transactions."))
    );
    assert_eq!(
        request(&app, "PATCH", &refund(&spend, org), Some(&other.token)).await,
        (200, Value::Null)
    );
    assert_eq!(
        request(&app, "PATCH", &refund(&manual, org), Some(&other.token)).await,
        (200, Value::Null)
    );
    assert_eq!(
        request(&app, "PATCH", &refund(&spend, org), Some(&other.token)).await,
        (400, error("Can only refund pending transactions."))
    );
    let rows = transactions(&db, org).await;
    let by_id = |id: &str| rows.iter().find(|row| row["id"] == id).unwrap().clone();
    assert_eq!(by_id(&spend)["creditState"], "Refunded");
    assert_eq!(by_id(&spend)["transactionState"], "Complete");
    let refunds: Vec<&Value> = rows
        .iter()
        .filter(|row| row["creditState"] == "Refunding")
        .collect();
    assert_eq!(refunds.len(), 2);
    let job_refund = refunds
        .iter()
        .find(|row| row["related"] == spend.as_str())
        .unwrap();
    assert_eq!(job_refund["delta"], 1500);
    assert_eq!(
        job_refund["comment"],
        format!("Refund for failed job {job}.")
    );
    let manual_refund = refunds
        .iter()
        .find(|row| row["related"] == manual.as_str())
        .unwrap();
    assert_eq!(manual_refund["delta"], 500);
    assert_eq!(
        manual_refund["comment"],
        format!("Refund for transaction {manual}.")
    );
    let balance: i64 = sqlx::query_scalar(
        "SELECT SUM(milli_credit_delta) FROM webknossos.credit_transactions_ WHERE _organization=$1",
    )
    .bind(org)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(balance, 10_000);
    // Listing is limited to organizations the requester administers, even for superusers.
    let (status, list) = request(&app, "GET", "/api/creditTransactions", Some(&other.token)).await;
    assert_eq!(status, 200);
    assert_eq!(list.as_array().unwrap().len(), 1);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn revoke_expired_credits_and_compact_display() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let org = &f.organization_id;
    let other = db.fixture().await;
    // Partially used grant: 2000 granted, 500 spent afterwards.
    let partial = seed_transaction(&db, org, 2000, "Complete", "Pending", None, 40, true).await;
    seed_transaction(&db, org, -500, "Complete", "Spent", None, 39, false).await;
    // Unused grant in another organization; fully spent grant there as well.
    let spent = seed_transaction(
        &db,
        &other.organization_id,
        1000,
        "Complete",
        "Pending",
        None,
        50,
        true,
    )
    .await;
    seed_transaction(
        &db,
        &other.organization_id,
        -1000,
        "Complete",
        "Spent",
        None,
        49,
        false,
    )
    .await;
    let unused = seed_transaction(
        &db,
        &other.organization_id,
        3000,
        "Complete",
        "Pending",
        None,
        10,
        true,
    )
    .await;
    // Not expired: untouched.
    let current = seed_transaction(&db, org, 700, "Complete", "Pending", None, 1, false).await;

    assert_eq!(
        request(&app, "GET", "/api/maintenance/revokeExpiredCredits", None)
            .await
            .0,
        401
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/maintenance/revokeExpiredCredits",
            Some(&f.token)
        )
        .await,
        (
            400,
            error("Only super users can manually revoke expired credits")
        )
    );
    make_superuser(&db, &f.multi_user_id).await;
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/maintenance/revokeExpiredCredits",
            Some(&f.token)
        )
        .await,
        (200, Value::Null)
    );
    let rows = transactions(&db, org).await;
    let state = |rows: &[Value], id: &str| {
        rows.iter().find(|row| row["id"] == id).unwrap()["creditState"].clone()
    };
    assert_eq!(state(&rows, &partial), "PartiallyRevoked");
    assert_eq!(state(&rows, &current), "Pending");
    let revocation = rows
        .iter()
        .find(|row| row["creditState"] == "Revoking")
        .unwrap();
    assert_eq!(revocation["related"], partial.as_str());
    assert_eq!(revocation["delta"], -1500);
    assert_eq!(revocation["transactionState"], "Complete");
    assert!(
        revocation["comment"]
            .as_str()
            .unwrap()
            .starts_with("Revoked unused complimentary credits (")
    );
    let other_rows = transactions(&db, &other.organization_id).await;
    assert_eq!(state(&other_rows, &spent), "Spent");
    assert_eq!(state(&other_rows, &unused), "Revoked");
    let unused_revocation = other_rows
        .iter()
        .find(|row| row["creditState"] == "Revoking")
        .unwrap();
    assert_eq!(unused_revocation["delta"], -3000);
    // Idempotent: nothing pending and expired remains.
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/maintenance/revokeExpiredCredits",
            Some(&f.token)
        )
        .await
        .0,
        200
    );
    assert_eq!(transactions(&db, org).await.len(), rows.len());

    // Display compaction: grant + revocation become one net entry.
    let (status, list) = request(&app, "GET", "/api/creditTransactions", Some(&f.token)).await;
    assert_eq!(status, 200, "{list}");
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0]["id"], partial.as_str());
    assert_eq!(list[0]["creditChange"], 500);
    assert_eq!(list[0]["comment"], "seeded: 0.5 used");
    assert_eq!(list[0]["creditState"], "PartiallyRevoked");
    assert!(list[0]["expirationDate"].is_i64());
    assert!(list.iter().all(|entry| entry["creditState"] != "Revoking"));
    // Net-zero pairs (unused grant) are hidden for the other organization's admin.
    let (_, other_list) = request(&app, "GET", "/api/creditTransactions", Some(&other.token)).await;
    let other_list = other_list.as_array().unwrap();
    assert_eq!(other_list.len(), 2);
    assert!(
        other_list
            .iter()
            .all(|entry| entry["id"] != unused.as_str())
    );
    db.cleanup().await;
}
