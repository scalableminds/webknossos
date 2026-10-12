mod common;

use std::time::Duration;

use chrono::{DateTime, TimeDelta, Utc};
use common::{Fixture, TestDb, object_id};
use webknossos_backend::{
    housekeeping::{self, HousekeepingConfig, HousekeepingJob},
    scheduler::{JobOutcome, JobSchedule, try_advisory_xact_lock},
};

/// Truncated to microseconds so values round-trip through TIMESTAMPTZ exactly.
fn now() -> DateTime<Utc> {
    let now = Utc::now();
    DateTime::from_timestamp_micros(now.timestamp_micros()).unwrap()
}

async fn execute(db: &TestDb, job: HousekeepingJob, now: DateTime<Utc>) -> u64 {
    let mut connection = db.pool.acquire().await.unwrap();
    job.execute(&mut connection, now).await.unwrap()
}

async fn seed_token(db: &TestDb, f: &Fixture, expiration: DateTime<Utc>, deleted: bool) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.tokens (_id, value, _user, lastUsedDateTime, expirationDateTime, tokenType, isDeleted) VALUES ($1, $1, $2, NOW(), $3, 'DataStore', $4)")
        .bind(&id).bind(&f.user_id).bind(expiration).bind(deleted)
        .execute(&db.pool).await.unwrap();
    id
}

async fn token_state(db: &TestDb, id: &str) -> Option<bool> {
    sqlx::query_scalar("SELECT isDeleted FROM webknossos.tokens WHERE _id = $1")
        .bind(id)
        .fetch_optional(&db.pool)
        .await
        .unwrap()
}

async fn seed_dataset(db: &TestDb, f: &Fixture) -> String {
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('store','http://store.invalid','http://store.invalid','key') ON CONFLICT DO NOTHING")
        .execute(&db.pool).await.unwrap();
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,voxelSizeFactor,sortingKey) SELECT $1,'store',_id,_rootFolder,$1,$1,true,ROW(1,1,1)::webknossos.VECTOR3,NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    id
}

async fn seed_annotation(
    db: &TestDb,
    f: &Fixture,
    dataset: &str,
    state: &str,
    age: &str,
) -> String {
    let id = object_id();
    sqlx::query(&format!("INSERT INTO webknossos.annotations (_id,_dataset,_user,typ,state,created) VALUES ($1,$2,$3,'Explorational',$4::webknossos.ANNOTATION_STATE,NOW() - INTERVAL '{age}')"))
        .bind(&id).bind(dataset).bind(&f.user_id).bind(state)
        .execute(&db.pool).await.unwrap();
    id
}

