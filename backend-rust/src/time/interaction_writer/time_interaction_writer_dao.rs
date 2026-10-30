//! TimeSpanDAO writes for the time interaction executor, with the annotation and task
//! accounting rows they credit and lock.
use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgConnection, PgPool};

use crate::util::id::ObjectId;

#[derive(FromRow)]
pub(super) struct OverLimitRow {
    pub(super) project_name: String,
    pub(super) expected_time: Option<i64>,
    pub(super) owner_first_name: String,
    pub(super) owner_last_name: String,
    pub(super) project_owner_email: String,
}

/// Scala `signalOverTime` lookups: annotation owner + MultiUser, task,
/// project, expectedTime, project owner + MultiUser, all live.
pub(super) async fn find_over_limit_row(
    pool: &PgPool,
    owner_id: &ObjectId,
    task_id: &ObjectId,
) -> Result<Option<OverLimitRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT p.name AS project_name,p.expectedTime AS expected_time,
             m.firstName AS owner_first_name,m.lastName AS owner_last_name,
             pm.email AS project_owner_email
           FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id=u._multiUser
           JOIN webknossos.tasks_ t ON t._id=$2
           JOIN webknossos.projects_ p ON p._id=t._project
           JOIN webknossos.users_ po ON po._id=p._owner
           JOIN webknossos.multiUsers_ pm ON pm._id=po._multiUser
           WHERE u._id=$1"#,
    )
    .bind(owner_id)
    .bind(task_id)
    .fetch_optional(pool)
    .await
}

/// Locks the annotation rows (sorted by id) and returns their tasks.
pub(super) async fn find_task_ids_for_update(
    connection: &mut PgConnection,
    annotations: &[&ObjectId],
) -> sqlx::Result<Vec<Option<ObjectId>>> {
    // Global like Scala's logTime UPDATE (deleted rows included).
    sqlx::query_scalar(
        "SELECT _task FROM webknossos.annotations WHERE _id=ANY($1) ORDER BY _id FOR NO KEY UPDATE",
    )
    .bind(annotations)
    .fetch_all(connection)
    .await
}

/// Locks the task rows (sorted by id).
pub(super) async fn lock_tasks(
    connection: &mut PgConnection,
    tasks: &[ObjectId],
) -> sqlx::Result<()> {
    sqlx::query("SELECT 1 FROM webknossos.tasks WHERE _id=ANY($1) ORDER BY _id FOR NO KEY UPDATE")
        .bind(tasks)
        .execute(connection)
        .await?;
    Ok(())
}

/// TimeSpan.fromInstant: time 0 and numberOfUpdates 0 are passed explicitly (the
/// column default is 1), lastUpdate = created.
#[allow(clippy::too_many_arguments)]
pub(super) async fn insert_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    user_id: &ObjectId,
    annotation_id: &Option<ObjectId>,
    time_millis: i64,
    last_update: DateTime<Utc>,
    number_of_updates: i64,
    created: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.timespans(_id,_user,_annotation,time,lastUpdate,numberOfUpdates,created,isDeleted) VALUES($1,$2,$3,$4,$5,$6,$7,false)",
    )
    .bind(id)
    .bind(user_id)
    .bind(annotation_id)
    .bind(time_millis)
    .bind(last_update)
    .bind(number_of_updates)
    .bind(created)
    .execute(connection)
    .await?;
    Ok(())
}

/// TimeSpanDAO.updateOne: every field except created, no row-count check.
pub(super) async fn update_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    user_id: &ObjectId,
    annotation_id: &Option<ObjectId>,
    time_millis: i64,
    last_update: DateTime<Utc>,
    number_of_updates: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.timespans SET _user=$2,_annotation=$3,time=$4,lastUpdate=$5,numberOfUpdates=$6,isDeleted=false WHERE _id=$1",
    )
    .bind(id)
    .bind(user_id)
    .bind(annotation_id)
    .bind(time_millis)
    .bind(last_update)
    .bind(number_of_updates)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn add_tracing_time_to_annotation(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    delta_millis: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.annotations SET tracingTime=COALESCE(tracingTime,0)+$2 WHERE _id=$1",
    )
    .bind(annotation_id)
    .bind(delta_millis)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn add_tracing_time_to_task(
    connection: &mut PgConnection,
    task_id: &ObjectId,
    delta_millis: i64,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.tasks SET tracingTime=COALESCE(tracingTime,0)+$2 WHERE _id=$1")
        .bind(task_id)
        .bind(delta_millis)
        .execute(connection)
        .await?;
    Ok(())
}
