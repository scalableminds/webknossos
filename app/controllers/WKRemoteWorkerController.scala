package controllers

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import javax.inject.Inject
import models.job._
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Request}
import utils.ObjectId

import scala.concurrent.ExecutionContext

class WKRemoteWorkerController @Inject()(jobDAO: JobDAO, jobService: JobService, workerDAO: WorkerDAO)(
    implicit ec: ExecutionContext,
    bodyParsers: PlayBodyParsers)
    extends Controller {

  def requestJobs: Action[AnyContent] = Action.async { implicit request =>
    for {
      worker <- validateWorkerAccess
      _ <- reserveNextJobs(worker)
      assignedUnfinishedJobs: List[Job] <- jobDAO.findAllUnfinishedByWorker(worker._id)
      _ = workerDAO.updateHeartBeat(worker._id)
      js = assignedUnfinishedJobs.map(jobService.parameterWrites)
    } yield Ok(Json.toJson(js))
  }

  private def reserveNextJobs(worker: Worker): Fox[Unit] =
    reserveNextJobsIter(worker, 1)

  private def reserveNextJobsIter(worker: Worker, depth: Int): Fox[Unit] =
    for {
      unfinishedCount <- jobDAO.countUnfinishedByWorker(worker._id)
      pendingCount <- jobDAO.countUnassignedPendingForDataStore(worker._dataStore)
      _ <- if (unfinishedCount >= worker.maxParallelJobs || pendingCount == 0) Fox.successful(())
      else {
        jobDAO.reserveNextJob(worker).flatMap { _ =>
          reserveNextJobsIter(worker, depth + 1)
        }
      }
    } yield ()

  def updateJobStatus(id: String): Action[JobStatus] = Action.async(validateJson[JobStatus]) { implicit request =>
    for {
      _ <- validateWorkerAccess
      jobIdParsed <- ObjectId.parse(id)
      job <- jobDAO.findOne(jobIdParsed)(GlobalAccessContext)
      _ <- jobDAO.updateStatus(jobIdParsed, request.body)
      _ = jobService.trackStatusChange(job, request.body)
    } yield Ok
  }

  private def validateWorkerAccess[A](implicit request: Request[A]): Fox[Worker] =
    for {
      key <- request.getQueryString("key").toFox
      worker <- workerDAO.findOneByKey(key) ?~> "jobs.worker.notFound"
    } yield worker

}
