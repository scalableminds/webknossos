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
  def storeWorkflow: Action[WorkflowDescription] =
    sil.SecuredAction.async(validateJson[WorkflowDescription]) { implicit request =>
      for {
        _ <- voxelyticsService.checkAuthForWorkflowCreation(request.body.run.name, request.identity) ?~> "Workflow run already exists by other user" ~> UNAUTHORIZED
        _ <- voxelyticsDAO.upsertWorkflow(request.body.workflow.hash,
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
          request.body.config.asJsonWithoutTasks
        )
        _ <- Fox.combined(
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
        runs <- voxelyticsDAO.findRuns(request.identity, None, workflowHash, conf.staleTimeout)
        _ <- bool2Fox(runs.nonEmpty) ?~> "No run found" ~> NOT_FOUND
        taskRuns <- voxelyticsDAO.findTaskRuns(request.identity._organization, runs.map(_.runId), conf.staleTimeout)
        _ <- bool2Fox(taskRuns.nonEmpty) ?~> "No tasks found" ~> NOT_FOUND
        workflows <- voxelyticsDAO.findWorkflowsByHash(request.identity._organization, runs.map(_.workflow_hash).toSet)
        _ <- bool2Fox(workflows.nonEmpty) ?~> "No workflows found" ~> NOT_FOUND

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
                  voxelyticsService.runWrites(run, tasks)
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
        runIdValidated <- Fox.runOptional(runId)(ObjectId.fromString(_))
        // Auth is implemented in `voxelyticsDAO.selectRuns`
        workflow <- voxelyticsDAO.findWorkflowByHash(request.identity._organization, workflowHash) ?~> "Workflow not found" ~> NOT_FOUND

        // Fetching all runs for this workflow or specified run
        // If all runs are fetched, a combined version of the workflow report
        // will be returned that contains the information of the most recent task runs
        runs <- runIdValidated
          .map(runIdValidated =>
            voxelyticsDAO.findRuns(request.identity, Some(List(runIdValidated)), Some(workflowHash), conf.staleTimeout))
          .getOrElse(voxelyticsDAO.findRuns(request.identity, None, Some(workflowHash), conf.staleTimeout))
        _ <- bool2Fox(runs.nonEmpty) ?~> "Runs not found" ~> NOT_FOUND
        sortedRuns = runs.sortBy(_.beginTime).reverse
        // All workflows have at least one run, because they are created at the same time
        mostRecentRun = sortedRuns.head

        // Fetch task runs for all runs
        taskRuns <- voxelyticsDAO.findTaskRuns(request.identity._organization,
                                               sortedRuns.map(_.runId),
                                               conf.staleTimeout)

        // Select one representative "task run" for each task
        // This will be the most recent run that is running or finished or the most recent run
        combinedTaskRuns = taskRuns
          .filter(task => task.runId == mostRecentRun.runId)
          .map(task => {
            val thisTaskRuns = taskRuns.filter(t => t.taskName == task.taskName).sortBy(_.beginTime)
            val nonWaitingTaskRuns = thisTaskRuns.filter(t => {
              t.state == VoxelyticsRunState.RUNNING || t.state == VoxelyticsRunState.COMPLETE || t.state == VoxelyticsRunState.FAILED || t.state == VoxelyticsRunState.CANCELLED
            })
            if (nonWaitingTaskRuns.nonEmpty) {
              nonWaitingTaskRuns.head
            } else {
              thisTaskRuns.head
            }
          })

        // Fetch artifact data for selected/combined task runs
        artifacts <- voxelyticsDAO.findArtifacts(combinedTaskRuns.map(_.taskId))
        tasks <- voxelyticsDAO.findTasks(combinedTaskRuns)

        // Assemble workflow report JSON
        (state, beginTime, endTime) = voxelyticsService.aggregateBeginEndTime(runs)
        result = Json.obj(
          "config" -> voxelyticsService.workflowConfigWrites(mostRecentRun.workflow_config, tasks),
          "artifacts" -> voxelyticsService.artifactsWrites(artifacts),
          "run" -> voxelyticsService
            .runWrites(mostRecentRun.copy(state = state, beginTime = beginTime, endTime = endTime), combinedTaskRuns),
          "workflow" -> Json.obj(
            "name" -> workflow.name,
            "hash" -> workflowHash,
            "yamlContent" -> mostRecentRun.workflow_yamlContent
          )
        )
      } yield JsonOk(result)
    }

  @ApiOperation(hidden = true, value = "")
  def storeWorkflowEvents(workflowHash: String, runName: String): Action[List[WorkflowEvent]] =
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
              _ <- Fox.combined(
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
                                                 artifact.metadataAsJson)
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
        runId <- voxelyticsDAO.getRunIdByName(runName, request.identity._organization) ?~> "Run not found" ~> NOT_FOUND
        _ <- voxelyticsService.checkAuth(runId, request.identity) ~> UNAUTHORIZED
        _ <- Fox.serialCombined(request.body)(event => createWorkflowEvent(runId, event))
      } yield Ok
    }

  @ApiOperation(hidden = true, value = "")
  def getChunkStatistics(workflowHash: String, runId: String, taskName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      {
        for {
          runIdValidated <- ObjectId.fromString(runId)
          _ <- voxelyticsService.checkAuth(runIdValidated, request.identity) ~> UNAUTHORIZED
          taskId <- voxelyticsDAO.getTaskIdByName(taskName, runIdValidated) ?~> "Task not found" ~> NOT_FOUND
          results <- voxelyticsDAO.getChunkStatistics(taskId)
        } yield JsonOk(Json.toJson(results))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def getArtifactChecksums(workflowHash: String,
                           runId: String,
                           taskName: String,
                           artifactName: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      {
        for {
          runIdValidated <- ObjectId.fromString(runId)
          _ <- voxelyticsService.checkAuth(runIdValidated, request.identity) ~> UNAUTHORIZED
          taskId <- voxelyticsDAO.getTaskIdByName(taskName, runIdValidated) ?~> "Task not found" ~> NOT_FOUND
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
  def getLogs(runId: String, taskName: Option[String], minLevel: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      {
        for {
          runIdValidated <- ObjectId.fromString(runId)
          runName <- voxelyticsDAO.getRunNameById(runIdValidated, request.identity._organization)
          _ <- voxelyticsService.checkAuth(runIdValidated, request.identity) ~> UNAUTHORIZED
          organization <- organizationDAO.findOne(request.identity._organization)
          organizationName = organization.name
          logEntries <- elasticsearchClient.queryLogs(
            runName,
            organizationName,
            taskName,
            minLevel.flatMap(VoxelyticsLogLevel.fromString).getOrElse(VoxelyticsLogLevel.INFO))
        } yield JsonOk(logEntries)
      }
    }
}
