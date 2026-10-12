//! VoxelyticsDAO: the voxelytics_* queries of the Scala backend.
//!
//! Every query binds its values. `$1` is always the stale timeout in
//! milliseconds where a query derives run/task/chunk states (runsWithStateQ),
//! state literals are SQL constants, and multi-row upserts pass one JSONB
//! array expanded with `jsonb_to_recordset` (the VALUES lists of Scala).
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool, Row};

use crate::{auth::AuthUser, error::ApiResult, id::ObjectId};

pub(crate) type Timestamp = Option<DateTime<Utc>>;

/// runsWithStateQ: a RUNNING run whose heartbeat is older than the stale
/// timeout ($1, milliseconds) is reported as STALE, ending at its heartbeat.
fn runs_with_state() -> &'static str {
    r#"SELECT
          r._id,
          CASE
            WHEN r.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - ($1::BIGINT * INTERVAL '1 millisecond')
            THEN 'STALE' ELSE r.state END AS state,
          r.beginTime AS beginTime,
          CASE
            WHEN r.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - ($1::BIGINT * INTERVAL '1 millisecond')
            THEN run_heartbeat.timestamp ELSE r.endTime END AS endTime
        FROM webknossos.voxelytics_runs r
        LEFT JOIN (
          SELECT _run, timestamp
          FROM webknossos.voxelytics_runHeartbeatEvents
        ) run_heartbeat ON r._id = run_heartbeat._run"#
}

fn tasks_with_state() -> String {
    format!(
        r#"SELECT
          t._id,
          CASE WHEN t.state = 'RUNNING' AND r.state = 'STALE' THEN 'STALE' ELSE t.state END AS state,
          t.beginTime AS beginTime,
          CASE WHEN t.state = 'RUNNING' AND r.state = 'STALE' THEN r.endTime ELSE t.endTime END AS endTime
        FROM webknossos.voxelytics_tasks t
        JOIN ({}) r ON r._id = t._run"#,
        runs_with_state()
    )
}

fn chunks_with_state() -> String {
    format!(
        r#"SELECT
          c._id,
          CASE WHEN c.state = 'RUNNING' AND r.state = 'STALE' THEN 'STALE' ELSE c.state END AS state,
          c.beginTime AS beginTime,
          CASE WHEN c.state = 'RUNNING' AND r.state = 'STALE' THEN r.endTime ELSE c.endTime END AS endTime
        FROM webknossos.voxelytics_chunks c
        JOIN webknossos.voxelytics_tasks t ON t._id = c._task
        JOIN ({}) r ON r._id = t._run"#,
        runs_with_state()
    )
}

/// visibleRunsQ: runs of the user's organization; unless `access` (a boolean
/// placeholder: admin, dataset manager or allowUnlisted) only the user's own.
fn visible_runs(access: &str, user: &str, organization: &str) -> String {
    format!(
        r#"SELECT __r.*
        FROM webknossos.voxelytics_runs __r
        WHERE ({access} OR __r._user = {user}) AND __r._organization = {organization}"#
    )
}

/// latestChunkStatesQ for the runs in `run_ids` (a TEXT[] placeholder), with
/// an optional task-name placeholder.
fn latest_chunk_states(run_ids: &str, task_name: Option<&str>) -> String {
    let chunks = chunks_with_state();
    let task_filter = task_name
        .map(|t| format!("AND tc.name = {t}"))
        .unwrap_or_default();
    format!(
        r#"SELECT
          tc.name taskName,
          tc.executionId executionId,
          tc.chunkName chunkName,
          COALESCE(running_chunks._chunk, any_chunks._chunk) _chunk,
          COALESCE(running_chunks.state, any_chunks.state) state,
          COALESCE(running_chunks.beginTime, any_chunks.beginTime) beginTime,
          COALESCE(running_chunks.endTime, any_chunks.endTime) endTime
        FROM (
          SELECT DISTINCT t.name, c.executionId, c.chunkName
          FROM webknossos.voxelytics_chunks c
          JOIN webknossos.voxelytics_tasks t ON t._id = c._task
          WHERE t._run = ANY({run_ids})
        ) tc
        JOIN ( -- Latest chunk states (including skipped or pending)
          SELECT
            DISTINCT ON (t.name, c.executionId, c.chunkName)
            t.name,
            c.executionId,
            c.chunkName,
            c._id _chunk,
            cs.state state,
            cs.beginTime beginTime,
            cs.endTime endTime
          FROM ({chunks}) cs
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._id
          JOIN webknossos.voxelytics_tasks t ON t._id = c._task
          WHERE t._run = ANY({run_ids})
          ORDER BY t.name, c.executionId, c.chunkName, cs.beginTime DESC NULLS LAST
        ) any_chunks ON any_chunks.name = tc.name AND any_chunks.executionId = tc.executionId AND any_chunks.chunkName = tc.chunkName
        LEFT JOIN ( -- Latest chunk states (excluding skipped or pending)
          SELECT
            DISTINCT ON (t.name, c.executionId, c.chunkName)
            t.name,
            c.executionId,
            c.chunkName,
            c._id _chunk,
            cs.state state,
            cs.beginTime beginTime,
            cs.endTime endTime
          FROM ({chunks}) cs
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._id
          JOIN webknossos.voxelytics_tasks t ON t._id = c._task
          WHERE cs.state NOT IN ('SKIPPED', 'PENDING')
            AND t._run = ANY({run_ids})
          ORDER BY t.name, c.executionId, c.chunkName, cs.beginTime DESC NULLS LAST
        ) running_chunks ON running_chunks.name = tc.name AND running_chunks.executionId = tc.executionId AND running_chunks.chunkName = tc.chunkName
        WHERE TRUE {task_filter}"#
    )
}

/// latestCompleteOrSkippedTaskQ.
fn latest_complete_or_skipped_task(run_ids: &str, task_name: Option<&str>) -> String {
    let task_filter = task_name
        .map(|t| format!("AND t.name = {t}"))
        .unwrap_or_default();
    format!(
        r#"SELECT
          DISTINCT ON (t.name)
          t.name,
          t._id,
          ts.state
        FROM ({}) ts
        JOIN webknossos.voxelytics_tasks t ON t._id = ts._id
        WHERE
          ts.state IN ('COMPLETE', 'SKIPPED')
          AND t._run = ANY({run_ids})
          {task_filter}
        ORDER BY t.name, ts.beginTime DESC NULLS LAST"#,
        tasks_with_state()
    )
}

