package models.voxelytics

import com.scalableminds.util.tools.Fox
import controllers._
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import utils.{ObjectId, SQLClient, SimpleSQLDAO}

import java.time.Instant
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.Duration

class VoxelyticsDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {
  private def writeSafeTuple(seq: List[String]) =
    sql"(" + seq.map(s => sql"${s}").mkString(", ") + sql")"
  def selectArtifacts(taskIds: List[ObjectId]): Fox[List[ArtifactEntry]] =
    for {
      r <- run(sql"""
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
          JOIN webknossos.voxelytics_tasks t ON t._id = a._task
          WHERE t."_id" IN #${writeSafeTuple(taskIds.map(_.id))}
          ;""".as[(String, String, String, String, Long, Long, String, String, String)])
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

  def selectTasks(combinedTaskRuns: List[TaskRunEntry]): Fox[List[TaskEntry]] =
    for {
      r <- run(sql"""
          SELECT
            t._id,
            t._run,
            t.name,
            t.task,
            t.config
          FROM webknossos.voxelytics_tasks t
          WHERE
              ("_run", "name") IN (#${combinedTaskRuns.map(t => sql"(${t.runId.id}, ${t.taskName})").mkString(", ")})
          ;""".as[(String, String, String, String, String)])
    } yield
      r.toList.map(row =>
        TaskEntry(ObjectId(row._1), ObjectId(row._2), row._3, row._4, Json.parse(row._5).as[JsObject]))

  def findWorkflowsByHash(organizationId: ObjectId, workflowHashes: Set[String]): Fox[List[WorkflowEntry]] =
    for {
      r <- run(sql"""
          SELECT name, hash
          FROM voxelytics_workflows
          WHERE hash IN ${writeSafeTuple(workflowHashes.toList)} AND _organization = ${organizationId.id}
          ;""".as[(String, String)])
    } yield r.toList.map(row => WorkflowEntry(row._1, row._2))

  def findWorkflowByHash(organizationId: ObjectId, workflowHash: String): Fox[WorkflowEntry] =
    for {
      r <- run(sql"""
          SELECT name, hash
          FROM voxelytics_workflows
          WHERE hash = $workflowHash AND _organization = ${organizationId.id}
          ;""".as[(String, String)])
    } yield WorkflowEntry(r.head._1, r.head._2)

  def selectTaskRuns(organizationId: ObjectId,
                     runIds: List[ObjectId],
                     staleTimeout: Duration): Fox[List[TaskRunEntry]] =
    for {
      r <- run(sql"""
        WITH latest_chunk_states AS (
          SELECT DISTINCT ON ("_chunk") "_chunk", "timestamp", "state"
          FROM "webknossos"."voxelytics_chunk_state_change_events"
          ORDER BY "_chunk", "timestamp" DESC
        )
        SELECT
          r."name" AS "runName",
          r."_id" AS "runId",
          t."_id" AS "taskId",
          t."name" AS "taskName",
          CASE
            WHEN task_state."state" = 'RUNNING' AND run_heartbeat."timestamp" IS NOT NULL AND run_heartbeat."timestamp" < NOW() - INTERVAL '${staleTimeout.toSeconds} SECONDS'
            THEN 'STALE' ELSE task_state."state" END AS "state",
          task_begin."timestamp" AS "beginTime",
          CASE
            WHEN task_state."state" = 'RUNNING' AND run_heartbeat."timestamp" IS NOT NULL AND run_heartbeat."timestamp" < NOW() - INTERVAL '${staleTimeout.toSeconds} SECONDS'
            THEN run_heartbeat."timestamp" ELSE task_end."timestamp" END AS "endTime",
          exec."executionId" AS "currentExecutionId",
          COALESCE(chunks."total", 0) AS "chunksTotal",
          COALESCE(chunks."finished", 0) AS "chunksFinished"
        FROM "webknossos"."voxelytics_runs" r
        JOIN "webknossos"."voxelytics_tasks" t ON t."_run" = r."_id"
        JOIN (
          SELECT DISTINCT ON ("_task") "_task", "state"
          FROM "webknossos"."voxelytics_task_state_change_events"
          ORDER BY "_task", "timestamp" DESC
        ) task_state
          ON t."_id" = task_state."_task"
        LEFT JOIN (
          SELECT DISTINCT ON ("_task") "_task", "timestamp"
          FROM "webknossos"."voxelytics_task_state_change_events"
          WHERE "state" = 'RUNNING'
          ORDER BY "_task", timestamp
        ) task_begin
          ON t."_id" = task_begin."_task"
        LEFT JOIN (
          SELECT DISTINCT ON ("_task") "_task", "timestamp"
          FROM "webknossos"."voxelytics_task_state_change_events"
          WHERE "state" IN ('COMPLETE', 'FAILED', 'CANCELLED')
          ORDER BY "_task", "timestamp" DESC
        ) task_end
          ON t."_id" = task_end."_task"
        LEFT JOIN (
          SELECT "_run", "timestamp"
          FROM "webknossos"."voxelytics_run_heartbeat_events"
        ) run_heartbeat
          ON r."_id" = run_heartbeat."_run"
        LEFT JOIN (
          SELECT DISTINCT ON (c."_task") c."_task", c."executionId"
          FROM latest_chunk_states
          JOIN "webknossos"."voxelytics_chunks" c ON c."_id" = latest_chunk_states."_chunk"
          WHERE latest_chunk_states."state" = 'RUNNING'
          ORDER BY c."_task", latest_chunk_states."timestamp" DESC
        ) exec ON exec."_task" = t."_id"
        LEFT JOIN (
          SELECT
            count_all."_task" AS "_task",
            count_all."count" AS "total",
            COALESCE(count_finished."count", 0) AS "finished"
          FROM (
            SELECT "_task", COUNT("_id") AS "count"
            FROM "webknossos"."voxelytics_chunks"
            GROUP BY "_task"
          ) count_all
          LEFT JOIN (
            SELECT c."_task", COUNT("_id") AS "count"
              FROM latest_chunk_states
              JOIN "webknossos"."voxelytics_chunks" c ON c."_id" = latest_chunk_states."_chunk"
              WHERE latest_chunk_states."state" IN ('COMPLETE', 'FAILED', 'CANCELLED')
            GROUP BY c."_task"
          ) count_finished ON count_finished."_task" = count_all."_task"
        ) chunks ON chunks."_task" = t."_id"
        WHERE
          r."_organization" = ${organizationId.id} AND
          r."_id" IN ${writeSafeTuple(runIds.map(_.id))}
        ;""".as[(String, String, String, String, String, Option[Instant], Option[Instant], Option[String], Long, Long)])
    } yield
      r.toList.map(
        row =>
          TaskRunEntry(
            row._1,
            ObjectId(row._2),
            ObjectId(row._3),
            row._4,
            RunState.fromString(row._5).get,
            row._6,
            row._7,
            row._8,
            row._9,
            row._10
        ))

  def selectRuns(organizationId: ObjectId,
                 runIds: Option[List[ObjectId]],
                 workflowHash: Option[String],
                 staleTimeout: Duration): Fox[List[RunEntry]] = {
    val runIdsQ = runIds.map(runIds => sql" AND r._id IN #${writeSafeTuple(runIds.map(_.id))}").getOrElse(sql"")
    val workflowHashQ =
      workflowHash.map(workflowHash => sql" AND r.workflow_hash = ${workflowHash}").getOrElse(sql"")
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
          r.workflow_config
          CASE
            WHEN run_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - INTERVAL '${staleTimeout.toSeconds} SECONDS'
            THEN 'STALE' ELSE run_state.state END AS state,
          run_begin.timestamp AS beginTime,
          CASE
            WHEN run_state.state = 'RUNNING' AND run_heartbeat.timestamp IS NOT NULL AND run_heartbeat.timestamp < NOW() - INTERVAL '${staleTimeout.toSeconds} SECONDS'
            THEN run_heartbeat.timestamp ELSE run_end.timestamp END AS endTime
        FROM webknossos.voxelytics_runs r
        JOIN (
          SELECT DISTINCT ON (_run) _run, state
          FROM webknossos.voxelytics_run_state_change_events
          ORDER BY _run, timestamp DESC
        ) run_state
          ON r._id = run_state._run
        JOIN (
          SELECT DISTINCT ON (_run) _run, timestamp
          FROM webknossos.voxelytics_run_state_change_events
          WHERE state = 'RUNNING'
          ORDER BY _run, timestamp
        ) run_begin
          ON r._id = run_begin._run
        LEFT JOIN (
          SELECT DISTINCT ON (_run) _run, timestamp
          FROM webknossos.voxelytics_run_state_change_events
          WHERE state IN ('COMPLETE', 'FAILED', 'CANCELLED')
          ORDER BY _run, timestamp DESC
        ) run_end
          ON r._id = run_end._run
        LEFT JOIN (
          SELECT _run, timestamp
          FROM webknossos.voxelytics_run_heartbeat_events
        ) run_heartbeat
          ON r._id = run_heartbeat._run
        WHERE r._organization = ${organizationId.id}
          #$runIdsQ
          #$workflowHashQ
        ;""".as[(String, String, String, String, String, String, String, String, String, Instant, Option[Instant])])
    } yield
      r.toList.map(
        row =>
          RunEntry(
            ObjectId(row._1),
            row._2,
            row._3,
            row._4,
            row._5,
            row._6,
            row._7,
            Json.parse(row._8).as[JsObject],
            RunState.fromString(row._9).get,
            row._10,
            row._11
        ))
  }

  def upsertArtifactChecksumEvent(artifactId: ObjectId, ev: ArtifactFileChecksumEvent): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""INSERT INTO webknossos.voxelytics_artifact_file_checksum_events (_artifact, path, resolvedPath, checksumMethod, checksum, fileSize, lastModified, timestamp)
               VALUES (${artifactId.id}, ${ev.path}, ${ev.resolvedPath}, ${ev.checksumMethod}, ${ev.checksum}, ${ev.fileSize}, ${ev.lastModified}, ${ev.timestamp})
               ON CONFLICT (_artifact, path, timestamp)
                 DO UPDATE SET
                   resolvedPath = EXCLUDED.resolvedPath,
                   checksumMethod = EXCLUDED.checksumMethod,
                   checksum = EXCLUDED.checksum,
                   fileSize = EXCLUDED.fileSize,
                   lastModified = EXCLUDED.lastModified
               ;""")
    } yield ()

