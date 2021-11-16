package controllers

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import javax.inject.Inject
import models.job.{Job, JobDAO, JobService, JobState, JobStatus}
import models.organization.OrganizationDAO
import oxalis.telemetry.SlackNotificationService
import play.api.i18n.MessagesProvider
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Request}
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

class WKRemoteWorkerController @Inject()(
    jobDAO: JobDAO,
    jobService: JobService,
    wkconf: WkConf,
    slackNotificationService: SlackNotificationService,
    organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def requestJobs: Action[AnyContent] = Action.async { implicit request =>
    for {
      _ <- validateWorkerAccess
      pendingJobs: List[Job] <- jobDAO.findAllByState(JobState.PENDING)(GlobalAccessContext)
      js = pendingJobs.map(jobService.parameterWrites)
    } yield Ok(Json.toJson(js))
  }

  def updateJobStatus(id: String): Action[JobStatus] = Action.async(validateJson[JobStatus]) { implicit request =>
    for {
      _ <- validateWorkerAccess
      jobIdParsed <- ObjectId.parse(id)
      _ <- jobDAO.updateStatus(jobIdParsed, request.body)
    } yield Ok
  }

  private def validateWorkerAccess[A](implicit request: Request[A], m: MessagesProvider): Fox[Unit] =
    for {
      key <- request.getQueryString("key")
      //_ <- workerDAO.findOneByKey(key) ?~> "jobs.worker.notFound"
    } yield ()

}