fn stale_millis(stale_timeout: std::time::Duration) -> i64 {
    i64::try_from(stale_timeout.as_millis()).unwrap_or(i64::MAX)
}

/// visibleRunsQ's unrestricted case (admins and dataset managers).
fn sees_all_runs(user: &AuthUser) -> bool {
    user.is_admin || user.is_dataset_manager
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ChunkCounts {
    pub total: i64,
    pub failed: i64,
    pub skipped: i64,
    pub complete: i64,
    pub cancelled: i64,
}

impl ChunkCounts {
    pub fn to_json(&self) -> Value {
        json!({
            "total": self.total,
            "failed": self.failed,
            "skipped": self.skipped,
            "complete": self.complete,
            "cancelled": self.cancelled,
        })
    }

    fn from_row(row: &sqlx::postgres::PgRow, offset: usize) -> sqlx::Result<Self> {
        Ok(Self {
            total: row.try_get(offset)?,
            failed: row.try_get(offset + 1)?,
            skipped: row.try_get(offset + 2)?,
            complete: row.try_get(offset + 3)?,
            cancelled: row.try_get(offset + 4)?,
        })
    }
}

#[derive(Clone, Debug)]
pub(crate) struct TaskCounts {
    pub chunk_like: ChunkCounts,
    pub file_size: i64,
    pub inode_count: i64,
}

impl TaskCounts {
    pub fn to_json(&self) -> Value {
        let mut value = self.chunk_like.to_json();
        value["fileSize"] = json!(self.file_size);
        value["inodeCount"] = json!(self.inode_count);
        value
    }
}

#[derive(Clone, Debug)]
pub(crate) struct RunEntry {
    pub id: String,
    pub name: String,
    pub host_user_name: String,
    pub host_name: String,
    pub voxelytics_version: String,
    pub workflow_hash: String,
    pub workflow_yaml_content: Option<String>,
    pub workflow_config: Value,
    pub state: String,
    pub begin_time: Timestamp,
    pub end_time: Timestamp,
}

#[derive(Clone, Debug)]
pub(crate) struct WorkflowListingRunEntry {
    pub id: String,
    pub name: String,
    pub host_user_name: String,
    pub host_name: String,
    pub voxelytics_version: String,
    pub workflow_hash: String,
    pub state: String,
    pub begin_time: Timestamp,
    pub end_time: Timestamp,
    pub task_counts: TaskCounts,
    pub user_first_name: Option<String>,
    pub user_last_name: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct TaskRunEntry {
    pub run_id: String,
    pub task_name: String,
    pub state: String,
    pub begin_time: Timestamp,
    pub end_time: Timestamp,
    pub current_execution_id: Option<String>,
    pub chunk_counts: ChunkCounts,
}

#[derive(Clone, Debug)]
pub(crate) struct CombinedTaskRunEntry {
    pub task_name: String,
    pub current_execution_id: Option<String>,
    pub chunk_counts: ChunkCounts,
}

#[derive(Clone, Debug)]
pub(crate) struct ArtifactEntry {
    pub artifact_id: String,
    pub task_id: String,
    pub name: String,
    pub path: String,
    pub file_size: i64,
    pub inode_count: i64,
    pub version: String,
    pub metadata: Value,
    pub task_name: String,
    pub foreign_workflow: Option<(String, String)>,
}

#[derive(Clone, Debug)]
pub(crate) struct TaskEntry {
    pub name: String,
    pub task: String,
    pub config: Value,
}

#[derive(Clone, Debug)]
pub(crate) struct WorkflowEntry {
    pub name: String,
    pub hash: String,
}

#[derive(Clone, Debug)]
pub(crate) struct StatisticsEntry {
    pub max: f64,
    pub median: f64,
    pub stddev: f64,
    pub sum: Option<f64>,
}

#[derive(Clone, Debug)]
pub(crate) struct ChunkStatisticsEntry {
    pub execution_id: String,
    pub chunk_counts: ChunkCounts,
    pub begin_time: Timestamp,
    pub end_time: Timestamp,
    pub wall_time: f64,
    pub memory: StatisticsEntry,
    pub cpu_user: StatisticsEntry,
    pub cpu_system: StatisticsEntry,
    pub duration: StatisticsEntry,
}

#[derive(Clone, Debug)]
pub(crate) struct ArtifactChecksumEntry {
    pub task_name: String,
    pub artifact_name: String,
    pub path: String,
    pub resolved_path: String,
    pub timestamp: DateTime<Utc>,
    pub checksum_method: String,
    pub checksum: String,
    pub file_size: i64,
    pub last_modified: DateTime<Utc>,
}

/// Slick reads SQL NULL doubles as 0.0.
fn double(row: &sqlx::postgres::PgRow, index: usize) -> sqlx::Result<f64> {
    Ok(row.try_get::<Option<f64>, _>(index)?.unwrap_or(0.0))
}

pub(crate) async fn find_runs(
    pool: &PgPool,
    user: &AuthUser,
    run_ids: Option<&[String]>,
    workflow_hash: Option<&str>,
    stale_timeout: std::time::Duration,
    allow_unlisted: bool,
) -> ApiResult<Vec<RunEntry>> {
    let sql = format!(
        r#"SELECT
          r._id,
          r.name,
          r.username,
          r.hostname,
          r.voxelyticsVersion,
          r.workflow_hash,
          r.workflow_yamlContent,
          r.workflow_config,
          rs.state::TEXT AS state,
          rs.beginTime AS beginTime,
          rs.endTime AS endTime
        FROM ({}) r
        JOIN ({}) rs ON rs._id = r._id
        WHERE ($5::TEXT[] IS NULL OR r._id = ANY($5))
          AND ($6::TEXT IS NULL OR r.workflow_hash = $6)"#,
        visible_runs("$2", "$3", "$4"),
        runs_with_state()
    );
    let rows = sqlx::query(&sql)
        .bind(stale_millis(stale_timeout))
        .bind(sees_all_runs(user) || allow_unlisted)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(run_ids)
        .bind(workflow_hash)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok(RunEntry {
                id: row.try_get(0)?,
                name: row.try_get(1)?,
                host_user_name: row.try_get(2)?,
                host_name: row.try_get(3)?,
                voxelytics_version: row.try_get(4)?,
                workflow_hash: row.try_get(5)?,
                workflow_yaml_content: row.try_get(6)?,
                workflow_config: row
                    .try_get::<Option<Value>, _>(7)?
                    .unwrap_or_else(|| json!({})),
                state: row.try_get(8)?,
                begin_time: row.try_get(9)?,
                end_time: row.try_get(10)?,
            })
        })
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

pub(crate) async fn find_runs_for_workflow_listing(
    pool: &PgPool,
    user: &AuthUser,
    stale_timeout: std::time::Duration,
) -> ApiResult<Vec<WorkflowListingRunEntry>> {
    let sql = format!(
        r#"SELECT
          r._id,
          r.name,
          r.username,
          r.hostname,
          r.voxelyticsVersion,
          r.workflow_hash,
          rs.state::TEXT AS state,
          rs.beginTime AS beginTime,
          rs.endTime AS endTime,
          COALESCE(tasks.total, 0)::BIGINT AS tasksTotal,
          COALESCE(tasks.failed, 0)::BIGINT AS tasksFailed,
          COALESCE(tasks.skipped, 0)::BIGINT AS tasksSkipped,
          COALESCE(tasks.complete, 0)::BIGINT AS tasksComplete,
          COALESCE(tasks.cancelled, 0)::BIGINT AS tasksCancelled,
          COALESCE(tasks.fileSize, 0)::BIGINT AS fileSize,
          COALESCE(tasks.inodeCount, 0)::BIGINT AS inodeCount,
          mu.firstName,
          mu.lastName
        FROM ({visible}) r
        JOIN ({runs}) rs ON rs._id = r._id
        LEFT JOIN (
          SELECT
            t._run AS _run,
            COUNT(t._id) AS total,
            SUM(CASE WHEN ts.state IN ('FAILED', 'STALE') THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN ts.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN ts.state = 'COMPLETE' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN ts.state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
            SUM(COALESCE(ta.fileSize, 0)) AS fileSize,
            SUM(COALESCE(ta.inodeCount, 0)) AS inodeCount
          FROM webknossos.voxelytics_tasks AS t
          JOIN ({tasks}) ts ON ts._id = t._id
          LEFT JOIN (
            SELECT a._task _task, SUM(a.fileSize) fileSize, SUM(a.inodeCount) inodeCount
            FROM webknossos.voxelytics_artifacts a
            GROUP BY a._task
          ) ta ON ta._task = t._id
          GROUP BY t._run
        ) tasks ON tasks._run = r._id
        LEFT JOIN webknossos.users_ u ON r._user = u._id
        LEFT JOIN webknossos.multiUsers_ mu ON u._multiUser = mu._id
        WHERE r._organization = $4"#,
        visible = visible_runs("$2", "$3", "$4"),
        runs = runs_with_state(),
        tasks = tasks_with_state(),
    );
    let rows = sqlx::query(&sql)
        .bind(stale_millis(stale_timeout))
        .bind(sees_all_runs(user))
        .bind(&user.id)
        .bind(&user.organization_id)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok(WorkflowListingRunEntry {
                id: row.try_get(0)?,
                name: row.try_get(1)?,
                host_user_name: row.try_get(2)?,
                host_name: row.try_get(3)?,
                voxelytics_version: row.try_get(4)?,
                workflow_hash: row.try_get(5)?,
                state: row.try_get(6)?,
                begin_time: row.try_get(7)?,
                end_time: row.try_get(8)?,
                task_counts: TaskCounts {
                    chunk_like: ChunkCounts::from_row(row, 9)?,
                    file_size: row.try_get(14)?,
                    inode_count: row.try_get(15)?,
                },
                user_first_name: row.try_get(16)?,
                user_last_name: row.try_get(17)?,
            })
        })
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

/// findWorkflowTaskCounts: per workflow, the latest state of each task name
/// over the user's listed runs (preferring non-skipped/pending states).
pub(crate) async fn find_workflow_task_counts(
    pool: &PgPool,
    user: &AuthUser,
    workflow_hashes: &[String],
    stale_timeout: std::time::Duration,
) -> ApiResult<Vec<(String, TaskCounts)>> {
    let visible = visible_runs("$2", "$3", "$4");
    let sql = format!(
        r#"WITH task_states AS ({tasks})
        SELECT
          w.hash,
          COUNT(any_tasks.state)::BIGINT AS total,
          SUM(CASE WHEN COALESCE(running_tasks.state, any_tasks.state) IN ('FAILED', 'STALE') THEN 1 ELSE 0 END)::BIGINT AS failed,
          SUM(CASE WHEN COALESCE(running_tasks.state, any_tasks.state) = 'SKIPPED' THEN 1 ELSE 0 END)::BIGINT AS skipped,
          SUM(CASE WHEN COALESCE(running_tasks.state, any_tasks.state) = 'COMPLETE' THEN 1 ELSE 0 END)::BIGINT AS complete,
          SUM(CASE WHEN COALESCE(running_tasks.state, any_tasks.state) = 'CANCELLED' THEN 1 ELSE 0 END)::BIGINT AS cancelled,
          SUM(COALESCE(running_tasks.fileSize, 0))::BIGINT AS fileSize,
          SUM(COALESCE(running_tasks.inodeCount, 0))::BIGINT AS inodeCount
        FROM webknossos.voxelytics_workflows w
        JOIN ( -- Aggregating the task states of workflow runs (including skipped and pending)
          SELECT DISTINCT ON (workflow_hash, taskName) r.workflow_hash workflow_hash, t.name taskName, ts.state state
          FROM webknossos.voxelytics_tasks t
          JOIN ({visible}) r ON t._run = r._id
          JOIN task_states ts ON ts._id = t._id
          ORDER BY workflow_hash, taskName, ts.beginTime DESC NULLS LAST
        ) any_tasks ON any_tasks.workflow_hash = w.hash
        LEFT JOIN ( -- Aggregating the task states of workflow runs (excluding skipped and pending)
          SELECT
            DISTINCT ON (workflow_hash, taskName)
            r.workflow_hash workflow_hash,
            t.name taskName,
            ts.state state,
            COALESCE(ta.fileSize, 0) fileSize,
            COALESCE(ta.inodeCount, 0) inodeCount
          FROM webknossos.voxelytics_tasks t
          JOIN ({visible}) r ON t._run = r._id
          JOIN task_states ts ON ts._id = t._id
          LEFT JOIN (
            SELECT a._task _task, SUM(a.fileSize) fileSize, SUM(a.inodeCount) inodeCount
            FROM webknossos.voxelytics_artifacts a
            GROUP BY a._task
          ) ta ON ta._task = t._id
          WHERE ts.state NOT IN ('SKIPPED', 'PENDING')
          ORDER BY workflow_hash, taskName, ts.beginTime DESC NULLS LAST
        ) running_tasks ON running_tasks.workflow_hash = w.hash AND running_tasks.taskName = any_tasks.taskName
        WHERE w.hash = ANY($5) AND w._organization = $4
        GROUP BY w.hash"#,
        tasks = tasks_with_state(),
    );
    let rows = sqlx::query(&sql)
        .bind(stale_millis(stale_timeout))
        .bind(sees_all_runs(user))
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(workflow_hashes)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok((
                row.try_get(0)?,
                TaskCounts {
                    chunk_like: ChunkCounts::from_row(row, 1)?,
                    file_size: row.try_get(6)?,
                    inode_count: row.try_get(7)?,
                },
            ))
        })
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

