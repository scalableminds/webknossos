//! JobDAO and the credit transaction queries of the job routes: the jobs, workers,
//! credit_transactions, tokens and datastore lookups behind `/jobs`.
//!
//! Callers own the connection and transaction; these functions only run SQL and
//! return rows. Mapping a missing row to an error is up to the caller.
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::{error::ApiResult, job::routes::Job, sql::Sql, util::id::ObjectId};

/// DataSourceStatus.unreportedStatusList.
const UNREPORTED_DATASET_STATUSES: [&str; 3] = [
    "No longer available on datastore.",
    "Deleted by user.",
    crate::dataset::lifecycle::CONVERSION_FAILED,
];

/// JobDAO.readAccessQ for alias `j`: own jobs, jobs of members of teams the
/// user manages, jobs of the admin's organization, or superuser.
fn push_job_read_access<'a>(q: &mut Sql<'a>, user_id: &'a ObjectId) {
    q.push("(j._owner = ")
        .push_bind(user_id)
        .push(
            r#"
  OR j._owner IN (SELECT _user FROM webknossos.user_team_roles WHERE _team IN
    (SELECT _team FROM webknossos.user_team_roles WHERE _user = "#,
        )
        .push_bind(user_id)
        .push(
            r#" AND isTeamManager))
  OR (SELECT ou._organization FROM webknossos.users_ ou WHERE ou._id = j._owner) IN
    (SELECT _organization FROM webknossos.users_ WHERE _id = "#,
        )
        .push_bind(user_id)
        .push(" AND isAdmin)\n  OR ")
        .push_bind(user_id)
        .push(
            " IN (SELECT su._id FROM webknossos.users_ su JOIN webknossos.multiUsers_ sm ON su._multiUser = sm._id WHERE sm.isSuperUser))",
        );
}

/// JobDAO.listAccessQ for alias `j`: own jobs or jobs of the admin's organization.
fn push_job_list_access<'a>(q: &mut Sql<'a>, user_id: &'a ObjectId) {
    q.push("(j._owner = ")
        .push_bind(user_id)
        .push(
            r#"
  OR (SELECT ou._organization FROM webknossos.users_ ou WHERE ou._id = j._owner) IN
    (SELECT _organization FROM webknossos.users_ WHERE _id = "#,
        )
        .push_bind(user_id)
        .push(" AND isAdmin))");
}

/// CreditTransactionDAO.readAccessQ (unaliased credit_transactions_).
fn push_credit_read_access<'a>(q: &mut Sql<'a>, user_id: &'a ObjectId) {
    q.push(
        "(_organization IN (SELECT _organization FROM webknossos.users_ WHERE (isAdmin OR isDatasetManager) AND _id = ",
    )
    .push_bind(user_id)
    .push(
        ")\n  OR _organization IN (SELECT _organization FROM webknossos.teams_ WHERE _id IN (SELECT _team FROM webknossos.user_team_roles WHERE isTeamManager AND _user = ",
    )
    .push_bind(user_id)
    .push(
        "))\n  OR TRUE IN (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN (SELECT _multiUser FROM webknossos.users_ WHERE _id = ",
    )
    .push_bind(user_id)
    .push(")))");
}

/// Column list for [`Job`] (alias `j`, `_dataStore` trimmed as in JobDAO.parse).
pub(crate) const JOB_COLUMNS: &str = r#"j._id AS id, j._owner AS owner, TRIM(j._dataStore) AS data_store,
  j.command, j.commandArgs AS args, j.state::text AS state, j.manualState::text AS manual_state,
  j._worker AS worker, j._voxelytics_workflowHash AS workflow_hash, j.latestRunId AS latest_run_id,
  j.latestRunErrorDetails AS error_details, j.returnValue AS return_value,
  j.retriedBySuperUser AS retried_by_superuser, j.started, j.ended, j.lastRetry AS last_retry, j.created"#;

/// A row of JobDAO.findAllCompact.
#[derive(sqlx::FromRow)]
pub(crate) struct CompactRow {
    pub id: ObjectId,
    pub command: String,
    pub organization: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub args: Value,
    pub state: String,
    pub return_value: Option<String>,
    pub error_details: Option<Value>,
    pub workflow_hash: Option<String>,
    pub created: DateTime<Utc>,
    pub started: Option<DateTime<Utc>>,
    pub ended: Option<DateTime<Utc>>,
    pub last_retry: Option<DateTime<Utc>>,
    pub milli_credit_delta: Option<i32>,
}

/// A row of WorkerDAO.findAll.
#[derive(sqlx::FromRow)]
pub(crate) struct WorkerRow {
    pub id: ObjectId,
    pub name: String,
    pub max_high: i32,
    pub max_low: i32,
    pub commands: Vec<String>,
    pub created: DateTime<Utc>,
    pub last_heart_beat: DateTime<Utc>,
    pub last_reported_version: Option<String>,
}

/// JobDAO.findOne with the requesting user's read access. The row is not
/// validated; see [`Job::is_valid`].
pub(crate) async fn find_one(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    job_id: &ObjectId,
) -> ApiResult<Option<Job>> {
    let mut q = Sql::new("SELECT ");
    q.push(JOB_COLUMNS)
        .push(" FROM webknossos.jobs_ j WHERE j._id = ")
        .push_bind(job_id)
        .push(" AND ");
    push_job_read_access(&mut q, user_id);
    Ok(q.build_query_as().fetch_optional(&mut *connection).await?)
}

/// UserDAO.findOne (read access: managed team member, own organization as admin, self);
/// the owner's organization and multi user.
pub(crate) async fn find_owner_organization_and_multi_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    owner_id: &ObjectId,
) -> ApiResult<Option<(String, ObjectId)>> {
    Ok(sqlx::query_as(
        r#"SELECT u._organization, u._multiUser FROM webknossos.users_ u
          WHERE u._id = $2 AND (
            u._id IN (SELECT _user FROM webknossos.user_team_roles WHERE _team IN
              (SELECT _team FROM webknossos.user_team_roles WHERE _user = $1 AND isTeamManager))
            OR u._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $1 AND isAdmin)
            OR u._id = $1)"#,
    )
    .bind(user_id)
    .bind(owner_id)
    .fetch_optional(&mut *connection)
    .await?)
}

