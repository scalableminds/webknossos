package models.voxelytics

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import models.user.User
import play.api.libs.json._
import utils.ObjectId
import utils.sql.{SQLClient, SimpleSQLDAO, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class VoxelyticsDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

  def runsWithStateQ(staleTimeout: FiniteDuration): SqlToken =
    q"""SELECT
          r._id,
          CASE
            WHEN run_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - $staleTimeout
            THEN 'STALE' ELSE run_state.state END AS state,
          run_begin.timestamp AS beginTime,
          CASE
            WHEN run_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - $staleTimeout
            THEN run_heartbeat.timestamp ELSE run_end.timestamp END AS endTime
        FROM webknossos.voxelytics_runs r
        JOIN (
          SELECT DISTINCT ON (_run) _run, state
          FROM webknossos.voxelytics_runStateChangeEvents
          ORDER BY _run, timestamp DESC
        ) run_state
          ON r._id = run_state._run
        JOIN (
          SELECT DISTINCT ON (_run) _run, timestamp
          FROM webknossos.voxelytics_runStateChangeEvents
          WHERE state = 'RUNNING'
          ORDER BY _run, timestamp
        ) run_begin
          ON r._id = run_begin._run
        LEFT JOIN (
          SELECT DISTINCT ON (_run) _run, timestamp
          FROM webknossos.voxelytics_runStateChangeEvents
          WHERE state IN ('COMPLETE', 'FAILED', 'CANCELLED')
          ORDER BY _run, timestamp DESC
        ) run_end
          ON r._id = run_end._run
        LEFT JOIN (
          SELECT _run, timestamp
          FROM webknossos.voxelytics_runHeartbeatEvents
        ) run_heartbeat
          ON r._id = run_heartbeat._run"""

  def tasksWithStateQ(staleTimeout: FiniteDuration): SqlToken =
    q"""SELECT
          t._id,
          CASE WHEN task_state.state = 'RUNNING' AND r.state = 'STALE' THEN 'STALE' ELSE task_state.state END AS state,
          task_begin.timestamp AS beginTime,
          CASE WHEN task_state.state = 'RUNNING' AND r.state = 'STALE' THEN r.endTime ELSE task_end.timestamp END AS endTime
        FROM webknossos.voxelytics_tasks t
        JOIN (${runsWithStateQ(staleTimeout)}) r ON r._id = t._run
        JOIN (
          SELECT DISTINCT ON (_task) _task, state
          FROM webknossos.voxelytics_taskStateChangeEvents
          ORDER BY _task, timestamp DESC
        ) task_state
          ON t._id = task_state._task
        LEFT JOIN (
          SELECT DISTINCT ON (_task) _task, timestamp
          FROM webknossos.voxelytics_taskStateChangeEvents
          WHERE state = 'RUNNING'
          ORDER BY _task, timestamp
        ) task_begin
          ON t._id = task_begin._task
        LEFT JOIN (
          SELECT DISTINCT ON (_task) _task, timestamp
          FROM webknossos.voxelytics_taskStateChangeEvents
          WHERE state IN ('COMPLETE', 'FAILED', 'CANCELLED')
          ORDER BY _task, timestamp DESC
        ) task_end
          ON t._id = task_end._task"""

  def chunksWithStateQ(staleTimeout: FiniteDuration): SqlToken =
    q"""SELECT
          c._id,
          CASE WHEN chunk_state.state = 'RUNNING' AND r.state = 'STALE' THEN 'STALE' ELSE chunk_state.state END AS state,
          chunk_begin.timestamp AS beginTime,
          CASE WHEN chunk_state.state = 'RUNNING' AND r.state = 'STALE' THEN r.endTime ELSE chunk_end.timestamp END AS endTime
        FROM webknossos.voxelytics_chunks c
        JOIN webknossos.voxelytics_tasks t ON t._id = c._task
        JOIN (${runsWithStateQ(staleTimeout)}) r ON r._id = t._run
        JOIN (
          SELECT DISTINCT ON (_chunk) _chunk, state
          FROM webknossos.voxelytics_chunkStateChangeEvents
          ORDER BY _chunk, timestamp DESC
        ) chunk_state
          ON c._id = chunk_state._chunk
        LEFT JOIN (
          SELECT DISTINCT ON (_chunk) _chunk, timestamp
          FROM webknossos.voxelytics_chunkStateChangeEvents
          WHERE state = 'RUNNING'
          ORDER BY _chunk, timestamp
        ) chunk_begin
          ON c._id = chunk_begin._chunk
        LEFT JOIN (
          SELECT DISTINCT ON (_chunk) _chunk, timestamp
          FROM webknossos.voxelytics_chunkStateChangeEvents
          WHERE state IN ('COMPLETE', 'FAILED', 'CANCELLED')
          ORDER BY _chunk, timestamp DESC
        ) chunk_end
          ON c._id = chunk_end._chunk"""

  private def visibleRunsQ(currentUser: User, allowUnlisted: Boolean) = {
    val organizationId = currentUser._organization
    val readAccessQ =
      if (currentUser.isAdmin || allowUnlisted) q"${true}"
      else q"(__r._user = ${currentUser._id})"
    q"""SELECT __r.*
        FROM webknossos.voxelytics_runs __r
        WHERE $readAccessQ AND __r._organization = $organizationId"""
  }

  private def latestChunkStatesQ(runIds: List[ObjectId], staleTimeout: FiniteDuration) =
    q"""SELECT
          DISTINCT ON (t.name, c.executionId, c.chunkName)
          t.name taskName,
          c.executionId executionId,
          c.chunkName chunkName,
          t._id _task,
          c._id _chunk,
          cs.timestamp timestamp,
          cs.state state
        FROM (${chunksWithStateQ(staleTimeout)}) cs
        JOIN webknossos.voxelytics_chunks c ON c._id = cs._chunk
        JOIN webknossos.voxelytics_tasks t ON t._id = c._task
        WHERE
          cs.state NOT IN ('SKIPPED', 'PENDING')
          AND t._run IN ${SqlToken.tuple(runIds)}
        ORDER BY t.name, c.executionId, c.chunkName, cs.timestamp DESC"""

  private def latestRunningChunkStatesQ(runIds: List[ObjectId], taskName: String, staleTimeout: FiniteDuration) =
    q"""SELECT
          DISTINCT ON (t.name, c.executionId, c.chunkName)
          t.name taskName,
          c.executionId executionId,
          c.chunkName chunkName,
          t._id _task,
          c._id _chunk,
          cs.state state,
          cs.beginTime beginTime,
          cs.endTime endTime
        FROM (${chunksWithStateQ(staleTimeout)}) cs
        JOIN webknossos.voxelytics_chunks c ON c._id = cs._chunk
        JOIN webknossos.voxelytics_tasks t ON t._id = c._task
        WHERE
          cs.state NOT IN ('SKIPPED', 'PENDING')
          AND t._run IN ${SqlToken.tuple(runIds)}
          AND t.name = $taskName
        ORDER BY t.name, c.executionId, c.chunkName, cs.beginTime DESC"""

  private def latestCompleteTaskQ(runIds: List[ObjectId], taskName: Option[String], staleTimeout: FiniteDuration) =
    q"""SELECT
          DISTINCT ON (t.name)
          t.name name,
          t._id _task
        FROM (${tasksWithStateQ(staleTimeout)}) ts
        JOIN webknossos.voxelytics_tasks t ON t._id = ts._task
        WHERE
          ts.state = 'COMPLETE'
          AND t._run IN ${SqlToken.tuple(runIds)}
          ${taskName.map(t => q" AND t.name = $t").getOrElse(SqlToken.empty)}
        ORDER BY t.name, ts.timestamp DESC"""

  def findArtifacts(runIds: List[ObjectId], staleTimeout: FiniteDuration): Fox[List[ArtifactEntry]] =
    for {
      r <- run(q"""
        WITH latest_complete_tasks AS (${latestCompleteTaskQ(runIds, None, staleTimeout)})
        SELECT
          a._id,
          a._task,
          a.name,
          a.path,
          a.fileSize,
          a.inodeCount,
          a.version,
          a.metadata,
          t.name AS taskName
        FROM webknossos.voxelytics_artifacts a
        JOIN latest_complete_tasks t ON t._task = a._task
        """.as[(String, String, String, String, Long, Long, String, String, String)])
    } yield
      r.toList.map(
        row =>
          ArtifactEntry(
            artifactId = ObjectId(row._1),
            taskId = ObjectId(row._2),
            name = row._3,
            path = row._4,
            fileSize = row._5,
            inodeCount = row._6,
            version = row._7,
            metadata = Json.parse(row._8).as[JsObject],
            taskName = row._9
        ))

  def findTasks(runId: ObjectId): Fox[List[TaskEntry]] =
    for {
      r <- run(q"""
        SELECT
          t._id,
          t._run,
          t.name,
          t.task,
          t.config
        FROM webknossos.voxelytics_tasks t
        WHERE _run = $runId
        """.as[(String, String, String, String, String)])
    } yield
      r.toList.map(
        row =>
          TaskEntry(taskId = ObjectId(row._1),
                    runId = ObjectId(row._2),
                    name = row._3,
                    task = row._4,
                    config = Json.parse(row._5).as[JsObject]))

  def findWorkflowsByHashAndOrganization(organizationId: ObjectId,
                                         workflowHashes: Set[String]): Fox[List[WorkflowEntry]] =
    for {
      r <- run(q"""
        SELECT name, hash
        FROM webknossos.voxelytics_workflows
        WHERE hash IN ${SqlToken.tuple(workflowHashes)} AND _organization = $organizationId
        """.as[(String, String)])
    } yield r.toList.map(row => WorkflowEntry(name = row._1, hash = row._2, _organization = organizationId))

  def findWorkflowByHashAndOrganization(organizationId: ObjectId, workflowHash: String): Fox[WorkflowEntry] =
    for {
      r <- run(q"""
        SELECT name, hash
        FROM webknossos.voxelytics_workflows
        WHERE hash = $workflowHash AND _organization = $organizationId
        """.as[(String, String)])
      (name, hash) <- r.headOption
    } yield WorkflowEntry(name, hash, organizationId)

  def findWorkflowByHash(workflowHash: String): Fox[WorkflowEntry] =
    for {
      r <- run(q"""
        SELECT name, hash, _organization
        FROM webknossos.voxelytics_workflows
        WHERE hash = $workflowHash
        """.as[(String, String, String)])
      (name, hash, organizationId) <- r.headOption // Could have multiple entries; picking the first.
    } yield WorkflowEntry(name, hash, ObjectId(organizationId))

  def findTaskRuns(runIds: List[ObjectId], staleTimeout: FiniteDuration): Fox[List[TaskRunEntry]] =
    for {
      r <- run(
        q"""
        WITH task_states AS (${tasksWithStateQ(staleTimeout)}),
          chunk_states AS (${chunksWithStateQ(staleTimeout)})
        SELECT
          r._id AS runId,
          r.name AS runName,
          t._id AS taskId,
          t.name AS taskName,
          ts.state AS state,
          ts.beginTime AS beginTime,
          ts.endTime AS endTime,
          exec.executionId AS currentExecutionId,
          COALESCE(chunks.total, 0) AS chunksTotal,
          COALESCE(chunks.failed, 0) AS chunksFailed,
          COALESCE(chunks.skipped, 0) AS chunksSkipped,
          COALESCE(chunks.complete, 0) AS chunksComplete,
          COALESCE(chunks.cancelled, 0) AS chunksCancelled
        FROM webknossos.voxelytics_runs r
        JOIN webknossos.voxelytics_tasks t ON t._run = r._id
        JOIN task_states ts ON ts._id = t._id
        LEFT JOIN (
          SELECT DISTINCT ON (c._task) c._task, c.executionId
          FROM chunk_states cs
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._chunk
          WHERE cs.state = 'RUNNING'
          ORDER BY c._task, cs.timestamp DESC
        ) exec ON exec._task = t._id
        LEFT JOIN (
          SELECT
            c._task AS _task,
            COUNT(c._id) AS total,
            SUM(CASE WHEN t.state = 'FAILED' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN t.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN t.state = 'COMPLETE' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN t.state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
          FROM chunk_states cs
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._chunk
          GROUP BY c._task
        ) chunks ON chunks._task = t._id
        WHERE
          r._id IN ${SqlToken.tuple(runIds)}
        """.as[(String,
                String,
                String,
                String,
                String,
                Option[Instant],
                Option[Instant],
                Option[String],
                Long,
                Long,
                Long,
                Long,
                Long)])
      results <- Fox.combined(
        r.toList.map(
          row =>
            for {
              state <- VoxelyticsRunState.fromString(row._5).toFox
            } yield
              TaskRunEntry(
                runId = ObjectId(row._1),
                runName = row._2,
                taskId = ObjectId(row._3),
                taskName = row._4,
                state = state,
                beginTime = row._6,
                endTime = row._7,
                currentExecutionId = row._8,
                chunks = ChunkStatistics(total = row._9,
                                         failed = row._10,
                                         skipped = row._11,
                                         complete = row._12,
                                         cancelled = row._13)
            )))
    } yield results

  def findCombinedTaskRuns(runIds: List[ObjectId], staleTimeout: FiniteDuration): Fox[List[CombinedTaskRunEntry]] =
    for {
      r <- run(q"""
        WITH latest_chunk_states AS (${latestChunkStatesQ(runIds, staleTimeout)})
        SELECT
          l.taskName AS taskName,
          exec.executionId AS currentExecutionId,
          COALESCE(chunks.total, 0) AS chunksTotal,
          COALESCE(chunks.failed, 0) AS chunksFailed,
          COALESCE(chunks.skipped, 0) AS chunksSkipped,
          COALESCE(chunks.complete, 0) AS chunksComplete,
          COALESCE(chunks.cancelled, 0) AS chunksCancelled
        FROM (SELECT DISTINCT taskName FROM latest_chunk_states) l
        LEFT JOIN (
          SELECT DISTINCT ON (l.taskName) l.taskName, c.executionId
          FROM latest_chunk_states l
          JOIN webknossos.voxelytics_chunks c ON c._id = l._chunk
          WHERE l.state = 'RUNNING'
          ORDER BY l.taskName, l.timestamp DESC
        ) exec ON exec.taskName = l.taskName
        LEFT JOIN (
          SELECT
            l.taskName AS taskName,
            COUNT(c._id) AS total,
            SUM(CASE WHEN t.state = 'FAILED' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN t.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN t.state = 'COMPLETE' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN t.state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
          FROM latest_chunk_states l
          JOIN webknossos.voxelytics_chunks c ON c._id = l._chunk
          GROUP BY l.taskName
        ) chunks ON chunks.taskName = l.taskName
        """.as[(String, Option[String], Long, Long, Long, Long, Long)])
    } yield
      r.toList.map(
        row =>
          CombinedTaskRunEntry(taskName = row._1,
                               currentExecutionId = row._2,
                               chunks = ChunkStatistics(total = row._3,
                                                        failed = row._4,
                                                        skipped = row._5,
                                                        complete = row._6,
                                                        cancelled = row._7)))

  def findRuns(currentUser: User,
               runIds: Option[List[ObjectId]],
               workflowHash: Option[String],
               staleTimeout: FiniteDuration,
               allowUnlisted: Boolean): Fox[List[RunEntry]] = {
    val runIdsQ =
      runIds.map(runIds => q" AND r._id IN ${SqlToken.tuple(runIds)}").getOrElse(SqlToken.empty)
    val workflowHashQ =
      workflowHash.map(workflowHash => q" AND r.workflow_hash = $workflowHash").getOrElse(SqlToken.empty)
    for {
      r <- run(q"""
        WITH run_states AS (${runsWithStateQ(staleTimeout)})
        SELECT
          r._id,
          r.name,
          r.username,
          r.hostname,
          r.voxelyticsVersion,
          r.workflow_hash,
          r.workflow_yamlContent,
          r.workflow_config,
          rs.state END AS state,
          rs.beginTime AS beginTime,
          rs.endTime END AS endTime
        FROM (${visibleRunsQ(currentUser, allowUnlisted)}) r
        JOIN run_states rs ON rs._id = r._id
        WHERE TRUE
          $runIdsQ
          $workflowHashQ
        """.as[(String, String, String, String, String, String, String, String, String, Instant, Option[Instant])])
      results <- Fox.combined(
        r.toList.map(
          row =>
            for {
              state <- VoxelyticsRunState.fromString(row._9).toFox
            } yield
              RunEntry(
                id = ObjectId(row._1),
                name = row._2,
                username = row._3,
                hostname = row._4,
                voxelyticsVersion = row._5,
                workflow_hash = row._6,
                workflow_yamlContent = row._7,
                workflow_config = Json.parse(row._8).as[JsObject],
                state = state,
                beginTime = row._10,
                endTime = row._11
            )))
    } yield results

  }

  def findWorkflowTaskStatistics(currentUser: User,
                                 workflowHashes: Set[String],
                                 staleTimeout: FiniteDuration): Fox[Map[String, TaskStatistics]] = {
    val organizationId = currentUser._organization
    for {
      r <- run(q"""
        WITH latest_task_states AS (${tasksWithStateQ(staleTimeout)})
        SELECT
          w.hash,
          COUNT(t.state) AS total,
          SUM(CASE WHEN t.state = 'FAILED' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN t.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
          SUM(CASE WHEN t.state = 'COMPLETE' THEN 1 ELSE 0 END) AS complete,
          SUM(CASE WHEN t.state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
        FROM webknossos.voxelytics_workflows w
        JOIN (
          -- Aggregating the task states of workflow runs (finished or running are prioritized)
          SELECT DISTINCT ON (workflow_hash, taskName) r.workflow_hash workflow_hash, t.name taskName, ts.state state
          FROM webknossos.voxelytics_tasks t
          JOIN (${visibleRunsQ(currentUser, allowUnlisted = false)}) r ON t._run = r._id
          JOIN latest_task_states ts ON ts._id = t._id
          WHERE ts.state IN ('RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED') AND r._organization = $organizationId
          ORDER BY workflow_hash, taskName, ts.beginTime DESC
        ) t ON t.workflow_hash = w.hash
        WHERE w.hash IN ${SqlToken.tuple(workflowHashes)} AND w._organization = $organizationId
        GROUP BY w.hash
        """.as[(String, Long, Long, Long, Long, Long)])
    } yield
      r.toList
        .map(
          row =>
            (row._1,
             TaskStatistics(total = row._2, failed = row._3, skipped = row._4, complete = row._5, cancelled = row._6)))
        .toMap
  }

  def findRunsForWorkflowListing(currentUser: User,
                                 staleTimeout: FiniteDuration): Fox[List[WorkflowListingRunEntry]] = {
    val organizationId = currentUser._organization
    for {
      r <- run(
        q"""
        WITH run_states AS (${runsWithStateQ(staleTimeout)})
        SELECT
          r._id,
          r.name,
          r.username,
          r.hostname,
          r.voxelyticsVersion,
          r.workflow_hash,
          rs.state END AS state,
          rs.beginTime AS beginTime,
          rs.endTime AS endTime,
          COALESCE(tasks.total, 0) AS tasksTotal,
          COALESCE(tasks.failed, 0) AS tasksFailed,
          COALESCE(tasks.skipped, 0) AS tasksSkipped,
          COALESCE(tasks.complete, 0) AS tasksComplete,
          COALESCE(tasks.cancelled, 0) AS tasksCancelled
        FROM (${visibleRunsQ(currentUser, allowUnlisted = false)}) r
        JOIN run_states rs ON rs._id = r._id
        LEFT JOIN (
          SELECT
            t._run AS _run,
            COUNT(t._id) AS total,
            SUM(CASE WHEN ts.state = 'FAILED' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN ts.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN ts.state = 'COMPLETE' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN ts.state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
          FROM webknossos.voxelytics_tasks AS t
          JOIN (${tasksWithStateQ(staleTimeout)}) ts ON ts._id = t._id
          GROUP BY t._run
        ) tasks ON tasks._run = r._id
        WHERE r._organization = $organizationId
        """.as[(String,
                String,
                String,
                String,
                String,
                String,
                String,
                Instant,
                Option[Instant],
                Long,
                Long,
                Long,
                Long,
                Long)])
      results <- Fox.combined(
        r.toList.map(
          row =>
            for {
              state <- VoxelyticsRunState.fromString(row._7).toFox
            } yield
              WorkflowListingRunEntry(
                id = ObjectId(row._1),
                name = row._2,
                username = row._3,
                hostname = row._4,
                voxelyticsVersion = row._5,
                workflow_hash = row._6,
                state = state,
                beginTime = row._8,
                endTime = row._9,
                taskStatistics = TaskStatistics(
                  total = row._10,
                  failed = row._11,
                  skipped = row._12,
                  complete = row._13,
                  cancelled = row._14
                )
            )))
    } yield results
  }

  def getRunIdByNameAndWorkflowHash(runName: String, workflowHash: String, currentUser: User): Fox[ObjectId] = {
    val readAccessQ =
      if (currentUser.isAdmin) q"${true}"
      else q"._user = ${currentUser._id}"
    for {
      objectIdList <- run(q"""
        SELECT _id
        FROM webknossos.voxelytics_runs
        WHERE
          name = $runName AND
          workflow_hash = $workflowHash AND
          _organization = ${currentUser._organization} AND
          ${readAccessQ}
        """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)
  }

  def getRunNameById(runId: ObjectId, organizationId: ObjectId): Fox[String] =
    for {
      nameList <- run(q"""
        SELECT name
        FROM webknossos.voxelytics_runs
        WHERE _id = $runId AND _organization = $organizationId
        """.as[String])
      name <- nameList.headOption
    } yield name

  def getUserIdForRun(runId: ObjectId): Fox[ObjectId] =
    for {
      userIdList <- run(q"""
        SELECT _user
        FROM webknossos.voxelytics_runs
        WHERE _id = $runId
        """.as[String])
      userId <- userIdList.headOption
    } yield ObjectId(userId)

  def getUserIdForRunOpt(runName: String, organizationId: ObjectId): Fox[Option[ObjectId]] =
    for {
      userId <- run(q"""
        SELECT _user
        FROM webknossos.voxelytics_runs
        WHERE name = $runName AND _organization = $organizationId
        """.as[String])
    } yield userId.headOption.map(ObjectId(_))

  def getChunkStatistics(runIds: List[ObjectId],
                         taskName: String,
                         staleTimeout: FiniteDuration): Fox[List[ChunkStatisticsEntry]] = {
    for {
      r <- run(
        q"""
        WITH latest_chunk_states AS (${latestRunningChunkStatesQ(runIds, taskName, staleTimeout)})
        SELECT
          exec.executionId AS executionId,
          exec.countTotal AS countTotal,
          exec.countFailed AS countFailed,
          exec.countComplete AS countComplete,
          exec.countCancelled AS countCancelled,
          times.beginTime AS beginTime,
          times.endTime AS endTime,
          times.wallTime AS wallTime,
          profiling.max_memory AS max_memory,
          profiling.median_memory AS median_memory,
          profiling.stddev_memory AS stddev_memory,
          profiling.max_cpuUser AS max_cpuUser,
          profiling.median_cpuUser AS median_cpuUser,
          profiling.stddev_cpuUser AS stddev_cpuUser,
          profiling.max_cpuSystem AS max_cpuSystem,
          profiling.median_cpuSystem AS median_cpuSystem,
          profiling.stddev_cpuSystem AS stddev_cpuSystem,
          durations.max_duration AS max_duration,
          durations.median_duration AS median_duration,
          durations.stddev_duration AS stddev_duration,
          durations.sum_duration AS sum_duration
        FROM
          ( -- Chunks grouped by task and executionId
            SELECT
              c.executionId,
              COUNT(c._chunk) AS countTotal,
              SUM(CASE WHEN c.state = 'FAILED' THEN 1 ELSE 0 END) AS countFailed
              SUM(CASE WHEN c.state = 'COMPLETE' THEN 1 ELSE 0 END) AS countCompleted
              SUM(CASE WHEN c.state = 'CANCELLED' THEN 1 ELSE 0 END) AS countCancelled
            FROM latest_chunk_states c
            GROUP BY c.executionId
          ) exec
        LEFT JOIN ( -- Wall clock times
          SELECT
            c.executionId,
            MIN(c.beginTime) AS beginTime,
            MAX(c.endTime) AS endTime,
            EXTRACT(epoch FROM MAX(c.endTime) - MIN(c.beginTime)) wallTime
          FROM latest_chunk_states c ON c._chunk = chunk_events._chunk
          GROUP BY c.executionId
        ) times ON times.executionId = exec.executionId
        LEFT JOIN ( -- Profiling statistics (memory, cpu); grouped by task and executionId
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
        LEFT JOIN ( -- Chunk duration statistics; grouped by task and executionId
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
        ORDER BY times.beginTime ASC NULLS LAST
        """.as[
          (String,
           Long,
           Long,
           Long,
           Long,
           Instant,
           Instant,
           Double,
           Double,
           Double,
           Double,
           Double,
           Double,
           Double,
           Double,
           Double,
           Double,
           Double,
           Double,
           Double,
           Double)])
    } yield
      r.toList.map(
        row =>
          ChunkStatisticsEntry(
            executionId = row._1,
            counts =
              ChunkStatistics(total = row._2, failed = row._3, skipped = 0L, complete = row._4, cancelled = row._5),
            beginTime = row._6,
            endTime = row._7,
            wallTime = row._8,
            memory = StatisticsEntry(max = row._9, median = row._10, stddev = row._11),
            cpuUser = StatisticsEntry(max = row._12, median = row._13, stddev = row._14),
            cpuSystem = StatisticsEntry(max = row._15, median = row._16, stddev = row._17),
            duration = StatisticsEntry(max = row._18, median = row._19, stddev = row._20, sum = Some(row._21))
        ))
  }

  def getArtifactChecksums(runIds: List[ObjectId],
                           taskName: String,
                           artifactName: Option[String],
                           staleTimeout: FiniteDuration): Fox[List[ArtifactChecksumEntry]] =
    for {
      r <- run(q"""
        WITH latest_complete_tasks AS (${latestCompleteTaskQ(runIds, Some(taskName), staleTimeout)})
        SELECT
          t.name AS taskName,
          a.name AS artifactName,
          af.path AS path,
          af.resolvedPath AS resolvedPath,
          af.timestamp AS timestamp,
          af.checksumMethod AS checksumMethod,
          af.checksum AS checksum,
          af.fileSize AS fileSize,
          af.lastModified AS lastModified
        FROM
          (
          SELECT DISTINCT ON(_artifact, path) *
            FROM webknossos.voxelytics_artifactFileChecksumEvents
          ORDER BY _artifact, path, timestamp
        ) af
        JOIN webknossos.voxelytics_artifacts a ON a._id = af._artifact
        JOIN latest_complete_tasks t ON t._task = a._task
        WHERE ${artifactName.map(a => q"a.name = $a").getOrElse(SqlToken.empty)}
        ORDER BY af.path
        """.as[(String, String, String, String, Instant, String, String, Long, Instant)])
    } yield
      r.toList.map(
        row =>
          ArtifactChecksumEntry(
            taskName = row._1,
            artifactName = row._2,
            path = row._3,
            resolvedPath = row._4,
            timestamp = row._5,
            checksumMethod = row._6,
            checksum = row._7,
            fileSize = row._8,
            lastModified = row._9
        ))

  def upsertArtifactChecksumEvents(runId: ObjectId, events: List[ArtifactFileChecksumEvent]): Fox[Unit] =
    for {
      _ <- run(q"""
        WITH insert_values(_run, taskName, artifactName, path, resolvedPath, checksumMethod, checksum, fileSize, lastModified, timestamp) AS (
          VALUES ${SqlToken.tupleList(
        events.map(
          ev =>
            List(runId,
                 ev.taskName,
                 ev.artifactName,
                 ev.path,
                 ev.resolvedPath,
                 ev.checksumMethod,
                 ev.checksum,
                 ev.fileSize,
                 ev.lastModified,
                 ev.timestamp)))}
        )
        INSERT INTO webknossos.voxelytics_artifactFileChecksumEvents (_artifact, path, resolvedPath, checksumMethod, checksum, fileSize, lastModified, timestamp)
        SELECT
          a._id _artifact,
          iv.path path,
          iv.resolvedPath resolvedPath,
          iv.checksumMethod checksumMethod,
          iv.checksum checksum,
          iv.fileSize fileSize,
          iv.lastModified lastModified,
          iv.timestamp timestamp
        FROM insert_values iv
        JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
        JOIN webknossos.voxelytics_artifacts a ON a._task = t._id AND a.name = iv.artifactName
        ON CONFLICT (_artifact, path, timestamp)
          DO UPDATE SET
            resolvedPath = EXCLUDED.resolvedPath,
            checksumMethod = EXCLUDED.checksumMethod,
            checksum = EXCLUDED.checksum,
            fileSize = EXCLUDED.fileSize,
            lastModified = EXCLUDED.lastModified
        """.asUpdate)
    } yield ()

  def upsertChunkProfilingEvents(runId: ObjectId, events: List[ChunkProfilingEvent]): Fox[Unit] =
    for {
      _ <- run(q"""
        WITH insert_values(_run, taskName, executionId, chunkName, hostname, pid, memory, cpuUser, cpuSystem, timestamp) AS (
          VALUES ${SqlToken.tupleList(
        events.map(
          ev =>
            List(runId,
                 ev.taskName,
                 ev.executionId,
                 ev.chunkName,
                 ev.hostname,
                 ev.pid,
                 ev.memory,
                 ev.cpuUser,
                 ev.cpuSystem,
                 ev.timestamp)))}
        )
        INSERT INTO webknossos.voxelytics_chunkProfilingEvents (_chunk, hostname, pid, memory, cpuUser, cpuSystem, timestamp)
        SELECT
          c._id _chunk,
          iv.hostname hostname,
          iv.pid pid,
          iv.memory memory,
          iv.cpuUser cpuUser,
          iv.cpuSystem cpuSystem,
          iv.timestamp timestamp
        FROM insert_values iv
        JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
        JOIN webknossos.voxelytics_chunks c ON c._task = t._id AND c.executionId = iv.executionId AND c.chunkName = iv.chunkName
        ON CONFLICT (_chunk, timestamp)
           DO UPDATE SET
             hostname = EXCLUDED.hostname,
             pid = EXCLUDED.pid,
             memory = EXCLUDED.memory,
             cpuUser = EXCLUDED.cpuUser,
             cpuSystem = EXCLUDED.cpuSystem
        """.asUpdate)
    } yield ()

  def upsertRunHeartbeatEvents(runId: ObjectId, events: List[RunHeartbeatEvent]): Fox[Unit] =
    for {
      _ <- run(q"""
        INSERT INTO webknossos.voxelytics_runHeartbeatEvents (_run, timestamp)
        VALUES ${SqlToken.tupleList(events.map(ev => List(runId, ev.timestamp)))}
        ON CONFLICT (_run)
          DO UPDATE SET timestamp = EXCLUDED.timestamp
        """.asUpdate)
    } yield ()

  def upsertChunkStateChangeEvents(runId: ObjectId, events: List[ChunkStateChangeEvent]): Fox[Unit] =
    for {
      _ <- run(q"""
        WITH insert_values(_run, taskName, _chunk, executionId, chunkName) AS (
          VALUES ${SqlToken.tupleList(
        events
          .map(ev => (runId, ev.taskName, ev.executionId, ev.chunkName))
          .distinct
          .map(ev => List(ev._1, ev._2, ObjectId.generate, ev._3, ev._4)))}
        )
        INSERT INTO webknossos.voxelytics_chunks (_id, _task, executionId, chunkName)
        SELECT iv._chunk _id, t._id _task, iv.executionId executionId, iv.chunkName chunkName
        FROM insert_values iv
        JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
        ON CONFLICT (_task, executionId, chunkName) DO NOTHING
        """.asUpdate)
      _ <- run(q"""
        WITH insert_values(_run, taskName, executionId, chunkName, timestamp, state) AS (
          VALUES ${SqlToken.tupleList(
        events.map(ev => List(runId.id, ev.taskName, ev.executionId, ev.chunkName, ev.timestamp, ev.state)))}
        )
        INSERT INTO webknossos.voxelytics_chunkStateChangeEvents (_chunk, timestamp, state)
        SELECT c._id _chunk, iv.timestamp timestamp, iv.state::webknossos.voxelytics_run_state state
        FROM insert_values iv
        JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
        JOIN webknossos.voxelytics_chunks c ON c._task = t._id AND c.executionId = iv.executionId AND c.chunkName = iv.chunkName
        ON CONFLICT (_chunk, timestamp)
          DO UPDATE SET state = EXCLUDED.state
        """.asUpdate)
    } yield ()

  def upsertTaskStateChangeEvents(runId: ObjectId, events: List[TaskStateChangeEvent]): Fox[Unit] =
    for {
      _ <- run(q"""
        WITH insert_values(_run, taskName, timestamp, state) AS (
          VALUES ${SqlToken.tupleList(events.map(ev => List(runId, ev.taskName, ev.timestamp, ev.state)))}
        )
        INSERT INTO webknossos.voxelytics_taskStateChangeEvents (_task, timestamp, state)
        SELECT t._id _task, iv.timestamp timestamp, iv.state::webknossos.voxelytics_run_state state
        FROM insert_values iv
        JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
        ON CONFLICT (_task, timestamp)
          DO UPDATE SET state = EXCLUDED.state
        """.asUpdate)
    } yield ()

  def upsertRunStateChangeEvents(runId: ObjectId, events: List[RunStateChangeEvent]): Fox[Unit] =
    for {
      _ <- run(q"""
        INSERT INTO webknossos.voxelytics_runStateChangeEvents (_run, timestamp, state)
        VALUES ${SqlToken.tupleList(events.map(ev => List(runId, ev.timestamp, ev.state)))}
        ON CONFLICT (_run, timestamp)
          DO UPDATE SET state = EXCLUDED.state
        """.asUpdate)
    } yield ()

  def upsertWorkflow(hash: String, name: String, organizationId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""
        INSERT INTO webknossos.voxelytics_workflows (hash, name, _organization)
        VALUES ${SqlToken.tuple(List(hash, name, organizationId))}
        ON CONFLICT (_organization, hash)
          DO UPDATE SET name = EXCLUDED.name
        """.asUpdate)
    } yield ()

  def upsertRun(organizationId: ObjectId,
                userId: ObjectId,
                name: String,
                username: String,
                hostname: String,
                voxelyticsVersion: String,
                workflow_hash: String,
                workflow_yamlContent: Option[String],
                workflow_config: JsValue): Fox[ObjectId] =
    for {
      _ <- run(q"""
        INSERT INTO webknossos.voxelytics_runs (_id, _organization, _user, name, username, hostname, voxelyticsVersion, workflow_hash, workflow_yamlContent, workflow_config)
        VALUES ${SqlToken.tuple(
        List(ObjectId.generate,
             organizationId,
             userId,
             name,
             username,
             hostname,
             voxelyticsVersion,
             workflow_hash,
             workflow_yamlContent,
             workflow_config))}
        ON CONFLICT (_organization, name)
          DO UPDATE SET
            _user = EXCLUDED._user,
            username = EXCLUDED.username,
            hostname = EXCLUDED.hostname,
            voxelyticsVersion = EXCLUDED.voxelyticsVersion,
            workflow_hash = EXCLUDED.workflow_hash,
            workflow_yamlContent = EXCLUDED.workflow_yamlContent,
            workflow_config = EXCLUDED.workflow_config
        """.asUpdate)
      objectIdList <- run(q"""
        SELECT _id
        FROM webknossos.voxelytics_runs
        WHERE _organization = $organizationId AND name = $name
        """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)

  def upsertTask(runId: ObjectId, name: String, task: String, config: JsValue): Fox[ObjectId] =
    for {
      _ <- run(q"""
        INSERT INTO webknossos.voxelytics_tasks (_id, _run, name, task, config)
        VALUES ${SqlToken.tuple(List(ObjectId.generate, runId, name, task, config))}
        ON CONFLICT (_run, name)
          DO UPDATE SET
            task = EXCLUDED.task,
            config = EXCLUDED.config
        """.asUpdate)
      objectIdList <- run(q"""
        SELECT _id
        FROM webknossos.voxelytics_tasks
        WHERE _run = $runId AND name = $name
        """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)

  def upsertArtifact(taskId: ObjectId,
                     name: String,
                     path: String,
                     fileSize: Long,
                     inodeCount: Long,
                     version: String,
                     metadata: JsValue): Fox[ObjectId] =
    for {
      _ <- run(q"""
        INSERT INTO webknossos.voxelytics_artifacts (_id, _task, name, path, fileSize, inodeCount, version, metadata)
        VALUES ${SqlToken.tuple(List(ObjectId.generate, taskId, name, path, fileSize, inodeCount, version, metadata))}
        ON CONFLICT (_task, name)
          DO UPDATE SET
            path = EXCLUDED.path,
            fileSize = EXCLUDED.fileSize,
            inodeCount = EXCLUDED.inodeCount,
            version = EXCLUDED.version,
            metadata = EXCLUDED.metadata
        """.asUpdate)
      objectIdList <- run(q"""
        SELECT _id
        FROM webknossos.voxelytics_artifacts
        WHERE _task = $taskId AND name = $name
        """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)

  def upsertArtifacts(runId: ObjectId, artifacts: List[(String, String, WorkflowDescriptionArtifact)]): Fox[Unit] =
    for {
      _ <- run(q"""
        WITH insert_values(_run, _id, taskName, artifactName, path, fileSize, inodeCount, version, metadata) AS (
          VALUES ${SqlToken.tupleList(
        artifacts.map(
          ev =>
            List(runId,
                 ObjectId.generate,
                 ev._1,
                 ev._2,
                 ev._3.path,
                 ev._3.file_size,
                 ev._3.inode_count,
                 ev._3.version,
                 ev._3.metadataAsJson)))}
        )
        INSERT INTO webknossos.voxelytics_artifacts (_id, _task, name, path, fileSize, inodeCount, version, metadata)
        SELECT
          iv._id _id,
          t._id _task,
          iv.artifactName name,
          iv.path path,
          iv.fileSize fileSize,
          iv.inodeCount inodeCount,
          iv.version version,
          iv.metadata metadata
        FROM insert_values iv
        JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
        ON CONFLICT (_task, name)
          DO UPDATE SET
            path = EXCLUDED.path,
            fileSize = EXCLUDED.fileSize,
            inodeCount = EXCLUDED.inodeCount,
            version = EXCLUDED.version,
            metadata = EXCLUDED.metadata
        """.asUpdate)
    } yield ()

}