pub(crate) async fn find_workflows_by_hash_and_organization(
    pool: &PgPool,
    organization_id: &str,
    workflow_hashes: &[String],
) -> ApiResult<Vec<WorkflowEntry>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT name, hash FROM webknossos.voxelytics_workflows WHERE hash = ANY($1) AND _organization = $2",
    )
    .bind(workflow_hashes)
    .bind(organization_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(name, hash)| WorkflowEntry { name, hash })
        .collect())
}

pub(crate) async fn find_workflow_by_hash_and_organization(
    pool: &PgPool,
    organization_id: &str,
    workflow_hash: &str,
) -> ApiResult<Option<WorkflowEntry>> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT name, hash FROM webknossos.voxelytics_workflows WHERE hash = $1 AND _organization = $2",
    )
    .bind(workflow_hash)
    .bind(organization_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(name, hash)| WorkflowEntry { name, hash }))
}

/// findWorkflowByHash: in ANY organization (DELETE only checks existence).
pub(crate) async fn workflow_hash_exists(pool: &PgPool, workflow_hash: &str) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.voxelytics_workflows WHERE hash = $1)",
    )
    .bind(workflow_hash)
    .fetch_one(pool)
    .await?)
}

pub(crate) async fn find_task_runs(
    pool: &PgPool,
    run_ids: &[String],
    stale_timeout: std::time::Duration,
) -> ApiResult<Vec<TaskRunEntry>> {
    let sql = format!(
        r#"WITH task_states AS (
          {tasks}
          WHERE t._run = ANY($2) -- Filter here, because CTEs are materialized
        ),
        chunk_states AS (
          {chunks}
          WHERE t._run = ANY($2) -- Filter here, because CTEs are materialized
        )
        SELECT
          r._id AS runId,
          r.name AS runName,
          t._id AS taskId,
          t.name AS taskName,
          ts.state::TEXT AS state,
          ts.beginTime AS beginTime,
          ts.endTime AS endTime,
          exec.executionId AS currentExecutionId,
          COALESCE(chunks.total, 0)::BIGINT AS chunksTotal,
          COALESCE(chunks.failed, 0)::BIGINT AS chunksFailed,
          COALESCE(chunks.skipped, 0)::BIGINT AS chunksSkipped,
          COALESCE(chunks.complete, 0)::BIGINT AS chunksComplete,
          COALESCE(chunks.cancelled, 0)::BIGINT AS chunksCancelled
        FROM webknossos.voxelytics_runs r
        JOIN webknossos.voxelytics_tasks t ON t._run = r._id
        JOIN task_states ts ON ts._id = t._id
        LEFT JOIN (
          SELECT DISTINCT ON (c._task) c._task, c.executionId
          FROM chunk_states cs
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._id
          WHERE cs.state = 'RUNNING'
          ORDER BY c._task, cs.beginTime DESC NULLS LAST
        ) exec ON exec._task = t._id
        LEFT JOIN (
          SELECT
            c._task AS _task,
            COUNT(c._id) AS total,
            SUM(CASE WHEN cs.state = 'FAILED' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN cs.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN cs.state = 'COMPLETE' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN cs.state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
          FROM chunk_states cs
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._id
          GROUP BY c._task
        ) chunks ON chunks._task = t._id
        WHERE
          r._id = ANY($2)"#,
        tasks = tasks_with_state(),
        chunks = chunks_with_state(),
    );
    let rows = sqlx::query(&sql)
        .bind(stale_millis(stale_timeout))
        .bind(run_ids)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok(TaskRunEntry {
                run_id: row.try_get(0)?,
                task_name: row.try_get(3)?,
                state: row.try_get(4)?,
                begin_time: row.try_get(5)?,
                end_time: row.try_get(6)?,
                current_execution_id: row.try_get(7)?,
                chunk_counts: ChunkCounts::from_row(row, 8)?,
            })
        })
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