/// MultiUserDAO.findOne (no access restriction): first name, last name and email.
pub(crate) async fn find_multi_user_name_and_email(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> ApiResult<Option<(String, String, String)>> {
    Ok(sqlx::query_as(
        "SELECT firstName, lastName, email FROM webknossos.multiUsers_ WHERE _id = $1",
    )
    .bind(multi_user_id)
    .fetch_optional(&mut *connection)
    .await?)
}

/// OrganizationDAO.findOne (read access: an organization of the user's account, or superuser).
pub(crate) async fn find_readable_organization_id(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    organization: &str,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.organizations_ WHERE _id = $2 AND (
            _id IN (SELECT _organization FROM webknossos.users_ WHERE _multiUser =
              (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1))
            OR TRUE IN (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN
              (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1)))"#,
    )
    .bind(user_id)
    .bind(organization)
    .fetch_optional(&mut *connection)
    .await?)
}

/// CreditTransactionService.findTransactionOfJob: the milli credit delta of the job's
/// first transaction visible to the user.
pub(crate) async fn find_credit_delta_of_job(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    job_id: &ObjectId,
) -> ApiResult<Option<i32>> {
    let mut q = Sql::new(
        "SELECT milli_credit_delta FROM webknossos.credit_transactions_ WHERE _paid_job = ",
    );
    q.push_bind(job_id).push(" AND ");
    push_credit_read_access(&mut q, user_id);
    q.push(" ORDER BY created_at, _id LIMIT 1");
    Ok(q.build_query_scalar()
        .fetch_optional(&mut *connection)
        .await?)
}

