//! The worker-facing queries: WorkerDAO, the worker's side of JobDAO, job tokens and
//! the credit, dataset and voxelytics writes of the worker status routes.
//!
//! Callers own the connection and transaction; these functions only run SQL and
//! return rows. Mapping a missing row to an error is up to the caller.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::{
    job::{dao::JOB_COLUMNS, routes::Job},
    sql::Sql,
    util::id::ObjectId,
};
use chrono::{DateTime, Utc};

#[derive(sqlx::FromRow)]
pub(crate) struct Worker {
    pub id: ObjectId,
    pub data_store: String,
    pub max_high: i32,
    pub max_low: i32,
    pub commands: Vec<String>,
    pub last_reported_version: Option<String>,
}

impl Worker {
    pub(crate) fn supports(&self, command: &str) -> bool {
        self.commands.iter().any(|supported| supported == command)
    }
}

/// The owner of a job with the organization and account fields the notifications need.
#[derive(sqlx::FromRow)]
pub(crate) struct Owner {
    pub id: ObjectId,
    pub organization: String,
    pub organization_name: String,
    pub is_admin: bool,
    pub is_dataset_manager: bool,
    pub is_superuser: bool,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
}

/// WorkerDAO.findOneByKey. The row is not validated.
pub(crate) async fn find_one_by_key(
    connection: &mut PgConnection,
    key: &str,
    for_update: bool,
) -> sqlx::Result<Option<Worker>> {
    let lock = if for_update { " FOR UPDATE" } else { "" };
    let mut q = Sql::new(
        r#"SELECT _id AS id, _dataStore AS data_store, maxParallelHighPriorityJobs AS max_high,
            maxParallelLowPriorityJobs AS max_low, supportedJobCommands AS commands,
            lastReportedVersion AS last_reported_version
          FROM webknossos.workers_ WHERE key = "#,
    );
    q.push_bind(key).push(lock);
    q.build_query_as().fetch_optional(&mut *connection).await
}

/// WorkerDAO.updateHeartBeat / updateLastReportedVersion (only if it changed).
pub(crate) async fn update_heart_beat(
    connection: &mut PgConnection,
    worker_id: &ObjectId,
    new_version: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE webknossos.workers SET lastHeartBeat = NOW(),
            lastReportedVersion = COALESCE($2, lastReportedVersion) WHERE _id = $1"#,
    )
    .bind(worker_id)
    .bind(new_version)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// JobDAO.reserveNextJob.
pub(crate) async fn reserve_next_job(
    connection: &mut PgConnection,
    worker_id: &ObjectId,
    data_store: &str,
    assignable: &[String],
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE webknossos.jobs SET _worker = $1
          WHERE _worker IS NULL AND _id = (
            SELECT _id FROM webknossos.jobs_
            WHERE state = 'PENDING' AND _dataStore = $2 AND manualState IS NULL
              AND _worker IS NULL AND command = ANY($3)
            ORDER BY created, _id LIMIT 1 FOR UPDATE SKIP LOCKED)"#,
    )
    .bind(worker_id)
    .bind(data_store)
    .bind(assignable)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// JobDAO.countUnfinishedByWorker: the counts for both command sets in one query.
/// An empty set matches nothing (`command = ANY('{}')` is false).
pub(crate) async fn count_unfinished_by_worker(
    connection: &mut PgConnection,
    worker_id: &ObjectId,
    commands_a: &[String],
    commands_b: &[String],
) -> sqlx::Result<(i64, i64)> {
    let commands_any: Vec<&String> = commands_a.iter().chain(commands_b).collect();
    sqlx::query_as(
        r#"SELECT COUNT(*) FILTER (WHERE command = ANY($2)), COUNT(*) FILTER (WHERE command = ANY($3))
          FROM webknossos.jobs_
          WHERE _worker = $1 AND state IN ('PENDING', 'STARTED') AND command = ANY($4)
            AND manualState IS NULL"#,
    )
    .bind(worker_id)
    .bind(commands_a)
    .bind(commands_b)
    .bind(commands_any)
    .fetch_one(&mut *connection)
    .await
}

