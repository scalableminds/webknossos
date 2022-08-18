package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import io.swagger.annotations._
import models.organization.OrganizationDAO
import models.user.{UserDAO, UserService}
import models.voxelytics.RunState.RunState
import models.voxelytics._
import oxalis.security.WkEnv
import play.api.libs.json._
import play.api.mvc._
import utils.{ObjectId, WkConf}

import java.time.Instant
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.util.Try

case class RunEntry(runId: ObjectId,
                    name: String,
                    username: String,
                    hostname: String,
                    voxelyticsVersion: String,
                    workflow_hash: String,
                    workflow_yamlContent: String,
                    workflow_config: JsObject,
                    state: RunState,
                    beginTime: Instant,
                    endTime: Option[Instant])

object RunEntry {
  implicit val jsonFormat: OFormat[RunEntry] = Json.format[RunEntry]
}

case class TaskRunEntry(runName: String,
                        runId: ObjectId,
                        taskId: ObjectId,
                        taskName: String,
                        state: RunState,
                        beginTime: Option[Instant],
                        endTime: Option[Instant],
                        currentExecutionId: Option[String],
                        chunksTotal: Long,
                        chunksFinished: Long)

object TaskRunEntry {
  implicit val jsonFormat: OFormat[TaskRunEntry] = Json.format[TaskRunEntry]
}

case class WorkflowEntry(
    name: String,
    hash: String
)

object WorkflowEntry {
  implicit val jsonFormat: OFormat[WorkflowEntry] = Json.format[WorkflowEntry]
}

case class ArtifactEntry(artifactId: ObjectId,
                         taskId: ObjectId,
                         name: String,
                         path: String,
                         fileSize: Long,
                         inodeCount: Long,
                         version: String,
                         metadata: JsObject,
                         taskName: String)

object ArtifactEntry {
  implicit val jsonFormat: OFormat[ArtifactEntry] = Json.format[ArtifactEntry]
}

case class TaskEntry(taskId: ObjectId, runId: ObjectId, name: String, task: String, config: JsObject)

object TaskEntry {
  implicit val jsonFormat: OFormat[TaskEntry] = Json.format[TaskEntry]
}

case class ChunkStatisticsEntry(executionId: String,
                                countTotal: Long,
                                countFinished: Long,
                                beginTime: Instant,
                                endTime: Instant,
                                max_memory: Double,
                                median_memory: Double,
                                stddev_memory: Double,
                                max_cpuUser: Double,
                                median_cpuUser: Double,
                                stddev_cpuUser: Double,
                                max_cpuSystem: Double,
                                median_cpuSystem: Double,
                                stddev_cpuSystem: Double,
                                max_duration: Double,
                                median_duration: Double,
                                stddev_duration: Double,
                                sum_duration: Double)

object ChunkStatisticsEntry {
  implicit val jsonFormat: OFormat[ChunkStatisticsEntry] = Json.format[ChunkStatisticsEntry]
}

case class ArtifactChecksumEntry(taskName: String,
                                 artifactName: String,
                                 path: String,
                                 resolvedPath: String,
                                 timestamp: Instant,
                                 checksumMethod: String,
                                 checksum: String,
                                 fileSize: Long,
                                 lastModified: Instant)

object ArtifactChecksumEntry {
  implicit val jsonFormat: OFormat[ArtifactChecksumEntry] = Json.format[ArtifactChecksumEntry]
}

