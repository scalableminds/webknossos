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
import utils.{ObjectId, WkConf}

import java.util.Date
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, FullAxisOrder, NDBoundingBox}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, LengthUnit, VoxelSize}
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
  def runConvertToWkwJob(organizationId: String,
                         datasetName: String,
                         scale: String,
                         unit: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOne(organizationId) ?~> Messages("organization.notFound", organizationId)
          voxelSizeFactor <- Vec3Double.fromUriLiteral(scale).toFox
          voxelSizeUnit <- Fox.runOptional(unit)(u => LengthUnit.fromString(u).toFox)
          voxelSize = VoxelSize.fromFactorAndUnitWithDefault(voxelSizeFactor, voxelSizeUnit)
          _ <- bool2Fox(request.identity._organization == organization._id) ~> FORBIDDEN
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
            "dataset.notFound",
            datasetName) ~> NOT_FOUND
          command = JobCommand.convert_to_wkw
          commandArgs = Json.obj(
            "organization_name" -> organizationId,
            "organization_display_name" -> organization.name,
            "dataset_name" -> datasetName,
            "voxel_size_factor" -> voxelSize.factor.toUriLiteral,
            "voxel_size_unit" -> voxelSize.unit
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunCubing"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runComputeMeshFileJob(organizationId: String,
                            datasetName: String,
                            layerName: String,
                            mag: String,
                            agglomerateView: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOne(organizationId)(GlobalAccessContext) ?~> Messages(
          "organization.notFound",
          organizationId)
        _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.meshFile.notAllowed.organization" ~> FORBIDDEN
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
          "dataset.notFound",
          datasetName) ~> NOT_FOUND
        _ <- datasetService.assertValidLayerNameLax(layerName)
        command = JobCommand.compute_mesh_file
        commandArgs = Json.obj(
          "organization_name" -> organizationId,
          "dataset_name" -> datasetName,
          "layer_name" -> layerName,
          "mag" -> mag,
          "agglomerate_view" -> agglomerateView
        )
        job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunComputeMeshFile"
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def runComputeSegmentIndexFileJob(organizationId: String, datasetName: String, layerName: String,
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOne(organizationId)(GlobalAccessContext) ?~> Messages(
          "organization.notFound",
          organizationId)
        _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.segmentIndexFile.notAllowed.organization" ~> FORBIDDEN
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
          "dataset.notFound",
          datasetName) ~> NOT_FOUND
        _ <- datasetService.assertValidLayerNameLax(layerName)
        command = JobCommand.compute_segment_index_file
        commandArgs = Json.obj(
          "organization_name" -> organizationId,
          "dataset_name" -> datasetName,
          "segmentation_layer_name" -> layerName,
        )
        job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunSegmentIndexFile"
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def runInferNucleiJob(organizationId: String,
                        datasetName: String,
                        layerName: String,
                        newDatasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOne(organizationId)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            organizationId)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.inferNuclei.notAllowed.organization" ~> FORBIDDEN
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
            "dataset.notFound",
            datasetName) ~> NOT_FOUND
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(layerName)
          command = JobCommand.infer_nuclei
          commandArgs = Json.obj(
            "organization_name" -> organizationId,
            "dataset_name" -> datasetName,
            "layer_name" -> layerName,
            "new_dataset_name" -> newDatasetName
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunNucleiInferral"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runInferNeuronsJob(organizationId: String,
                         datasetName: String,
                         layerName: String,
                         bbox: String,
                         newDatasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOne(organizationId) ?~> Messages("organization.notFound", organizationId)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.inferNeurons.notAllowed.organization" ~> FORBIDDEN
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
            "dataset.notFound",
            datasetName) ~> NOT_FOUND
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(layerName)
          multiUser <- multiUserDAO.findOne(request.identity._multiUser)
          _ <- Fox.runIf(!multiUser.isSuperUser)(jobService.assertBoundingBoxLimits(bbox, None))
          command = JobCommand.infer_neurons
          commandArgs = Json.obj(
            "organization_name" -> organizationId,
            "dataset_name" -> datasetName,
            "new_dataset_name" -> newDatasetName,
            "layer_name" -> layerName,
            "bbox" -> bbox,
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunNeuronInferral"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runInferMitochondriaJob(organizationId: String,
                              datasetName: String,
                              layerName: String,
                              bbox: String,
                              newDatasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOne(organizationId) ?~> Messages("organization.notFound", organizationId)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.inferMitochondria.notAllowed.organization" ~> FORBIDDEN
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
            "dataset.notFound",
            datasetName) ~> NOT_FOUND
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(layerName)
          multiUser <- multiUserDAO.findOne(request.identity._multiUser)
          _ <- bool2Fox(multiUser.isSuperUser) ?~> "job.inferMitochondria.notAllowed.onlySuperUsers"
          _ <- Fox.runIf(!multiUser.isSuperUser)(jobService.assertBoundingBoxLimits(bbox, None))
          command = JobCommand.infer_mitochondria
          commandArgs = Json.obj(
            "organization_name" -> organizationId,
            "dataset_name" -> datasetName,
            "new_dataset_name" -> newDatasetName,
            "layer_name" -> layerName,
            "bbox" -> bbox,
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunInferMitochondria"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runAlignSectionsJob(organizationId: String,
                          datasetName: String,
                          layerName: String,
                          newDatasetName: String,
                          annotationId: Option[String] = None): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOne(organizationId) ?~> Messages("organization.notFound", organizationId)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.alignSections.notAllowed.organization" ~> FORBIDDEN
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
            "dataset.notFound",
            datasetName) ~> NOT_FOUND
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(layerName)
          _ <- Fox.runOptional(annotationId)(ObjectId.fromString)
          multiUser <- multiUserDAO.findOne(request.identity._multiUser)
          _ <- bool2Fox(multiUser.isSuperUser) ?~> "job.alignSections.notAllowed.onlySuperUsers"
          command = JobCommand.align_sections
          commandArgs = Json.obj(
            "organization_name" -> organizationId,
            "dataset_name" -> datasetName,
            "new_dataset_name" -> newDatasetName,
            "layer_name" -> layerName,
            "annotation_id" -> annotationId
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunAlignSections"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runExportTiffJob(organizationId: String,
                       datasetName: String,
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
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId) ?~> Messages(
            "dataset.notFound",
            datasetName) ~> NOT_FOUND
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
            s"${formatDateForFilename(new Date())}__${datasetName}__${annotationLayerName.map(_ => "volume").getOrElse(layerName.getOrElse(""))}.ome.tif"
          else
            s"${formatDateForFilename(new Date())}__${datasetName}__${annotationLayerName.map(_ => "volume").getOrElse(layerName.getOrElse(""))}.zip"
          commandArgs = Json.obj(
            "organization_name" -> organizationId,
            "dataset_name" -> datasetName,
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

  def runMaterializeVolumeAnnotationJob(organizationId: String,
                                        datasetName: String,
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
          organization <- organizationDAO.findOne(organizationId)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            organizationId)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.materializeVolumeAnnotation.notAllowed.organization" ~> FORBIDDEN
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
            "dataset.notFound",
            datasetName) ~> NOT_FOUND
          _ <- datasetService.assertValidLayerNameLax(fallbackLayerName)
          command = JobCommand.materialize_volume_annotation
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(outputSegmentationLayerName)
          commandArgs = Json.obj(
            "organization_name" -> organizationId,
            "dataset_name" -> datasetName,
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

  def runFindLargestSegmentIdJob(organizationId: String, datasetName: String, layerName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOne(organizationId) ?~> Messages("organization.notFound", organizationId)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.findLargestSegmentId.notAllowed.organization" ~> FORBIDDEN
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
            "dataset.notFound",
            datasetName) ~> NOT_FOUND
          _ <- datasetService.assertValidLayerNameLax(layerName)
          command = JobCommand.find_largest_segment_id
          commandArgs = Json.obj(
            "organization_name" -> organizationId,
            "dataset_name" -> datasetName,
            "layer_name" -> layerName
          )
          job <- jobService.submitJob(command, commandArgs, request.identity, dataset._dataStore) ?~> "job.couldNotRunFindLargestSegmentId"
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runRenderAnimationJob(organizationId: String, datasetName: String): Action[AnimationJobOptions] =
    sil.SecuredAction.async(validateJson[AnimationJobOptions]) { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          organization <- organizationDAO.findOne(organizationId) ?~> Messages("organization.notFound", organizationId)
          userOrganization <- organizationDAO.findOne(request.identity._organization)
          _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.renderAnimation.notAllowed.organization" ~> FORBIDDEN
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> Messages(
            "dataset.notFound",
            datasetName) ~> NOT_FOUND
          animationJobOptions = request.body
          _ <- Fox.runIf(userOrganization.pricingPlan == PricingPlan.Basic) {
            bool2Fox(animationJobOptions.includeWatermark) ?~> "job.renderAnimation.mustIncludeWatermark"
          }
          _ <- Fox.runIf(userOrganization.pricingPlan == PricingPlan.Basic) {
            bool2Fox(animationJobOptions.movieResolution == MovieResolutionSetting.SD) ?~> "job.renderAnimation.resolutionMustBeSD"
          }
          layerName = animationJobOptions.layerName
          _ <- datasetService.assertValidLayerNameLax(layerName)
          exportFileName = s"webknossos_animation_${formatDateForFilename(new Date())}__${datasetName}__$layerName.mp4"
          command = JobCommand.render_animation
          commandArgs = Json.obj(
            "organization_name" -> organizationId,
            "dataset_name" -> datasetName,
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