/// JobDAO.countUnassignedPendingForDataStore: the counts for both command sets in
/// one query. An empty set matches nothing.
pub(crate) async fn count_unassigned_pending_for_data_store(
    connection: &mut PgConnection,
    data_store: &str,
    commands_a: &[String],
    commands_b: &[String],
) -> sqlx::Result<(i64, i64)> {
    let commands_any: Vec<&String> = commands_a.iter().chain(commands_b).collect();
    sqlx::query_as(
        r#"SELECT COUNT(*) FILTER (WHERE command = ANY($2)), COUNT(*) FILTER (WHERE command = ANY($3))
          FROM webknossos.jobs_
          WHERE state = 'PENDING' AND command = ANY($4) AND manualState IS NULL
            AND _dataStore = $1 AND _worker IS NULL"#,
    )
    .bind(data_store)
    .bind(commands_a)
    .bind(commands_b)
    .bind(commands_any)
    .fetch_one(&mut *connection)
    .await
}

/// JobDAO.findAllUnfinishedByWorker. The rows are not validated.
pub(crate) async fn find_all_unfinished_by_worker(
    connection: &mut PgConnection,
    worker_id: &ObjectId,
) -> sqlx::Result<Vec<Job>> {
    find_all_by_worker(
        connection,
        worker_id,
        "j.state IN ('PENDING', 'STARTED') AND j.manualState IS NULL",
    )
    .await
}

/// JobDAO.findAllCancellingByWorker: jobs cancelled by a user (manualState) that the
/// worker has not cancelled yet. The rows are not validated.
pub(crate) async fn find_all_cancelling_by_worker(
    connection: &mut PgConnection,
    worker_id: &ObjectId,
) -> sqlx::Result<Vec<Job>> {
    find_all_by_worker(
        connection,
        worker_id,
        "j.state != 'CANCELLED' AND j.manualState = 'CANCELLED'",
    )
    .await
}

async fn find_all_by_worker(
    connection: &mut PgConnection,
    worker_id: &ObjectId,
    condition: &str,
) -> sqlx::Result<Vec<Job>> {
    let mut q = Sql::new("SELECT ");
    q.push(JOB_COLUMNS)
        .push(" FROM webknossos.jobs_ j WHERE j._worker = ")
        .push_bind(worker_id)
        .push(" AND ")
        .push(condition)
        .push(" ORDER BY j.created, j._id");
    q.build_query_as().fetch_all(&mut *connection).await
}

