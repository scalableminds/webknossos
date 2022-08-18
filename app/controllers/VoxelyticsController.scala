package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import io.swagger.annotations._
import models.organization.OrganizationDAO
import models.user.{UserDAO, UserService}
import models.voxelytics._
import oxalis.security.WkEnv
import play.api.http.HttpEntity.NoEntity
import play.api.libs.json._
import play.api.mvc.{ResponseHeader, _}
import utils.{ObjectId, WkConf}

import java.time.Instant
import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

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
  def createWorkflow: Action[VoxelyticsWorkflowDescription] =
    sil.SecuredAction.async(validateJson[VoxelyticsWorkflowDescription]) { implicit request =>
      def upsertTask(_run: ObjectId, taskName: String, task: VoxelyticsWorkflowDescriptionTaskConfig): Fox[Unit] =
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

  @ApiOperation(hidden = true, value = "")
  def listWorkflows(workflowHash: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      notImplemented
    }

  @ApiOperation(hidden = true, value = "")
  def getWorkflow(workflowHash: String, runId: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      notImplemented
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

  private def notImplemented: Future[Result] = Future.successful(Result(ResponseHeader(NOT_IMPLEMENTED), NoEntity))
}