@Api
class VoxelyticsController @Inject()(
    userDAO: UserDAO,
    organizationDAO: OrganizationDAO,
    voxelyticsDAO: VoxelyticsDAO,
    userService: UserService,
    elasticsearchClient: ElasticsearchClient,
    wkConf: WkConf,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private lazy val conf = wkConf.Voxelytics

  @ApiOperation(hidden = true, value = "")
  def createWorkflow: Action[WorkflowDescription] =
    sil.SecuredAction.async(validateJson[WorkflowDescription]) { implicit request =>
      def upsertTask(_run: ObjectId, taskName: String, task: WorkflowDescriptionTaskConfig): Fox[Unit] =
        for {
          // TODO: Authorization
          taskId <- voxelyticsDAO.upsertTask(
            _run,
            taskName,
            task.task,
            Json.obj("config" -> task.config,
                     "description" -> task.description,
                     "distribution" -> task.distribution,
                     "inputs" -> task.inputs,
                     "output_paths" -> task.output_paths)
          )
          _ <- Fox.sequence(
            request.body.artifacts
              .getOrElse(taskName, List.empty)
              .map(artifactKV => {
                val artifactName = artifactKV._1
                val artifact = artifactKV._2
                voxelyticsDAO.upsertArtifact(taskId,
                                             artifactName,
                                             artifact.path,
                                             artifact.file_size,
                                             artifact.inode_count,
                                             artifact.version,
                                             artifact.metadata)
              })
              .toList)
        } yield ()

      for {
        workflowId <- voxelyticsDAO.upsertWorkflow(request.body.workflow.hash,
                                                   request.body.workflow.name,
                                                   request.identity._organization)
        runId <- voxelyticsDAO.upsertRun(
          request.identity._organization,
          request.identity._id,
          request.body.run.name,
          request.body.run.user,
          request.body.run.hostname,
          request.body.run.voxelyticsVersion,
          request.body.workflow.hash,
          request.body.workflow.yamlContent,
          request.body.config.withoutTasks()
        )
        _ <- Fox.sequence(
          request.body.config.tasks
            .map(taskKV => {
              val taskName = taskKV._1
              val task = taskKV._2
              upsertTask(runId, taskName, task)
            })
            .toList)

      } yield JsonOk(Json.obj("workflowId" -> workflowId, "runId" -> runId))
    }

  private def aggregateBeginEndTime(runs: List[RunEntry]): (RunState, Instant, Option[Instant]) = {
    val state = runs.maxBy(_.beginTime).state
    val beginTime = runs.map(_.beginTime).min
    val endTime = Try(runs.flatMap(_.endTime).max).toOption

    (state, beginTime, endTime)
  }

  @ApiOperation(hidden = true, value = "")
  def listWorkflows(workflowHash: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        runs <- voxelyticsDAO.selectRuns(request.identity._organization, None, workflowHash, conf.staleTimeout)
        taskRuns <- voxelyticsDAO.selectTaskRuns(request.identity._organization, runs.map(_.runId), conf.staleTimeout)
        workflows <- voxelyticsDAO.findWorkflowsByHash(request.identity._organization, runs.map(_.workflow_hash).toSet)
        result = JsArray(workflows.flatMap(workflow => {
          val workflowRuns = runs.filter(run => run.workflow_hash == workflow.hash)
          if (workflowRuns.nonEmpty) {
            val state, beginTime, endTime = aggregateBeginEndTime(workflowRuns)
            Some(
              Json.obj(
                "name" -> workflow.name,
                "hash" -> workflow.hash,
                "beginTime" -> beginTime,
                "endTime" -> endTime,
                "state" -> state.toString(),
                "runs" -> workflowRuns.map(run => {
                  val tasks = taskRuns.filter(taskRun => taskRun.runId == run.runId)
                  Json.obj(
                    "id" -> run.runId,
                    "name" -> run.name,
                    "username" -> run.username,
                    "hostname" -> run.hostname,
                    "voxelyticsVersion" -> run.voxelyticsVersion,
                    "beginTime" -> run.beginTime,
                    "endTime" -> run.endTime,
                    "state" -> run.state,
                    "tasks" -> tasks
                  )
                })
              ))
          } else {
            None
          }
        }))
      } yield JsonOk(result)
    }

  @ApiOperation(hidden = true, value = "")
  def getWorkflow(workflowHash: String, runId: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        workflow <- voxelyticsDAO.findWorkflowByHash(request.identity._organization, workflowHash) ~> NOT_FOUND

        // Fetching all runs for this workflow or specified run
        // If all runs are fetched, a combined version of the workflow report
        // will be returned that contains the information of the most recent task runs
        runs <- runId
          .map(
            runId =>
              voxelyticsDAO.selectRuns(request.identity._organization,
                                       Some(List(ObjectId(runId))),
                                       Some(workflowHash),
                                       conf.staleTimeout))
          .getOrElse(
            voxelyticsDAO.selectRuns(request.identity._organization, None, Some(workflowHash), conf.staleTimeout))
        _ <- bool2Fox(runs.nonEmpty) ~> NOT_FOUND
        sortedRuns = runs.sortBy(_.beginTime).reverse
        // All workflows have at least one run, because they are created at the same time
        mostRecentRun = sortedRuns.head

        // Fetch task runs for all runs
        taskRuns <- voxelyticsDAO.selectTaskRuns(request.identity._organization,
                                                 sortedRuns.map(_.runId),
                                                 conf.staleTimeout)

        // Select one representative "task run" for each task
        // This will be the most recent run that is running or finished or the most recent run
        combinedTaskRuns = taskRuns
          .filter(task => task.runId == mostRecentRun.runId)
          .map(task => {
            val thisTaskRuns = taskRuns.filter(t => t.taskName == task.taskName).sortBy(_.beginTime)
            val nonWaitingTaskRuns = thisTaskRuns.filter(t => {
              t.state == RunState.RUNNING || t.state == RunState.COMPLETE || t.state == RunState.FAILED || t.state == RunState.CANCELLED
            })
            if (nonWaitingTaskRuns.nonEmpty) {
              nonWaitingTaskRuns.head
            } else {
              thisTaskRuns.head
            }
          })

        // Fetch artifact data for selected/combined task runs
        artifacts <- voxelyticsDAO.selectArtifacts(combinedTaskRuns.map(_.taskId))
        artifactsByTask = artifacts.groupBy(_.taskName)
        tasks <- voxelyticsDAO.selectTasks(combinedTaskRuns)

        // Assemble workflow report JSON
        (state, beginTime, endTime) = aggregateBeginEndTime(runs)
        config = mostRecentRun.workflow_config ++ Json.obj(
          "tasks" -> JsObject(tasks.map(t => (t.name, t.config ++ Json.obj("task" -> t.task)))))
        result = Json.obj(
          "config" -> config,
          "artifacts" -> artifactsByTask,
          "run" -> Json.obj(
            "id" -> mostRecentRun.runId.id,
            "name" -> mostRecentRun.name,
            "username" -> mostRecentRun.username,
            "hostname" -> mostRecentRun.hostname,
            "voxelyticsVersion" -> mostRecentRun.voxelyticsVersion,
            "beginTime" -> beginTime,
            "endTime" -> endTime,
            "state" -> state,
            "tasks" -> combinedTaskRuns
          ),
          "workflow" -> Json.obj(
            "name" -> workflow.name,
            "hash" -> workflowHash,
            "yamlContent" -> mostRecentRun.workflow_yamlContent
          )
        )
      } yield JsonOk(result)
    }

  @ApiOperation(hidden = true, value = "")
  def createWorkflowEvents(workflowHash: String, runName: String): Action[List[WorkflowEvent]] =
    sil.SecuredAction.async(validateJson[List[WorkflowEvent]]) { implicit request =>
      def createWorkflowEvent(runId: ObjectId, event: WorkflowEvent): Fox[Unit] =
        event match {
          case ev: RunStateChangeEvent =>
            for {
              _ <- voxelyticsDAO.upsertRunStateChangeEvent(runId, ev)
            } yield ()

          case ev: TaskStateChangeEvent =>
            for {
              taskId <- voxelyticsDAO.getTaskIdByName(ev.taskName, runId)
              _ <- voxelyticsDAO.upsertTaskStateChangeEvent(taskId, ev)
              _ <- Fox.sequence(
                ev.artifacts
                  .map(artifactKV => {
                    val artifactName = artifactKV._1
                    val artifact = artifactKV._2
                    voxelyticsDAO.upsertArtifact(taskId,
                                                 artifactName,
                                                 artifact.path,
                                                 artifact.file_size,
                                                 artifact.inode_count,
                                                 artifact.version,
                                                 artifact.metadata)
                  })
                  .toList)
            } yield ()

          case ev: ChunkStateChangeEvent =>
            for {
              taskId <- voxelyticsDAO.getTaskIdByName(ev.taskName, runId)
              chunkId <- voxelyticsDAO.getChunkIdByName(taskId, ev.executionId, ev.chunkName)
              _ <- voxelyticsDAO.upsertChunkStateChangeEvent(chunkId, ev)
            } yield ()

          case ev: RunHeartbeatEvent =>
            for {
              _ <- voxelyticsDAO.upsertRunHeartbeatEvent(runId, ev)
            } yield ()

          case ev: ChunkProfilingEvent =>
            for {
              taskId <- voxelyticsDAO.getTaskIdByName(ev.taskName, runId)
              chunkId <- voxelyticsDAO.getChunkIdByName(taskId, ev.executionId, ev.chunkName)
              _ <- voxelyticsDAO.upsertChunkProfilingEvent(chunkId, ev)
            } yield ()

          case ev: ArtifactFileChecksumEvent =>
            for {
              taskId <- voxelyticsDAO.getTaskIdByName(ev.taskName, runId)
              artifactId <- voxelyticsDAO.getArtifactIdByName(taskId, ev.artifactName)
              _ <- voxelyticsDAO.upsertArtifactChecksumEvent(artifactId, ev)
            } yield ()
        }

      for {
        // TODO: Authorization based on runId
        runId <- voxelyticsDAO.getRunIdByName(runName, request.identity._organization)
        _ <- Fox.sequence(request.body.map(event => createWorkflowEvent(runId, event)))
      } yield Ok
    }

  @ApiOperation(hidden = true, value = "")
  def getChunkStatistics(workflowHash: String, runId: String, taskName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        // TODO: Authorization based on runId
        taskId <- voxelyticsDAO.getTaskIdByName(taskName, ObjectId(runId))
        results <- voxelyticsDAO.getChunkStatistics(taskId)
      } yield JsonOk(Json.toJson(results))
    }

  @ApiOperation(hidden = true, value = "")
  def getArtifactChecksums(workflowHash: String,
                           runId: String,
                           taskName: String,
                           artifactName: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        // TODO: Authorization based on runId
        taskId <- voxelyticsDAO.getTaskIdByName(taskName, ObjectId(runId))
        results <- voxelyticsDAO.getArtifactChecksums(taskId, artifactName)
      } yield JsonOk(Json.toJson(results))
    }

  @ApiOperation(hidden = true, value = "")
  def appendLogs: Action[List[JsObject]] =
    sil.SecuredAction.async(validateJson[List[JsObject]]) { implicit request =>
      for {
        organization <- organizationDAO.findOne(request.identity._organization)
        logEntries = request.body.map(
          entry =>
            entry ++ Json.obj("vx" -> ((entry \ "vx").as[JsObject] ++ Json.obj("wk_org" -> organization.name,
                                                                               "wk_user" -> request.identity._id.id))))
        _ <- elasticsearchClient.bulkInsert(logEntries)
      } yield Ok
    }

  @ApiOperation(hidden = true, value = "")
  def getLogs(runId: String, taskName: Option[String], minLevel: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        runName <- voxelyticsDAO.getRunNameById(ObjectId(runId), request.identity._organization)
        organization <- organizationDAO.findOne(request.identity._organization)
        organizationName = organization.name
        logEntries <- elasticsearchClient.queryLogs(
          runName,
          organizationName,
          taskName,
          minLevel.flatMap(VoxelyticsLogLevel.fromString).getOrElse(VoxelyticsLogLevel.INFO)) ~> BAD_REQUEST
      } yield JsonOk(logEntries)
    }
}
