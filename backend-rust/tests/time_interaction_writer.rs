mod common;

use axum::http::StatusCode;
use common::{Fixture, TestDb, UserFixture, object_id};
use webknossos_backend::{
    annotation_provider::AccessContext,
    auth::AuthUser,
    id::ObjectId,
    mail::{MailSender, RecordingMailer},
    time_interaction::{MAX_DURATION_MILLIS, TimeInteractionConfig, TimeInteractionState},
    time_interaction_writer::{OverLimitNotifier, RESOURCE_NOT_FOUND, TimeInteractionWriter},
};

const BASE: i64 = 1_700_000_000_000;

struct World {
    f: Fixture,
    owner: UserFixture,
    other: UserFixture,
    dataset: String,
    task_type: String,
}

async fn world(db: &TestDb) -> World {
    let f = db.fixture().await;
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let other = db.seed_user(&object_id(), &f.organization_id, false).await;
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('tw2','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'tw2',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    let task_type = object_id();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'TW2 type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    World {
        f,
        owner,
        other,
        dataset,
        task_type,
    }
}

/// Project owned by the fixture admin, with one task; returns the task id.
async fn task(db: &TestDb, w: &World, expected_time: Option<i64>) -> String {
    let (project, task) = (object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name,expectedTime) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(&project).bind(&w.f.organization_id).bind(&w.f.team_id).bind(&w.f.user_id)
        .bind(format!("Project {}", &project[..6])).bind(expected_time).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation,boundingbox) VALUES($1,$2,$3,'test',0,10,10,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3,ROW(1,2,3,10,20,30)::webknossos.BOUNDING_BOX)")
        .bind(&task).bind(&project).bind(&w.task_type).execute(&db.pool).await.unwrap();
    task
}

async fn annotation(
    db: &TestDb,
    w: &World,
    owner: &str,
    task: Option<&str>,
    visibility: &str,
    tracing_time: Option<i64>,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,tracingTime) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,$7)")
        .bind(&id).bind(&w.dataset).bind(task).bind(owner)
        .bind(if task.is_some() { "Task" } else { "Explorational" })
        .bind(visibility).bind(tracing_time).execute(&db.pool).await.unwrap();
    id
}

fn auth(user: &UserFixture) -> AuthUser {
    AuthUser {
        id: user.user_id.clone(),
        organization_id: user.organization_id.clone(),
        is_admin: false,
        is_dataset_manager: false,
        is_superuser: false,
    }
}

fn oid(id: &str) -> ObjectId {
    ObjectId::parse(id).unwrap()
}

fn writer(mailer: &RecordingMailer) -> TimeInteractionWriter {
    TimeInteractionWriter::new(
        TimeInteractionState::default(),
        TimeInteractionConfig::default(),
        OverLimitNotifier::new(MailSender::new(mailer.clone()), "https://wk.example.test/"),
    )
}

#[derive(Debug, PartialEq, Eq, sqlx::FromRow)]
struct Span {
    id: String,
    annotation: Option<String>,
    time: i64,
    count: i64,
    last: i64,
    created: i64,
    deleted: bool,
}

async fn spans(db: &TestDb, user: &str) -> Vec<Span> {
    sqlx::query_as("SELECT _id AS id,_annotation AS annotation,time,numberOfUpdates AS count,(EXTRACT(EPOCH FROM lastUpdate)*1000)::bigint AS last,(EXTRACT(EPOCH FROM created)*1000)::bigint AS created,isDeleted AS deleted FROM webknossos.timespans WHERE _user=$1 ORDER BY created,_id")
        .bind(user).fetch_all(&db.pool).await.unwrap()
}

fn span(id: &str, annotation: &str, time: i64, count: i64, last: i64, created: i64) -> Span {
    Span {
        id: id.to_owned(),
        annotation: Some(annotation.to_owned()),
        time,
        count,
        last,
        created,
        deleted: false,
    }
}