async fn exists(db: &TestDb, table: &str, column: &str, id: &str) -> bool {
    sqlx::query_scalar(&format!(
        "SELECT EXISTS (SELECT 1 FROM webknossos.{table} WHERE {column} = $1)"
    ))
    .bind(id)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

async fn seed_mutex(db: &TestDb, f: &Fixture, annotation: &str, offset: &str) {
    sqlx::query(&format!("INSERT INTO webknossos.annotation_mutexes (_annotation,_user,sessionId,expiry) VALUES ($1,$2,'session',NOW() + INTERVAL '{offset}')"))
        .bind(annotation).bind(&f.user_id).execute(&db.pool).await.unwrap();
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn expired_tokens_are_soft_deleted_inclusive_of_now() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let now = now();
    let expired = seed_token(&db, &f, now - TimeDelta::minutes(1), false).await;
    let boundary = seed_token(&db, &f, now, false).await;
    let already = seed_token(&db, &f, now - TimeDelta::days(30), true).await;
    let valid = seed_token(&db, &f, now + TimeDelta::microseconds(1), false).await;
    // Scala's UPDATE does not exclude already-deleted rows, so they are counted again; the
    // fixture's own authentication token expires in one hour and stays.
    assert_eq!(execute(&db, HousekeepingJob::ExpiredTokens, now).await, 3);
    assert_eq!(token_state(&db, &expired).await, Some(true));
    assert_eq!(token_state(&db, &boundary).await, Some(true));
    assert_eq!(token_state(&db, &already).await, Some(true));
    assert_eq!(token_state(&db, &valid).await, Some(false));
    let live: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.tokens WHERE NOT isDeleted")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(live, 2);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn old_soft_deleted_tokens_are_hard_deleted_after_seven_days() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let now = now();
    let grace = TimeDelta::days(7);
    let old = seed_token(&db, &f, now - TimeDelta::days(8), true).await;
    let boundary = seed_token(&db, &f, now - grace, true).await;
    let recent = seed_token(&db, &f, now - grace + TimeDelta::microseconds(1), true).await;
    let old_live = seed_token(&db, &f, now - TimeDelta::days(30), false).await;
    assert_eq!(execute(&db, HousekeepingJob::OldTokens, now).await, 2);
    assert_eq!(token_state(&db, &old).await, None);
    assert_eq!(token_state(&db, &boundary).await, None);
    assert_eq!(token_state(&db, &recent).await, Some(true));
    assert_eq!(token_state(&db, &old_live).await, Some(false));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn expired_invites_are_soft_deleted() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let now = now();
    let mut ids = Vec::new();
    for (expiration, deleted) in [
        (now - TimeDelta::hours(1), false),
        (now, false),
        (now + TimeDelta::microseconds(1), false),
        (now + TimeDelta::days(1), false),
    ] {
        let id = object_id();
        sqlx::query("INSERT INTO webknossos.invites (_id, tokenValue, _organization, autoActivate, expirationDateTime, isDeleted) VALUES ($1, $1, $2, TRUE, $3, $4)")
            .bind(&id).bind(&f.organization_id).bind(expiration).bind(deleted)
            .execute(&db.pool).await.unwrap();
        ids.push(id);
    }
    assert_eq!(execute(&db, HousekeepingJob::ExpiredInvites, now).await, 2);
    let mut states = Vec::new();
    for id in &ids {
        let deleted: bool =
            sqlx::query_scalar("SELECT isDeleted FROM webknossos.invites WHERE _id = $1")
                .bind(id)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        states.push(deleted);
    }
    assert_eq!(states, [true, true, false, false]);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn only_initializing_annotations_older_than_one_hour_are_deleted() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dataset = seed_dataset(&db, &f).await;
    let stale = seed_annotation(&db, &f, &dataset, "Initializing", "2 hours").await;
    let fresh = seed_annotation(&db, &f, &dataset, "Initializing", "50 minutes").await;
    let active = seed_annotation(&db, &f, &dataset, "Active", "2 days").await;
    let finished = seed_annotation(&db, &f, &dataset, "Finished", "2 days").await;
    // Dependent rows with ON DELETE CASCADE follow the annotation.
    seed_mutex(&db, &f, &stale, "1 hour").await;
    assert_eq!(
        execute(&db, HousekeepingJob::InitializingAnnotations, now()).await,
        1
    );
    assert!(!exists(&db, "annotations", "_id", &stale).await);
    assert!(!exists(&db, "annotation_mutexes", "_annotation", &stale).await);
    for id in [&fresh, &active, &finished] {
        assert!(exists(&db, "annotations", "_id", id).await);
    }
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn thumbnails_older_than_ten_days_are_deleted() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dataset = seed_dataset(&db, &f).await;
    let now = now();
    for (width, created) in [
        (1, now - TimeDelta::days(11)),
        (2, now - TimeDelta::days(10) - TimeDelta::microseconds(1)),
        (3, now - TimeDelta::days(10)),
        (4, now - TimeDelta::days(9)),
    ] {
        sqlx::query("INSERT INTO webknossos.dataset_thumbnails (_dataset,dataLayerName,width,height,mappingName,image,mag,mag1BoundingBox,created) VALUES ($1,'color',$2,1,'','\\x00',ROW(1,1,1)::webknossos.VECTOR3,ROW(0,0,0,1,1,1)::webknossos.BOUNDING_BOX,$3)")
            .bind(&dataset).bind(width).bind(created).execute(&db.pool).await.unwrap();
    }
    assert_eq!(
        execute(&db, HousekeepingJob::ExpiredThumbnails, now).await,
        2
    );
    let remaining: Vec<i32> =
        sqlx::query_scalar("SELECT width FROM webknossos.dataset_thumbnails ORDER BY width")
            .fetch_all(&db.pool)
            .await
            .unwrap();
    assert_eq!(remaining, [3, 4]);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn expired_annotation_mutexes_are_deleted() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dataset = seed_dataset(&db, &f).await;
    let expired = seed_annotation(&db, &f, &dataset, "Active", "1 day").await;
    let held = seed_annotation(&db, &f, &dataset, "Active", "1 day").await;
    seed_mutex(&db, &f, &expired, "-1 minute").await;
    seed_mutex(&db, &f, &held, "2 minutes").await;
    let outcome = HousekeepingJob::ExpiredAnnotationMutexes
        .run(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed("Cleaned up 1 expired annotation mutexes.".into())
    );
    assert!(!exists(&db, "annotation_mutexes", "_annotation", &expired).await);
    assert!(exists(&db, "annotation_mutexes", "_annotation", &held).await);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn advisory_lock_held_elsewhere_skips_only_that_job() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let expired = seed_token(&db, &f, now() - TimeDelta::minutes(1), false).await;
    let old = seed_token(&db, &f, now() - TimeDelta::days(30), true).await;

    // Another instance is in the middle of the expired-token job.
    let mut other = db.pool.begin().await.unwrap();
    assert!(
        try_advisory_xact_lock(
            &mut other,
            HousekeepingJob::ExpiredTokens.advisory_lock_key()
        )
        .await
        .unwrap()
    );
    assert_eq!(
        HousekeepingJob::ExpiredTokens.run(&db.pool).await.unwrap(),
        JobOutcome::SkippedLocked
    );
    assert_eq!(token_state(&db, &expired).await, Some(false));
    // A different job has its own key and still runs.
    assert_eq!(
        HousekeepingJob::OldTokens.run(&db.pool).await.unwrap(),
        JobOutcome::Completed("1 old soft-deleted tokens removed".into())
    );
    assert_eq!(token_state(&db, &old).await, None);

    // The transaction-scoped lock ends with the holder's transaction.
    other.commit().await.unwrap();
    assert!(matches!(
        HousekeepingJob::ExpiredTokens.run(&db.pool).await.unwrap(),
        JobOutcome::Completed(_)
    ));
    assert_eq!(token_state(&db, &expired).await, Some(true));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn concurrent_runs_of_one_job_never_overlap() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dataset = seed_dataset(&db, &f).await;
    for _ in 0..5 {
        let annotation = seed_annotation(&db, &f, &dataset, "Active", "1 day").await;
        seed_mutex(&db, &f, &annotation, "-1 minute").await;
    }
    // Hold the lock while all contenders start, so every one of them must be skipped.
    let mut holder = db.pool.begin().await.unwrap();
    let key = HousekeepingJob::ExpiredAnnotationMutexes.advisory_lock_key();
    assert!(try_advisory_xact_lock(&mut holder, key).await.unwrap());
    let contenders: Vec<_> = (0..3)
        .map(|_| {
            let pool = db.pool.clone();
            tokio::spawn(async move {
                HousekeepingJob::ExpiredAnnotationMutexes
                    .run(&pool)
                    .await
                    .unwrap()
            })
        })
        .collect();
    for contender in contenders {
        assert_eq!(contender.await.unwrap(), JobOutcome::SkippedLocked);
    }
    holder.rollback().await.unwrap();
    // Unsynchronized parallel runs: every outcome is a full run or a skip, and the rows are
    // deleted exactly once in total.
    let runs: Vec<_> = (0..4)
        .map(|_| {
            let pool = db.pool.clone();
            tokio::spawn(async move {
                HousekeepingJob::ExpiredAnnotationMutexes
                    .run(&pool)
                    .await
                    .unwrap()
            })
        })
        .collect();
    let mut deleted = 0;
    for run in runs {
        match run.await.unwrap() {
            JobOutcome::Completed(message) => {
                deleted += message
                    .trim_start_matches("Cleaned up ")
                    .split(' ')
                    .next()
                    .unwrap()
                    .parse::<u64>()
                    .unwrap();
            }
            JobOutcome::SkippedLocked => {}
        }
    }
    assert_eq!(deleted, 5);
    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.annotation_mutexes")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn spawned_scheduler_runs_enabled_jobs_and_shuts_down() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let expired = seed_token(&db, &f, now() - TimeDelta::minutes(1), false).await;
    let old = seed_token(&db, &f, now() - TimeDelta::days(30), true).await;
    let soon = JobSchedule {
        enabled: true,
        interval: Duration::from_secs(3600),
        initial_delay: Duration::ZERO,
    };
    let config = HousekeepingConfig {
        expired_tokens: soon,
        old_tokens: JobSchedule {
            enabled: false,
            ..soon
        },
        ..HousekeepingConfig::default()
    };
    let handle = housekeeping::spawn(db.pool.clone(), &config);
    assert!(handle.job_names().contains(&"expired-tokens"));
    assert!(!handle.job_names().contains(&"old-tokens"));
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while token_state(&db, &expired).await != Some(true) {
        assert!(std::time::Instant::now() < deadline, "job did not run");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    tokio::time::timeout(Duration::from_secs(5), handle.shutdown())
        .await
        .expect("scheduler shutdown");
    // The disabled hard-delete job never ran.
    assert_eq!(token_state(&db, &old).await, Some(true));
    db.cleanup().await;
}