  def upsertChunkProfilingEvent(chunkId: ObjectId, ev: ChunkProfilingEvent): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""INSERT INTO webknossos.voxelytics_chunk_profiling_events (_chunk, hostname, pid, memory, cpuUser, cpuSystem, timestamp)
                 VALUES (${chunkId.id}, ${ev.hostname}, ${ev.pid}, ${ev.memory}, ${ev.cpuUser}, ${ev.cpuSystem}, ${ev.timestamp})
                 ON CONFLICT (_chunk, timestamp)
                   DO UPDATE SET
                     hostname = EXCLUDED.hostname,
                     pid = EXCLUDED.pid,
                     memory = EXCLUDED.memory,
                     cpuUser = EXCLUDED.cpuUser,
                     cpuSystem = EXCLUDED.cpuSystem
                 ;""")
    } yield ()

  def upsertRunHeartbeatEvent(runId: ObjectId, ev: RunHeartbeatEvent): Fox[Unit] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_run_heartbeat_events (_run, timestamp)
                     VALUES (${runId.id}, ${ev.timestamp})
                     ON CONFLICT (_run)
                       DO UPDATE SET timestamp = EXCLUDED.timestamp
                     ;""")
    } yield ()

  def upsertChunkStateChangeEvent(chunkId: ObjectId, ev: ChunkStateChangeEvent): Fox[Unit] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_chunk_state_change_events (_chunk, timestamp, state)
                      VALUES (${chunkId.id}, ${ev.timestamp}, ${ev.state.toString})
                      ON CONFLICT (_chunk, timestamp)
                        DO UPDATE SET state = EXCLUDED.state
                      ;""")
    } yield ()

  def upsertTaskStateChangeEvent(taskId: ObjectId, ev: TaskStateChangeEvent): Fox[Unit] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_task_state_change_events (_task, timestamp, state)
                VALUES (${taskId.id}, ${ev.timestamp}, ${ev.state.toString})
                ON CONFLICT (_task, timestamp)
                  DO UPDATE SET state = EXCLUDED.state
                ;""")
    } yield ()

  def upsertRunStateChangeEvent(runId: ObjectId, ev: RunStateChangeEvent): Fox[Unit] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_run_state_change_events (_run, timestamp, state)
                VALUES (${runId.id}, ${ev.timestamp}, ${ev.state.toString})
                ON CONFLICT (_run, timestamp)
                  DO UPDATE SET state = EXCLUDED.state
                ;""")
    } yield ()

  def upsertWorkflow(hash: String, name: String, organizationId: ObjectId): Fox[ObjectId] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_workflows (_id, hash, name, _organization)
                VALUES (${ObjectId.generate}, $hash, $name, ${organizationId.id})
                ON CONFLICT (_organization, hash)
                  DO UPDATE SET name = EXCLUDED.name
                ;""")
      objectId <- run(sql"""SELECT _id
             FROM webknossos.voxelytics_workflows
             WHERE _organization = ${organizationId.id} AND hash = $hash;""".as[String])
    } yield ObjectId(objectId.head)

  def upsertRun(organizationId: ObjectId,
                userId: ObjectId,
                name: String,
                username: String,
                hostname: String,
                voxelyticsVersion: String,
                workflow_hash: String,
                workflow_yamlContent: String,
                workflow_config: JsValue): Fox[ObjectId] =
    for {
      _ <- run(
        sqlu"""INSERT INTO webknossos.voxelytics_runs (_id, _organization, _user, name, username, hostname, voxelyticsVersion, workflow_hash, workflow_yamlContent, workflow_config)
                VALUES (${ObjectId.generate}, ${organizationId.id}, ${userId.id}, $name, $username, $hostname, $voxelyticsVersion, $workflow_hash, $workflow_yamlContent, ${Json
          .stringify(workflow_config)})
                ON CONFLICT (_organization, name)
                  DO UPDATE SET
                    _user = EXCLUDED._user,
                    username = EXCLUDED.username,
                    hostname = EXCLUDED.hostname,
                    voxelyticsVersion = EXCLUDED.voxelyticsVersion,
                    workflow_hash = EXCLUDED.workflow_hash,
                    workflow_yamlContent = EXCLUDED.workflow_yamlContent,
                    workflow_config = EXCLUDED.workflow_config
                ;""")
      objectId <- run(sql"""SELECT _id
             FROM webknossos.voxelytics_runs
             WHERE _organization = ${organizationId.id} AND name = $name;""".as[String])
    } yield ObjectId(objectId.head)

  def upsertTask(runId: ObjectId, name: String, task: String, config: JsValue): Fox[ObjectId] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.voxelytics_tasks (_id, _run, name, task, config)
                VALUES (${ObjectId.generate}, ${runId.id}, $name, $task, ${Json.stringify(config)})
                ON CONFLICT (_run, name)
                  DO UPDATE SET
                    task = EXCLUDED.task,
                    config = EXCLUDED.config
                ;""")
      objectId <- run(sql"""SELECT _id
             FROM webknossos.voxelytics_tasks
             WHERE _run = ${runId.id} AND name = $name;""".as[String])
    } yield ObjectId(objectId.head)

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
                VALUES (${ObjectId.generate}, ${taskId.id}, $name, $path, $fileSize, $inodeCount, $version, ${Json
          .stringify(metadata)})
                ON CONFLICT (_task, name)
                  DO UPDATE SET
                    path = EXCLUDED.path,
                    fileSize = EXCLUDED.fileSize,
                    inodeCount = EXCLUDED.inodeCount,
                    version = EXCLUDED.version,
                    metadata = EXCLUDED.metadata
                ;""")
      objectId <- run(sql"""SELECT _id
             FROM webknossos.voxelytics_artifacts
             WHERE _task = ${taskId.id} AND name = $name;""".as[String])
    } yield ObjectId(objectId.head)

  def getRunIdByName(runName: String, organizationId: ObjectId): Fox[ObjectId] =
    for {
      objectId <- run(sql"""SELECT _id
           FROM webknossos.voxelytics_runs
           WHERE name = $runName AND _organization = ${organizationId.id};""".as[String])
    } yield ObjectId(objectId.head)

  def getRunNameById(runId: ObjectId, organizationId: ObjectId): Fox[String] =
    for {
      name <- run(sql"""SELECT name
           FROM webknossos.voxelytics_runs
           WHERE _id = ${runId.id} AND _organization = ${organizationId.id};""".as[String])
    } yield name.head

  def getTaskIdByName(taskName: String, runId: ObjectId): Fox[ObjectId] =
    for {
      objectId <- run(sql"""SELECT _id
             FROM webknossos.voxelytics_tasks
             WHERE _run = ${runId.id} AND name = $taskName;""".as[String])
    } yield ObjectId(objectId.head)

  def getChunkIdByName(taskId: ObjectId, executionId: String, chunkName: String): Fox[ObjectId] =
    for {
      objectId <- run(sql"""SELECT _id
             FROM webknossos.voxelytics_chunks
             WHERE _task = ${taskId.id} AND executionId = $executionId AND chunkName = $chunkName;""".as[String])
    } yield ObjectId(objectId.head)

  def getArtifactIdByName(taskId: ObjectId, artifactName: String): Fox[ObjectId] =
    for {
      objectId <- run(sql"""SELECT _id
               FROM webknossos.voxelytics_artifacts
               WHERE _task = ${taskId.id} AND name = $artifactName;""".as[String])
    } yield ObjectId(objectId.head)

  def getChunkStatistics(taskId: ObjectId): Fox[List[ChunkStatisticsEntry]] = {
    for {
      r <- run(
        sql"""
          WITH latest_chunk_states AS (
            SELECT DISTINCT ON (_chunk) _chunk, timestamp, state
            FROM webknossos.voxelytics_chunk_state_change_events
            ORDER BY _chunk, timestamp DESC
          )
          SELECT
            exec.executionId AS executionId,
            exec.countTotal AS countTotal,
            exec.countFinished AS countFinished,
            times.beginTime AS beginTime,
            times.endTime AS endTime,
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
                c._task,
                c.executionId,
                COUNT(c._id) AS countTotal,
                COUNT(finished._chunk) AS countFinished
              FROM webknossos.voxelytics_chunks c
              LEFT JOIN (
                SELECT *
                FROM latest_chunk_states
                WHERE state IN ('COMPLETE', 'FAILED', 'CANCELLED')
              ) finished ON finished._chunk = c._id
              GROUP BY _task, executionId
            ) exec
          LEFT JOIN ( -- Begin and end time of task+executionId
            SELECT
              c._task,
              c.executionId,
              MIN(chunk_events.timestamp) AS beginTime,
              MAX(chunk_events.timestamp) AS endTime
            FROM webknossos.voxelytics_chunk_state_change_events chunk_events
            JOIN webknossos.voxelytics_chunks c ON c._id = chunk_events._chunk
            GROUP BY c._task, c.executionId
          ) times ON times._task = exec._task AND times.executionId = exec.executionId
          LEFT JOIN ( -- Profiling statistics (memory, cpu); grouped by task and executionId
            SELECT
              c._task AS _task,
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
            FROM
              webknossos.voxelytics_chunk_profiling_events cp,
              webknossos.voxelytics_chunks c
            WHERE
              c._id = cp._chunk
            GROUP BY c._task, c.executionId
          ) profiling ON profiling._task = exec._task AND profiling.executionId = exec.executionId
          LEFT JOIN ( -- Chunk duration statistics; grouped by task and executionId
            SELECT
              c._task AS _task,
              c.executionId AS executionId,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (EXTRACT(epoch FROM c_end.timestamp - c_begin.timestamp))) AS median_duration,
              MAX(EXTRACT(epoch FROM c_end.timestamp - c_begin.timestamp)) AS max_duration,
              STDDEV(EXTRACT(epoch FROM c_end.timestamp - c_begin.timestamp)) AS stddev_duration,
              SUM(EXTRACT(epoch FROM c_end.timestamp - c_begin.timestamp)) AS sum_duration
            FROM
              (
                SELECT DISTINCT ON (_chunk) _chunk, timestamp
                FROM webknossos.voxelytics_chunk_state_change_events
                WHERE state = 'RUNNING'
                ORDER BY _chunk, timestamp
              ) c_begin,
              (
                SELECT DISTINCT ON (_chunk) _chunk, timestamp
                FROM webknossos.voxelytics_chunk_state_change_events
                WHERE state = 'COMPLETE'
                ORDER BY _chunk, timestamp
              ) c_end,
              webknossos.voxelytics_chunks c
            WHERE
              c_begin._chunk = c_end._chunk
              AND c._id = c_begin._chunk
            GROUP BY c._task, c.executionId
          ) durations ON durations._task = exec._task AND durations.executionId = exec.executionId
          JOIN webknossos.voxelytics_tasks t
            ON t._id = exec._task
          WHERE -- Limit to specified task
            exec._task = $taskId
          ORDER BY times.beginTime ASC NULLS LAST;
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
           Double)])
    } yield
      r.toList.map(
        row =>
          ChunkStatisticsEntry(
            row._1,
            row._2,
            row._3,
            row._4,
            row._5,
            row._6,
            row._7,
            row._8,
            row._9,
            row._10,
            row._11,
            row._12,
            row._13,
            row._14,
            row._15,
            row._16,
            row._17,
            row._18
        ))
  }

  def getArtifactChecksums(taskId: ObjectId, artifactName: Option[String]): Fox[List[ArtifactChecksumEntry]] =
    for {
      r <- run(sql"""
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
            FROM webknossos.voxelytics_artifact_file_checksum_events
          ORDER BY _artifact, path, timestamp
        ) af
          JOIN webknossos.voxelytics_artifacts a ON a._id = af._artifact
        WHERE
          a._task = ${taskId.id} #${artifactName.map(a => sql"AND a.name = $a").getOrElse("")}
        ORDER BY af.path;""".as[(String, String, String, String, Instant, String, String, Long, Instant)])
    } yield
      r.toList.map(row => ArtifactChecksumEntry(row._1, row._2, row._3, row._4, row._5, row._6, row._7, row._8, row._9))
}