pub(crate) async fn find_combined_task_runs(
    pool: &PgPool,
    run_ids: &[String],
    stale_timeout: std::time::Duration,
) -> ApiResult<Vec<CombinedTaskRunEntry>> {
    let sql = format!(
        r#"WITH latest_chunk_states AS ({latest})
        SELECT
          l.taskName AS taskName,
          exec.executionId AS currentExecutionId,
          COALESCE(chunks.total, 0)::BIGINT AS chunksTotal,
          COALESCE(chunks.failed, 0)::BIGINT AS chunksFailed,
          COALESCE(chunks.skipped, 0)::BIGINT AS chunksSkipped,
          COALESCE(chunks.complete, 0)::BIGINT AS chunksComplete,
          COALESCE(chunks.cancelled, 0)::BIGINT AS chunksCancelled
        FROM (SELECT DISTINCT taskName FROM latest_chunk_states) l
        LEFT JOIN (
          SELECT DISTINCT ON (l.taskName) l.taskName, l.executionId
          FROM latest_chunk_states l
          WHERE l.state = 'RUNNING'
          ORDER BY l.taskName, l.beginTime DESC NULLS LAST
        ) exec ON exec.taskName = l.taskName
        LEFT JOIN (
          SELECT
            l.taskName AS taskName,
            COUNT(l.state) AS total,
            SUM(CASE WHEN l.state = 'FAILED' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN l.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN l.state = 'COMPLETE' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN l.state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
          FROM latest_chunk_states l
          GROUP BY l.taskName
        ) chunks ON chunks.taskName = l.taskName"#,
        latest = latest_chunk_states("$2", None),
    );
    let rows = sqlx::query(&sql)
        .bind(stale_millis(stale_timeout))
        .bind(run_ids)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok(CombinedTaskRunEntry {
                task_name: row.try_get(0)?,
                current_execution_id: row.try_get(1)?,
                chunk_counts: ChunkCounts::from_row(row, 2)?,
            })
        })
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

