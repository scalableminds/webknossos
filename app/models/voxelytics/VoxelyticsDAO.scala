package models.voxelytics

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import models.user.User
import play.api.libs.json._
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SimpleSQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class VoxelyticsDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

  private def runsWithStateQ(staleTimeout: FiniteDuration): SqlToken =
    q"""SELECT
          r._id,
          CASE
            WHEN r.state = ${VoxelyticsRunState.RUNNING} AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - $staleTimeout
            THEN ${VoxelyticsRunState.STALE} ELSE r.state END AS state,
          r.beginTime AS beginTime,
          CASE
            WHEN r.state = ${VoxelyticsRunState.RUNNING} AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - $staleTimeout
            THEN run_heartbeat.timestamp ELSE r.endTime END AS endTime
        FROM webknossos.voxelytics_runs r
        LEFT JOIN (
          SELECT _run, timestamp
          FROM webknossos.voxelytics_runHeartbeatEvents
        ) run_heartbeat ON r._id = run_heartbeat._run"""

  private def tasksWithStateQ(staleTimeout: FiniteDuration): SqlToken =
    q"""SELECT
          t._id,
          CASE WHEN t.state = ${VoxelyticsRunState.RUNNING} AND r.state = ${VoxelyticsRunState.STALE} THEN ${VoxelyticsRunState.STALE} ELSE t.state END AS state,
          t.beginTime AS beginTime,
          CASE WHEN t.state = ${VoxelyticsRunState.RUNNING} AND r.state = ${VoxelyticsRunState.STALE} THEN r.endTime ELSE t.endTime END AS endTime
        FROM webknossos.voxelytics_tasks t
        JOIN (${runsWithStateQ(staleTimeout)}) r ON r._id = t._run"""

  private def chunksWithStateQ(staleTimeout: FiniteDuration): SqlToken =
    q"""SELECT
          c._id,
          CASE WHEN c.state = ${VoxelyticsRunState.RUNNING} AND r.state = ${VoxelyticsRunState.STALE} THEN ${VoxelyticsRunState.STALE} ELSE c.state END AS state,
          c.beginTime AS beginTime,
          CASE WHEN c.state = ${VoxelyticsRunState.RUNNING} AND r.state = ${VoxelyticsRunState.STALE} THEN r.endTime ELSE c.endTime END AS endTime
        FROM webknossos.voxelytics_chunks c
        JOIN webknossos.voxelytics_tasks t ON t._id = c._task
        JOIN (${runsWithStateQ(staleTimeout)}) r ON r._id = t._run"""

  private def visibleRunsQ(currentUser: User, allowUnlisted: Boolean) = {
    val organizationId = currentUser._organization
    val readAccessQ =
      if (currentUser.isAdmin || currentUser.isDatasetManager || allowUnlisted) q"TRUE"
      else q"(__r._user = ${currentUser._id})"
    q"""SELECT __r.*
        FROM webknossos.voxelytics_runs __r
        WHERE $readAccessQ AND __r._organization = $organizationId"""
  }

  private def latestChunkStatesQ(runIds: List[ObjectId], taskName: Option[String], staleTimeout: FiniteDuration) =
    q"""SELECT
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
          WHERE t._run IN ${SqlToken.tupleFromList(runIds)}
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
          FROM (${chunksWithStateQ(staleTimeout)}) cs
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._id
          JOIN webknossos.voxelytics_tasks t ON t._id = c._task
          WHERE t._run IN ${SqlToken.tupleFromList(runIds)}
          ORDER BY t.name, c.executionId, c.chunkName, cs.beginTime DESC
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
          FROM (${chunksWithStateQ(staleTimeout)}) cs
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._id
          JOIN webknossos.voxelytics_tasks t ON t._id = c._task
          WHERE cs.state NOT IN ${SqlToken.tupleFromValues(VoxelyticsRunState.SKIPPED, VoxelyticsRunState.PENDING)}
            AND t._run IN ${SqlToken.tupleFromList(runIds)}
          ORDER BY t.name, c.executionId, c.chunkName, cs.beginTime DESC
        ) running_chunks ON running_chunks.name = tc.name AND running_chunks.executionId = tc.executionId AND running_chunks.chunkName = tc.chunkName
        WHERE TRUE ${taskName.map(t => q"AND tc.name = $t").getOrElse(q"")}"""

  private def latestCompleteOrSkippedTaskQ(
      runIds: List[ObjectId],
      taskName: Option[String],
      staleTimeout: FiniteDuration
  ) =
    q"""SELECT
          DISTINCT ON (t.name)
          t.name,
          t._id,
          ts.state
        FROM (${tasksWithStateQ(staleTimeout)}) ts
        JOIN webknossos.voxelytics_tasks t ON t._id = ts._id
        WHERE
          ts.state IN ${SqlToken.tupleFromValues(VoxelyticsRunState.COMPLETE, VoxelyticsRunState.SKIPPED)}
          AND t._run IN ${SqlToken.tupleFromList(runIds)}
          ${taskName.map(t => q" AND t.name = $t").getOrElse(q"")}
        ORDER BY t.name, ts.beginTime DESC"""

  def findArtifacts(currentUser: User, runIds: List[ObjectId], staleTimeout: FiniteDuration): Fox[List[ArtifactEntry]] =
    for {
      r <- run(q"""
        WITH latest_complete_tasks AS (${latestCompleteOrSkippedTaskQ(runIds, None, staleTimeout)})
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
          -- Fan out is not possible because of distinct path selection in combination with unique (_task, path) constraint
          SELECT
            DISTINCT ON (a.path)
            a.path path,
            r.workflow_hash workflow_hash,
            r._id _run
          FROM webknossos.voxelytics_artifacts a
          JOIN webknossos.voxelytics_tasks t ON a._task = t._id
          JOIN (${tasksWithStateQ(staleTimeout)}) ts ON ts._id = t._id AND ts.state = ${VoxelyticsRunState.COMPLETE}
          JOIN (${visibleRunsQ(currentUser, allowUnlisted = true)}) r ON r._id = t._run
          ORDER BY a.path, ts.beginTime DESC
        ) o ON o.path = a.path AND t.state = ${VoxelyticsRunState.SKIPPED}
        """.as[(String, String, String, String, Long, Long, String, String, String, Option[String], Option[String])])
    } yield r.toList.map(row =>
      ArtifactEntry(
        artifactId = ObjectId(row._1),
        taskId = ObjectId(row._2),
        name = row._3,
        path = row._4,
        fileSize = row._5,
        inodeCount = row._6,
        version = row._7,
        metadata = Json.parse(row._8).as[JsObject],
        taskName = row._9,
        foreignWorkflow = (row._10, row._11) match {
          case (Some(workflow_hash), Some(run)) => Some((workflow_hash, run))
          case _                                => None
        }
      )
    )

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
    } yield r.toList.map(row =>
      TaskEntry(
        taskId = ObjectId(row._1),
        runId = ObjectId(row._2),
        name = row._3,
        task = row._4,
        config = Json.parse(row._5).as[JsObject]
      )
    )

  def findWorkflowsByHashAndOrganization(
      organizationId: String,
      workflowHashes: Set[String]
  ): Fox[List[WorkflowEntry]] =
    for {
      r <- run(q"""
        SELECT name, hash
        FROM webknossos.voxelytics_workflows
        WHERE hash IN ${SqlToken.tupleFromList(workflowHashes)} AND _organization = $organizationId
        """.as[(String, String)])
    } yield r.toList.map(row => WorkflowEntry(name = row._1, hash = row._2, _organization = organizationId))

  def findWorkflowByHashAndOrganization(organizationId: String, workflowHash: String): Fox[WorkflowEntry] =
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
    } yield WorkflowEntry(name, hash, organizationId)

  def findTaskRuns(runIds: List[ObjectId], staleTimeout: FiniteDuration): Fox[List[TaskRunEntry]] =
    for {
      r <- run(
        q"""
        WITH task_states AS (
          ${tasksWithStateQ(staleTimeout)}
          WHERE t._run IN ${SqlToken.tupleFromList(runIds)} -- Filter here, because CTEs are materialized
        ),
        chunk_states AS (
          ${chunksWithStateQ(staleTimeout)}
          WHERE t._run IN ${SqlToken.tupleFromList(runIds)} -- Filter here, because CTEs are materialized
        )
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
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._id
          WHERE cs.state = ${VoxelyticsRunState.RUNNING}
          ORDER BY c._task, cs.beginTime DESC
        ) exec ON exec._task = t._id
        LEFT JOIN (
          SELECT
            c._task AS _task,
            COUNT(c._id) AS total,
            SUM(CASE WHEN cs.state = ${VoxelyticsRunState.FAILED} THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN cs.state = ${VoxelyticsRunState.SKIPPED} THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN cs.state = ${VoxelyticsRunState.COMPLETE} THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN cs.state = ${VoxelyticsRunState.CANCELLED} THEN 1 ELSE 0 END) AS cancelled
          FROM chunk_states cs
          JOIN webknossos.voxelytics_chunks c ON c._id = cs._id
          GROUP BY c._task
        ) chunks ON chunks._task = t._id
        WHERE
          r._id IN ${SqlToken.tupleFromList(runIds)}
        """.as[
          (
              String,
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
              Long
          )
        ]
      )
      results <- Fox.combined(
        r.toList.map(row =>
          for {
            state <- VoxelyticsRunState.fromString(row._5).toFox
          } yield TaskRunEntry(
            runId = ObjectId(row._1),
            runName = row._2,
            taskId = ObjectId(row._3),
            taskName = row._4,
            state = state,
            beginTime = row._6,
            endTime = row._7,
            currentExecutionId = row._8,
            chunkCounts =
              ChunkCounts(total = row._9, failed = row._10, skipped = row._11, complete = row._12, cancelled = row._13)
          )
        )
      )
    } yield results

  def findCombinedTaskRuns(runIds: List[ObjectId], staleTimeout: FiniteDuration): Fox[List[CombinedTaskRunEntry]] =
    for {
      r <- run(q"""
        WITH latest_chunk_states AS (${latestChunkStatesQ(runIds, None, staleTimeout)})
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
          SELECT DISTINCT ON (l.taskName) l.taskName, l.executionId
          FROM latest_chunk_states l
          WHERE l.state = ${VoxelyticsRunState.RUNNING}
          ORDER BY l.taskName, l.beginTime DESC
        ) exec ON exec.taskName = l.taskName
        LEFT JOIN (
          SELECT
            l.taskName AS taskName,
            COUNT(l.state) AS total,
            SUM(CASE WHEN l.state = ${VoxelyticsRunState.FAILED} THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN l.state = ${VoxelyticsRunState.SKIPPED} THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN l.state = ${VoxelyticsRunState.COMPLETE} THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN l.state = ${VoxelyticsRunState.CANCELLED} THEN 1 ELSE 0 END) AS cancelled
          FROM latest_chunk_states l
          GROUP BY l.taskName
        ) chunks ON chunks.taskName = l.taskName
        """.as[(String, Option[String], Long, Long, Long, Long, Long)])
    } yield r.toList.map(row =>
      CombinedTaskRunEntry(
        taskName = row._1,
        currentExecutionId = row._2,
        chunkCounts =
          ChunkCounts(total = row._3, failed = row._4, skipped = row._5, complete = row._6, cancelled = row._7)
      )
    )

  def findRuns(
      currentUser: User,
      runIds: Option[List[ObjectId]],
      workflowHash: Option[String],
      staleTimeout: FiniteDuration,
      allowUnlisted: Boolean
  ): Fox[List[RunEntry]] = {
    val runIdsQ =
      runIds.map(runIds => q" AND r._id IN ${SqlToken.tupleFromList(runIds)}").getOrElse(q"")
    val workflowHashQ =
      workflowHash.map(workflowHash => q" AND r.workflow_hash = $workflowHash").getOrElse(q"")
    for {
      r <- run(
        q"""
        SELECT
          r._id,
          r.name,
          r.username,
          r.hostname,
          r.voxelyticsVersion,
          r.workflow_hash,
          r.workflow_yamlContent,
          r.workflow_config,
          rs.state AS state,
          rs.beginTime AS beginTime,
          rs.endTime AS endTime
        FROM (${visibleRunsQ(currentUser, allowUnlisted)}) r
        JOIN (${runsWithStateQ(staleTimeout)}) rs ON rs._id = r._id
        WHERE TRUE
          $runIdsQ
          $workflowHashQ
        """.as[
          (String, String, String, String, String, String, String, String, String, Option[Instant], Option[Instant])
        ]
      )
      results <- Fox.combined(
        r.toList.map(row =>
          for {
            state <- VoxelyticsRunState.fromString(row._9).toFox
          } yield RunEntry(
            id = ObjectId(row._1),
            name = row._2,
            hostUserName = row._3,
            hostName = row._4,
            voxelyticsVersion = row._5,
            workflowHash = row._6,
            workflowYamlContent = row._7,
            workflowConfig = Json.parse(row._8).as[JsObject],
            state = state,
            beginTime = row._10,
            endTime = row._11
          )
        )
      )
    } yield results
  }

  def findWorkflowTaskCounts(
      currentUser: User,
      workflowHashes: Set[String],
      staleTimeout: FiniteDuration
  ): Fox[Map[String, TaskCounts]] = {
    val organizationId = currentUser._organization
    for {
      r <- run(q"""
        WITH task_states AS (${tasksWithStateQ(staleTimeout)})
        SELECT
          w.hash,
          COUNT(any_tasks.state) AS total,
          SUM(CASE WHEN COALESCE(running_tasks.state, any_tasks.state) IN ${SqlToken
          .tupleFromValues(VoxelyticsRunState.FAILED, VoxelyticsRunState.STALE)} THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN COALESCE(running_tasks.state, any_tasks.state) = ${VoxelyticsRunState.SKIPPED} THEN 1 ELSE 0 END) AS skipped,
          SUM(CASE WHEN COALESCE(running_tasks.state, any_tasks.state) = ${VoxelyticsRunState.COMPLETE} THEN 1 ELSE 0 END) AS complete,
          SUM(CASE WHEN COALESCE(running_tasks.state, any_tasks.state) = ${VoxelyticsRunState.CANCELLED} THEN 1 ELSE 0 END) AS cancelled,
          SUM(COALESCE(running_tasks.fileSize, 0)) AS fileSize,
          SUM(COALESCE(running_tasks.inodeCount, 0)) AS inodeCount
        FROM webknossos.voxelytics_workflows w
        JOIN ( -- Aggregating the task states of workflow runs (including skipped and pending)
          SELECT DISTINCT ON (workflow_hash, taskName) r.workflow_hash workflow_hash, t.name taskName, ts.state state
          FROM webknossos.voxelytics_tasks t
          JOIN (${visibleRunsQ(currentUser, allowUnlisted = false)}) r ON t._run = r._id
          JOIN task_states ts ON ts._id = t._id
          ORDER BY workflow_hash, taskName, ts.beginTime DESC
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
          JOIN (${visibleRunsQ(currentUser, allowUnlisted = false)}) r ON t._run = r._id
          JOIN task_states ts ON ts._id = t._id
          LEFT JOIN (
            SELECT a._task _task, SUM(a.fileSize) fileSize, SUM(a.inodeCount) inodeCount
            FROM webknossos.voxelytics_artifacts a
            GROUP BY a._task
          ) ta ON ta._task = t._id
          WHERE ts.state NOT IN ${SqlToken.tupleFromValues(VoxelyticsRunState.SKIPPED, VoxelyticsRunState.PENDING)}
          ORDER BY workflow_hash, taskName, ts.beginTime DESC
        ) running_tasks ON running_tasks.workflow_hash = w.hash AND running_tasks.taskName = any_tasks.taskName
        WHERE w.hash IN ${SqlToken.tupleFromList(workflowHashes)} AND w._organization = $organizationId
        GROUP BY w.hash
        """.as[(String, Long, Long, Long, Long, Long, Long, Long)])
    } yield r.toList
      .map(row =>
        (
          row._1,
          TaskCounts(
            total = row._2,
            failed = row._3,
            skipped = row._4,
            complete = row._5,
            cancelled = row._6,
            fileSize = row._7,
            inodeCount = row._8
          )
        )
      )
      .toMap
  }

  def findRunsForWorkflowListing(
      currentUser: User,
      staleTimeout: FiniteDuration
  ): Fox[List[WorkflowListingRunEntry]] = {
    val organizationId = currentUser._organization
    for {
      r <- run(
        q"""
        SELECT
          r._id,
          r.name,
          r.username,
          r.hostname,
          r.voxelyticsVersion,
          r.workflow_hash,
          rs.state AS state,
          rs.beginTime AS beginTime,
          rs.endTime AS endTime,
          COALESCE(tasks.total, 0) AS tasksTotal,
          COALESCE(tasks.failed, 0) AS tasksFailed,
          COALESCE(tasks.skipped, 0) AS tasksSkipped,
          COALESCE(tasks.complete, 0) AS tasksComplete,
          COALESCE(tasks.cancelled, 0) AS tasksCancelled,
          COALESCE(tasks.fileSize, 0) AS fileSize,
          COALESCE(tasks.inodeCount, 0) AS inodeCount,
          u.firstName,
          u.lastName
        FROM (${visibleRunsQ(currentUser, allowUnlisted = false)}) r
        JOIN (${runsWithStateQ(staleTimeout)}) rs ON rs._id = r._id
        LEFT JOIN (
          SELECT
            t._run AS _run,
            COUNT(t._id) AS total,
            SUM(CASE WHEN ts.state IN ${SqlToken
            .tupleFromValues(VoxelyticsRunState.FAILED, VoxelyticsRunState.STALE)} THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN ts.state = ${VoxelyticsRunState.SKIPPED} THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN ts.state = ${VoxelyticsRunState.COMPLETE} THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN ts.state = ${VoxelyticsRunState.CANCELLED} THEN 1 ELSE 0 END) AS cancelled,
            SUM(COALESCE(ta.fileSize, 0)) AS fileSize,
            SUM(COALESCE(ta.inodeCount, 0)) AS inodeCount
          FROM webknossos.voxelytics_tasks AS t
          JOIN (${tasksWithStateQ(staleTimeout)}) ts ON ts._id = t._id
          LEFT JOIN (
            SELECT a._task _task, SUM(a.fileSize) fileSize, SUM(a.inodeCount) inodeCount
            FROM webknossos.voxelytics_artifacts a
            GROUP BY a._task
          ) ta ON ta._task = t._id
          GROUP BY t._run
        ) tasks ON tasks._run = r._id
        LEFT JOIN webknossos.users_ u ON r._user = u._id
        WHERE r._organization = $organizationId
        """.as[
          (
              String,
              String,
              String,
              String,
              String,
              String,
              String,
              Option[Instant],
              Option[Instant],
              Long,
              Long,
              Long,
              Long,
              Long,
              Long,
              Long,
              Option[String],
              Option[String]
          )
        ]
      )
      results <- Fox.combined(
        r.toList.map(row =>
          for {
            state <- VoxelyticsRunState.fromString(row._7).toFox
          } yield WorkflowListingRunEntry(
            id = ObjectId(row._1),
            name = row._2,
            hostUserName = row._3,
            hostName = row._4,
            voxelyticsVersion = row._5,
            workflowHash = row._6,
            state = state,
            beginTime = row._8,
            endTime = row._9,
            taskCounts = TaskCounts(
              total = row._10,
              failed = row._11,
              skipped = row._12,
              complete = row._13,
              cancelled = row._14,
              fileSize = row._15,
              inodeCount = row._16
            ),
            userFirstName = row._17,
            userLastName = row._18
          )
        )
      )
    } yield results
  }

  def getRunIdByNameAndWorkflowHash(runName: String, workflowHash: String, currentUser: User): Fox[ObjectId] = {
    val readAccessQ =
      if (currentUser.isAdmin) q"TRUE"
      else q"_user = ${currentUser._id}"
    for {
      objectIdList <- run(q"""
        SELECT _id
        FROM webknossos.voxelytics_runs
        WHERE
          name = $runName AND
          workflow_hash = $workflowHash AND
          _organization = ${currentUser._organization} AND
          $readAccessQ
        """.as[String])
      objectId <- objectIdList.headOption
    } yield ObjectId(objectId)
  }

  def getRunNameById(runId: ObjectId, organizationId: String): Fox[String] =
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

  def getUserIdForRunOpt(runName: String, organizationId: String): Fox[Option[ObjectId]] =
    for {
      userId <- run(q"""
        SELECT _user
        FROM webknossos.voxelytics_runs
        WHERE name = $runName AND _organization = $organizationId
        """.as[String])
    } yield userId.headOption.map(ObjectId(_))

  def getChunkStatistics(
      runIds: List[ObjectId],
      taskName: String,
      staleTimeout: FiniteDuration
  ): Fox[List[ChunkStatisticsEntry]] = {
    for {
      r <- run(
        q"""
        WITH latest_chunk_states AS (${latestChunkStatesQ(runIds, Some(taskName), staleTimeout)})
        SELECT
          exec.executionId AS executionId,
          exec.countTotal AS countTotal,
          exec.countFailed AS countFailed,
          exec.countSkipped AS countSkipped,
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
        FROM ( -- Chunks grouped by executionId
          SELECT
            c.executionId,
            COUNT(c._chunk) AS countTotal,
            SUM(CASE WHEN c.state = ${VoxelyticsRunState.FAILED} THEN 1 ELSE 0 END) AS countFailed,
            SUM(CASE WHEN c.state = ${VoxelyticsRunState.SKIPPED} THEN 1 ELSE 0 END) AS countSkipped,
            SUM(CASE WHEN c.state = ${VoxelyticsRunState.COMPLETE} THEN 1 ELSE 0 END) AS countComplete,
            SUM(CASE WHEN c.state = ${VoxelyticsRunState.CANCELLED} THEN 1 ELSE 0 END) AS countCancelled
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
            JOIN (${chunksWithStateQ(staleTimeout)}) cs ON cs._id = c._id
            WHERE t._run IN ${SqlToken.tupleFromList(runIds)} AND t.name = $taskName
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
          WHERE c.state = ${VoxelyticsRunState.COMPLETE}
          GROUP BY c.executionId
        ) durations ON durations.executionId = exec.executionId
        ORDER BY times.beginTime ASC NULLS LAST
        """.as[
          (
              String,
              Long,
              Long,
              Long,
              Long,
              Long,
              Option[Instant],
              Option[Instant],
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
              Double
          )
        ]
      )
    } yield r.toList.map(row =>
      ChunkStatisticsEntry(
        executionId = row._1,
        chunkCounts =
          ChunkCounts(total = row._2, failed = row._3, skipped = row._4, complete = row._5, cancelled = row._6),
        beginTime = row._7,
        endTime = row._8,
        wallTime = row._9,
        memory = StatisticsEntry(max = row._10, median = row._11, stddev = row._12),
        cpuUser = StatisticsEntry(max = row._13, median = row._14, stddev = row._15),
        cpuSystem = StatisticsEntry(max = row._16, median = row._17, stddev = row._18),
        duration = StatisticsEntry(max = row._19, median = row._20, stddev = row._21, sum = Some(row._22))
      )
    )
  }

  def getArtifactChecksums(
      runIds: List[ObjectId],
      taskName: String,
      artifactName: Option[String],
      staleTimeout: FiniteDuration
  ): Fox[List[ArtifactChecksumEntry]] =
    for {
      r <- run(q"""
        WITH latest_complete_tasks AS (${latestCompleteOrSkippedTaskQ(runIds, Some(taskName), staleTimeout)})
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
        WHERE ${artifactName.map(a => q"a.name = $a").getOrElse(q"")}
        ORDER BY af.path
        """.as[(String, String, String, String, Instant, String, String, Long, Instant)])
    } yield r.toList.map(row =>
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
      )
    )

  def upsertArtifactChecksumEvents(runId: ObjectId, events: List[ArtifactFileChecksumEvent]): Fox[Unit] =
    for {
      _ <- run(q"""
        WITH insert_values(_run, taskName, artifactName, path, resolvedPath, checksumMethod, checksum, fileSize, lastModified, timestamp) AS (
          VALUES ${SqlToken.joinByComma(
          events.map(ev =>
            SqlToken.tupleFromValues(
              runId,
              ev.taskName,
              ev.artifactName,
              ev.path,
              ev.resolvedPath,
              ev.checksumMethod,
              ev.checksum,
              ev.fileSize,
              ev.lastModified,
              ev.timestamp
            )
          )
        )}
        )
        INSERT INTO webknossos.voxelytics_artifactFileChecksumEvents (_artifact, path, resolvedPath, checksumMethod, checksum, fileSize, lastModified, timestamp)
        SELECT
          a._id,
          iv.path,
          iv.resolvedPath,
          iv.checksumMethod,
          iv.checksum,
          iv.fileSize,
          iv.lastModified,
          iv.timestamp
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
          VALUES ${SqlToken.joinByComma(
          events.map(ev =>
            SqlToken.tupleFromValues(
              runId,
              ev.taskName,
              ev.executionId,
              ev.chunkName,
              ev.hostname,
              ev.pid,
              ev.memory,
              ev.cpuUser,
              ev.cpuSystem,
              ev.timestamp
            )
          )
        )}
        )
        INSERT INTO webknossos.voxelytics_chunkProfilingEvents (_chunk, hostname, pid, memory, cpuUser, cpuSystem, timestamp)
        SELECT
          c._id,
          iv.hostname,
          iv.pid,
          iv.memory,
          iv.cpuUser,
          iv.cpuSystem,
          iv.timestamp
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
        VALUES ${SqlToken.joinByComma(events.map(ev => SqlToken.tupleFromValues(runId, ev.timestamp)))}
        ON CONFLICT (_run)
          DO UPDATE SET timestamp = EXCLUDED.timestamp
        """.asUpdate)
    } yield ()

  def upsertChunkStates(runId: ObjectId, events: List[ChunkStateChangeEvent]): Fox[Unit] = {
    val values = events.map(ev =>
      SqlToken.tupleFromValues(
        runId,
        ev.taskName,
        ObjectId.generate,
        ev.executionId,
        ev.chunkName,
        if (ev.state == VoxelyticsRunState.RUNNING) {
          Some(ev.timestamp)
        } else {
          None
        },
        if (
          ev.state == VoxelyticsRunState.COMPLETE || ev.state == VoxelyticsRunState.CANCELLED || ev.state == VoxelyticsRunState.FAILED
        ) {
          Some(ev.timestamp)
        } else {
          None
        },
        ev.state
      )
    )

    for {
      _ <- run(q"""
        WITH insert_values(_run, taskName, _chunk, executionId, chunkName, beginTime, endTime, state) AS (
          VALUES ${SqlToken.joinByComma(values)}
        )
        INSERT INTO webknossos.voxelytics_chunks AS u (_id, _task, executionId, chunkName, beginTime, endTime, state)
        SELECT
          iv._chunk,
          t._id,
          iv.executionId,
          iv.chunkName,
          iv.beginTime::TIMESTAMPTZ,
          iv.endTime::TIMESTAMPTZ,
          iv.state::webknossos.voxelytics_run_state
        FROM insert_values iv
        JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
        ON CONFLICT (_task, executionId, chunkName)
          DO UPDATE SET
            state = EXCLUDED.state,
            beginTime = COALESCE(EXCLUDED.beginTime, u.beginTime),
            endTime = COALESCE(EXCLUDED.endTime, u.endTime)
        """.asUpdate)
    } yield ()
  }

  def updateTaskStates(runId: ObjectId, events: List[TaskStateChangeEvent]): Fox[Unit] = {
    val values = events.map(ev =>
      SqlToken.tupleFromValues(
        runId,
        ev.taskName,
        if (ev.state == VoxelyticsRunState.RUNNING) {
          Some(ev.timestamp)
        } else {
          None
        },
        if (
          ev.state == VoxelyticsRunState.COMPLETE || ev.state == VoxelyticsRunState.CANCELLED || ev.state == VoxelyticsRunState.FAILED
        ) {
          Some(ev.timestamp)
        } else {
          None
        },
        ev.state
      )
    )
    for {
      _ <- run(q"""
        WITH insert_values(_run, taskName, beginTime, endTime, state) AS (
          VALUES ${SqlToken.joinByComma(values)}
        )
        UPDATE webknossos.voxelytics_tasks u
        SET
          beginTime = COALESCE(v.beginTime::TIMESTAMPTZ, u.beginTime::TIMESTAMPTZ),
          endTime = COALESCE(v.endTime::TIMESTAMPTZ, u.endTime::TIMESTAMPTZ),
          state = v.state::webknossos.voxelytics_run_state
        FROM (
          SELECT t._id _task, iv.beginTime beginTime, iv.endTime endTime, iv.state::webknossos.voxelytics_run_state state
          FROM insert_values iv
          JOIN webknossos.voxelytics_tasks t ON t._run = iv._run AND t.name = iv.taskName
        ) v
        WHERE u._id = v._task
        """.asUpdate)
    } yield ()
  }

  def updateRunStates(runId: ObjectId, events: List[RunStateChangeEvent]): Fox[Unit] = {
    val values = events.map(ev =>
      SqlToken.tupleFromValues(
        runId,
        if (ev.state == VoxelyticsRunState.RUNNING) {
          Some(ev.timestamp)
        } else {
          None
        },
        if (
          ev.state == VoxelyticsRunState.COMPLETE || ev.state == VoxelyticsRunState.CANCELLED || ev.state == VoxelyticsRunState.FAILED
        ) {
          Some(ev.timestamp)
        } else {
          None
        },
        ev.state
      )
    )
    for {
      _ <- run(q"""
        UPDATE webknossos.voxelytics_runs u
        SET
          beginTime = COALESCE(v.beginTime::TIMESTAMPTZ, u.beginTime::TIMESTAMPTZ),
          endTime = COALESCE(v.endTime::TIMESTAMPTZ, u.endTime::TIMESTAMPTZ),
          state = v.state::webknossos.voxelytics_run_state
        FROM (
          VALUES ${SqlToken.joinByComma(values)}
        ) v(_run, beginTime, endTime, state)
        WHERE u._id = v._run
        """.asUpdate)
    } yield ()
  }

  def upsertWorkflow(hash: String, name: String, organizationId: String): Fox[Unit] =
    for {
      _ <- run(q"""
        INSERT INTO webknossos.voxelytics_workflows (hash, name, _organization)
        VALUES ${SqlToken.tupleFromValues(hash, name, organizationId)}
        ON CONFLICT (_organization, hash)
          DO UPDATE SET name = EXCLUDED.name
        """.asUpdate)
    } yield ()

  def upsertRun(
      organizationId: String,
      userId: ObjectId,
      name: String,
      username: String,
      hostname: String,
      voxelyticsVersion: String,
      workflowHash: String,
      workflowYamlContent: Option[String],
      workflowConfig: JsValue
  ): Fox[ObjectId] =
    for {
      _ <- run(q"""
        INSERT INTO webknossos.voxelytics_runs (_id, _organization, _user, name, username, hostname, voxelyticsVersion, workflow_hash, workflow_yamlContent, workflow_config)
        VALUES ${SqlToken.tupleFromValues(
          ObjectId.generate,
          organizationId,
          userId,
          name,
          username,
          hostname,
          voxelyticsVersion,
          workflowHash,
          workflowYamlContent,
          workflowConfig
        )}
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
        VALUES ${SqlToken.tupleFromValues(ObjectId.generate, runId, name, task, config)}
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

  def upsertArtifact(
      taskId: ObjectId,
      name: String,
      path: String,
      fileSize: Long,
      inodeCount: Long,
      version: String,
      metadata: JsValue
  ): Fox[ObjectId] =
    for {
      _ <- run(q"""
        INSERT INTO webknossos.voxelytics_artifacts (_id, _task, name, path, fileSize, inodeCount, version, metadata)
        VALUES ${SqlToken.tupleFromValues(
          ObjectId.generate,
          taskId,
          name,
          path,
          fileSize,
          inodeCount,
          version,
          metadata
        )}
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
          VALUES ${SqlToken.joinByComma(
          artifacts.map(ev =>
            SqlToken.tupleFromValues(
              runId,
              ObjectId.generate,
              ev._1,
              ev._2,
              ev._3.path,
              ev._3.file_size,
              ev._3.inode_count,
              ev._3.version,
              ev._3.metadataAsJson
            )
          )
        )}
        )
        INSERT INTO webknossos.voxelytics_artifacts (_id, _task, name, path, fileSize, inodeCount, version, metadata)
        SELECT
          iv._id,
          t._id,
          iv.artifactName,
          iv.path,
          iv.fileSize,
          iv.inodeCount,
          iv.version,
          iv.metadata
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

  def deleteWorkflow(hash: String, organizationId: String): Fox[Unit] =
    for {
      _ <- run(q"""
                  DELETE FROM webknossos.voxelytics_workflows
                  WHERE hash = $hash
                  AND _organization = $organizationId;
                  """.asUpdate)
      _ <- run(q"""
                  UPDATE webknossos.jobs
                  SET _voxelytics_workflowHash = NULL
                  WHERE _voxelytics_workflowHash = $hash
                  AND (SELECT _organization FROM webknossos.users  AS u WHERE u._id = _owner) = $organizationId;
        """.asUpdate)
    } yield ()

}
