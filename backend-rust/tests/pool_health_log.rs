//! Pool health log against a real database pool.
use crate::common;

use common::TestDb;
use webknossos_backend::background::pool_health_log::run;

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn logs_the_real_pool_and_runtime() {
    let db = TestDb::new().await;
    let mut held = db.pool.acquire().await.unwrap();
    sqlx::query("SELECT 1").execute(&mut *held).await.unwrap();
    let health = run(&db.pool);
    assert!(!health.db_pool_saturated, "{}", health.message);
    assert!(
        health.message.contains("inUse=1,") && health.message.contains("maxConnections=5"),
        "{}",
        health.message
    );
    assert!(
        health.message.contains("Tokio runtime: workers="),
        "{}",
        health.message
    );

    // Hold every allowed connection: the tick becomes a warning.
    let mut all = vec![held];
    for _ in 1..5 {
        all.push(db.pool.acquire().await.unwrap());
    }
    let health = run(&db.pool);
    assert!(health.db_pool_saturated, "{}", health.message);
    assert!(health.message.contains("inUse=5, idle=0, maxConnections=5"));
    drop(all);
    db.cleanup().await;
}
