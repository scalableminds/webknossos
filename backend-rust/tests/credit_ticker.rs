mod common;

use std::time::{Duration, Instant};

use common::{TestDb, object_id};
use webknossos_backend::{
    credit_ticker::{self, CreditTickerConfig, JOB_NAME},
    scheduler::{JobOutcome, JobSchedule, advisory_lock_key, try_advisory_xact_lock},
};

const MONTHLY: i32 = 2000;

/// Seeds a grant/spending; `expiration` is a SQL expression (e.g. `NOW() - INTERVAL '1 day'`).
async fn seed(
    db: &TestDb,
    organization: &str,
    delta: i32,
    credit_state: &str,
    created_ago_days: i32,
    expiration: &str,
) -> String {
    let id = object_id();
    sqlx::query(&format!(
        r#"INSERT INTO webknossos.credit_transactions
          (_id,_organization,milli_credit_delta,comment,transaction_state,credit_state,expiration_date,created_at,updated_at)
          VALUES ($1,$2,$3,'seeded','Complete',$4::webknossos.credit_state,{expiration},
            NOW() - make_interval(days => $5), NOW() - make_interval(days => $5))"#
    ))
    .bind(&id)
    .bind(organization)
    .bind(delta)
    .bind(credit_state)
    .bind(created_ago_days)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

async fn credit_state(db: &TestDb, id: &str) -> String {
    sqlx::query_scalar(
        "SELECT credit_state::text FROM webknossos.credit_transactions WHERE _id = $1",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

/// (related transaction, delta) of all revoking rows of an organization.
async fn revocations(db: &TestDb, organization: &str) -> Vec<(Option<String>, i32)> {
    sqlx::query_as(
        "SELECT _related_transaction, milli_credit_delta FROM webknossos.credit_transactions \
         WHERE _organization = $1 AND credit_state = 'Revoking' ORDER BY milli_credit_delta",
    )
    .bind(organization)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

/// (delta, comment, expires on the first of next month) of all complimentary grants.
async fn monthly_grants(db: &TestDb, organization: &str) -> Vec<(i32, String, bool)> {
    sqlx::query_as(
        "SELECT milli_credit_delta, comment, \
           expiration_date = DATE_TRUNC('MONTH', NOW()) + INTERVAL '1 MONTH' \
         FROM webknossos.credit_transactions \
         WHERE _organization = $1 AND comment LIKE 'Complimentary credits (%' ORDER BY created_at",
    )
    .bind(organization)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

async fn row_count(db: &TestDb) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.credit_transactions")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

async fn current_month(db: &TestDb) -> String {
    sqlx::query_scalar("SELECT TO_CHAR(NOW(), 'YYYY-MM')")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

fn completed(outcome: JobOutcome) -> String {
    match outcome {
        JobOutcome::Completed(message) => message,
        JobOutcome::SkippedLocked => panic!("run was unexpectedly skipped"),
    }
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn run_revokes_exactly_the_expired_credits() {
    let db = TestDb::new().await;
    let a = db.fixture().await.organization_id;
    let b = db.fixture().await.organization_id;
    let expired = "NOW() - INTERVAL '1 day'";
    // a: expired grant of 2000 with 500 spent afterwards -> partially revoked (-1500).
    let partial = seed(&db, &a, 2000, "Pending", 40, expired).await;
    seed(&db, &a, -500, "Spent", 39, "NULL").await;
    // a: not yet expired grant, and an expired grant already revoked earlier: both untouched.
    let current = seed(&db, &a, 700, "Pending", 1, "NOW() + INTERVAL '1 day'").await;
    let already = seed(&db, &a, 900, "Revoked", 70, "NOW() - INTERVAL '30 days'").await;
    // b: unused expired grant -> revoked (-3000); fully spent expired grant -> Spent.
    let spent = seed(&db, &b, 1000, "Pending", 50, expired).await;
    seed(&db, &b, -1000, "Spent", 49, "NULL").await;
    let unused = seed(&db, &b, 3000, "Pending", 10, expired).await;

    let message = completed(credit_ticker::run(&db.pool, MONTHLY).await.unwrap());
    assert_eq!(
        message,
        "Finished revoking and handing out free monthly credits."
    );
    assert_eq!(credit_state(&db, &partial).await, "PartiallyRevoked");
    assert_eq!(credit_state(&db, &current).await, "Pending");
    assert_eq!(credit_state(&db, &already).await, "Revoked");
    assert_eq!(credit_state(&db, &spent).await, "Spent");
    assert_eq!(credit_state(&db, &unused).await, "Revoked");
    assert_eq!(revocations(&db, &a).await, vec![(Some(partial), -1500)]);
    assert_eq!(revocations(&db, &b).await, vec![(Some(unused), -3000)]);

    // Second run: nothing expired is pending any more, and the monthly grants exist already.
    let rows = row_count(&db).await;
    completed(credit_ticker::run(&db.pool, MONTHLY).await.unwrap());
    assert_eq!(row_count(&db).await, rows);
    assert_eq!(revocations(&db, &a).await.len(), 1);
    assert_eq!(revocations(&db, &b).await.len(), 1);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn monthly_credits_are_handed_out_once_per_due_organization() {
    let db = TestDb::new().await;
    let due = db.fixture().await.organization_id;
    let granted = db.fixture().await.organization_id;
    // `granted` already received this month's grant (it expires on the first of next month).
    let existing = seed(
        &db,
        &granted,
        2000,
        "Pending",
        3,
        "DATE_TRUNC('MONTH', NOW()) + INTERVAL '1 MONTH'",
    )
    .await;
    let month = current_month(&db).await;

    completed(credit_ticker::run(&db.pool, MONTHLY).await.unwrap());
    assert_eq!(
        monthly_grants(&db, &due).await,
        vec![(MONTHLY, format!("Complimentary credits ({month})"), true)]
    );
    assert!(monthly_grants(&db, &granted).await.is_empty());
    let granted_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.credit_transactions WHERE _organization = $1",
    )
    .bind(&granted)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(granted_rows, 1);
    assert_eq!(credit_state(&db, &existing).await, "Pending");
    let state: (String, String) = sqlx::query_as(
        "SELECT transaction_state::text, credit_state::text FROM webknossos.credit_transactions \
         WHERE _organization = $1",
    )
    .bind(&due)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(state, ("Complete".into(), "Pending".into()));

    // Second (and third) run in the same month: no-op.
    let rows = row_count(&db).await;
    completed(credit_ticker::run(&db.pool, MONTHLY).await.unwrap());
    completed(credit_ticker::run(&db.pool, 5000).await.unwrap());
    assert_eq!(row_count(&db).await, rows);
    assert_eq!(monthly_grants(&db, &due).await.len(), 1);

    // A new organization becomes due and is granted on the next run only.
    let late = db.fixture().await.organization_id;
    completed(credit_ticker::run(&db.pool, MONTHLY).await.unwrap());
    assert_eq!(row_count(&db).await, rows + 1);
    assert_eq!(monthly_grants(&db, &late).await.len(), 1);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn lock_contention_skips_the_run() {
    let db = TestDb::new().await;
    let organization = db.fixture().await.organization_id;
    let expired = seed(
        &db,
        &organization,
        1000,
        "Pending",
        40,
        "NOW() - INTERVAL '1 day'",
    )
    .await;
    let rows = row_count(&db).await;

    let mut holder = db.pool.begin().await.unwrap();
    assert!(
        try_advisory_xact_lock(&mut holder, advisory_lock_key(JOB_NAME))
            .await
            .unwrap()
    );
    assert_eq!(
        credit_ticker::run(&db.pool, MONTHLY).await.unwrap(),
        JobOutcome::SkippedLocked
    );
    assert_eq!(credit_state(&db, &expired).await, "Pending");
    assert_eq!(row_count(&db).await, rows);

    // Concurrent contenders are all skipped while the lock is held.
    let contenders: Vec<_> = (0..3)
        .map(|_| {
            let pool = db.pool.clone();
            tokio::spawn(async move { credit_ticker::run(&pool, MONTHLY).await.unwrap() })
        })
        .collect();
    for contender in contenders {
        assert_eq!(contender.await.unwrap(), JobOutcome::SkippedLocked);
    }
    assert_eq!(row_count(&db).await, rows);

    // The transaction-scoped lock ends with the holder's transaction.
    holder.rollback().await.unwrap();
    completed(credit_ticker::run(&db.pool, MONTHLY).await.unwrap());
    assert_eq!(credit_state(&db, &expired).await, "Revoked");
    assert_eq!(monthly_grants(&db, &organization).await.len(), 1);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn spawned_ticker_runs_on_schedule() {
    let db = TestDb::new().await;
    let organization = db.fixture().await.organization_id;
    let config = CreditTickerConfig {
        schedule: JobSchedule {
            enabled: true,
            interval: Duration::from_secs(3600),
            initial_delay: Duration::ZERO,
        },
    };
    let handle = credit_ticker::spawn(db.pool.clone(), &config, 1234);
    assert_eq!(handle.job_names(), vec![JOB_NAME]);
    let deadline = Instant::now() + Duration::from_secs(10);
    while monthly_grants(&db, &organization).await.is_empty() {
        assert!(Instant::now() < deadline, "ticker did not run in time");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    handle.shutdown().await;
    let grants = monthly_grants(&db, &organization).await;
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].0, 1234);
    db.cleanup().await;
}