/// UserDAO.findOne with global access: the user id.
pub(crate) async fn find_user_id(
    pool: &PgPool,
    user_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar("SELECT _id FROM webknossos.users_ WHERE _id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

/// A recent Job token of the user, to be reused instead of minting one per poll.
pub(crate) async fn find_recent_job_token(
    pool: &PgPool,
    user_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        r#"SELECT value FROM webknossos.tokens
          WHERE _user = $1 AND tokenType = 'Job'
            AND created > statement_timestamp() - INTERVAL '1 hour'
            AND expirationDateTime > statement_timestamp() + INTERVAL '1 hour'
          ORDER BY created DESC LIMIT 1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

/// Inserts a Job token expiring after `expiry_ms` with the given idle timeout.
pub(crate) async fn insert_job_token(
    pool: &PgPool,
    id: &ObjectId,
    value: &str,
    user_id: &ObjectId,
    expiry_ms: i64,
    idle_ms: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.tokens
          (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
          VALUES ($1, $2, $3, statement_timestamp(),
            statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
            'Job', statement_timestamp())"#,
    )
    .bind(id)
    .bind(value)
    .bind(user_id)
    .bind(expiry_ms)
    .bind(idle_ms)
    .execute(pool)
    .await?;
    Ok(())
}

/// JobDAO.findOne with global access. The row is not validated.
pub(crate) async fn find_one_global(
    connection: &mut PgConnection,
    job_id: &ObjectId,
    for_update: bool,
) -> sqlx::Result<Option<Job>> {
    let lock = if for_update { " FOR UPDATE" } else { "" };
    let mut q = Sql::new("SELECT ");
    q.push(JOB_COLUMNS)
        .push(" FROM webknossos.jobs_ j WHERE j._id = ")
        .push_bind(job_id)
        .push(lock);
    q.build_query_as().fetch_optional(&mut *connection).await
}

/// JobDAO.updateStatus: absent optional fields are written as NULL.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_status(
    connection: &mut PgConnection,
    job_id: &ObjectId,
    latest_run_id: Option<&str>,
    error_details: Option<Value>,
    state: &str,
    return_value: Option<&str>,
    started: Option<DateTime<Utc>>,
    ended: Option<DateTime<Utc>>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE webknossos.jobs SET latestRunId = $2, latestRunErrorDetails = $3,
            state = $4::webknossos.JOB_STATE, returnValue = $5, started = $6, ended = $7
          WHERE _id = $1"#,
    )
    .bind(job_id)
    .bind(latest_run_id)
    .bind(error_details)
    .bind(state)
    .bind(return_value)
    .bind(started)
    .bind(ended)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// DatasetDAO.findOneByDirectoryNameAndOrganization with global access.
pub(crate) async fn find_dataset_id_by_directory_name_and_organization(
    connection: &mut PgConnection,
    directory_name: &str,
    organization: &str,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.datasets_ WHERE directoryName = $1 AND _organization = $2
          ORDER BY created, _id LIMIT 1"#,
    )
    .bind(directory_name)
    .bind(organization)
    .fetch_optional(&mut *connection)
    .await
}

/// DatasetDAO.updateDatasetStatusByDatasetId(isUsable = false).
pub(crate) async fn update_dataset_status_unusable(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    status: &str,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.datasets SET isUsable = false, status = $2 WHERE _id = $1")
        .bind(dataset_id)
        .bind(status)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// CreditTransactionService.completeTransactionOfJob: the reservation becomes spent.
pub(crate) async fn update_transaction_spent(
    connection: &mut PgConnection,
    transaction_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE webknossos.credit_transactions
          SET transaction_state = 'Complete', credit_state = 'Spent', updated_at = NOW()
          WHERE _id = $1"#,
    )
    .bind(transaction_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// The job owner with the organization and account fields of the status notifications.
pub(crate) async fn find_owner(pool: &PgPool, user_id: &ObjectId) -> sqlx::Result<Option<Owner>> {
    sqlx::query_as(
        r#"SELECT u._id AS id, u._organization AS organization, o.name AS organization_name,
                u.isAdmin AS is_admin, u.isDatasetManager AS is_dataset_manager,
                m.isSuperUser AS is_superuser, m.firstName AS first_name, m.lastName AS last_name,
                m.email
              FROM webknossos.users_ u
              JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
              JOIN webknossos.organizations_ o ON o._id = u._organization
              WHERE u._id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

/// JobDAO.organizationIdForJobId (base tables).
pub(crate) async fn find_organization_id_of_job(
    connection: &mut PgConnection,
    job_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        r#"SELECT u._organization FROM webknossos.users u
          JOIN webknossos.jobs j ON j._owner = u._id WHERE j._id = $1"#,
    )
    .bind(job_id)
    .fetch_optional(&mut *connection)
    .await
}

/// VoxelyticsDAO.upsertWorkflow with a placeholder name. DO NOTHING keeps a concurrently
/// created workflow's real name.
pub(crate) async fn insert_voxelytics_workflow_if_missing(
    connection: &mut PgConnection,
    workflow_hash: &str,
    organization: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.voxelytics_workflows (hash, name, _organization)
          VALUES ($1, 'initializing worker workflow', $2)
          ON CONFLICT (_organization, hash) DO NOTHING"#,
    )
    .bind(workflow_hash)
    .bind(organization)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// JobDAO.updateVoxelyticsWorkflow.
pub(crate) async fn update_voxelytics_workflow_hash(
    connection: &mut PgConnection,
    job_id: &ObjectId,
    workflow_hash: &str,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.jobs SET _voxelytics_workflowHash = $2 WHERE _id = $1")
        .bind(job_id)
        .bind(workflow_hash)
        .execute(&mut *connection)
        .await?;
    Ok(())
}