/// JobDAO.findAllCompact. The credit lateral join has no access check (as in Scala);
/// retries can attach several transactions with the same delta, so one suffices.
pub(crate) async fn find_all_compact(
    pool: &PgPool,
    user_id: &ObjectId,
    command: Option<&str>,
    skip_for_deleted_datasets: bool,
) -> ApiResult<Vec<CompactRow>> {
    let mut q = Sql::new(
        r#"SELECT j._id AS id, j.command, u._organization AS organization, mu.firstName AS first_name,
            mu.lastName AS last_name, mu.email, j.commandArgs AS args,
            COALESCE(j.manualState, j.state)::text AS state, j.returnValue AS return_value,
            j.latestRunErrorDetails AS error_details, j._voxelytics_workflowHash AS workflow_hash,
            j.created, j.started, j.ended, j.lastRetry AS last_retry, ct.milli_credit_delta
          FROM webknossos.jobs_ j
          JOIN webknossos.users_ u ON j._owner = u._id
          JOIN webknossos.multiUsers_ mu ON u._multiUser = mu._id
          LEFT JOIN LATERAL (SELECT milli_credit_delta FROM webknossos.credit_transactions_
            WHERE _paid_job = j._id LIMIT 1) ct ON TRUE
          WHERE ("#,
    );
    q.push_bind(command)
        .push("::text IS NULL OR j.command = ")
        .push_bind(command)
        .push(") AND ");
    push_job_list_access(&mut q, user_id);
    q.push(" AND (NOT ")
        .push_bind(skip_for_deleted_datasets)
        .push(
            " OR (j.commandArgs->>'dataset_id')::text IN
              (SELECT _id FROM webknossos.datasets WHERE status NOT IN (",
        );
    let mut statuses = q.separated(", ");
    for status in UNREPORTED_DATASET_STATUSES {
        statuses.push_bind(status);
    }
    q.push("))) ORDER BY j.created DESC, j._id DESC");
    Ok(q.build_query_as().fetch_all(pool).await?)
}

/// Job counts by state of the jobs without a manual state.
pub(crate) async fn count_by_state(pool: &PgPool) -> ApiResult<Vec<(String, i64)>> {
    Ok(sqlx::query_as(
        r#"SELECT state::text, COUNT(_id) FROM webknossos.jobs_
          WHERE manualState IS NULL GROUP BY state ORDER BY state"#,
    )
    .fetch_all(pool)
    .await?)
}

/// WorkerDAO.findAll (global access).
pub(crate) async fn find_all_workers(pool: &PgPool) -> ApiResult<Vec<WorkerRow>> {
    Ok(sqlx::query_as(
        r#"SELECT _id AS id, name, maxParallelHighPriorityJobs AS max_high,
            maxParallelLowPriorityJobs AS max_low, supportedJobCommands AS commands, created,
            lastHeartBeat AS last_heart_beat, lastReportedVersion AS last_reported_version
          FROM webknossos.workers_ ORDER BY created, _id"#,
    )
    .fetch_all(pool)
    .await?)
}

/// JobDAO.updateManualState: update access equals read access, checked by the caller.
/// Finished jobs stay as they are; cancelling them would hide their result and make the
/// worker see them as to-cancel on every poll.
pub(crate) async fn update_manual_state_cancelled(
    connection: &mut PgConnection,
    job_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE webknossos.jobs SET manualState = 'CANCELLED'
         WHERE _id = $1 AND state NOT IN ('SUCCESS', 'FAILURE')",
    )
    .bind(job_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// JobDAO.retryOne: only failed or cancelled jobs are reset (otherwise a no-op). The retry
/// limit is re-checked here so that concurrent retries cannot both pass it. Returns the
/// number of reset jobs.
pub(crate) async fn retry_one(
    connection: &mut PgConnection,
    job_id: &ObjectId,
    is_superuser: bool,
) -> ApiResult<u64> {
    Ok(sqlx::query(
        r#"UPDATE webknossos.jobs
          SET state = 'PENDING', manualState = NULL, retriedBySuperUser = $2, lastRetry = NOW()
          WHERE _id = $1 AND ($2 OR lastRetry IS NULL)
            AND (state IN ('FAILURE', 'CANCELLED') OR manualState = 'CANCELLED')"#,
    )
    .bind(job_id)
    .bind(is_superuser)
    .execute(&mut *connection)
    .await?
    .rows_affected())
}

/// The job's oldest pending credit transaction (row lock), if any.
pub(crate) async fn find_pending_transaction_of_job(
    connection: &mut PgConnection,
    job_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.credit_transactions_
          WHERE _paid_job = $1 AND transaction_state = 'Pending'
          ORDER BY created_at, _id LIMIT 1 FOR UPDATE"#,
    )
    .bind(job_id)
    .fetch_optional(&mut *connection)
    .await?)
}

/// CreditTransactionDAO.refundTransaction, insert part: the refund amount is NULL (and the
/// insert fails) unless the reservation is still pending with a non-positive delta.
/// Returns the number of inserted rows.
pub(crate) async fn insert_refund_transaction(
    connection: &mut PgConnection,
    id: &ObjectId,
    transaction_id: &ObjectId,
    comment: &str,
) -> sqlx::Result<u64> {
    Ok(sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id, _organization, _related_transaction, milli_credit_delta, comment, transaction_state, credit_state)
          SELECT $1, _organization, _id,
            (SELECT milli_credit_delta * -1 FROM webknossos.credit_transactions
              WHERE _id = $2 AND transaction_state = 'Pending' AND credit_state = 'Pending'
                AND milli_credit_delta <= 0),
            $3, 'Complete', 'Refunding'
          FROM webknossos.credit_transactions WHERE _id = $2"#,
    )
    .bind(id)
    .bind(transaction_id)
    .bind(comment)
    .execute(&mut *connection)
    .await?
    .rows_affected())
}

