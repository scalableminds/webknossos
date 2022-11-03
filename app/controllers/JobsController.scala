package controllers

import java.util.Date

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import javax.inject.Inject
import models.binary.DataSetDAO
import models.job.{JobDAO, JobService, JobState, WorkerDAO, WorkerService}
import models.organization.OrganizationDAO
import oxalis.security.{WkEnv, WkSilhouetteEnvironment}
import oxalis.telemetry.SlackNotificationService
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

class JobsController @Inject()(jobDAO: JobDAO,
                               sil: Silhouette[WkEnv],
                               dataSetDAO: DataSetDAO,
                               jobService: JobService,
                               workerService: WorkerService,
                               workerDAO: WorkerDAO,
                               wkconf: WkConf,
                               wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                               slackNotificationService: SlackNotificationService,
                               organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext)
    extends Controller {

  def status: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(())
      jobCountsByState <- jobDAO.countByState
      workers <- workerDAO.findAll
      workersJson = workers.map(workerService.publicWrites)
      jsStatus = Json.obj(
        "workers" -> workersJson,
        "jobsByState" -> Json.toJson(jobCountsByState)
      )
    } yield Ok(jsStatus)
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

  /*
   * Job cancelling protocol:
   * When a user cancels a job, the manualState is immediately set. Thus, the job looks cancelled to the user
   * The worker-written “state” field is later updated by the worker when it has successfully cancelled the job run.
   * When both fields are set, the cancelling is complete and wk no longer includes the job in the to_cancel list sent to worker
   */
  def cancel(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(wkconf.Features.jobsEnabled) ?~> "job.disabled"
      jobIdValidated <- ObjectId.fromString(id)
      job <- jobDAO.findOne(jobIdValidated)
      _ <- jobDAO.updateManualState(jobIdValidated, JobState.CANCELLED)
      js <- jobService.publicWrites(job)
    } yield Ok(js)
  }

  // Note that the dataset has to be registered by reserveUpload via the datastore first.
  def runConvertToWkwJob(organizationName: String, dataSetName: String, scale: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                       organizationName)
          _ <- bool2Fox(request.identity._organization == organization._id) ~> FORBIDDEN
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          command = "convert_to_wkw"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "scale" -> scale,
            "webknossos_token" -> RpcTokenHolder.webKnossosToken
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataSet._dataStore) ?~> "job.couldNotRunCubing"
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
        organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> Messages(
          "organization.notFound",
          organizationName)
        _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.meshFile.notAllowed.organization" ~> FORBIDDEN
        dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id) ?~> Messages(
          "dataSet.notFound",
          dataSetName) ~> NOT_FOUND
        command = "compute_mesh_file"
        commandArgs = Json.obj(
          "organization_name" -> organizationName,
          "dataset_name" -> dataSetName,
          "layer_name" -> layerName,
          "mag" -> mag,
          "agglomerate_view" -> agglomerateView
        )
        job <- jobService.submitJob(command, commandArgs, request.identity, dataSet._dataStore) ?~> "job.couldNotRunComputeMeshFile"
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def runInferNucleiJob(organizationName: String,
                        dataSetName: String,
                        layerName: String,
                        newDatasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            organizationName)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.inferNuclei.notAllowed.organization" ~> FORBIDDEN
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          command = "infer_nuclei"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "layer_name" -> layerName,
            "new_dataset_name" -> newDatasetName,
            "webknossos_token" -> RpcTokenHolder.webKnossosToken,
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataSet._dataStore) ?~> "job.couldNotRunNucleiInferral"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runInferNeuronsJob(organizationName: String,
                         dataSetName: String,
                         layerName: String,
                         bbox: String,
                         newDatasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                       organizationName)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.inferNeurons.notAllowed.organization" ~> FORBIDDEN
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          command = "infer_neurons"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "new_dataset_name" -> newDatasetName,
            "layer_name" -> layerName,
            "webknossos_token" -> RpcTokenHolder.webKnossosToken,
            "bbox" -> bbox,
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataSet._dataStore) ?~> "job.couldNotRunNeuronInferral"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runGlobalizeFloodfills(
      organizationName: String,
      dataSetName: String,
      fallbackLayerName: String,
      annotationId: String,
      annotationType: String,
      newDatasetName: String,
      volumeLayerName: Option[String]
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            organizationName)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.globalizeFloodfill.notAllowed.organization" ~> FORBIDDEN
          userAuthToken <- wkSilhouetteEnvironment.combinedAuthenticatorService.findOrCreateToken(
            request.identity.loginInfo)
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          command = "globalize_floodfills"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "fallback_layer_name" -> fallbackLayerName,
            "webknossos_token" -> RpcTokenHolder.webKnossosToken,
            "user_auth_token" -> userAuthToken.id,
            "annotation_id" -> annotationId,
            "annotation_type" -> annotationType,
            "new_dataset_name" -> newDatasetName,
            "volume_layer_name" -> volumeLayerName
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataSet._dataStore) ?~> "job.couldNotRunGlobalizeFloodfills"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runExportTiffJob(organizationName: String,
                       dataSetName: String,
                       bbox: String,
                       layerName: Option[String],
                       annotationLayerName: Option[String],
                       annotationId: Option[String],
                       annotationType: Option[String],
                       hideUnmappedIds: Option[Boolean],
                       mappingName: Option[String],
                       mappingType: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          _ <- jobService.assertTiffExportBoundingBoxLimits(bbox)
          userAuthToken <- wkSilhouetteEnvironment.combinedAuthenticatorService.findOrCreateToken(
            request.identity.loginInfo)
          command = "export_tiff"
          exportFileName = s"${formatDateForFilename(new Date())}__${dataSetName}__${annotationLayerName.map(_ => "volume").getOrElse(layerName.getOrElse(""))}.zip"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "bbox" -> bbox,
            "export_file_name" -> exportFileName,
            "layer_name" -> layerName,
            "user_auth_token" -> userAuthToken.id,
            "annotation_layer_name" -> annotationLayerName,
            "annotation_id" -> annotationId,
            "annotation_type" -> annotationType,
            "mapping_name" -> mappingName,
            "mapping_type" -> mappingType,
            "hide_unmapped_ids" -> hideUnmappedIds
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataSet._dataStore) ?~> "job.couldNotRunTiffExport"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runMaterializeVolumeAnnotationJob(organizationName: String,
                                        dataSetName: String,
                                        fallbackLayerName: String,
                                        annotationId: String,
                                        annotationType: String,
                                        newDatasetName: String,
                                        outputSegmentationLayerName: String,
                                        mergeSegments: Boolean,
                                        volumeLayerName: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                       organizationName)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.applyMergerMode.notAllowed.organization" ~> FORBIDDEN
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          userAuthToken <- wkSilhouetteEnvironment.combinedAuthenticatorService.findOrCreateToken(
            request.identity.loginInfo)
          command = "materialize_volume_annotation"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "fallback_layer_name" -> fallbackLayerName,
            "webknossos_token" -> RpcTokenHolder.webKnossosToken,
            "user_auth_token" -> userAuthToken.id,
            "annotation_id" -> annotationId,
            "output_segmentation_layer_name" -> outputSegmentationLayerName,
            "annotation_type" -> annotationType,
            "new_dataset_name" -> newDatasetName,
            "merge_segments" -> mergeSegments,
            "volume_layer_name" -> volumeLayerName
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataSet._dataStore) ?~> "job.couldNotRunApplyMergerMode"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runFindLargestSegmentIdJob(organizationName: String, dataSetName: String, layerName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                       organizationName)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.applyMergerMode.notAllowed.organization" ~> FORBIDDEN
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          command = "find_largest_segment_id"
          commandArgs = Json.obj(
            "organization_name" -> organizationName,
            "dataset_name" -> dataSetName,
            "layer_name" -> layerName
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataSet._dataStore) ?~> "job.couldNotRunFindLargestSegmentId"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

}