/// findArtifacts: artifacts of the latest complete-or-skipped task per name.
/// For skipped tasks, the producing (complete) run of the same path within the
/// user's organization is linked as `foreignWorkflow`.
pub(crate) async fn find_artifacts(
    pool: &PgPool,
    user: &AuthUser,
    run_ids: &[String],
    stale_timeout: std::time::Duration,
) -> ApiResult<Vec<ArtifactEntry>> {
    let sql = format!(
        r#"WITH latest_complete_tasks AS ({latest})
        SELECT
          a._id,
          a._task,
          a.name,
          a.path,
          a.fileSize,
          a.inodeCount,
          a.version,
          a.metadata,
          t.name AS taskName,
          o.workflow_hash AS other_workflow_hash,
          o._run AS other_run
        FROM webknossos.voxelytics_artifacts a
        JOIN latest_complete_tasks t ON t._id = a._task
        LEFT JOIN ( -- when the task is skipped, the artifact from the producing task run is joined for linking
          SELECT
            DISTINCT ON (a.path)
            a.path path,
            r.workflow_hash workflow_hash,
            r._id _run
          FROM webknossos.voxelytics_artifacts a
          JOIN webknossos.voxelytics_tasks t ON a._task = t._id
          JOIN ({tasks}) ts ON ts._id = t._id AND ts.state = 'COMPLETE'
          JOIN ({visible}) r ON r._id = t._run
          ORDER BY a.path, ts.beginTime DESC NULLS LAST
        ) o ON o.path = a.path AND t.state = 'SKIPPED'"#,
        latest = latest_complete_or_skipped_task("$2", None),
        tasks = tasks_with_state(),
        visible = visible_runs("TRUE", "$3", "$4"),
    );
    let rows = sqlx::query(&sql)
        .bind(stale_millis(stale_timeout))
        .bind(run_ids)
        .bind(&user.id)
        .bind(&user.organization_id)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            let other_hash: Option<String> = row.try_get(9)?;
            let other_run: Option<String> = row.try_get(10)?;
            Ok(ArtifactEntry {
                artifact_id: row.try_get(0)?,
                task_id: row.try_get(1)?,
                name: row.try_get(2)?,
                path: row.try_get(3)?,
                file_size: row.try_get(4)?,
                inode_count: row.try_get(5)?,
                version: row.try_get(6)?,
                metadata: row
                    .try_get::<Option<Value>, _>(7)?
                    .unwrap_or_else(|| json!({})),
                task_name: row.try_get(8)?,
                foreign_workflow: other_hash.zip(other_run),
            })
        })
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

pub(crate) async fn find_tasks(pool: &PgPool, run_id: &str) -> ApiResult<Vec<TaskEntry>> {
    let rows: Vec<(String, String, Value)> = sqlx::query_as(
        "SELECT t.name, t.task, t.config FROM webknossos.voxelytics_tasks t WHERE _run = $1",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(name, task, config)| TaskEntry { name, task, config })
        .collect())
}

/// getRunIdByNameAndWorkflowHash: admins see every run of their organization,
/// other users only their own.
pub(crate) async fn run_id_by_name_and_workflow_hash(
    pool: &PgPool,
    run_name: &str,
    workflow_hash: &str,
    user: &AuthUser,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.voxelytics_runs
        WHERE name = $1 AND workflow_hash = $2 AND _organization = $3 AND ($4 OR _user = $5)
        LIMIT 1"#,
    )
    .bind(run_name)
    .bind(workflow_hash)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&user.id)
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn run_name_by_id(
    pool: &PgPool,
    run_id: &str,
    organization_id: &str,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT name FROM webknossos.voxelytics_runs WHERE _id = $1 AND _organization = $2",
    )
    .bind(run_id)
    .bind(organization_id)
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn user_id_for_run_name(
    conn: &mut PgConnection,
    run_name: &str,
    organization_id: &str,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT _user FROM webknossos.voxelytics_runs WHERE name = $1 AND _organization = $2",
    )
    .bind(run_name)
    .bind(organization_id)
    .fetch_optional(conn)
    .await?)
}

