package controllers

import java.nio.file.{Files, Paths}
import java.util.Date

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import javax.inject.Inject
import models.job.{JobDAO, JobService, JobStatus}
import models.organization.OrganizationDAO
import oxalis.security.WkEnv
import oxalis.telemetry.SlackNotificationService
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

class JobsController @Inject()(
    jobDAO: JobDAO,
    sil: Silhouette[WkEnv],
    jobService: JobService,
    wkconf: WkConf,
    slackNotificationService: SlackNotificationService,
    organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def status: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(())
      /*jobCountsByStatus <- jobService.countByStatus()
      workerStatus <- jobService.workerStatus()
      jsStatus = Json.obj(
        "workers" -> workerStatus,
        "queue" -> Json.toJson(jobCountsByStatus)
      )*/
    } yield Ok
  }

  def request: Action[AnyContent] = Action.async { implicit request =>
    Fox.successful(Ok)
  }

  def updateStatus(jobId: String): Action[JobStatus] = Action.async(validateJson[JobStatus]) { implicit request =>
    for {
      jobIdParsed <- ObjectId.parse(jobId)
      _ <- jobDAO.updateStatus(jobIdParsed, request.body)
    } yield Ok
  }

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(wkconf.Features.jobsEnabled) ?~> "job.disabled"
      jobs <- jobDAO.findAll
      jobsJsonList <- Fox.serialCombined(jobs.sortBy(-_.created))(jobService.publicWrites)
    } yield Ok(Json.toJson(jobsJsonList))
  }

  def get(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(wkconf.Features.jobsEnabled) ?~> "job.disabled"
      job <- jobDAO.findOne(ObjectId(id))
      js <- jobService.publicWrites(job)
    } yield Ok(js)
  }

  def runConvertToWkwJob(organizationName: String, dataSetName: String, scale: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                       organizationName)
          _ <- bool2Fox(request.identity._organization == organization._id) ~> FORBIDDEN
          command = "convert_to_wkw"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "scale" -> scale,
            "webknossos_token" -> RpcTokenHolder.webKnossosToken
          )

          job <- jobService.submitJob(command, commandArgs, request.identity) ?~> "job.couldNotRunCubing"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runComputeMeshFileJob(organizationName: String,
                            dataSetName: String,
                            layerName: String,
                            mag: String,
                            agglomerateView: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                     organizationName)
        _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.meshFile.notAllowed.organization" ~> FORBIDDEN
        command = "compute_mesh_file"
        commandArgs = Json.obj(
          "organization_name" -> organizationName,
          "dataset_name" -> dataSetName,
          "layer_name" -> layerName,
          "mag" -> mag,
          "agglomerate_view" -> agglomerateView
        )
        job <- jobService.submitJob(command, commandArgs, request.identity) ?~> "job.couldNotRunComputeMeshFile"
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def runInferNucleiJob(organizationName: String, dataSetName: String, layerName: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                       organizationName)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.inferNuclei.notAllowed.organization" ~> FORBIDDEN
          command = "infer_nuclei"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "layer_name" -> layerName,
            "webknossos_token" -> RpcTokenHolder.webKnossosToken,
          )
          job <- jobService.submitJob(command, commandArgs, request.identity) ?~> "job.couldNotRunNucleiInferral"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runExportTiffJob(organizationName: String,
                       dataSetName: String,
                       bbox: String,
                       layerName: Option[String],
                       tracingId: Option[String],
                       tracingVersion: Option[String],
                       annotationId: Option[String],
                       annotationType: Option[String],
                       hideUnmappedIds: Option[Boolean],
                       mappingName: Option[String],
                       mappingType: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                       organizationName)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.export.notAllowed.organization" ~> FORBIDDEN
          _ <- jobService.assertTiffExportBoundingBoxLimits(bbox)
          command = "export_tiff"
          exportFileName = s"${formatDateForFilename(new Date())}__${dataSetName}__${tracingId.map(_ => "volume").getOrElse(layerName.getOrElse(""))}.zip"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "bbox" -> bbox,
            "webknossos_token" -> RpcTokenHolder.webKnossosToken,
            "export_file_name" -> exportFileName,
            "layer_name" -> layerName,
            "volume_tracing_id" -> tracingId,
            "volume_tracing_version" -> tracingVersion,
            "annotation_id" -> annotationId,
            "annotation_type" -> annotationType,
            "mapping_name" -> mappingName,
            "mapping_type" -> mappingType,
            "hide_unmapped_ids" -> hideUnmappedIds
          )
          job <- jobService.submitJob(command, commandArgs, request.identity) ?~> "job.couldNotRunTiffExport"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def downloadExport(jobId: String, exportFileName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        jobIdValidated <- ObjectId.parse(jobId)
        job <- jobDAO.findOne(jobIdValidated)
        latestRunId <- job.latestRunId.toFox
        organization <- organizationDAO.findOne(request.identity._organization)
        filePath = Paths.get("binaryData", organization.name, ".export", latestRunId, exportFileName)
        _ <- bool2Fox(Files.exists(filePath)) ?~> "job.export.fileNotFound"
      } yield Ok.sendPath(filePath, inline = false)
    }

}
