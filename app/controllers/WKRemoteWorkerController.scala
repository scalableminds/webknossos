package controllers

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
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
      _ <- reserveNextJobs(worker)
      assignedUnfinishedJobs: List[Job] <- jobDAO.findAllUnfinishedByWorker(worker._id)
      _ = workerDAO.updateHeartBeat(worker._id)
      js = assignedUnfinishedJobs.map(jobService.parameterWrites)
    } yield Ok(Json.toJson(js))
  }

  private def reserveNextJobs(worker: Worker): Fox[Unit] =
    for {
      unfinishedCount <- jobDAO.countUnfinishedByWorker(worker._id)
      pendingCount <- jobDAO.countUnassignedPendingForDataStore(worker._dataStore)
      _ <- if (unfinishedCount >= worker.maxParallelJobs || pendingCount == 0) Fox.successful(())
      else {
        jobDAO.reserveNextJob(worker).flatMap { _ =>
          reserveNextJobs(worker)
        }
      }
    } yield ()

  def updateJobStatus(key: String, id: String): Action[JobStatus] = Action.async(validateJson[JobStatus]) {
    implicit request =>
      for {
        _ <- workerDAO.findOneByKey(key) ?~> "jobs.worker.notFound"
        jobIdParsed <- ObjectId.parse(id)
        jobBeforeChange <- jobDAO.findOne(jobIdParsed)(GlobalAccessContext)
        _ <- jobDAO.updateStatus(jobIdParsed, request.body)
        jobAfterChange <- jobDAO.findOne(jobIdParsed)(GlobalAccessContext)
        _ = jobService.trackStatusChange(jobBeforeChange, jobAfterChange)
      } yield Ok
  }

}
