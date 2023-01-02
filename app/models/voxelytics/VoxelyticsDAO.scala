package models.voxelytics

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import models.user.User
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import utils.{ObjectId, SQLClient, SimpleSQLDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.Duration

class VoxelyticsDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

  def findArtifacts(runIds: List[ObjectId]): Fox[List[ArtifactEntry]] =
    for {
      r <- run(sql"""
        WITH latest_complete_tasks AS (#${latestCompleteTaskQ(runIds)})
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
          ArtifactEntry(ObjectId(row._1),
                        ObjectId(row._2),
                        row._3,
                        row._4,
                        row._5,
                        row._6,
                        row._7,
                        Json.parse(row._8).as[JsObject],
                        row._9))

  def findTasks(runId: ObjectId): Fox[List[TaskEntry]] =
    for {
      r <- run(sql"""
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
      r.toList.map(row =>
        TaskEntry(ObjectId(row._1), ObjectId(row._2), row._3, row._4, Json.parse(row._5).as[JsObject]))

  def findWorkflowsByHashAndOrganization(organizationId: ObjectId,
                                         workflowHashes: Set[String]): Fox[List[WorkflowEntry]] =
    for {
      r <- run(sql"""
        SELECT name, hash
        FROM webknossos.voxelytics_workflows
        WHERE hash IN #${writeEscapedTuple(workflowHashes.toList)} AND _organization = $organizationId
        """.as[(String, String)])
    } yield r.toList.map(row => WorkflowEntry(row._1, row._2, organizationId))

  def findWorkflowByHashAndOrganization(organizationId: ObjectId, workflowHash: String): Fox[WorkflowEntry] =
    for {
      r <- run(sql"""
        SELECT name, hash
        FROM webknossos.voxelytics_workflows
        WHERE hash = $workflowHash AND _organization = $organizationId
        """.as[(String, String)])
      (name, hash) <- r.headOption
    } yield WorkflowEntry(name, hash, organizationId)

  def findWorkflowByHash(workflowHash: String): Fox[WorkflowEntry] =
    for {
      r <- run(sql"""
        SELECT name, hash, _organization
        FROM webknossos.voxelytics_workflows
        WHERE hash = $workflowHash
        """.as[(String, String, String)])
      (name, hash, organizationId) <- r.headOption // Could have multiple entries; picking the first.
    } yield WorkflowEntry(name, hash, ObjectId(organizationId))

  def findTaskRuns(runIds: List[ObjectId], staleTimeout: Duration): Fox[List[TaskRunEntry]] =
    for {
      r <- run(
        sql"""
        WITH latest_chunk_states AS (#${latestChunkStatesQ(runIds)})
        SELECT
          r.name AS runName,
          r._id AS runId,
          t._id AS taskId,
          t.name AS taskName,
          CASE
            WHEN task_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - INTERVAL '#${staleTimeout.toSeconds} SECONDS'
            THEN 'STALE' ELSE task_state.state END AS state,
          task_begin.timestamp AS beginTime,
          CASE
            WHEN task_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - INTERVAL '#${staleTimeout.toSeconds} SECONDS'
            THEN run_heartbeat.timestamp ELSE task_end.timestamp END AS endTime,
          exec.executionId AS currentExecutionId,
          COALESCE(chunks.total, 0) AS chunksTotal,
          COALESCE(chunks.skipped, 0) AS chunksSkipped,
          COALESCE(chunks.finished, 0) AS chunksFinished
        FROM webknossos.voxelytics_runs r
        JOIN webknossos.voxelytics_tasks t ON t._run = r._id
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
          ON t._id = task_end._task
        LEFT JOIN (
          SELECT _run, timestamp
          FROM webknossos.voxelytics_runHeartbeatEvents
        ) run_heartbeat
          ON r._id = run_heartbeat._run
        LEFT JOIN (
          SELECT DISTINCT ON (c._task) c._task, c.executionId
          FROM latest_chunk_states
          JOIN webknossos.voxelytics_chunks c ON c._id = latest_chunk_states._chunk
          WHERE latest_chunk_states.state = 'RUNNING'
          ORDER BY c._task, latest_chunk_states.timestamp DESC
        ) exec ON exec._task = t._id
        LEFT JOIN (
          SELECT
            c._task AS _task,
            COUNT(c._id) AS total,
            SUM(CASE WHEN l.state IN ('COMPLETE', 'FAILED', 'CANCELLED') THEN 1 ELSE 0 END) AS finished,
            SUM(CASE WHEN l.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped
          FROM webknossos.voxelytics_chunks c
          JOIN latest_chunk_states l ON l._chunk = c._id
          GROUP BY c._task
        ) chunks ON chunks._task = t._id
        WHERE
          r._id IN #${writeEscapedTuple(runIds.map(_.id))}
        """.as[
          (String, String, String, String, String, Option[Instant], Option[Instant], Option[String], Long, Long, Long)])
      results <- Fox.combined(
        r.toList.map(
          row =>
            for {
              state <- VoxelyticsRunState.fromString(row._5).toFox
            } yield
              TaskRunEntry(
                runName = row._1,
                runId = ObjectId(row._2),
                taskId = ObjectId(row._3),
                taskName = row._4,
                state = state,
                beginTime = row._6,
                endTime = row._7,
                currentExecutionId = row._8,
                chunksTotal = row._9,
                chunksSkipped = row._10,
                chunksFinished = row._11
            )))
    } yield results

  def findRuns(currentUser: User,
               runIds: Option[List[ObjectId]],
               workflowHash: Option[String],
               staleTimeout: Duration,
               allowUnlisted: Boolean): Fox[List[RunEntry]] = {
    val runIdsQ = runIds.map(runIds => s" AND r._id IN ${writeEscapedTuple(runIds.map(_.id))}").getOrElse("")
    val workflowHashQ =
      workflowHash.map(workflowHash => s" AND r.workflow_hash = ${escapeLiteral(workflowHash)}").getOrElse("")
    for {
      r <- run(sql"""
        SELECT
          r._id,
          r.name,
          r.username,
          r.hostname,
          r.voxelyticsVersion,
          r.workflow_hash,
          r.workflow_yamlContent,
          r.workflow_config,
          CASE
            WHEN run_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - INTERVAL '#${staleTimeout.toSeconds} SECONDS'
            THEN 'STALE' ELSE run_state.state END AS state,
          run_begin.timestamp AS beginTime,
          CASE
            WHEN run_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - INTERVAL '#${staleTimeout.toSeconds} SECONDS'
            THEN run_heartbeat.timestamp ELSE run_end.timestamp END AS endTime
        FROM (#${visibleRunsQ(currentUser, allowUnlisted)}) r
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
          ON r._id = run_heartbeat._run
        WHERE TRUE
          #$runIdsQ
          #$workflowHashQ
        """.as[(String, String, String, String, String, String, String, String, String, Instant, Option[Instant])])
      results <- Fox.combined(
        r.toList.map(
          row =>
            for {
              state <- VoxelyticsRunState.fromString(row._9).toFox
            } yield
              RunEntry(
                ObjectId(row._1),
                row._2,
                row._3,
                row._4,
                row._5,
                row._6,
                row._7,
                Json.parse(row._8).as[JsObject],
                state,
                row._10,
                row._11
            )))
    } yield results

  }

  private def visibleRunsQ(currentUser: User, allowUnlisted: Boolean) = {
    val organizationId = currentUser._organization
    val readAccessQ =
      if (currentUser.isAdmin || allowUnlisted) "TRUE"
      else s"(__r._user = ${escapeLiteral(currentUser._id.id)})"
    s"""
       SELECT __r.*
       FROM webknossos.voxelytics_runs __r
       WHERE $readAccessQ AND __r._organization = ${escapeLiteral(organizationId.id)}
    """
  }

  private def latestChunkStatesQ(runIds: List[ObjectId]) =
    s"""
      SELECT
        DISTINCT ON (t.name, c.executionId, c.chunkName)
        t.name taskName,
        c.executionId executionId,
        c.chunkName chunkName,
        t._id _task,
        c._id _chunk,
        chunk_state.timestamp timestamp,
        chunk_state.state state
      FROM webknossos.voxelytics_chunkStateChangeEvents chunk_state
      JOIN webknossos.voxelytics_chunks c ON c._id = chunk_state._chunk
      JOIN webknossos.voxelytics_tasks t ON t._id = c._task
      WHERE
        chunk_state.state NOT IN ('SKIPPED', 'PENDING')
        AND t._run IN ${writeEscapedTuple(runIds.map(_.id))}
      ORDER BY t.name, c.executionId, c.chunkName, chunk_state.timestamp DESC
    """

  private def latestRunningChunkStatesQ(runIds: List[ObjectId], taskName: String) =
    s"""
      SELECT
        DISTINCT ON (t.name, c.executionId, c.chunkName)
        t.name taskName,
        c.executionId executionId,
        c.chunkName chunkName,
        t._id _task,
        c._id _chunk,
        chunk_state.timestamp timestamp,
        chunk_state.state state
      FROM webknossos.voxelytics_chunkStateChangeEvents chunk_state
      JOIN webknossos.voxelytics_chunks c ON c._id = chunk_state._chunk
      JOIN webknossos.voxelytics_tasks t ON t._id = c._task
      WHERE
        chunk_state.state NOT IN ('SKIPPED', 'PENDING')
        AND t._run IN ${writeEscapedTuple(runIds.map(_.id))}
        AND t.name = ${escapeLiteral(taskName)}
      ORDER BY t.name, c.executionId, c.chunkName, chunk_state.timestamp DESC
    """

  private def latestCompleteTaskQ(runIds: List[ObjectId], taskName: Option[String] = None) =
    s"""
      SELECT
        DISTINCT ON (t.name)
        t.name name,
        t._id _task
      FROM webknossos.voxelytics_taskStateChangeEvents task_state
      JOIN webknossos.voxelytics_tasks t ON t._id = task_state._task
      WHERE
        task_state.state = 'COMPLETE'
        AND t._run IN ${writeEscapedTuple(runIds.map(_.id))}
        ${taskName.map(t => s" AND t.name = ${escapeLiteral(t)}").getOrElse("")}
      ORDER BY t.name, task_state.timestamp DESC
    """

  def findWorkflowTaskStatistics(currentUser: User, workflowHashes: Set[String]): Fox[Map[String, TaskStatistics]] = {
    val organizationId = currentUser._organization
    for {
      r <- run(sql"""
        WITH latest_task_states AS (
          SELECT DISTINCT ON (_task) _task, timestamp, state
          FROM webknossos.voxelytics_taskStateChangeEvents
          ORDER BY _task, timestamp DESC
        )
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
          SELECT
            COALESCE(latest_finished_or_running_task_instances.taskName, latest_task_instances.taskName) taskName,
            COALESCE(latest_finished_or_running_task_instances.runName, latest_task_instances.runName) runName,
            COALESCE(latest_finished_or_running_task_instances.state, latest_task_instances.state) state,
            w.hash hash
          FROM webknossos.voxelytics_workflows w
          JOIN (
            SELECT DISTINCT ON (workflow_hash, taskName) r.workflow_hash workflow_hash, r.name runName, t.name taskName, timestamp, state
            FROM webknossos.voxelytics_tasks t
            JOIN (#${visibleRunsQ(currentUser, false)}) r ON t._run = r._id
            JOIN latest_task_states l ON l._task = t._id
            ORDER BY workflow_hash, taskName, timestamp DESC
          ) latest_task_instances ON latest_task_instances.workflow_hash = w.hash
          LEFT JOIN (
            SELECT DISTINCT ON (workflow_hash, taskName) r.workflow_hash workflow_hash, r.name runName, t.name taskName, timestamp, state
            FROM webknossos.voxelytics_tasks t
            JOIN (#${visibleRunsQ(currentUser, false)}) r ON t._run = r._id
            JOIN latest_task_states l ON l._task = t._id
            WHERE l.state IN ('RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED')
            ORDER BY workflow_hash, taskName, timestamp DESC
          ) latest_finished_or_running_task_instances ON latest_finished_or_running_task_instances.workflow_hash = w.hash AND latest_task_instances.taskName = latest_finished_or_running_task_instances.taskName
        ) t ON t.hash = w.hash
        WHERE w.hash IN #${writeEscapedTuple(workflowHashes.toList)} AND w._organization = $organizationId
        GROUP BY w.hash
        """.as[(String, Int, Int, Int, Int, Int)])
    } yield
      r.toList
        .map(
          row =>
            (row._1,
             TaskStatistics(total = row._2, failed = row._3, skipped = row._4, complete = row._5, cancelled = row._6)))
        .toMap
  }

  def findRunsForWorkflowListing(currentUser: User, staleTimeout: Duration): Fox[List[WorkflowListingRunEntry]] = {
    val organizationId = currentUser._organization
    for {
      r <- run(
        sql"""
        WITH latest_task_states AS (
          SELECT DISTINCT ON (_task) _task, timestamp, state
          FROM webknossos.voxelytics_taskStateChangeEvents
          ORDER BY _task, timestamp DESC
        )
        SELECT
          r._id,
          r.name,
          r.username,
          r.hostname,
          r.voxelyticsVersion,
          r.workflow_hash,
          CASE
            WHEN run_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - INTERVAL '#${staleTimeout.toSeconds} SECONDS'
            THEN 'STALE' ELSE run_state.state END AS state,
          run_begin.timestamp AS beginTime,
          CASE
            WHEN run_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - INTERVAL '#${staleTimeout.toSeconds} SECONDS'
            THEN run_heartbeat.timestamp ELSE run_end.timestamp END AS endTime,
          COALESCE(tasks.total, 0) AS tasksTotal,
          COALESCE(tasks.failed, 0) AS tasksFailed,
          COALESCE(tasks.skipped, 0) AS tasksSkipped,
          COALESCE(tasks.complete, 0) AS tasksComplete,
          COALESCE(tasks.cancelled, 0) AS tasksCancelled
        FROM (#${visibleRunsQ(currentUser, false)}) r
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
          ON r._id = run_heartbeat._run
        LEFT JOIN (
          SELECT
            t._run AS _run,
            COUNT(t._id) AS total,
            SUM(CASE WHEN l.state = 'FAILED' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN l.state = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN l.state = 'COMPLETE' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN l.state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
          FROM webknossos.voxelytics_tasks AS t
          JOIN latest_task_states l ON l._task = t._id
          GROUP BY t._run
        ) tasks ON tasks._run = r._id
        WHERE r._organization = $organizationId
        """.as[
          (String, String, String, String, String, String, String, Instant, Option[Instant], Int, Int, Int, Int, Int)])
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
      if (currentUser.isAdmin) "TRUE"
      else s"._user = ${escapeLiteral(currentUser._id.id)}"
    for {
      objectIdList <- run(sql"""
           SELECT _id
           FROM webknossos.voxelytics_runs
           WHERE
            name = $runName AND
            workflow_hash = $workflowHash AND
            _organization = ${currentUser._organization} AND
            #${readAccessQ}
           """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)
  }

  def getRunNameById(runId: ObjectId, organizationId: ObjectId): Fox[String] =
    for {
      nameList <- run(sql"""SELECT name
           FROM webknossos.voxelytics_runs
           WHERE _id = $runId AND _organization = $organizationId
           """.as[String])
      name <- nameList.headOption
    } yield name

  def getUserIdForRun(runId: ObjectId): Fox[ObjectId] =
    for {
      userIdList <- run(sql"""
         SELECT _user
         FROM webknossos.voxelytics_runs
         WHERE _id = $runId
         """.as[String])
      userId <- userIdList.headOption
    } yield ObjectId(userId)

  def getUserIdForRunOpt(runName: String, organizationId: ObjectId): Fox[Option[ObjectId]] =
    for {
      userId <- run(sql"""
       SELECT _user
       FROM webknossos.voxelytics_runs
       WHERE name = $runName AND _organization = $organizationId
       """.as[String])
    } yield userId.headOption.map(ObjectId(_))

  def getTaskIdByName(taskName: String, runId: ObjectId): Fox[ObjectId] =
    for {
      objectIdList <- run(sql"""SELECT _id
             FROM webknossos.voxelytics_tasks
             WHERE _run = $runId AND name = $taskName
             """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)

  def getArtifactIdByName(taskId: ObjectId, artifactName: String): Fox[ObjectId] =
    for {
      objectIdList <- run(sql"""SELECT _id
               FROM webknossos.voxelytics_artifacts
               WHERE _task = $taskId AND name = $artifactName
               """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)

  def getChunkStatistics(runIds: List[ObjectId], taskName: String): Fox[List[ChunkStatisticsEntry]] = {
    for {
      r <- run(
        sql"""
          WITH latest_chunk_states AS (#${latestRunningChunkStatesQ(runIds, taskName)})
          SELECT
            exec.executionId AS executionId,
            exec.countTotal AS countTotal,
            exec.countFinished AS countFinished,
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
                SUM(CASE WHEN c.state IN ('COMPLETE', 'FAILED', 'CANCELLED') THEN 1 ELSE 0 END) AS countFinished
              FROM latest_chunk_states c
              GROUP BY c.executionId
            ) exec
          LEFT JOIN ( -- Wall clock times
            SELECT
              c.executionId,
              SUM(c.wallTime) AS wallTime,
              MIN(c.beginTime) AS beginTime,
              MAX(c.endTime) AS endTime
            FROM (
              SELECT
                c.executionId,
                MIN(chunk_events.timestamp) AS beginTime,
                MAX(chunk_events.timestamp) AS endTime,
                EXTRACT(epoch FROM MAX(chunk_events.timestamp) - MIN(chunk_events.timestamp)) wallTime
              FROM webknossos.voxelytics_chunkStateChangeEvents chunk_events
              JOIN latest_chunk_states c ON c._chunk = chunk_events._chunk
              GROUP BY c.executionId, c._task
            ) c
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
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (EXTRACT(epoch FROM c_end.timestamp - c_begin.timestamp))) AS median_duration,
              MAX(EXTRACT(epoch FROM c_end.timestamp - c_begin.timestamp)) AS max_duration,
              STDDEV(EXTRACT(epoch FROM c_end.timestamp - c_begin.timestamp)) AS stddev_duration,
              SUM(EXTRACT(epoch FROM c_end.timestamp - c_begin.timestamp)) AS sum_duration
            FROM latest_chunk_states c
            JOIN (
              SELECT DISTINCT ON (_chunk) _chunk, timestamp
              FROM webknossos.voxelytics_chunkStateChangeEvents
              WHERE state = 'RUNNING'
              ORDER BY _chunk, timestamp
            ) c_begin ON c_begin._chunk = c._chunk
            JOIN (
              SELECT DISTINCT ON (_chunk) _chunk, timestamp
              FROM webknossos.voxelytics_chunkStateChangeEvents
              WHERE state = 'COMPLETE'
              ORDER BY _chunk, timestamp
            ) c_end ON c_end._chunk = c._chunk
            GROUP BY c.executionId
          ) durations ON durations.executionId = exec.executionId
          ORDER BY times.beginTime ASC NULLS LAST
          """.as[
          (String,
           Int,
           Int,
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
            countTotal = row._2,
            countFinished = row._3,
            beginTime = row._4,
            endTime = row._5,
            wallTime = row._6,
            memory = StatisticsEntry(max = row._7, median = row._8, stddev = row._9),
            cpuUser = StatisticsEntry(max = row._10, median = row._11, stddev = row._12),
            cpuSystem = StatisticsEntry(max = row._13, median = row._14, stddev = row._15),
            duration = StatisticsEntry(max = row._16, median = row._17, stddev = row._18, sum = Some(row._19))
        ))
  }

  def getArtifactChecksums(runIds: List[ObjectId],
                           taskName: String,
                           artifactName: Option[String]): Fox[List[ArtifactChecksumEntry]] =
    for {
      r <- run(sql"""
        WITH latest_complete_tasks AS (#${latestCompleteTaskQ(runIds, Some(taskName))})
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
        WHERE #${artifactName.map(a => s"a.name = ${escapeLiteral(a)}").getOrElse("")}
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

  def upsertArtifactChecksumEvent(artifactId: ObjectId, ev: ArtifactFileChecksumEvent): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""INSERT INTO webknossos.voxelytics_artifactFileChecksumEvents (_artifact, path, resolvedPath, checksumMethod, checksum, fileSize, lastModified, timestamp)
             VALUES ($artifactId, ${ev.path}, ${ev.resolvedPath}, ${ev.checksumMethod}, ${ev.checksum}, ${ev.fileSize}, ${ev.lastModified}, ${ev.timestamp})
             ON CONFLICT (_artifact, path, timestamp)
               DO UPDATE SET
                 resolvedPath = EXCLUDED.resolvedPath,
                 checksumMethod = EXCLUDED.checksumMethod,
                 checksum = EXCLUDED.checksum,
                 fileSize = EXCLUDED.fileSize,
                 lastModified = EXCLUDED.lastModified
             """)
    } yield ()

  def upsertChunkProfilingEvents(runId: ObjectId, events: List[ChunkProfilingEvent]): Fox[Unit] =
    for {
      _ <- run(sqlu"""
      WITH insert_values(_run, taskName, executionId, chunkName, hostname, pid, memory, cpuUser, cpuSystem, timestamp) AS (
        VALUES #${events
        .map(ev =>
          s"(${escapeLiteral(runId)}, ${escapeLiteral(ev.taskName)}, ${escapeLiteral(ev.executionId)}, ${escapeLiteral(
            ev.chunkName)}, ${escapeLiteral(ev.hostname)}, ${ev.pid}, ${ev.memory}, ${ev.cpuUser}, ${ev.cpuSystem}, ${escapeLiteral(
            ev.timestamp)})")
        .mkString(", ")}
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
       """)
    } yield ()

  def upsertRunHeartbeatEvents(runId: ObjectId, events: List[RunHeartbeatEvent]): Fox[Unit] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_runHeartbeatEvents (_run, timestamp)
                   VALUES #${events
        .map(ev => s"(${escapeLiteral(runId)}, ${escapeLiteral(ev.timestamp)})")
        .mkString(",")}
                   ON CONFLICT (_run)
                     DO UPDATE SET timestamp = EXCLUDED.timestamp
                   """)
    } yield ()

  def upsertChunkStateChangeEvents(runId: ObjectId, events: List[ChunkStateChangeEvent]): Fox[Unit] =
    for {
      _ <- run(sqlu"""
      WITH insert_values(_run, taskName, _chunk, executionId, chunkName) AS (
        VALUES #${events
        .map(ev => (runId, ev.taskName, ev.executionId, ev.chunkName))
        .distinct
        .map(ev =>
          s"(${escapeLiteral(ev._1)}, ${escapeLiteral(ev._2)}, ${escapeLiteral(ObjectId.generate)}, ${escapeLiteral(
            ev._3)}, ${escapeLiteral(ev._4)})")
        .mkString(",")}
      )
      INSERT INTO webknossos.voxelytics_chunks (_id, _task, executionId, chunkName)
      SELECT iv._chunk _id, t._id _task, iv.executionId executionId, iv.chunkName chunkName
      FROM insert_values iv
      JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
      ON CONFLICT (_task, executionId, chunkName) DO NOTHING
      """)
      _ <- run(sqlu"""
      WITH insert_values(_run, taskName, executionId, chunkName, timestamp, state) AS (
        VALUES #${events
        .map(ev =>
          s"(${escapeLiteral(runId.id)}, ${escapeLiteral(ev.taskName)}, ${escapeLiteral(ev.executionId)}, ${escapeLiteral(
            ev.chunkName)}, ${escapeLiteral(ev.timestamp)}, ${escapeLiteral(ev.state.toString)}::webknossos.VOXELYTICS_RUN_STATE)")
        .mkString(", ")}
      )
      INSERT INTO webknossos.voxelytics_chunkStateChangeEvents (_chunk, timestamp, state)
      SELECT c._id _chunk, iv.timestamp timestamp, iv.state state
      FROM insert_values iv
      JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
      JOIN webknossos.voxelytics_chunks c ON c._task = t._id AND c.executionId = iv.executionId AND c.chunkName = iv.chunkName
      ON CONFLICT (_chunk, timestamp)
        DO UPDATE SET state = EXCLUDED.state
      """)
    } yield ()

  def upsertTaskStateChangeEvents(runId: ObjectId, events: List[TaskStateChangeEvent]): Fox[Unit] =
    for {
      _ <- run(sqlu"""
      WITH insert_values(_run, taskName, timestamp, state) AS (
        VALUES #${events
        .map(ev =>
          s"(${escapeLiteral(runId)}, ${escapeLiteral(ev.taskName)}, ${escapeLiteral(ev.timestamp)}, ${escapeLiteral(
            ev.state.toString)}::webknossos.VOXELYTICS_RUN_STATE)")
        .mkString(",")}
      )
      INSERT INTO webknossos.voxelytics_taskStateChangeEvents (_task, timestamp, state)
      SELECT t._id _task, iv.timestamp timestamp, iv.state state
      FROM insert_values iv
      JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
      ON CONFLICT (_task, timestamp)
        DO UPDATE SET state = EXCLUDED.state
      """)
    } yield ()

  def upsertRunStateChangeEvents(runId: ObjectId, events: List[RunStateChangeEvent]): Fox[Unit] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_runStateChangeEvents (_run, timestamp, state)
              VALUES #${events
        .map(ev =>
          s"(${escapeLiteral(runId)}, ${escapeLiteral(ev.timestamp)}, ${escapeLiteral(ev.state.toString)}::webknossos.VOXELYTICS_RUN_STATE)")
        .mkString(",")}
              ON CONFLICT (_run, timestamp)
                DO UPDATE SET state = EXCLUDED.state
              """)
    } yield ()

  def upsertWorkflow(hash: String, name: String, organizationId: ObjectId): Fox[Unit] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_workflows (hash, name, _organization)
              VALUES ($hash, $name, $organizationId)
              ON CONFLICT (_organization, hash)
                DO UPDATE SET name = EXCLUDED.name
              """)
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
      _ <- run(
        sqlu"""INSERT INTO webknossos.voxelytics_runs (_id, _organization, _user, name, username, hostname, voxelyticsVersion, workflow_hash, workflow_yamlContent, workflow_config)
              VALUES (${ObjectId.generate}, $organizationId, $userId, $name, $username, $hostname, $voxelyticsVersion, $workflow_hash, $workflow_yamlContent, ${Json
          .stringify(workflow_config)}::JSONB)
              ON CONFLICT (_organization, name)
                DO UPDATE SET
                  _user = EXCLUDED._user,
                  username = EXCLUDED.username,
                  hostname = EXCLUDED.hostname,
                  voxelyticsVersion = EXCLUDED.voxelyticsVersion,
                  workflow_hash = EXCLUDED.workflow_hash,
                  workflow_yamlContent = EXCLUDED.workflow_yamlContent,
                  workflow_config = EXCLUDED.workflow_config
              """)
      objectIdList <- run(sql"""SELECT _id
           FROM webknossos.voxelytics_runs
           WHERE _organization = $organizationId AND name = $name
           """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)

  def upsertTask(runId: ObjectId, name: String, task: String, config: JsValue): Fox[ObjectId] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_tasks (_id, _run, name, task, config)
              VALUES (${ObjectId.generate}, $runId, $name, $task, ${Json.stringify(config)}::JSONB)
              ON CONFLICT (_run, name)
                DO UPDATE SET
                  task = EXCLUDED.task,
                  config = EXCLUDED.config
              """)
      objectIdList <- run(sql"""SELECT _id
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
      _ <- run(
        sqlu"""INSERT INTO webknossos.voxelytics_artifacts (_id, _task, name, path, fileSize, inodeCount, version, metadata)
              VALUES (${ObjectId.generate}, $taskId, $name, $path, $fileSize, $inodeCount, $version, ${Json.stringify(
          metadata)}::JSONB)
              ON CONFLICT (_task, name)
                DO UPDATE SET
                  path = EXCLUDED.path,
                  fileSize = EXCLUDED.fileSize,
                  inodeCount = EXCLUDED.inodeCount,
                  version = EXCLUDED.version,
                  metadata = EXCLUDED.metadata
              """)
      objectIdList <- run(sql"""SELECT _id
           FROM webknossos.voxelytics_artifacts
           WHERE _task = $taskId AND name = $name
           """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)

  def upsertArtifacts(runId: ObjectId, artifacts: List[(String, String, WorkflowDescriptionArtifact)]): Fox[Unit] =
    for {
      _ <- run(sqlu"""
      WITH insert_values(_run, _id, taskName, artifactName, path, fileSize, inodeCount, version, metadata) AS (
        VALUES #${artifacts
        .map(ev =>
          s"(${escapeLiteral(runId)}, ${escapeLiteral(ObjectId.generate)}, ${escapeLiteral(ev._1)}, ${escapeLiteral(
            ev._2)}, ${escapeLiteral(ev._3.path)}, ${ev._3.file_size}, ${ev._3.inode_count}, ${escapeLiteral(
            ev._3.version)}, ${escapeLiteral(Json.stringify(ev._3.metadataAsJson))}::JSONB)")
        .mkString(",")}
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
      """)
    } yield ()

}