/// CreditTransactionDAO.refundTransaction, update part. Returns the number of updated rows.
pub(crate) async fn update_transaction_refunded(
    connection: &mut PgConnection,
    transaction_id: &ObjectId,
) -> sqlx::Result<u64> {
    Ok(sqlx::query(
        r#"UPDATE webknossos.credit_transactions
          SET transaction_state = 'Complete', credit_state = 'Refunded', updated_at = NOW()
          WHERE _id = $1 AND transaction_state = 'Pending' AND milli_credit_delta <= 0"#,
    )
    .bind(transaction_id)
    .execute(&mut *connection)
    .await?
    .rows_affected())
}

/// The job's first credit transaction visible to the user: organization, milli credit
/// delta and comment.
pub(crate) async fn find_credit_transaction_of_job(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    job_id: &ObjectId,
) -> ApiResult<Option<(String, i32, String)>> {
    let mut q = Sql::new(
        "SELECT _organization, milli_credit_delta, comment FROM webknossos.credit_transactions_ WHERE _paid_job = ",
    );
    q.push_bind(job_id).push(" AND ");
    push_credit_read_access(&mut q, user_id);
    q.push(" ORDER BY created_at, _id LIMIT 1");
    Ok(q.build_query_as().fetch_optional(&mut *connection).await?)
}

