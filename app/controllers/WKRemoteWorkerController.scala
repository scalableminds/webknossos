package controllers

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.job.JobCommand.JobCommand

import javax.inject.Inject
import models.job._
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.ObjectId

import scala.concurrent.ExecutionContext

class WKRemoteWorkerController @Inject()(jobDAO: JobDAO, jobService: JobService, workerDAO: WorkerDAO)(
    implicit ec: ExecutionContext,
    bodyParsers: PlayBodyParsers)
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

  def updateJobStatus(key: String, id: String): Action[JobStatus] = Action.async(validateJson[JobStatus]) {
    implicit request =>
      for {
        _ <- workerDAO.findOneByKey(key) ?~> "jobs.worker.notFound"
        jobIdParsed <- ObjectId.fromString(id)
        jobBeforeChange <- jobDAO.findOne(jobIdParsed)(GlobalAccessContext)
        _ <- jobDAO.updateStatus(jobIdParsed, request.body)
        jobAfterChange <- jobDAO.findOne(jobIdParsed)(GlobalAccessContext)
        _ = jobService.trackStatusChange(jobBeforeChange, jobAfterChange)
        _ <- jobService.cleanUpIfFailed(jobAfterChange)
      } yield Ok
  }

}
