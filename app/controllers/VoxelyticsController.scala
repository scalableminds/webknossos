package controllers

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.organization.OrganizationDAO
import models.user.UserService
import models.voxelytics._
import play.api.libs.json._
import play.api.mvc._
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.SecuredRequest
import security.WkEnv
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.util.Try

class VoxelyticsController @Inject() (
    organizationDAO: OrganizationDAO,
    voxelyticsDAO: VoxelyticsDAO,
    voxelyticsService: VoxelyticsService,
    userService: UserService,
    lokiClient: LokiClient,
    wkConf: WkConf,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private val WORKFLOW_EVENT_INSERT_BATCH_SIZE = 500
  private lazy val conf = wkConf.Voxelytics

  def storeWorkflow: Action[WorkflowDescription] =
    sil.SecuredAction.async(validateJson[WorkflowDescription]) { implicit request =>
      for {
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        _ <- voxelyticsService.checkAuthForWorkflowCreation(
          request.body.run.name,
          request.identity
        ) ?~> "voxelytics.workflowUserMismatch" ~> UNAUTHORIZED
        _ <- voxelyticsDAO.upsertWorkflow(
          request.body.workflow.hash,
          request.body.workflow.name,
          request.identity._organization
        )
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
        _ <- Fox.combined(request.body.config.tasks.map { taskKV =>
          val taskName = taskKV._1
          val task = taskKV._2
          voxelyticsService.upsertTaskWithArtifacts(runId, taskName, task, request.body.artifacts)
        }.toList)

      } yield Ok
    }

  def listWorkflows: Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        // Auth is implemented in `voxelyticsDAO.findRunsForWorkflowListing`
        runs <- voxelyticsDAO.findRunsForWorkflowListing(request.identity, conf.staleTimeout)
        result <-
          if (runs.nonEmpty) {
            listWorkflowsWithRuns(request, runs)
          } else {
            Fox.successful(Json.arr())
          }
      } yield JsonOk(result)
    }

  private def listWorkflowsWithRuns(
      request: SecuredRequest[WkEnv, AnyContent],
      runs: List[WorkflowListingRunEntry]
  ): Fox[JsArray] =
    for {
      _ <- bool2Fox(runs.nonEmpty) // just asserting once more
      workflowTaskCounts <- voxelyticsDAO.findWorkflowTaskCounts(
        request.identity,
        runs.map(_.workflowHash).toSet,
        conf.staleTimeout
      )
      _ <- bool2Fox(workflowTaskCounts.nonEmpty) ?~> "voxelytics.noTaskFound" ~> NOT_FOUND
      workflows <- voxelyticsDAO.findWorkflowsByHashAndOrganization(
        request.identity._organization,
        runs.map(_.workflowHash).toSet
      )
      _ <- bool2Fox(workflows.nonEmpty) ?~> "voxelytics.noWorkflowFound" ~> NOT_FOUND

      workflowsAsJson = JsArray(workflows.flatMap { workflow =>
        val workflowRuns = runs.filter(run => run.workflowHash == workflow.hash)
        if (workflowRuns.nonEmpty) {
          val state = workflowRuns.maxBy(_.beginTime).state
          val beginTime = workflowRuns.map(_.beginTime).min
          val endTime = Try(workflowRuns.flatMap(_.endTime).max).toOption
          Some(
            Json.obj(
              "name" -> workflow.name,
              "hash" -> workflow.hash,
              "beginTime" -> beginTime,
              "endTime" -> endTime,
              "state" -> state.toString(),
              "taskCounts" -> workflowTaskCounts.get(workflow.hash),
              "runs" -> workflowRuns
            )
          )
        } else {
          None
        }
      })
    } yield workflowsAsJson

  def getWorkflow(workflowHash: String, runIdOpt: Option[ObjectId]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        // Auth is implemented in `voxelyticsDAO.findRuns`
        workflow <- voxelyticsDAO.findWorkflowByHashAndOrganization(
          request.identity._organization,
          workflowHash
        ) ?~> "voxelytics.workflowNotFound" ~> NOT_FOUND

        // Fetching all runs for this workflow or specified run
        // If all runs are fetched, a combined version of the workflow report
        // will be returned that contains the information of the most recent task runs
        runs <- runIdOpt
          .map(runId =>
            voxelyticsDAO.findRuns(
              request.identity,
              Some(List(runId)),
              Some(workflowHash),
              conf.staleTimeout,
              allowUnlisted = true
            )
          )
          .getOrElse(
            voxelyticsDAO.findRuns(request.identity, None, Some(workflowHash), conf.staleTimeout, allowUnlisted = true)
          )
        _ <- bool2Fox(runs.nonEmpty) ?~> "voxelytics.runNotFound" ~> NOT_FOUND
        sortedRuns = runs.sortBy(_.beginTime).reverse
        // All workflows have at least one run, because they are created at the same time
        mostRecentRun <- sortedRuns.headOption ?~> "voxelytics.zeroRunWorkflow"

        // Fetch task runs for all runs
        allTaskRuns <- voxelyticsDAO.findTaskRuns(sortedRuns.map(_.id), conf.staleTimeout)
        combinedTaskRuns <- voxelyticsDAO.findCombinedTaskRuns(sortedRuns.map(_.id), conf.staleTimeout)

        // Fetch artifact data for task runs
        artifacts <- voxelyticsDAO.findArtifacts(request.identity, sortedRuns.map(_.id), conf.staleTimeout)

        // Fetch task configs
        tasks <- voxelyticsDAO.findTasks(mostRecentRun.id)

        // Assemble workflow report JSON
        result = Json.obj(
          "config" -> voxelyticsService.workflowConfigPublicWrites(mostRecentRun.workflowConfig, tasks),
          "artifacts" -> voxelyticsService.artifactsPublicWrites(artifacts),
          "runs" -> sortedRuns,
          "tasks" -> voxelyticsService.taskRunsPublicWrites(combinedTaskRuns, allTaskRuns),
          "workflow" -> Json.obj(
            "name" -> workflow.name,
            "hash" -> workflowHash,
            "yamlContent" -> mostRecentRun.workflowYamlContent
          )
        )
      } yield JsonOk(result)
    }

  def deleteWorkflow(workflowHash: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        _ <- userService.assertIsSuperUser(request.identity)
        _ <- voxelyticsDAO.findWorkflowByHash(workflowHash) ?~> "voxelytics.workflowNotFound" ~> NOT_FOUND
        _ = logger.info(s"Deleting workflow with hash $workflowHash in organization ${request.identity._organization}")
        _ <- voxelyticsDAO.deleteWorkflow(workflowHash, request.identity._organization)
      } yield Ok
    }

  def storeWorkflowEvents(workflowHash: String, runName: String): Action[List[WorkflowEvent]] =
    sil.SecuredAction.async(validateJson[List[WorkflowEvent]]) { implicit request =>
      def createWorkflowEvent(runId: ObjectId, events: List[WorkflowEvent]): Fox[Unit] =
        events.headOption.map { firstEvent =>
          for {
            _ <- Fox.serialCombined(events.grouped(WORKFLOW_EVENT_INSERT_BATCH_SIZE).toList)(eventBatch =>
              firstEvent match {
                case _: RunStateChangeEvent =>
                  voxelyticsDAO.updateRunStates(runId, eventBatch.map(_.asInstanceOf[RunStateChangeEvent]))

                case _: TaskStateChangeEvent =>
                  val taskEvents = eventBatch.map(_.asInstanceOf[TaskStateChangeEvent])
                  val artifactEvents =
                    taskEvents.flatMap(ev => ev.artifacts.map(artifact => (ev.taskName, artifact._1, artifact._2)))
                  for {
                    _ <- voxelyticsDAO.updateTaskStates(runId, taskEvents)
                    _ <-
                      if (artifactEvents.nonEmpty) {
                        voxelyticsDAO.upsertArtifacts(runId, artifactEvents)
                      } else {
                        Fox.successful(())
                      }
                  } yield ()

                case _: ChunkStateChangeEvent =>
                  voxelyticsDAO.upsertChunkStates(runId, eventBatch.map(_.asInstanceOf[ChunkStateChangeEvent]))

                case _: RunHeartbeatEvent =>
                  voxelyticsDAO.upsertRunHeartbeatEvents(runId, eventBatch.map(_.asInstanceOf[RunHeartbeatEvent]))

                case _: ChunkProfilingEvent =>
                  voxelyticsDAO.upsertChunkProfilingEvents(runId, eventBatch.map(_.asInstanceOf[ChunkProfilingEvent]))

                case _: ArtifactFileChecksumEvent =>
                  voxelyticsDAO.upsertArtifactChecksumEvents(
                    runId,
                    eventBatch.map(_.asInstanceOf[ArtifactFileChecksumEvent])
                  )
              }
            )
          } yield ()
        }.getOrElse(Fox.successful(()))

      val groupedEvents = request.body.groupBy(_.getClass)

      for {
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        // Also checks authorization
        runId <- voxelyticsDAO.getRunIdByNameAndWorkflowHash(
          runName,
          workflowHash,
          request.identity
        ) ?~> "voxelytics.runNotFound" ~> NOT_FOUND
        _ <- Fox.serialCombined(groupedEvents.values.toList)(eventGroup =>
          createWorkflowEvent(runId, eventGroup)
        ) ~> INTERNAL_SERVER_ERROR
      } yield Ok
    }

  def getChunkStatistics(workflowHash: String, runIdOpt: Option[ObjectId], taskName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        runs <- voxelyticsDAO.findRuns(
          request.identity,
          runIdOpt.map(List(_)),
          Some(workflowHash),
          conf.staleTimeout,
          allowUnlisted = true
        )
        _ <- runs.headOption ?~> "voxelytics.runNotFound" ~> NOT_FOUND
        results <- voxelyticsDAO.getChunkStatistics(runs.map(_.id), taskName, conf.staleTimeout)
      } yield JsonOk(Json.toJson(results))
    }

  def getArtifactChecksums(
      workflowHash: String,
      runIdOpt: Option[ObjectId],
      taskName: String,
      artifactName: Option[String]
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        runs <- voxelyticsDAO.findRuns(
          request.identity,
          runIdOpt.map(List(_)),
          Some(workflowHash),
          conf.staleTimeout,
          allowUnlisted = true
        )
        _ <- runs.headOption ?~> "voxelytics.runNotFound" ~> NOT_FOUND
        results <- voxelyticsDAO.getArtifactChecksums(runs.map(_.id), taskName, artifactName, conf.staleTimeout)
      } yield JsonOk(Json.toJson(results))
    }

  def appendLogs: Action[List[JsObject]] =
    sil.SecuredAction.async(validateJson[List[JsObject]]) { implicit request =>
      for {
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        organization <- organizationDAO.findOne(request.identity._organization)
        logEntries = request.body
        _ <- lokiClient.bulkInsertBatched(logEntries, organization._id)
      } yield Ok
    }

  def getLogs(
      runId: ObjectId,
      taskName: Option[String],
      minLevel: Option[String],
      startTimestamp: Long,
      endTimestamp: Long,
      limit: Option[Int]
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        runName <- voxelyticsDAO.getRunNameById(runId, request.identity._organization)
        _ <- voxelyticsService.checkAuth(runId, request.identity) ~> UNAUTHORIZED
        organization <- organizationDAO.findOne(request.identity._organization)
        logEntries <- lokiClient.queryLogsBatched(
          runName,
          organization._id,
          taskName,
          minLevel.flatMap(VoxelyticsLogLevel.fromString).getOrElse(VoxelyticsLogLevel.INFO),
          Instant(startTimestamp),
          Instant(endTimestamp),
          limit
        )
      } yield JsonOk(JsArray(logEntries))
    }
}
