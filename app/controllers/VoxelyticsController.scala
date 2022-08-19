package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import io.swagger.annotations._
import models.organization.OrganizationDAO
import models.voxelytics._
import oxalis.security.WkEnv
import play.api.libs.json._
import play.api.mvc._
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

@Api
class VoxelyticsController @Inject()(
    organizationDAO: OrganizationDAO,
    voxelyticsDAO: VoxelyticsDAO,
    voxelyticsService: VoxelyticsService,
    elasticsearchClient: ElasticsearchClient,
    wkConf: WkConf,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private lazy val conf = wkConf.Voxelytics

  override def allowRemoteOrigin: Boolean = true

  @ApiOperation(hidden = true, value = "")
  def createWorkflow: Action[WorkflowDescription] =
    sil.SecuredAction.async(validateJson[WorkflowDescription]) { implicit request =>
      for {
        _ <- voxelyticsDAO.upsertWorkflow(request.body.workflow.hash,
                                          request.body.workflow.name,
                                          request.identity._organization)
        _ <- voxelyticsService.checkAuthCreateWorkflow(request.body.run.name, request.identity) ~> UNAUTHORIZED
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
              voxelyticsService.upsertTask(runId, taskName, task, request.body.artifacts)
            })
            .toList)

      } yield Ok
    }

  @ApiOperation(hidden = true, value = "")
  def listWorkflows(workflowHash: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        // Auth is implemented in `voxelyticsDAO.selectRuns`
        runs <- voxelyticsDAO.selectRuns(request.identity, None, workflowHash, conf.staleTimeout)
        _ <- bool2Fox(runs.nonEmpty) ~> NOT_FOUND
        taskRuns <- voxelyticsDAO.selectTaskRuns(request.identity._organization, runs.map(_.runId), conf.staleTimeout)
        _ <- bool2Fox(taskRuns.nonEmpty) ~> NOT_FOUND
        workflows <- voxelyticsDAO.findWorkflowsByHash(request.identity._organization, runs.map(_.workflow_hash).toSet)
        _ <- bool2Fox(workflows.nonEmpty) ~> NOT_FOUND

        result = JsArray(workflows.flatMap(workflow => {
          val workflowRuns = runs.filter(run => run.workflow_hash == workflow.hash)
          if (workflowRuns.nonEmpty) {
            val state, beginTime, endTime = voxelyticsService.aggregateBeginEndTime(workflowRuns)
            Some(
              Json.obj(
                "name" -> workflow.name,
                "hash" -> workflow.hash,
                "beginTime" -> beginTime,
                "endTime" -> endTime,
                "state" -> state.toString(),
                "runs" -> workflowRuns.map(run => {
                  val tasks = taskRuns.filter(taskRun => taskRun.runId == run.runId)
                  voxelyticsService.writesRun(run, tasks)
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
        // Auth is implemented in `voxelyticsDAO.selectRuns`
        workflow <- voxelyticsDAO.findWorkflowByHash(request.identity._organization, workflowHash) ~> NOT_FOUND

        // Fetching all runs for this workflow or specified run
        // If all runs are fetched, a combined version of the workflow report
        // will be returned that contains the information of the most recent task runs
        runs <- runId
          .map(
            runId =>
              voxelyticsDAO
                .selectRuns(request.identity, Some(List(ObjectId(runId))), Some(workflowHash), conf.staleTimeout))
          .getOrElse(voxelyticsDAO.selectRuns(request.identity, None, Some(workflowHash), conf.staleTimeout))
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
        tasks <- voxelyticsDAO.selectTasks(combinedTaskRuns)

        // Assemble workflow report JSON
        (state, beginTime, endTime) = voxelyticsService.aggregateBeginEndTime(runs)
        result = Json.obj(
          "config" -> voxelyticsService.writesWorkflowConfig(mostRecentRun.workflow_config, tasks),
          "artifacts" -> voxelyticsService.writesArtifacts(artifacts),
          "run" -> voxelyticsService
            .writesRun(mostRecentRun.copy(state = state, beginTime = beginTime, endTime = endTime), combinedTaskRuns),
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
              chunkId <- voxelyticsDAO.upsertChunk(taskId, ev.executionId, ev.chunkName)
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
        runId <- voxelyticsDAO.getRunIdByName(runName, request.identity._organization) ~> NOT_FOUND
        _ <- voxelyticsService.checkAuth(runId, request.identity) ~> UNAUTHORIZED
        _ <- Fox.sequence(request.body.map(event => createWorkflowEvent(runId, event)))
      } yield Ok
    }

  @ApiOperation(hidden = true, value = "")
  def getChunkStatistics(workflowHash: String, runIdS: String, taskName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      {
        val runId = ObjectId(runIdS)
        for {
          _ <- voxelyticsService.checkAuth(runId, request.identity) ~> UNAUTHORIZED
          taskId <- voxelyticsDAO.getTaskIdByName(taskName, runId) ~> NOT_FOUND
          results <- voxelyticsDAO.getChunkStatistics(taskId)
        } yield JsonOk(Json.toJson(results))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def getArtifactChecksums(workflowHash: String,
                           runIdS: String,
                           taskName: String,
                           artifactName: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      {
        val runId = ObjectId(runIdS)
        for {
          _ <- voxelyticsService.checkAuth(runId, request.identity) ~> UNAUTHORIZED
          taskId <- voxelyticsDAO.getTaskIdByName(taskName, runId) ~> NOT_FOUND
          results <- voxelyticsDAO.getArtifactChecksums(taskId, artifactName)
        } yield JsonOk(Json.toJson(results))
      }
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
  def getLogs(runIdS: String, taskName: Option[String], minLevel: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      {
        val runId = ObjectId(runIdS)
        for {
          runName <- voxelyticsDAO.getRunNameById(runId, request.identity._organization)
          _ <- voxelyticsService.checkAuth(runId, request.identity) ~> UNAUTHORIZED
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
}