/// CreditTransactionDAO.insertNewPendingTransaction for a retried job: a pending reservation of `delta`.
pub(crate) async fn insert_pending_credit_transaction(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization: &str,
    delta: i32,
    comment: &str,
    job_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id, _organization, milli_credit_delta, comment, _paid_job,
           transaction_state, credit_state, expiration_date, created_at, updated_at, is_deleted)
          VALUES ($1, $2, $3, $4, $5, 'Pending', 'Pending', NULL, NOW(), NOW(), FALSE)"#,
    )
    .bind(id)
    .bind(organization)
    .bind(delta)
    .bind(comment)
    .bind(job_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// CreditTransactionDAO.getMilliCreditBalance with the user's read access
/// (users without credit access see a balance of 0).
pub(crate) async fn get_milli_credit_balance(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    organization: &str,
) -> ApiResult<i64> {
    let mut q = Sql::new(
        "SELECT COALESCE(SUM(milli_credit_delta), 0)::bigint FROM webknossos.credit_transactions_ WHERE _organization = ",
    );
    q.push_bind(organization).push(" AND ");
    push_credit_read_access(&mut q, user_id);
    Ok(q.build_query_scalar().fetch_one(&mut *connection).await?)
}

/// DataStoreDAO.findOneByName (read access: unrestricted or the user's organization);
/// the public URL.
pub(crate) async fn find_data_store_public_url(
    connection: &mut PgConnection,
    name: &str,
    user_id: &ObjectId,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        r#"SELECT publicUrl FROM webknossos.dataStores_ WHERE name = $1 AND
          (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization IN
            (SELECT _organization FROM webknossos.users_ WHERE _id = $2))"#,
    )
    .bind(name)
    .bind(user_id)
    .fetch_optional(&mut *connection)
    .await?)
}

/// DataStoreDAO.findOneByName with global access: the internal URL.
pub(crate) async fn find_data_store_url(
    executor: impl sqlx::PgExecutor<'_>,
    name: &str,
) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ WHERE name = $1")
            .bind(name)
            .fetch_optional(executor)
            .await?,
    )
}

/// Serializes concurrent token creation for the same user (row lock).
pub(crate) async fn lock_user(connection: &mut PgConnection, user_id: &ObjectId) -> ApiResult<()> {
    sqlx::query("SELECT _id FROM webknossos.users WHERE _id = $1 FOR UPDATE")
        .bind(user_id)
        .fetch_one(&mut *connection)
        .await?;
    Ok(())
}

/// The user's oldest usable Authentication token value, with the same filter as
/// GET /auth/token (`crate::auth::routes::get_token`).
pub(crate) async fn find_usable_authentication_token(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        r#"SELECT token.value FROM webknossos.tokens AS token
          JOIN webknossos.users AS usr ON usr._id = token._user
          WHERE token._user = $1 AND token.tokenType = 'Authentication' AND NOT token.isDeleted
            AND token.expirationDateTime > statement_timestamp()
            AND (token.idleTimeout IS NULL OR (token.idleTimeout > 0 AND
              EXTRACT(EPOCH FROM (statement_timestamp() - token.lastUsedDateTime)) * 1000 < token.idleTimeout))
            AND (usr.loggedOutEverywhereTime IS NULL OR token.created > usr.loggedOutEverywhereTime)
            AND (SELECT COUNT(*) FROM webknossos.tokens AS matching WHERE matching.value = token.value AND NOT matching.isDeleted) = 1
          ORDER BY token.created, token._id LIMIT 1"#,
    )
    .bind(user_id)
    .fetch_optional(&mut *connection)
    .await?)
}

/// Retires all Authentication tokens of the user.
pub(crate) async fn delete_authentication_tokens(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE _user = $1 AND tokenType = 'Authentication' AND NOT isDeleted",
    )
    .bind(user_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// Inserts an Authentication token expiring after `expiry_ms` with the given idle timeout.
pub(crate) async fn insert_authentication_token(
    connection: &mut PgConnection,
    id: &ObjectId,
    value: &str,
    user_id: &ObjectId,
    expiry_ms: i64,
    idle_ms: i64,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.tokens
          (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
          VALUES ($1, $2, $3, statement_timestamp(),
            statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
            'Authentication', statement_timestamp())"#,
    )
    .bind(id)
    .bind(value)
    .bind(user_id)
    .bind(expiry_ms)
    .bind(idle_ms)
    .execute(&mut *connection)
    .await?;
    Ok(())
}
