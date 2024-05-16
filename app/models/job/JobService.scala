package models.job

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import mail.{DefaultMails, MailchimpClient, MailchimpTag, Send}
import models.analytics.{AnalyticsService, FailedJobEvent, RunJobEvent}
import models.dataset.DatasetDAO
import models.job.JobCommand.JobCommand
import models.organization.OrganizationDAO
import models.user.{MultiUserDAO, User, UserDAO, UserService}
import org.apache.pekko.actor.ActorSystem
import play.api.libs.json.{JsObject, Json}
import security.WkSilhouetteEnvironment
import telemetry.SlackNotificationService
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class JobService @Inject()(wkConf: WkConf,
                           actorSystem: ActorSystem,
                           userDAO: UserDAO,
                           mailchimpClient: MailchimpClient,
                           multiUserDAO: MultiUserDAO,
                           jobDAO: JobDAO,
                           workerDAO: WorkerDAO,
                           organizationDAO: OrganizationDAO,
                           datasetDAO: DatasetDAO,
                           defaultMails: DefaultMails,
                           analyticsService: AnalyticsService,
                           userService: UserService,
                           wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                           slackNotificationService: SlackNotificationService)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with Formatter {

  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  def trackStatusChange(jobBeforeChange: Job, jobAfterChange: Job): Unit =
    if (!jobBeforeChange.isEnded) {
      if (jobAfterChange.state == JobState.SUCCESS) trackNewlySuccessful(jobBeforeChange, jobAfterChange)
      if (jobAfterChange.state == JobState.FAILURE) trackNewlyFailed(jobBeforeChange, jobAfterChange)
    }

  private def trackNewlyFailed(jobBeforeChange: Job, jobAfterChange: Job): Unit = {
    for {
      user <- userDAO.findOne(jobBeforeChange._owner)(GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      durationLabel = jobAfterChange.duration.map(d => s" after ${formatDuration(d)}").getOrElse("")
      _ = analyticsService.track(FailedJobEvent(user, jobBeforeChange.command))
      msg = s"Job ${jobBeforeChange._id} failed$durationLabel. Command ${jobBeforeChange.command}, organization: ${organization.displayName}."
      _ = logger.warn(msg)
      _ = slackNotificationService.warn(
        s"Failed job$superUserLabel",
        msg
      )
      _ = sendFailedEmailNotification(user, jobAfterChange)
    } yield ()
    ()
  }

  private def trackNewlySuccessful(jobBeforeChange: Job, jobAfterChange: Job): Unit = {
    for {
      user <- userDAO.findOne(jobBeforeChange._owner)(GlobalAccessContext)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      resultLink = jobAfterChange.resultLinkPublic(organization.name, wkConf.Http.uri)
      resultLinkSlack = jobAfterChange.resultLinkSlackFormatted(organization.name, wkConf.Http.uri)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      durationLabel = jobAfterChange.duration.map(d => s" after ${formatDuration(d)}").getOrElse("")
      msg = s"Job ${jobBeforeChange._id} succeeded$durationLabel. Command ${jobBeforeChange.command}, organization: ${organization.displayName}.${resultLinkSlack
        .getOrElse("")}"
      _ = logger.info(msg)
      _ = slackNotificationService.success(
        s"Successful job$superUserLabel",
        msg
      )
      _ = sendSuccessEmailNotification(user, jobAfterChange, resultLink.getOrElse(""))
      _ = if (jobAfterChange.command == JobCommand.convert_to_wkw)
        mailchimpClient.tagUser(user, MailchimpTag.HasUploadedOwnDataset)
    } yield ()
    ()
  }

  private def sendSuccessEmailNotification(user: User, job: Job, resultLink: String): Unit =
    for {
      userEmail <- userService.emailFor(user)(GlobalAccessContext)
      datasetName = job.datasetName.getOrElse("")
      genericEmailTemplate = defaultMails.jobSuccessfulGenericMail(user, userEmail, datasetName, resultLink, _, _)
      emailTemplate <- (job.command match {
        case JobCommand.convert_to_wkw =>
          Some(defaultMails.jobSuccessfulUploadConvertMail(user, userEmail, datasetName, resultLink))
        case JobCommand.export_tiff =>
          Some(
            genericEmailTemplate(
              "Tiff Export",
              "Your dataset has been exported as Tiff and is ready for download."
            ))
        case JobCommand.infer_nuclei =>
          Some(
            defaultMails.jobSuccessfulSegmentationMail(user, userEmail, datasetName, resultLink, "Nuclei Segmentation"))
        case JobCommand.infer_neurons =>
          Some(
            defaultMails.jobSuccessfulSegmentationMail(user, userEmail, datasetName, resultLink, "Neuron Segmentation",
            ))
        case JobCommand.materialize_volume_annotation =>
          Some(
            genericEmailTemplate(
              "Volume Annotation Merged",
              "Your volume annotation has been successfully merged with the existing segmentation. The result is available as a new dataset in your dashboard."
            ))
        case JobCommand.compute_mesh_file =>
          Some(
            genericEmailTemplate(
              "Mesh Generation",
              "WEBKNOSSOS created 3D meshes for the whole segmentation layer of your dataset. Load pre-computed meshes by right-clicking any segment and choosing the corresponding option for near instant visualizations."
            ))
        case JobCommand.render_animation =>
          Some(
            genericEmailTemplate(
              "Dataset Animation",
              "Your animation of a WEBKNOSSOS dataset has been successfully created and is ready for download."
            ))
        case _ => None
      }) ?~> "job.emailNotifactionsDisabled"
      // some jobs, e.g. "find largest segment ideas", do not require an email notification
      _ = Mailer ! Send(emailTemplate)
    } yield ()

  private def sendFailedEmailNotification(user: User, job: Job): Unit =
    for {
      userEmail <- userService.emailFor(user)(GlobalAccessContext)
      datasetName = job.datasetName.getOrElse("")
      emailTemplate = job.command match {
        case JobCommand.convert_to_wkw => defaultMails.jobFailedUploadConvertMail(user, userEmail, datasetName)
        case _                         => defaultMails.jobFailedGenericMail(user, userEmail, datasetName, job.command.toString)
      }
      _ = Mailer ! Send(emailTemplate)
    } yield ()

  def cleanUpIfFailed(job: Job): Fox[Unit] =
    if (job.state == JobState.FAILURE && job.command == JobCommand.convert_to_wkw) {
      logger.info(s"WKW conversion job ${job._id} failed. Deleting dataset from the database, freeing the name...")
      val commandArgs = job.commandArgs.value
      for {
        datasetName <- commandArgs.get("dataset_name").map(_.as[String]).toFox
        organizationName <- commandArgs.get("organization_name").map(_.as[String]).toFox
        dataset <- datasetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)(GlobalAccessContext)
        _ <- datasetDAO.deleteDataset(dataset._id)
      } yield ()
    } else Fox.successful(())

  def publicWrites(job: Job)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      owner <- userDAO.findOne(job._owner) ?~> "user.notFound"
      organization <- organizationDAO.findOne(owner._organization) ?~> "organization.notFound"
      resultLink = job.resultLink(organization.name)
    } yield {
      Json.obj(
        "id" -> job._id.id,
        "command" -> job.command,
        "commandArgs" -> (job.commandArgs - "webknossos_token" - "user_auth_token"),
        "state" -> job.state,
        "manualState" -> job.manualState,
        "latestRunId" -> job.latestRunId,
        "returnValue" -> job.returnValue,
        "resultLink" -> resultLink,
        "created" -> job.created,
        "started" -> job.started,
        "ended" -> job.ended,
      )
    }

  // Only seen by the workers
  def parameterWrites(job: Job)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      owner <- userDAO.findOne(job._owner)
      userAuthToken <- wkSilhouetteEnvironment.combinedAuthenticatorService.findOrCreateToken(owner.loginInfo)
    } yield {
      Json.obj(
        "job_id" -> job._id.id,
        "command" -> job.command,
        "job_kwargs" -> (job.commandArgs ++ Json.obj("user_auth_token" -> userAuthToken.id))
      )
    }

  def submitJob(command: JobCommand, commandArgs: JsObject, owner: User, dataStoreName: String): Fox[Job] =
    for {
      _ <- bool2Fox(wkConf.Features.jobsEnabled) ?~> "job.disabled"
      _ <- Fox.assertTrue(jobIsSupportedByAvailableWorkers(command, dataStoreName)) ?~> "job.noWorkerForDatastore"
      job = Job(ObjectId.generate, owner._id, dataStoreName, command, commandArgs)
      _ <- jobDAO.insertOne(job)
      _ = analyticsService.track(RunJobEvent(owner, command))
    } yield job

  def jobsSupportedByAvailableWorkers(dataStoreName: String): Fox[Set[JobCommand]] =
    for {
      workers <- workerDAO.findAllByDataStore(dataStoreName)
      jobs = if (workers.isEmpty) Set[JobCommand]() else workers.map(_.supportedJobCommands).reduce(_.union(_))
    } yield jobs

  private def jobIsSupportedByAvailableWorkers(command: JobCommand, dataStoreName: String): Fox[Boolean] =
    for {
      jobs <- jobsSupportedByAvailableWorkers(dataStoreName)
    } yield jobs.contains(command)

  def assertBoundingBoxLimits(boundingBox: String, mag: Option[String]): Fox[Unit] =
    for {
      parsedBoundingBox <- BoundingBox.fromLiteral(boundingBox).toFox ?~> "job.invalidBoundingBox"
      parsedMag <- Vec3Int.fromMagLiteral(mag.getOrElse("1-1-1"), allowScalar = true) ?~> "job.invalidMag"
      boundingBoxInMag = parsedBoundingBox / parsedMag
      _ <- bool2Fox(boundingBoxInMag.volume <= wkConf.Features.exportTiffMaxVolumeMVx * 1024 * 1024) ?~> "job.volumeExceeded"
      _ <- bool2Fox(boundingBoxInMag.size.maxDim <= wkConf.Features.exportTiffMaxEdgeLengthVx) ?~> "job.edgeLengthExceeded"
    } yield ()

}