pub(crate) async fn chunk_statistics(
    pool: &PgPool,
    run_ids: &[String],
    task_name: &str,
    stale_timeout: std::time::Duration,
) -> ApiResult<Vec<ChunkStatisticsEntry>> {
    let sql = format!(
        r#"WITH latest_chunk_states AS ({latest})
        SELECT
          exec.executionId AS executionId,
          exec.countTotal::BIGINT AS countTotal,
          exec.countFailed::BIGINT AS countFailed,
          exec.countSkipped::BIGINT AS countSkipped,
          exec.countComplete::BIGINT AS countComplete,
          exec.countCancelled::BIGINT AS countCancelled,
          times.beginTime AS beginTime,
          times.endTime AS endTime,
          times.wallTime::FLOAT8 AS wallTime,
          profiling.max_memory::FLOAT8 AS max_memory,
          profiling.median_memory::FLOAT8 AS median_memory,
          profiling.stddev_memory::FLOAT8 AS stddev_memory,
          profiling.max_cpuUser::FLOAT8 AS max_cpuUser,
          profiling.median_cpuUser::FLOAT8 AS median_cpuUser,
          profiling.stddev_cpuUser::FLOAT8 AS stddev_cpuUser,
          profiling.max_cpuSystem::FLOAT8 AS max_cpuSystem,
          profiling.median_cpuSystem::FLOAT8 AS median_cpuSystem,
          profiling.stddev_cpuSystem::FLOAT8 AS stddev_cpuSystem,
          durations.max_duration::FLOAT8 AS max_duration,
          durations.median_duration::FLOAT8 AS median_duration,
          durations.stddev_duration::FLOAT8 AS stddev_duration,
          durations.sum_duration::FLOAT8 AS sum_duration
        FROM ( -- Chunks grouped by executionId
          SELECT
            c.executionId,
            COUNT(c._chunk) AS countTotal,
            SUM(CASE WHEN c.state = 'FAILED' THEN 1 ELSE 0 END) AS countFailed,
            SUM(CASE WHEN c.state = 'SKIPPED' THEN 1 ELSE 0 END) AS countSkipped,
            SUM(CASE WHEN c.state = 'COMPLETE' THEN 1 ELSE 0 END) AS countComplete,
            SUM(CASE WHEN c.state = 'CANCELLED' THEN 1 ELSE 0 END) AS countCancelled
          FROM latest_chunk_states c
          GROUP BY c.executionId
        ) exec
        LEFT JOIN ( -- Wall clock times
          SELECT
            c.executionId,
            MIN(c.beginTime) AS beginTime,
            MAX(c.endTime) AS endTime,
            SUM(c.wallTime) wallTime
          FROM (
            SELECT
              c.executionId,
              MIN(cs.beginTime) AS beginTime,
              MAX(cs.endTime) AS endTime,
              EXTRACT(epoch FROM MAX(cs.endTime) - MIN(cs.beginTime)) wallTime
            FROM webknossos.voxelytics_chunks c
            JOIN webknossos.voxelytics_tasks t ON t._id = c._task
            JOIN ({chunks}) cs ON cs._id = c._id
            WHERE t._run = ANY($2) AND t.name = $3
            GROUP BY c.executionId, t._id
          ) c
          GROUP BY c.executionId
        ) times ON times.executionId = exec.executionId
        LEFT JOIN ( -- Profiling statistics (memory, cpu); grouped by executionId
          SELECT
            c.executionId AS executionId,
            MAX(cp.memory) AS max_memory,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cp.memory) AS median_memory,
            STDDEV(cp.memory) AS stddev_memory,
            MAX(cp.cpuUser) AS max_cpuUser,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cp.cpuUser) AS median_cpuUser,
            STDDEV(cp.cpuUser) AS stddev_cpuUser,
            MAX(cp.cpuSystem) AS max_cpuSystem,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cp.cpuSystem) AS median_cpuSystem,
            STDDEV(cp.cpuSystem) AS stddev_cpuSystem
          FROM webknossos.voxelytics_chunkProfilingEvents cp
          JOIN latest_chunk_states c ON c._chunk = cp._chunk
          GROUP BY c.executionId
        ) profiling ON profiling.executionId = exec.executionId
        LEFT JOIN ( -- Chunk duration statistics; grouped by executionId
          SELECT
            c.executionId AS executionId,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (EXTRACT(epoch FROM COALESCE(c.endTime, NOW()) - c.beginTime))) AS median_duration,
            MAX(EXTRACT(epoch FROM COALESCE(c.endTime, NOW()) - c.beginTime)) AS max_duration,
            STDDEV(EXTRACT(epoch FROM COALESCE(c.endTime, NOW()) - c.beginTime)) AS stddev_duration,
            SUM(EXTRACT(epoch FROM COALESCE(c.endTime, NOW()) - c.beginTime)) AS sum_duration
          FROM latest_chunk_states c
          WHERE c.state = 'COMPLETE'
          GROUP BY c.executionId
        ) durations ON durations.executionId = exec.executionId
        ORDER BY times.beginTime ASC NULLS LAST"#,
        latest = latest_chunk_states("$2", Some("$3")),
        chunks = chunks_with_state(),
    );
    let rows = sqlx::query(&sql)
        .bind(stale_millis(stale_timeout))
        .bind(run_ids)
        .bind(task_name)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            let stats = |offset: usize, with_sum: bool| -> sqlx::Result<StatisticsEntry> {
                Ok(StatisticsEntry {
                    max: double(row, offset)?,
                    median: double(row, offset + 1)?,
                    stddev: double(row, offset + 2)?,
                    sum: if with_sum {
                        Some(double(row, offset + 3)?)
                    } else {
                        None
                    },
                })
            };
            Ok(ChunkStatisticsEntry {
                execution_id: row.try_get(0)?,
                chunk_counts: ChunkCounts::from_row(row, 1)?,
                begin_time: row.try_get(6)?,
                end_time: row.try_get(7)?,
                wall_time: double(row, 8)?,
                memory: stats(9, false)?,
                cpu_user: stats(12, false)?,
                cpu_system: stats(15, false)?,
                duration: stats(18, true)?,
            })
        })
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

/// getArtifactChecksums: the first (oldest) checksum event per artifact file
/// of the latest complete-or-skipped run of the task.
pub(crate) async fn artifact_checksums(
    pool: &PgPool,
    run_ids: &[String],
    task_name: &str,
    artifact_name: Option<&str>,
    stale_timeout: std::time::Duration,
) -> ApiResult<Vec<ArtifactChecksumEntry>> {
    let sql = format!(
        r#"WITH latest_complete_tasks AS ({latest})
        SELECT
          t.name,
          a.name,
          af.path,
          af.resolvedPath,
          af.timestamp,
          af.checksumMethod,
          af.checksum,
          af.fileSize,
          af.lastModified
        FROM
          (
          SELECT DISTINCT ON(_artifact, path) *
            FROM webknossos.voxelytics_artifactFileChecksumEvents
          ORDER BY _artifact, path, timestamp
        ) af
        JOIN webknossos.voxelytics_artifacts a ON a._id = af._artifact
        JOIN latest_complete_tasks t ON t._id = a._task
        WHERE ($4::TEXT IS NULL OR a.name = $4)
        ORDER BY af.path"#,
        latest = latest_complete_or_skipped_task("$2", Some("$3")),
    );
    let rows = sqlx::query(&sql)
        .bind(stale_millis(stale_timeout))
        .bind(run_ids)
        .bind(task_name)
        .bind(artifact_name)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok(ArtifactChecksumEntry {
                task_name: row.try_get(0)?,
                artifact_name: row.try_get(1)?,
                path: row.try_get(2)?,
                resolved_path: row.try_get(3)?,
                timestamp: row.try_get(4)?,
                checksum_method: row.try_get(5)?,
                checksum: row.try_get(6)?,
                file_size: row.try_get(7)?,
                last_modified: row.try_get(8)?,
            })
        })
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

// ---------------------------------------------------------------------------
// Writes

pub(crate) async fn upsert_workflow(
    conn: &mut PgConnection,
    hash: &str,
    name: &str,
    organization_id: &str,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.voxelytics_workflows (hash, name, _organization)
        VALUES ($1, $2, $3)
        ON CONFLICT (_organization, hash)
          DO UPDATE SET name = EXCLUDED.name"#,
    )
    .bind(hash)
    .bind(name)
    .bind(organization_id)
    .execute(conn)
    .await?;
    Ok(())
}

