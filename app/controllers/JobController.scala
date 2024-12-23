package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.dataset.{DataStoreDAO, DatasetDAO, DatasetLayerAdditionalAxesDAO, DatasetService}
import models.job._
import models.organization.OrganizationDAO
import models.user.MultiUserDAO
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{WkEnv, WkSilhouetteEnvironment}
import telemetry.SlackNotificationService
import utils.WkConf

import java.util.Date
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, FullAxisOrder, NDBoundingBox}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import models.team.PricingPlan

object MovieResolutionSetting extends ExtendedEnumeration {
  val SD, HD = Value
}

object CameraPositionSetting extends ExtendedEnumeration {
  val MOVING, STATIC_XZ, STATIC_YZ = Value
}

case class AnimationJobOptions(
    layerName: String,
    boundingBox: BoundingBox,
    includeWatermark: Boolean,
    meshes: JsValue,
    movieResolution: MovieResolutionSetting.Value,
    cameraPosition: CameraPositionSetting.Value,
    intensityMin: Double,
    intensityMax: Double,
    magForTextures: Vec3Int
)

object AnimationJobOptions {
  implicit val jsonFormat: OFormat[AnimationJobOptions] = Json.format[AnimationJobOptions]
}

class JobController @Inject()(
    jobDAO: JobDAO,
    sil: Silhouette[WkEnv],
    datasetDAO: DatasetDAO,
    datasetService: DatasetService,
    jobService: JobService,
    workerService: WorkerService,
    workerDAO: WorkerDAO,
    datasetLayerAdditionalAxesDAO: DatasetLayerAdditionalAxesDAO,
    wkconf: WkConf,
    multiUserDAO: MultiUserDAO,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    slackNotificationService: SlackNotificationService,
    organizationDAO: OrganizationDAO,
    dataStoreDAO: DataStoreDAO)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
    with Zarr3OutputHelper {

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
      jobsJsonList <- Fox.serialCombined(jobs.sortBy(_.created).reverse)(jobService.publicWrites)
    } yield Ok(Json.toJson(jobsJsonList))
  }

  def get(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(wkconf.Features.jobsEnabled) ?~> "job.disabled"
      idValidated <- ObjectId.fromString(id)
      job <- jobDAO.findOne(idValidated) ?~> "job.notFound"
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
  def runConvertToWkwJob(datasetId: String, scale: String, unit: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          voxelSizeFactor <- Vec3Double.fromUriLiteral(scale).toFox
          voxelSizeUnit <- Fox.runOptional(unit)(u => LengthUnit.fromString(u).toFox)
          voxelSize = VoxelSize.fromFactorAndUnitWithDefault(voxelSizeFactor, voxelSizeUnit)
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            dataset._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.convertToWkw.notAllowed.organization" ~> FORBIDDEN
          command = JobCommand.convert_to_wkw
          commandArgs = Json.obj(
            "organization_id" -> organization._id,
            "organization_display_name" -> organization.name,
            "dataset_name" -> dataset.name,
            "dataset_id" -> dataset._id,
            "dataset_directory_name" -> dataset.directoryName,
            "voxel_size_factor" -> voxelSize.factor.toUriLiteral,
            "voxel_size_unit" -> voxelSize.unit
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunCubing"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runComputeMeshFileJob(datasetId: String,
                            layerName: String,
                            mag: String,
                            agglomerateView: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        datasetIdValidated <- ObjectId.fromString(datasetId)
        dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
        organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
          "organization.notFound",
          dataset._organization)
        _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.meshFile.notAllowed.organization" ~> FORBIDDEN
        _ <- datasetService.assertValidLayerNameLax(layerName)
        command = JobCommand.compute_mesh_file
        commandArgs = Json.obj(
          "organization_id" -> organization._id,
          "dataset_name" -> dataset.name,
          "dataset_id" -> dataset._id,
          "dataset_directory_name" -> dataset.directoryName,
          "layer_name" -> layerName,
          "mag" -> mag,
          "agglomerate_view" -> agglomerateView
        )
        job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunComputeMeshFile"
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def runComputeSegmentIndexFileJob(datasetId: String, layerName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        datasetIdValidated <- ObjectId.fromString(datasetId)
        dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
        organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
          "organization.notFound",
          dataset._organization)
        _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.segmentIndexFile.notAllowed.organization" ~> FORBIDDEN
        _ <- datasetService.assertValidLayerNameLax(layerName)
        command = JobCommand.compute_segment_index_file
        commandArgs = Json.obj(
          "organization_id" -> dataset._organization,
          "dataset_name" -> dataset.name,
          "dataset_directory_name" -> dataset.directoryName,
          "segmentation_layer_name" -> layerName,
        )
        job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunSegmentIndexFile"
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def runInferNucleiJob(datasetId: String, layerName: String, newDatasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            dataset._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.inferNuclei.notAllowed.organization" ~> FORBIDDEN
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(layerName)
          command = JobCommand.infer_nuclei
          commandArgs = Json.obj(
            "organization_id" -> dataset._organization,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "layer_name" -> layerName,
            "new_dataset_name" -> newDatasetName
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunNucleiInferral"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runInferNeuronsJob(datasetId: String,
                         layerName: String,
                         bbox: String,
                         newDatasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            dataset._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.inferNeurons.notAllowed.organization" ~> FORBIDDEN
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(layerName)
          multiUser <- multiUserDAO.findOne(request.identity._multiUser)
          _ <- Fox.runIf(!multiUser.isSuperUser)(jobService.assertBoundingBoxLimits(bbox, None))
          command = JobCommand.infer_neurons
          commandArgs = Json.obj(
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "new_dataset_name" -> newDatasetName,
            "layer_name" -> layerName,
            "bbox" -> bbox,
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunNeuronInferral"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runInferMitochondriaJob(datasetId: String,
                              layerName: String,
                              bbox: String,
                              newDatasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            dataset._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.inferMitochondria.notAllowed.organization" ~> FORBIDDEN
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(layerName)
          multiUser <- multiUserDAO.findOne(request.identity._multiUser)
          _ <- bool2Fox(multiUser.isSuperUser) ?~> "job.inferMitochondria.notAllowed.onlySuperUsers"
          _ <- Fox.runIf(!multiUser.isSuperUser)(jobService.assertBoundingBoxLimits(bbox, None))
          command = JobCommand.infer_mitochondria
          commandArgs = Json.obj(
            "organization_id" -> dataset._organization,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "new_dataset_name" -> newDatasetName,
            "layer_name" -> layerName,
            "bbox" -> bbox,
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunInferMitochondria"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runAlignSectionsJob(datasetId: String,
                          layerName: String,
                          newDatasetName: String,
                          annotationId: Option[String] = None): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            dataset._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.alignSections.notAllowed.organization" ~> FORBIDDEN
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(layerName)
          _ <- Fox.runOptional(annotationId)(ObjectId.fromString)
          command = JobCommand.align_sections
          commandArgs = Json.obj(
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "new_dataset_name" -> newDatasetName,
            "layer_name" -> layerName,
            "annotation_id" -> annotationId
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunAlignSections"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runExportTiffJob(datasetId: String,
                       bbox: String,
                       additionalCoordinates: Option[String],
                       layerName: Option[String],
                       mag: Option[String],
                       annotationLayerName: Option[String],
                       annotationId: Option[String],
                       asOmeTiff: Boolean): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            dataset._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.meshFile.notAllowed.organization" ~> FORBIDDEN
          _ <- Fox.runOptional(layerName)(datasetService.assertValidLayerNameLax)
          _ <- Fox.runOptional(annotationLayerName)(datasetService.assertValidLayerNameLax)
          _ <- jobService.assertBoundingBoxLimits(bbox, mag)
          additionalAxesOpt <- Fox.runOptional(layerName)(layerName =>
            datasetLayerAdditionalAxesDAO.findAllForDatasetAndDataLayerName(dataset._id, layerName))
          additionalAxesOpt <- Fox.runOptional(additionalAxesOpt)(a => Fox.successful(reorderAdditionalAxes(a)))
          rank = additionalAxesOpt.map(_.length).getOrElse(0) + 4
          axisOrder = FullAxisOrder.fromAxisOrderAndAdditionalAxes(rank,
                                                                   AxisOrder.cAdditionalxyz(rank),
                                                                   additionalAxesOpt)
          threeDBBox <- BoundingBox.fromLiteral(bbox).toFox ~> "job.invalidBoundingBox"
          parsedAdditionalCoordinatesOpt <- Fox.runOptional(additionalCoordinates)(coords =>
            Json.parse(coords).validate[Seq[AdditionalCoordinate]]) ~> "job.additionalCoordinates.invalid"
          parsedAdditionalCoordinates = parsedAdditionalCoordinatesOpt.getOrElse(Seq.empty)
          additionalAxesOfNdBBox = additionalAxesOpt.map(additionalAxes =>
            additionalAxes.map(_.intersectWithAdditionalCoordinates(parsedAdditionalCoordinates)))
          ndBoundingBox = NDBoundingBox(threeDBBox, additionalAxesOfNdBBox.getOrElse(Seq.empty), axisOrder)
          command = JobCommand.export_tiff
          exportFileName = if (asOmeTiff)
            s"${formatDateForFilename(new Date())}__${dataset.name}__${annotationLayerName.map(_ => "volume").getOrElse(layerName.getOrElse(""))}.ome.tif"
          else
            s"${formatDateForFilename(new Date())}__${dataset.name}__${annotationLayerName.map(_ => "volume").getOrElse(layerName.getOrElse(""))}.zip"
          commandArgs = Json.obj(
            "dataset_directory_name" -> dataset.directoryName,
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "nd_bbox" -> ndBoundingBox.toWkLibsDict,
            "export_file_name" -> exportFileName,
            "layer_name" -> layerName,
            "mag" -> mag,
            "annotation_layer_name" -> annotationLayerName,
            "annotation_id" -> annotationId,
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunTiffExport"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runMaterializeVolumeAnnotationJob(datasetId: String,
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
          datasetIdValidated <- ObjectId.fromString(datasetId)
          dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            dataset._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.materializeVolumeAnnotation.notAllowed.organization" ~> FORBIDDEN
          _ <- datasetService.assertValidLayerNameLax(fallbackLayerName)
          command = JobCommand.materialize_volume_annotation
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(outputSegmentationLayerName)
          commandArgs = Json.obj(
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "fallback_layer_name" -> fallbackLayerName,
            "annotation_id" -> annotationId,
            "output_segmentation_layer_name" -> outputSegmentationLayerName,
            "annotation_type" -> annotationType,
            "new_dataset_name" -> newDatasetName,
            "merge_segments" -> mergeSegments,
            "volume_layer_name" -> volumeLayerName
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunApplyMergerMode"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runFindLargestSegmentIdJob(datasetId: String, layerName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            dataset._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.findLargestSegmentId.notAllowed.organization" ~> FORBIDDEN
          _ <- datasetService.assertValidLayerNameLax(layerName)
          command = JobCommand.find_largest_segment_id
          commandArgs = Json.obj(
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "layer_name" -> layerName
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunFindLargestSegmentId"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runRenderAnimationJob(datasetId: String): Action[AnimationJobOptions] =
    sil.SecuredAction.async(validateJson[AnimationJobOptions]) { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          dataset <- datasetDAO.findOne(datasetIdValidated) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            dataset._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.renderAnimation.notAllowed.organization" ~> FORBIDDEN
          userOrganization <- organizationDAO.findOne(request.identity._organization)
          animationJobOptions = request.body
          _ <- Fox.runIf(userOrganization.pricingPlan == PricingPlan.Basic) {
            bool2Fox(animationJobOptions.includeWatermark) ?~> "job.renderAnimation.mustIncludeWatermark"
          }
          _ <- Fox.runIf(userOrganization.pricingPlan == PricingPlan.Basic) {
            bool2Fox(animationJobOptions.movieResolution == MovieResolutionSetting.SD) ?~> "job.renderAnimation.resolutionMustBeSD"
          }
          layerName = animationJobOptions.layerName
          _ <- datasetService.assertValidLayerNameLax(layerName)
          exportFileName = s"webknossos_animation_${formatDateForFilename(new Date())}__${dataset.name}__$layerName.mp4"
          command = JobCommand.render_animation
          commandArgs = Json.obj(
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "export_file_name" -> exportFileName,
            "layer_name" -> animationJobOptions.layerName,
            "bounding_box" -> animationJobOptions.boundingBox.toLiteral,
            "include_watermark" -> animationJobOptions.includeWatermark,
            "meshes" -> animationJobOptions.meshes,
            "movie_resolution" -> animationJobOptions.movieResolution,
            "camera_position" -> animationJobOptions.cameraPosition,
            "intensity_min" -> animationJobOptions.intensityMin,
            "intensity_max" -> animationJobOptions.intensityMax,
            "mag_for_textures" -> animationJobOptions.magForTextures,
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunRenderAnimation"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def redirectToExport(jobId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        jobIdValidated <- ObjectId.fromString(jobId)
        job <- jobDAO.findOne(jobIdValidated)
        dataStore <- dataStoreDAO.findOneByName(job._dataStore) ?~> "dataStore.notFound"
        userAuthToken <- wkSilhouetteEnvironment.combinedAuthenticatorService.findOrCreateToken(
          request.identity.loginInfo)
        uri = s"${dataStore.publicUrl}/data/exports/$jobId/download"
      } yield Redirect(uri, Map(("token", Seq(userAuthToken.id))))
    }

}