async fn total(db: &TestDb, table: &str, id: &str) -> Option<i64> {
    let sql = match table {
        "annotations" => "SELECT tracingTime FROM webknossos.annotations WHERE _id=$1",
        _ => "SELECT tracingTime FROM webknossos.tasks WHERE _id=$1",
    };
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

/// (id, count, lastUpdate) of the user's cached span.
async fn cached(writer: &TimeInteractionWriter, user: &str) -> Option<(String, i64, i64)> {
    let guard = writer.state().lock_user(&oid(user)).await;
    guard.cached().map(|s| {
        (
            s.id.to_string(),
            s.state.number_of_updates,
            s.state.last_update_millis,
        )
    })
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn inserts_new_span_and_extends_it_within_pause_with_task_propagation() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let t = task(&db, &w, None).await;
    let a = annotation(&db, &w, &w.owner.user_id, Some(&t), "Private", None).await;
    let mailer = RecordingMailer::default();
    let writer = writer(&mailer);
    let user = auth(&w.owner);
    let access = AccessContext::requester(Some(&user));
    let uid = oid(&w.owner.user_id);

    // Empty input is a no-op without SQL.
    writer
        .log_user_interaction(&db.pool, access, &uid, &oid(&a), &[])
        .await
        .unwrap();
    assert!(spans(&db, &w.owner.user_id).await.is_empty());
    assert_eq!(cached(&writer, &w.owner.user_id).await, None);

    writer
        .log_user_interaction(&db.pool, access, &uid, &oid(&a), &[BASE])
        .await
        .unwrap();
    let rows = spans(&db, &w.owner.user_id).await;
    assert_eq!(rows.len(), 1);
    let id = rows[0].id.clone();
    // Inserted with time 0/count 0, then the zero-delta close counts once.
    assert_eq!(rows, vec![span(&id, &a, 0, 1, BASE, BASE)]);
    assert_eq!(total(&db, "annotations", &a).await, Some(0));
    assert_eq!(total(&db, "tasks", &t).await, Some(0));
    assert_eq!(
        cached(&writer, &w.owner.user_id).await,
        Some((id.clone(), 1, BASE))
    );

    writer
        .log_user_interaction(&db.pool, access, &uid, &oid(&a), &[BASE + 10_000])
        .await
        .unwrap();
    assert_eq!(
        spans(&db, &w.owner.user_id).await,
        vec![span(&id, &a, 10_000, 2, BASE + 10_000, BASE)]
    );
    assert_eq!(total(&db, "annotations", &a).await, Some(10_000));
    assert_eq!(total(&db, "tasks", &t).await, Some(10_000));
    assert_eq!(
        cached(&writer, &w.owner.user_id).await,
        Some((id, 2, BASE + 10_000))
    );
    assert!(mailer.messages().is_empty());
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn pause_splits_spans_without_idle_credit() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let a = annotation(&db, &w, &w.owner.user_id, None, "Internal", Some(5)).await;
    let mailer = RecordingMailer::default();
    let writer = writer(&mailer);
    let user = auth(&w.owner);
    let access = AccessContext::requester(Some(&user));
    let uid = oid(&w.owner.user_id);

    // Gap 10_000 -> 70_000 equals the pause and splits.
    writer
        .log_user_interaction(
            &db.pool,
            access,
            &uid,
            &oid(&a),
            &[BASE, BASE + 10_000, BASE + 70_000, BASE + 80_000],
        )
        .await
        .unwrap();
    let rows = spans(&db, &w.owner.user_id).await;
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows,
        vec![
            span(&rows[0].id, &a, 10_000, 1, BASE + 10_000, BASE),
            span(&rows[1].id, &a, 10_000, 1, BASE + 80_000, BASE + 70_000),
        ]
    );
    assert_eq!(total(&db, "annotations", &a).await, Some(20_005));
    assert_eq!(
        cached(&writer, &w.owner.user_id).await,
        Some((rows[1].id.clone(), 1, BASE + 80_000))
    );

    // Later call after the pause: fresh span, cached span untouched.
    writer
        .log_user_interaction(&db.pool, access, &uid, &oid(&a), &[BASE + 200_000])
        .await
        .unwrap();
    let after = spans(&db, &w.owner.user_id).await;
    assert_eq!(after.len(), 3);
    assert_eq!(&after[..2], &rows[..]);
    assert_eq!(
        after[2],
        span(&after[2].id, &a, 0, 1, BASE + 200_000, BASE + 200_000)
    );
    assert_eq!(total(&db, "annotations", &a).await, Some(20_005));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn short_gap_switch_credits_previous_annotation_and_its_task() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let (t1, t2) = (task(&db, &w, None).await, task(&db, &w, None).await);
    let a = annotation(&db, &w, &w.owner.user_id, Some(&t1), "Private", None).await;
    let b = annotation(&db, &w, &w.owner.user_id, Some(&t2), "Private", Some(100)).await;
    let mailer = RecordingMailer::default();
    let writer = writer(&mailer);
    let user = auth(&w.owner);
    let access = AccessContext::requester(Some(&user));
    let uid = oid(&w.owner.user_id);

    writer
        .log_user_interaction(&db.pool, access, &uid, &oid(&a), &[BASE])
        .await
        .unwrap();
    writer
        .log_user_interaction(
            &db.pool,
            access,
            &uid,
            &oid(&b),
            &[BASE + 15_000, BASE + 20_000],
        )
        .await
        .unwrap();
    let rows = spans(&db, &w.owner.user_id).await;
    assert_eq!(
        rows,
        vec![
            span(&rows[0].id, &a, 15_000, 2, BASE + 15_000, BASE),
            span(&rows[1].id, &b, 5_000, 1, BASE + 20_000, BASE + 15_000),
        ]
    );
    assert_eq!(total(&db, "annotations", &a).await, Some(15_000));
    assert_eq!(total(&db, "tasks", &t1).await, Some(15_000));
    assert_eq!(total(&db, "annotations", &b).await, Some(5_100));
    assert_eq!(total(&db, "tasks", &t2).await, Some(5_000));
    assert_eq!(
        cached(&writer, &w.owner.user_id).await,
        Some((rows[1].id.clone(), 1, BASE + 20_000))
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn failures_roll_back_all_accounting_and_keep_cache() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let t = task(&db, &w, None).await;
    let a = annotation(&db, &w, &w.owner.user_id, Some(&t), "Private", None).await;
    // Private annotation of another user: not readable by the owner.
    let hidden = annotation(&db, &w, &w.other.user_id, None, "Private", Some(7)).await;
    let near_max = annotation(
        &db,
        &w,
        &w.owner.user_id,
        None,
        "Private",
        Some(i64::MAX - 5),
    )
    .await;
    let mailer = RecordingMailer::default();
    let writer = writer(&mailer);
    let user = auth(&w.owner);
    let access = AccessContext::requester(Some(&user));
    let uid = oid(&w.owner.user_id);

    writer
        .log_user_interaction(&db.pool, access, &uid, &oid(&a), &[BASE])
        .await
        .unwrap();
    let before = spans(&db, &w.owner.user_id).await;
    let cache_before = cached(&writer, &w.owner.user_id).await;

    // Switch to an unreadable annotation: old span close + new insert happen,
    // then the reload under the requester context fails -> 404, rollback.
    let err = writer
        .log_user_interaction(&db.pool, access, &uid, &oid(&hidden), &[BASE + 5_000])
        .await
        .unwrap_err();
    assert_eq!(err.status, StatusCode::NOT_FOUND);
    assert_eq!(err.message, RESOURCE_NOT_FOUND);
    assert_eq!(spans(&db, &w.owner.user_id).await, before);
    assert_eq!(total(&db, "annotations", &a).await, Some(0));
    assert_eq!(total(&db, "tasks", &t).await, Some(0));
    assert_eq!(total(&db, "annotations", &hidden).await, Some(7));
    assert_eq!(cached(&writer, &w.owner.user_id).await, cache_before);

    // The same call in the global context (tracingstore report) succeeds.
    writer
        .log_user_interaction(
            &db.pool,
            AccessContext::global(None),
            &uid,
            &oid(&hidden),
            &[BASE + 5_000],
        )
        .await
        .unwrap();
    assert_eq!(total(&db, "annotations", &a).await, Some(5_000));
    assert_eq!(total(&db, "tasks", &t).await, Some(5_000));
    assert_eq!(total(&db, "annotations", &hidden).await, Some(7));
    let before = spans(&db, &w.owner.user_id).await;
    assert_eq!(before.len(), 2);
    let cache_before = cached(&writer, &w.owner.user_id).await;

    // BIGINT overflow of the annotation total. The span insert has already
    // run; the new span's close is flushed first (newest first) and its
    // annotation increment overflows -> 22003 -> 400, everything rolls back.
    let err = writer
        .log_user_interaction(
            &db.pool,
            access,
            &uid,
            &oid(&near_max),
            &[BASE + 6_000, BASE + 16_000],
        )
        .await
        .unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
    assert_eq!(spans(&db, &w.owner.user_id).await, before);
    assert_eq!(total(&db, "annotations", &hidden).await, Some(7));
    assert_eq!(
        total(&db, "annotations", &near_max).await,
        Some(i64::MAX - 5)
    );
    assert_eq!(cached(&writer, &w.owner.user_id).await, cache_before);

    // Planner failure (FiniteDuration range) -> 500 before any SQL.
    let err = writer
        .log_user_interaction(
            &db.pool,
            access,
            &uid,
            &oid(&a),
            &[BASE + 7_000, BASE + 7_000 + MAX_DURATION_MILLIS + 1],
        )
        .await
        .unwrap_err();
    assert_eq!(err.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(spans(&db, &w.owner.user_id).await, before);
    assert_eq!(cached(&writer, &w.owner.user_id).await, cache_before);
    assert!(mailer.messages().is_empty());
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn over_limit_mail_is_sent_once_when_crossing_expected_time() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let limited = task(&db, &w, Some(15_000)).await;
    let unlimited = task(&db, &w, None).await;
    let a = annotation(&db, &w, &w.owner.user_id, Some(&limited), "Private", None).await;
    let b = annotation(&db, &w, &w.owner.user_id, Some(&unlimited), "Private", None).await;
    let mailer = RecordingMailer::default();
    let writer = writer(&mailer);
    let user = auth(&w.owner);
    let access = AccessContext::requester(Some(&user));
    let uid = oid(&w.owner.user_id);
    let project_name: String = sqlx::query_scalar("SELECT p.name FROM webknossos.projects p JOIN webknossos.tasks t ON t._project=p._id WHERE t._id=$1")
        .bind(&limited).fetch_one(&db.pool).await.unwrap();
    let project_owner_email: String =
        sqlx::query_scalar("SELECT email FROM webknossos.multiUsers WHERE _id=$1")
            .bind(&w.f.multi_user_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();

    for (timestamps, expected_mails) in [
        (vec![BASE, BASE + 10_000], 0),
        (vec![BASE + 20_000], 1), // 10_000 -> 20_000 crosses 15_000
        (vec![BASE + 30_000], 0),
    ] {
        writer
            .log_user_interaction(&db.pool, access, &uid, &oid(&a), &timestamps)
            .await
            .unwrap();
        let mails = mailer.take();
        assert_eq!(mails.len(), expected_mails, "{timestamps:?}");
        if let Some(mail) = mails.first() {
            assert_eq!(mail.recipients, vec![project_owner_email.clone()]);
            assert_eq!(
                mail.subject,
                format!("WEBKNOSSOS | Time limit reached. rtest in {project_name}")
            );
            assert!(mail.body_html.contains("User: Rust Test"));
            assert!(mail.body_html.contains(&format!("Task: {limited}")));
            assert!(
                mail.body_html
                    .contains(&format!("https://wk.example.test/annotations/Task/{a}"))
            );
        }
    }
    assert_eq!(total(&db, "annotations", &a).await, Some(30_000));

    // Missing project expectedTime: accounting succeeds, no mail.
    writer
        .log_user_interaction(
            &db.pool,
            access,
            &uid,
            &oid(&b),
            &[BASE + 300_000, BASE + 340_000],
        )
        .await
        .unwrap();
    assert_eq!(total(&db, "tasks", &unlimited).await, Some(40_000));
    assert!(mailer.messages().is_empty());
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn contributor_gate_skips_non_contributors() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let a = annotation(&db, &w, &w.owner.user_id, None, "Public", None).await;
    let mailer = RecordingMailer::default();
    let writer = writer(&mailer);
    let other = auth(&w.other);
    let access = AccessContext::requester(Some(&other));
    let (other_id, owner_id) = (oid(&w.other.user_id), oid(&w.owner.user_id));

    writer
        .log_user_interaction_if_potential_contributor(
            &db.pool,
            access,
            &other_id,
            &oid(&a),
            &owner_id,
            "OwnerOnly",
            BASE,
        )
        .await
        .unwrap();
    assert!(spans(&db, &w.other.user_id).await.is_empty());
    assert_eq!(total(&db, "annotations", &a).await, None);
    assert_eq!(cached(&writer, &w.other.user_id).await, None);

    writer
        .log_user_interaction_if_potential_contributor(
            &db.pool,
            access,
            &other_id,
            &oid(&a),
            &owner_id,
            "Concurrent",
            BASE,
        )
        .await
        .unwrap();
    assert_eq!(spans(&db, &w.other.user_id).await.len(), 1);
    assert_eq!(total(&db, "annotations", &a).await, Some(0));

    // The owner always qualifies.
    let owner = auth(&w.owner);
    writer
        .log_user_interaction_if_potential_contributor(
            &db.pool,
            AccessContext::requester(Some(&owner)),
            &owner_id,
            &oid(&a),
            &owner_id,
            "OwnerOnly",
            BASE,
        )
        .await
        .unwrap();
    assert_eq!(spans(&db, &w.owner.user_id).await.len(), 1);
    db.cleanup().await;
}