pub(crate) struct NewRun<'a> {
    pub organization_id: &'a str,
    pub user_id: &'a str,
    pub name: &'a str,
    pub username: &'a str,
    pub hostname: &'a str,
    pub voxelytics_version: &'a str,
    pub workflow_hash: &'a str,
    pub workflow_yaml_content: Option<&'a str>,
    pub workflow_config: &'a Value,
}

/// upsertRun: one run per (organization, name); returns its id.
pub(crate) async fn upsert_run(conn: &mut PgConnection, run: NewRun<'_>) -> ApiResult<String> {
    Ok(sqlx::query_scalar(
        r#"INSERT INTO webknossos.voxelytics_runs (_id, _organization, _user, name, username, hostname, voxelyticsVersion, workflow_hash, workflow_yamlContent, workflow_config)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (_organization, name)
          DO UPDATE SET
            _user = EXCLUDED._user,
            username = EXCLUDED.username,
            hostname = EXCLUDED.hostname,
            voxelyticsVersion = EXCLUDED.voxelyticsVersion,
            workflow_hash = EXCLUDED.workflow_hash,
            workflow_yamlContent = EXCLUDED.workflow_yamlContent,
            workflow_config = EXCLUDED.workflow_config
        RETURNING _id"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(run.organization_id)
    .bind(run.user_id)
    .bind(run.name)
    .bind(run.username)
    .bind(run.hostname)
    .bind(run.voxelytics_version)
    .bind(run.workflow_hash)
    .bind(run.workflow_yaml_content)
    .bind(run.workflow_config)
    .fetch_one(conn)
    .await?)
}

pub(crate) async fn upsert_task(
    conn: &mut PgConnection,
    run_id: &str,
    name: &str,
    task: &str,
    config: &Value,
) -> ApiResult<String> {
    Ok(sqlx::query_scalar(
        r#"INSERT INTO webknossos.voxelytics_tasks (_id, _run, name, task, config)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (_run, name)
          DO UPDATE SET
            task = EXCLUDED.task,
            config = EXCLUDED.config
        RETURNING _id"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(run_id)
    .bind(name)
    .bind(task)
    .bind(config)
    .fetch_one(conn)
    .await?)
}

pub(crate) struct ArtifactValues<'a> {
    pub path: &'a str,
    pub file_size: i64,
    pub inode_count: i64,
    pub version: &'a str,
    pub metadata: Value,
}

pub(crate) async fn upsert_artifact(
    conn: &mut PgConnection,
    task_id: &str,
    name: &str,
    artifact: &ArtifactValues<'_>,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.voxelytics_artifacts (_id, _task, name, path, fileSize, inodeCount, version, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (_task, name)
          DO UPDATE SET
            path = EXCLUDED.path,
            fileSize = EXCLUDED.fileSize,
            inodeCount = EXCLUDED.inodeCount,
            version = EXCLUDED.version,
            metadata = EXCLUDED.metadata"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(task_id)
    .bind(name)
    .bind(artifact.path)
    .bind(artifact.file_size)
    .bind(artifact.inode_count)
    .bind(artifact.version)
    .bind(&artifact.metadata)
    .execute(conn)
    .await?;
    Ok(())
}

/// upsertArtifacts (from task state events): rows are JSON objects with
/// task_name, artifact_name, path, file_size, inode_count, version, metadata.
pub(crate) async fn upsert_artifacts(
    conn: &mut PgConnection,
    run_id: &str,
    rows: &[Value],
) -> ApiResult<()> {
    let rows: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut row = row.clone();
            row["id"] = json!(ObjectId::new().as_str());
            row
        })
        .collect();
    sqlx::query(
        r#"INSERT INTO webknossos.voxelytics_artifacts (_id, _task, name, path, fileSize, inodeCount, version, metadata)
        SELECT iv.id, t._id, iv.artifact_name, iv.path, iv.file_size, iv.inode_count, iv.version, iv.metadata
        FROM jsonb_to_recordset($2::JSONB) AS iv(id TEXT, task_name TEXT, artifact_name TEXT, path TEXT, file_size BIGINT, inode_count BIGINT, version TEXT, metadata JSONB)
        JOIN webknossos.voxelytics_tasks t ON t._run = $1 AND t.name = iv.task_name
        ON CONFLICT (_task, name)
          DO UPDATE SET
            path = EXCLUDED.path,
            fileSize = EXCLUDED.fileSize,
            inodeCount = EXCLUDED.inodeCount,
            version = EXCLUDED.version,
            metadata = EXCLUDED.metadata"#,
    )
    .bind(run_id)
    .bind(Value::Array(rows))
    .execute(conn)
    .await?;
    Ok(())
}

/// updateRunStates: rows have begin_time, end_time (ISO or null) and state.
pub(crate) async fn update_run_states(
    conn: &mut PgConnection,
    run_id: &str,
    rows: &[Value],
) -> ApiResult<()> {
    sqlx::query(
        r#"UPDATE webknossos.voxelytics_runs u
        SET
          beginTime = COALESCE(v.begin_time, u.beginTime),
          endTime = COALESCE(v.end_time, u.endTime),
          state = v.state::webknossos.voxelytics_run_state
        FROM jsonb_to_recordset($2::JSONB) AS v(begin_time TIMESTAMPTZ, end_time TIMESTAMPTZ, state TEXT)
        WHERE u._id = $1"#,
    )
    .bind(run_id)
    .bind(Value::Array(rows.to_vec()))
    .execute(conn)
    .await?;
    Ok(())
}

/// updateTaskStates: rows have task_name, begin_time, end_time and state.
pub(crate) async fn update_task_states(
    conn: &mut PgConnection,
    run_id: &str,
    rows: &[Value],
) -> ApiResult<()> {
    sqlx::query(
        r#"UPDATE webknossos.voxelytics_tasks u
        SET
          beginTime = COALESCE(v.beginTime, u.beginTime),
          endTime = COALESCE(v.endTime, u.endTime),
          state = v.state
        FROM (
          SELECT t._id _task, iv.begin_time beginTime, iv.end_time endTime, iv.state::webknossos.voxelytics_run_state state
          FROM jsonb_to_recordset($2::JSONB) AS iv(task_name TEXT, begin_time TIMESTAMPTZ, end_time TIMESTAMPTZ, state TEXT)
          JOIN webknossos.voxelytics_tasks t ON t._run = $1 AND t.name = iv.task_name
        ) v
        WHERE u._id = v._task"#,
    )
    .bind(run_id)
    .bind(Value::Array(rows.to_vec()))
    .execute(conn)
    .await?;
    Ok(())
}

