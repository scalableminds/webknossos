package controllers

import java.nio.file.{Files, Paths}
import java.util.Date

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import javax.inject.Inject
import models.job.{JobDAO, JobService}
import models.organization.OrganizationDAO
import oxalis.security.WkEnv
import oxalis.telemetry.SlackNotificationService
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

class JobsController @Inject()(jobDAO: JobDAO,
                               sil: Silhouette[WkEnv],
                               jobService: JobService,
                               wkconf: WkConf,
                               slackNotificationService: SlackNotificationService,
                               organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext)
    extends Controller {

  def status: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      taskInfos <- jobService.fetchCeleryInfos()
      taskCountsByStatus = jobService.countByStatus(taskInfos)
      workerStatus <- jobService.fetchWorkerStatus()
      jsStatus = Json.obj(
        "workers" -> workerStatus,
        "queue" -> Json.toJson(taskCountsByStatus)
      )
    } yield Ok(jsStatus)
  }

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(wkconf.Features.jobsEnabled) ?~> "job.disabled"
      _ <- jobService.updateCeleryInfos()
      jobs <- jobDAO.findAll
      jobsJsonList <- Fox.serialCombined(jobs.sortBy(-_.created))(jobService.publicWrites)
    } yield Ok(Json.toJson(jobsJsonList))
  }

  def get(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(wkconf.Features.jobsEnabled) ?~> "job.disabled"
      _ <- jobService.updateCeleryInfos()
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

          job <- jobService.runJob(command, commandArgs, request.identity) ?~> "job.couldNotRunCubing"
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
        job <- jobService.runJob(command, commandArgs, request.identity) ?~> "job.couldNotRunComputeMeshFile"
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
          job <- jobService.runJob(command, commandArgs, request.identity) ?~> "job.couldNotRunNucleiInferral"
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
          job <- jobService.runJob(command, commandArgs, request.identity) ?~> "job.couldNotRunTiffExport"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def downloadExport(jobId: String, exportFileName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        jobIdValidated <- ObjectId.parse(jobId)
        job <- jobDAO.findOne(jobIdValidated)
        organization <- organizationDAO.findOne(request.identity._organization)
        filePath = Paths.get("binaryData", organization.name, ".export", job.celeryJobId, exportFileName)
        _ <- bool2Fox(Files.exists(filePath)) ?~> "job.export.fileNotFound"
      } yield Ok.sendPath(filePath, inline = false)
    }

}
