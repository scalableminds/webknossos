package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import models.aimodels.AiInferenceDAO
import models.dataset.DatasetDAO
import models.job.JobCommand.JobCommand

import javax.inject.Inject
import models.job._
import models.organization.CreditTransactionService
import models.voxelytics.VoxelyticsDAO
import net.liftweb.common.{Empty, Failure, Full}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.WkConf

import scala.concurrent.ExecutionContext

class WKRemoteWorkerController @Inject()(jobDAO: JobDAO,
                                         jobService: JobService,
                                         workerDAO: WorkerDAO,
                                         creditTransactionService: CreditTransactionService,
                                         voxelyticsDAO: VoxelyticsDAO,
                                         aiInferenceDAO: AiInferenceDAO,
                                         datasetDAO: DatasetDAO,
                                         wkConf: WkConf)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def requestJobs(key: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      worker <- workerDAO.findOneByKey(key) ?~> "jobs.worker.notFound"
      _ = workerDAO.updateHeartBeat(worker._id)
      _ <- reserveNextJobs(worker, pendingIterationCount = 10)
      assignedUnfinishedJobs: List[Job] <- jobDAO.findAllUnfinishedByWorker(worker._id)
      jobsToCancel: List[Job] <- jobDAO.findAllCancellingByWorker(worker._id)
      // make sure that the jobs to run have not already just been cancelled
      assignedUnfinishedJobsFiltered = assignedUnfinishedJobs.filter(j =>
        !jobsToCancel.map(_._id).toSet.contains(j._id))
      assignedUnfinishedJs <- Fox.serialCombined(assignedUnfinishedJobsFiltered)(
        jobService.parameterWrites(_)(GlobalAccessContext))
      toCancelJs <- Fox.serialCombined(jobsToCancel)(jobService.parameterWrites(_)(GlobalAccessContext))
    } yield Ok(Json.obj("to_run" -> assignedUnfinishedJs, "to_cancel" -> toCancelJs))
  }

  private def reserveNextJobs(worker: Worker, pendingIterationCount: Int): Fox[Unit] =
    for {
      unfinishedHighPriorityCount <- jobDAO.countUnfinishedByWorker(worker._id, JobCommand.highPriorityJobs)
      unfinishedLowPriorityCount <- jobDAO.countUnfinishedByWorker(worker._id, JobCommand.lowPriorityJobs)
      pendingHighPriorityCount <- jobDAO.countUnassignedPendingForDataStore(
        worker._dataStore,
        JobCommand.highPriorityJobs.intersect(worker.supportedJobCommands))
      pendingLowPriorityCount <- jobDAO.countUnassignedPendingForDataStore(
        worker._dataStore,
        JobCommand.lowPriorityJobs.intersect(worker.supportedJobCommands))
      mayAssignHighPriorityJob = unfinishedHighPriorityCount < worker.maxParallelHighPriorityJobs && pendingHighPriorityCount > 0
      mayAssignLowPriorityJob = unfinishedLowPriorityCount < worker.maxParallelLowPriorityJobs && pendingLowPriorityCount > 0
      currentlyAssignableJobCommands = assignableJobCommands(mayAssignHighPriorityJob, mayAssignLowPriorityJob)
        .intersect(worker.supportedJobCommands)
      _ <- if ((!mayAssignHighPriorityJob && !mayAssignLowPriorityJob) || pendingIterationCount == 0)
        Fox.successful(())
      else {
        jobDAO.reserveNextJob(worker, currentlyAssignableJobCommands).flatMap { _ =>
          reserveNextJobs(worker, pendingIterationCount - 1)
        }
      }
    } yield ()

  private def assignableJobCommands(mayAssignHighPriorityJob: Boolean,
                                    mayAssignLowPriorityJob: Boolean): Set[JobCommand] = {
    val lowPriorityOrEmpty = if (mayAssignLowPriorityJob) JobCommand.lowPriorityJobs else Set()
    val highPriorityOrEmpty = if (mayAssignHighPriorityJob) JobCommand.highPriorityJobs else Set()
    lowPriorityOrEmpty ++ highPriorityOrEmpty
  }

  def updateJobStatus(key: String, id: ObjectId): Action[JobStatus] = Action.async(validateJson[JobStatus]) {
    implicit request =>
      for {
        _ <- workerDAO.findOneByKey(key) ?~> "jobs.worker.notFound"
        jobBeforeChange <- jobDAO.findOne(id)(GlobalAccessContext)
        _ <- jobDAO.updateStatus(id, request.body)
        jobAfterChange <- jobDAO.findOne(id)(GlobalAccessContext)
        _ = jobService.trackStatusChange(jobBeforeChange, jobAfterChange)
        _ <- jobService.cleanUpIfFailed(jobAfterChange)
        _ <- Fox.runIf(request.body.state == JobState.SUCCESS) {
          creditTransactionService.completeTransactionOfJob(jobAfterChange._id)(GlobalAccessContext)
        }
        _ <- Fox.runIf(request.body.state == JobState.FAILURE || request.body.state == JobState.CANCELLED) {
          creditTransactionService.refundTransactionForJob(jobAfterChange._id)(GlobalAccessContext)
        }
      } yield Ok
  }

  def attachVoxelyticsWorkflow(key: String, id: ObjectId): Action[String] = Action.async(validateJson[String]) {
    implicit request =>
      for {
        _ <- workerDAO.findOneByKey(key) ?~> "jobs.worker.notFound"
        _ <- bool2Fox(wkConf.Features.voxelyticsEnabled) ?~> "voxelytics.disabled"
        organizationId <- jobDAO.organizationIdForJobId(id) ?~> "job.notFound"
        workflowHash = request.body
        existingWorkflowBox <- voxelyticsDAO.findWorkflowByHashAndOrganization(organizationId, workflowHash).futureBox
        _ <- existingWorkflowBox match {
          case Full(_)    => Fox.successful(())
          case Empty      => voxelyticsDAO.upsertWorkflow(workflowHash, "initializing worker workflow", organizationId)
          case f: Failure => f.toFox
        }
        _ <- jobDAO.updateVoxelyticsWorkflow(id, request.body)
      } yield Ok
  }

  def attachDatasetToInference(key: String, id: ObjectId): Action[String] =
    Action.async(validateJson[String]) { implicit request =>
      implicit val ctx: DBAccessContext = GlobalAccessContext
      for {
        _ <- workerDAO.findOneByKey(key) ?~> "jobs.worker.notFound"
        organizationId <- jobDAO.organizationIdForJobId(id) ?~> "job.notFound"
        dataset <- datasetDAO.findOneByDirectoryNameAndOrganization(request.body, organizationId)
        aiInference <- aiInferenceDAO.findOneByJobId(id) ?~> "aiInference.notFound"
        _ <- aiInferenceDAO.updateDataset(aiInference._id, dataset._id)
      } yield Ok
    }

}