/// upsertChunkStates: rows have task_name, execution_id, chunk_name,
/// begin_time, end_time and state.
pub(crate) async fn upsert_chunk_states(
    conn: &mut PgConnection,
    run_id: &str,
    rows: &[Value],
) -> ApiResult<()> {
    let rows: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut row = row.clone();
            row["id"] = json!(ObjectId::new().as_str());
            row
        })
        .collect();
    sqlx::query(
        r#"INSERT INTO webknossos.voxelytics_chunks AS u (_id, _task, executionId, chunkName, beginTime, endTime, state)
        SELECT
          iv.id,
          t._id,
          iv.execution_id,
          iv.chunk_name,
          iv.begin_time,
          iv.end_time,
          iv.state::webknossos.voxelytics_run_state
        FROM jsonb_to_recordset($2::JSONB) AS iv(id TEXT, task_name TEXT, execution_id TEXT, chunk_name TEXT, begin_time TIMESTAMPTZ, end_time TIMESTAMPTZ, state TEXT)
        JOIN webknossos.voxelytics_tasks t ON t._run = $1 AND t.name = iv.task_name
        ON CONFLICT (_task, executionId, chunkName)
          DO UPDATE SET
            state = EXCLUDED.state,
            beginTime = COALESCE(EXCLUDED.beginTime, u.beginTime),
            endTime = COALESCE(EXCLUDED.endTime, u.endTime)"#,
    )
    .bind(run_id)
    .bind(Value::Array(rows))
    .execute(conn)
    .await?;
    Ok(())
}

/// upsertRunHeartbeatEvents: rows have a timestamp.
pub(crate) async fn upsert_run_heartbeats(
    conn: &mut PgConnection,
    run_id: &str,
    rows: &[Value],
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.voxelytics_runHeartbeatEvents (_run, timestamp)
        SELECT $1, iv.timestamp
        FROM jsonb_to_recordset($2::JSONB) AS iv(timestamp TIMESTAMPTZ)
        ON CONFLICT (_run)
          DO UPDATE SET timestamp = EXCLUDED.timestamp"#,
    )
    .bind(run_id)
    .bind(Value::Array(rows.to_vec()))
    .execute(conn)
    .await?;
    Ok(())
}

/// upsertChunkProfilingEvents: rows have task_name, execution_id, chunk_name,
/// hostname, pid, memory, cpu_user, cpu_system and timestamp.
pub(crate) async fn upsert_chunk_profiling(
    conn: &mut PgConnection,
    run_id: &str,
    rows: &[Value],
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.voxelytics_chunkProfilingEvents (_chunk, hostname, pid, memory, cpuUser, cpuSystem, timestamp)
        SELECT
          c._id,
          iv.hostname,
          iv.pid,
          iv.memory,
          iv.cpu_user,
          iv.cpu_system,
          iv.timestamp
        FROM jsonb_to_recordset($2::JSONB) AS iv(task_name TEXT, execution_id TEXT, chunk_name TEXT, hostname TEXT, pid BIGINT, memory FLOAT8, cpu_user FLOAT8, cpu_system FLOAT8, timestamp TIMESTAMPTZ)
        JOIN webknossos.voxelytics_tasks t ON t._run = $1 AND t.name = iv.task_name
        JOIN webknossos.voxelytics_chunks c ON c._task = t._id AND c.executionId = iv.execution_id AND c.chunkName = iv.chunk_name
        ON CONFLICT (_chunk, timestamp)
           DO UPDATE SET
             hostname = EXCLUDED.hostname,
             pid = EXCLUDED.pid,
             memory = EXCLUDED.memory,
             cpuUser = EXCLUDED.cpuUser,
             cpuSystem = EXCLUDED.cpuSystem"#,
    )
    .bind(run_id)
    .bind(Value::Array(rows.to_vec()))
    .execute(conn)
    .await?;
    Ok(())
}

/// upsertArtifactChecksumEvents: rows have task_name, artifact_name, path,
/// resolved_path, checksum_method, checksum, file_size, last_modified, timestamp.
pub(crate) async fn upsert_artifact_checksums(
    conn: &mut PgConnection,
    run_id: &str,
    rows: &[Value],
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.voxelytics_artifactFileChecksumEvents (_artifact, path, resolvedPath, checksumMethod, checksum, fileSize, lastModified, timestamp)
        SELECT
          a._id,
          iv.path,
          iv.resolved_path,
          iv.checksum_method,
          iv.checksum,
          iv.file_size,
          iv.last_modified,
          iv.timestamp
        FROM jsonb_to_recordset($2::JSONB) AS iv(task_name TEXT, artifact_name TEXT, path TEXT, resolved_path TEXT, checksum_method TEXT, checksum TEXT, file_size BIGINT, last_modified TIMESTAMPTZ, timestamp TIMESTAMPTZ)
        JOIN webknossos.voxelytics_tasks t ON t._run = $1 AND t.name = iv.task_name
        JOIN webknossos.voxelytics_artifacts a ON a._task = t._id AND a.name = iv.artifact_name
        ON CONFLICT (_artifact, path, timestamp)
          DO UPDATE SET
            resolvedPath = EXCLUDED.resolvedPath,
            checksumMethod = EXCLUDED.checksumMethod,
            checksum = EXCLUDED.checksum,
            fileSize = EXCLUDED.fileSize,
            lastModified = EXCLUDED.lastModified"#,
    )
    .bind(run_id)
    .bind(Value::Array(rows.to_vec()))
    .execute(conn)
    .await?;
    Ok(())
}

/// deleteWorkflow: the workflow of the user's organization (runs, tasks,
/// chunks, artifacts and events cascade) and the job links to it.
pub(crate) async fn delete_workflow(
    conn: &mut PgConnection,
    hash: &str,
    organization_id: &str,
) -> ApiResult<()> {
    sqlx::query(
        "DELETE FROM webknossos.voxelytics_workflows WHERE hash = $1 AND _organization = $2",
    )
    .bind(hash)
    .bind(organization_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        r#"UPDATE webknossos.jobs
        SET _voxelytics_workflowHash = NULL
        WHERE _voxelytics_workflowHash = $1
        AND (SELECT _organization FROM webknossos.users AS u WHERE u._id = _owner) = $2"#,
    )
    .bind(hash)
    .bind(organization_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}
