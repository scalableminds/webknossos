package models.job

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import mail.{DefaultMails, MailchimpClient, MailchimpTag, Send}
import models.analytics.{AnalyticsService, FailedJobEvent, RunJobEvent}
import models.dataset.DatasetDAO
import models.job.JobCommand.JobCommand
import models.organization.{CreditTransactionService, OrganizationDAO, OrganizationService}
import models.user.{MultiUserDAO, User, UserDAO, UserService}
import net.liftweb.common.Full
import org.apache.pekko.actor.ActorSystem
import play.api.libs.json.{JsObject, Json}
import security.WkSilhouetteEnvironment
import telemetry.SlackNotificationService
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.math.BigDecimal.RoundingMode

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
                           organizationService: OrganizationService,
                           creditTransactionService: CreditTransactionService,
                           wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                           slackNotificationService: SlackNotificationService)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with Formatter {

  private val MINIMUM_COST_PER_JOB = BigDecimal(0.001)
  private val ONE_GIGAVOXEL = BigDecimal(math.pow(10, 9))
  private val SHOULD_DEDUCE_CREDITS = false

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
      workflowLink = jobAfterChange.workflowLinkSlackFormatted(wkConf.Http.uri)
      msg = s"Job ${jobBeforeChange._id} failed$durationLabel. Command ${jobBeforeChange.command}, organization: ${organization.name}.$workflowLink"
      _ = logger.warn(msg)
      _ = slackNotificationService.warn(
        s"Failed job$superUserLabel",
        msg
      )
      _ = if (!jobAfterChange.retriedBySuperUser) sendFailedEmailNotification(user, jobAfterChange)
    } yield ()
    ()
  }

  private def trackNewlySuccessful(jobBeforeChange: Job, jobAfterChange: Job): Unit = {
    for {
      user <- userDAO.findOne(jobBeforeChange._owner)(GlobalAccessContext)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      resultLink = jobAfterChange.resultLinkPublic(organization._id, wkConf.Http.uri)
      resultLinkSlack = jobAfterChange.resultLinkSlackFormatted(organization._id, wkConf.Http.uri)
      workflowLink = jobAfterChange.workflowLinkSlackFormatted(wkConf.Http.uri)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      durationLabel = jobAfterChange.duration.map(d => s" after ${formatDuration(d)}").getOrElse("")
      msg = s"Job ${jobBeforeChange._id} succeeded$durationLabel. Command ${jobBeforeChange.command}, organization: ${organization.name}.$resultLinkSlack$workflowLink"
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
      logger.info(
        s"WKW conversion job ${job._id} failed. Deleting dataset from the database, freeing the directoryName...")
      val commandArgs = job.commandArgs.value
      for {
        datasetDirectoryName <- commandArgs.get("dataset_directory_name").map(_.as[String]).toFox
        organizationId <- commandArgs.get("organization_id").map(_.as[String]).toFox
        dataset <- datasetDAO.findOneByDirectoryNameAndOrganization(datasetDirectoryName, organizationId)(
          GlobalAccessContext)
        _ <- datasetDAO.deleteDataset(dataset._id)
      } yield ()
    } else Fox.successful(())

  def publicWrites(job: Job)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      owner <- userDAO.findOne(job._owner) ?~> "user.notFound"
      organization <- organizationDAO.findOne(owner._organization) ?~> "organization.notFound"
      resultLink = job.resultLink(organization._id)
      ownerJson <- userService.compactWrites(owner)
      creditTransactionOpt <- creditTransactionService.findTransactionOfJob(job._id)
    } yield {
      Json.obj(
        "id" -> job._id.id,
        "owner" -> ownerJson,
        "command" -> job.command,
        "commandArgs" -> (job.commandArgs - "webknossos_token" - "user_auth_token"),
        "state" -> job.state,
        "manualState" -> job.manualState,
        "latestRunId" -> job.latestRunId,
        "returnValue" -> job.returnValue,
        "resultLink" -> resultLink,
        "voxelyticsWorkflowHash" -> job._voxelyticsWorkflowHash,
        "created" -> job.created,
        "started" -> job.started,
        "ended" -> job.ended,
        "creditCost" -> creditTransactionOpt.map(t => (t.creditDelta * -1).toString)
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
      _ <- Fox.fromBool(wkConf.Features.jobsEnabled) ?~> "job.disabled"
      _ <- Fox.assertTrue(jobIsSupportedByAvailableWorkers(command, dataStoreName)) ?~> "job.noWorkerForDatastoreAndJob"
      job = Job(ObjectId.generate, owner._id, dataStoreName, command, commandArgs)
      _ <- jobDAO.insertOne(job)
      _ = analyticsService.track(RunJobEvent(owner, command))
    } yield job

  def submitPaidJob(command: JobCommand,
                    commandArgs: JsObject,
                    jobBoundingBox: BoundingBox,
                    creditTransactionComment: String,
                    user: User,
                    datastoreName: String)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      costsInCredits <- if (SHOULD_DEDUCE_CREDITS) calculateJobCostInCredits(jobBoundingBox, command)
      else Fox.successful(BigDecimal(0))
      _ <- Fox.assertTrue(creditTransactionService.hasEnoughCredits(user._organization, costsInCredits)) ?~> "job.notEnoughCredits"
      creditTransaction <- creditTransactionService.reserveCredits(user._organization,
                                                                   costsInCredits,
                                                                   creditTransactionComment)
      job <- submitJob(command, commandArgs, user, datastoreName).futureBox.flatMap {
        case Full(job) => Fox.successful(job)
        case _ =>
          creditTransactionService
            .refundTransactionWhenStartingJobFailed(creditTransaction)
            .flatMap(_ => Fox.failure("job.couldNotRunAlignSections"))
      }.toFox
      _ <- creditTransactionService.addJobIdToTransaction(creditTransaction, job._id)
      js <- publicWrites(job)
    } yield js

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
      boundingBoxInMag <- BoundingBox.fromLiteralWithMagOpt(boundingBox, mag) ?~> "job.invalidBoundingBoxOrMag"
      _ <- Fox.fromBool(boundingBoxInMag.volume <= wkConf.Features.exportTiffMaxVolumeMVx * 1024 * 1024) ?~> "job.volumeExceeded"
      _ <- Fox.fromBool(boundingBoxInMag.size.maxDim <= wkConf.Features.exportTiffMaxEdgeLengthVx) ?~> "job.edgeLengthExceeded"
    } yield ()

  private def getJobCostPerGVx(jobCommand: JobCommand): Fox[BigDecimal] =
    jobCommand match {
      case JobCommand.infer_neurons      => Fox.successful(wkConf.Features.neuronInferralCostPerGVx)
      case JobCommand.infer_mitochondria => Fox.successful(wkConf.Features.mitochondriaInferralCostPerGVx)
      case JobCommand.align_sections     => Fox.successful(wkConf.Features.alignmentCostPerGVx)
      case _                             => Fox.failure(s"Unsupported job command $jobCommand")
    }

  def calculateJobCostInCredits(boundingBoxInTargetMag: BoundingBox, jobCommand: JobCommand): Fox[BigDecimal] =
    getJobCostPerGVx(jobCommand).map(costPerGVx => {
      val volumeInGVx = BigDecimal(boundingBoxInTargetMag.volume) / ONE_GIGAVOXEL
      val costInCredits = volumeInGVx * costPerGVx
      if (costInCredits < MINIMUM_COST_PER_JOB) MINIMUM_COST_PER_JOB
      else costInCredits.setScale(3, RoundingMode.HALF_UP)
    })

}
