package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import models.dataset.{DataStoreDAO, DatasetDAO, DatasetLayerAdditionalAxesDAO, DatasetService}
import models.job._
import models.organization.{CreditTransactionDAO, CreditTransactionService, OrganizationDAO, PricingPlan}
import models.user.{MultiUserDAO, UserService}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{WkEnv, WkSilhouetteEnvironment}
import telemetry.SlackNotificationService
import utils.WkConf

import java.util.Date
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, FullAxisOrder, NDBoundingBox}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import play.api.libs.json.{JsObject, JsValue, Json, OFormat}

object MovieResolutionSetting extends ExtendedEnumeration {
  val SD, HD = Value
}

object MovieDurationSetting extends ExtendedEnumeration {
  val SHORT, STANDARD, LONG = Value
}

object CameraPositionSetting extends ExtendedEnumeration {
  val MOVING, STATIC_ISOMETRIC, STATIC_XY, STATIC_XZ, STATIC_YZ = Value
}

case class AnimationJobOptions(
    layerName: String,
    boundingBox: BoundingBox,
    includeWatermark: Boolean,
    meshes: JsValue,
    movieResolution: MovieResolutionSetting.Value,
    movieDuration: MovieDurationSetting.Value,
    cameraPosition: CameraPositionSetting.Value,
    magForTextures: Vec3Int,
    annotationId: Option[ObjectId],
    includeSkeletons: Boolean,
    hideImageData: Boolean,
    saveBlenderFile: Boolean
)

object AnimationJobOptions {
  implicit val jsonFormat: OFormat[AnimationJobOptions] = Json.format[AnimationJobOptions]
}

case class AlignSectionsJobOptions(
    layerName: String,
    newDatasetName: String,
    annotationId: Option[ObjectId],
    customConfiguration: Option[JsObject]
)

object AlignSectionsJobOptions {
  implicit val jsonFormat: OFormat[AlignSectionsJobOptions] = Json.format[AlignSectionsJobOptions]
}

class JobController @Inject() (
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
    creditTransactionService: CreditTransactionService,
    creditTransactionDAO: CreditTransactionDAO,
    dataStoreDAO: DataStoreDAO,
    userService: UserService
)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
    with Zarr3OutputHelper {

  def status: Action[AnyContent] = sil.SecuredAction.fox { _ =>
    for {
      _ <- Fox.successful(())
      jobCountsByState <- jobDAO.countByState
      workers <- workerDAO.findAll(using GlobalAccessContext)
      workersJson = workers.map(workerService.publicWrites)
      jsStatus = Json.obj(
        "workers" -> workersJson,
        "jobsByState" -> Json.toJson(jobCountsByState)
      )
    } yield Ok(jsStatus)
  }

  def list(command: Option[String], skipForDeletedDatasets: Option[Boolean]): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        _ <- Fox.fromBool(wkconf.Features.jobsEnabled) ?~> Msg.Job.notEnabled
        commandValidatedOpt <- Fox.runOptional(command)(JobCommand.fromString(_).toFox)
        jobsCompact <- jobDAO.findAllCompact(commandValidatedOpt, skipForDeletedDatasets.getOrElse(false))
      } yield Ok(Json.toJson(jobsCompact.map(_.enrich)))
    }

  def get(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- Fox.fromBool(wkconf.Features.jobsEnabled) ?~> Msg.Job.notEnabled
      job <- jobDAO.findOne(id) ?~> Msg.Job.notFound
      js <- jobService.publicWrites(job)
    } yield Ok(js)
  }

  /*
   * Job cancelling protocol:
   * When a user cancels a job, the manualState is immediately set. Thus, the job looks cancelled to the user
   * The worker-written “state” field is later updated by the worker when it has successfully cancelled the job run.
   * When both fields are set, the cancelling is complete and wk no longer includes the job in the to_cancel list sent to worker
   */
  def cancel(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- Fox.fromBool(wkconf.Features.jobsEnabled) ?~> Msg.Job.notEnabled
      job <- jobDAO.findOne(id)
      _ <- jobDAO.updateManualState(id, JobState.CANCELLED)
      _ <- Fox.runIf(job.state == JobState.PENDING || job.state == JobState.STARTED) {
        creditTransactionService.refundTransactionForJob(job._id, isCancelled = true)(using
          GlobalAccessContext
        ) ?~> Msg.Job.Credits.refundFailed
      }
      js <- jobService.publicWrites(job)
    } yield Ok(js)
  }

  /*
   * Users may retry their failed jobs once (a second failure is likely persistent,
   * so they are asked to contact administrators instead). Super users may always retry.
   */
  def retry(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- Fox.fromBool(wkconf.Features.jobsEnabled) ?~> Msg.Job.notEnabled
      job <- jobDAO.findOne(id) ?~> Msg.Job.notFound
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- Fox.fromBool(multiUser.isSuperUser || job.lastRetry.isEmpty) ?~> Msg.Job.alreadyRetried ~> FORBIDDEN
      _ <- creditTransactionService.reserveCreditsForRetry(job._id)
      _ <- jobDAO.retryOne(id, retriedBySuperUser = multiUser.isSuperUser)
      js <- jobService.publicWrites(job)
    } yield Ok(js)
  }

  def runComputeMeshFileJob(
      datasetId: ObjectId,
      layerName: String,
      mag: String,
      agglomerateView: Option[String]
  ): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
        organization <- organizationDAO.findOne(dataset._organization)(using GlobalAccessContext) ?~> Msg.Organization
          .notFound(dataset._organization)
        _ <- Fox.fromBool(
          request.identity._organization == organization._id
        ) ?~> Msg.Job.ComputeMeshFile.wrongOrga ~> FORBIDDEN
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
        job <- jobService.submitJob(
          command,
          commandArgs,
          request.identity,
          dataset._dataStore
        ) ?~> Msg.Job.ComputeMeshFile.submitFailed
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def runComputeSegmentIndexFileJob(datasetId: ObjectId, layerName: String): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
        organization <- organizationDAO.findOne(dataset._organization)(using GlobalAccessContext) ?~> Msg.Organization
          .notFound(dataset._organization)
        _ <- Fox.fromBool(
          request.identity._organization == organization._id
        ) ?~> Msg.Job.ComputeSegmentIndex.wrongOrga ~> FORBIDDEN
        _ <- datasetService.assertValidLayerNameLax(layerName)
        command = JobCommand.compute_segment_index_file
        commandArgs = Json.obj(
          "dataset_id" -> dataset._id,
          "organization_id" -> dataset._organization,
          "dataset_name" -> dataset.name,
          "dataset_directory_name" -> dataset.directoryName,
          "segmentation_layer_name" -> layerName
        )
        job <- jobService.submitJob(
          command,
          commandArgs,
          request.identity,
          dataset._dataStore
        ) ?~> Msg.Job.ComputeSegmentIndex.submitFailed
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def runInferMitochondriaJob(
      datasetId: ObjectId,
      layerName: String,
      bbox: String,
      newDatasetName: String
  ): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(using GlobalAccessContext) ?~> Msg.Organization
            .notFound(dataset._organization)
          _ <- Fox.fromBool(
            request.identity._organization == organization._id
          ) ?~> Msg.Job.Inference.wrongOrga ~> FORBIDDEN
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(layerName)
          (_, dataLayer) <- datasetService.getDataSourceAndLayerFor(dataset, layerName)
          command = JobCommand.infer_mitochondria
          mag1BoundingBox <- BoundingBox.fromLiteral(bbox).toFox
          targetMag <- dataLayer.finestMag.toFox
          targetMagBoundingBox = mag1BoundingBox / targetMag
          commandArgs = Json.obj(
            "dataset_id" -> dataset._id,
            "organization_id" -> dataset._organization,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "new_dataset_name" -> newDatasetName,
            "layer_name" -> layerName,
            "bbox" -> bbox
          )
          creditTransactionComment = s"Run for AI mitochondria segmentation for dataset ${dataset.name}"
          job <- jobService.submitPaidJob(
            command,
            commandArgs,
            targetMagBoundingBox,
            creditTransactionComment,
            request.identity,
            dataset._dataStore
          ) ?~> Msg.Job.Inference.submitFailed
          jobAsJs <- jobService.publicWrites(job)
        } yield Ok(jobAsJs)
      }
    }

  def runAlignSectionsJob(datasetId: ObjectId): Action[AlignSectionsJobOptions] =
    sil.SecuredAction.fox(validateJson[AlignSectionsJobOptions]) { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(using GlobalAccessContext) ?~> Msg.Organization
            .notFound(dataset._organization)
          _ <- Fox.fromBool(
            request.identity._organization == organization._id
          ) ?~> Msg.Job.AlignSections.wrongOrga ~> FORBIDDEN
          _ <- datasetService.assertValidDatasetName(request.body.newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(request.body.layerName)
          (dataSource, layer) <- datasetService.getDataSourceAndLayerFor(
            dataset,
            request.body.layerName
          ) ?~> Msg.Dataset.notUsable(dataset._id)
          layerMag <- layer.finestMag.toFox ?~> Msg.Dataset.noMags
          finestMagDatasetBoundingBox = dataSource.boundingBox / layerMag
          command = JobCommand.align_sections
          commandArgs = Json.obj(
            "dataset_id" -> dataset._id,
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "new_dataset_name" -> request.body.newDatasetName,
            "layer_name" -> request.body.layerName,
            "annotation_id" -> request.body.annotationId,
            "custom_configuration" -> request.body.customConfiguration
          )
          creditTransactionComment = s"Align dataset ${dataset.name}"
          job <- jobService.submitPaidJob(
            command,
            commandArgs,
            finestMagDatasetBoundingBox,
            creditTransactionComment,
            request.identity,
            dataset._dataStore
          ) ?~> Msg.Job.AlignSections.submitFailed
          jobAsJs <- jobService.publicWrites(job)
        } yield Ok(jobAsJs)
      }
    }

  def runExportTiffJob(
      datasetId: ObjectId,
      bbox: String,
      additionalCoordinates: Option[String],
      layerName: Option[String],
      mag: Option[String],
      annotationLayerName: Option[String],
      annotationId: Option[ObjectId],
      asOmeTiff: Boolean
  ): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(using GlobalAccessContext) ?~> Msg.Organization
            .notFound(dataset._organization)
          _ <- Fox.runOptional(layerName)(datasetService.assertValidLayerNameLax)
          _ <- Fox.runOptional(annotationLayerName)(datasetService.assertValidLayerNameLax)
          _ <- jobService.assertBoundingBoxLimits(bbox, mag)
          additionalAxesOpt <- Fox.runOptional(layerName)(layerName =>
            datasetLayerAdditionalAxesDAO.findAllForDatasetAndDataLayerName(dataset._id, layerName)
          )
          additionalAxesOpt <- Fox.runOptional(additionalAxesOpt)(a => Fox.successful(reorderAdditionalAxes(a)))
          rank = additionalAxesOpt.map(_.length).getOrElse(0) + 4
          axisOrder = FullAxisOrder.fromAxisOrderAndAdditionalAxes(
            rank,
            AxisOrder.cAdditionalxyz(rank),
            additionalAxesOpt
          )
          threeDBBox <- BoundingBox.fromLiteral(bbox).toFox ?~> Msg.Job.invalidBoundingBox
          parsedAdditionalCoordinatesOpt <- Fox.runOptional(additionalCoordinates)(coords =>
            JsonHelper.parseAs[Seq[AdditionalCoordinate]](coords).toFox
          ) ?~> Msg.Zarr.invalidAdditionalCoordinates
          parsedAdditionalCoordinates = parsedAdditionalCoordinatesOpt.getOrElse(Seq.empty)
          additionalAxesOfNdBBox = additionalAxesOpt.map(additionalAxes =>
            additionalAxes.map(_.intersectWithAdditionalCoordinates(parsedAdditionalCoordinates))
          )
          ndBoundingBox = NDBoundingBox(threeDBBox, additionalAxesOfNdBBox.getOrElse(Seq.empty), axisOrder)
          command = JobCommand.export_tiff
          exportFileName =
            if (asOmeTiff)
              s"${formatDateForFilename(new Date())}__${dataset.name}__${annotationLayerName.map(_ => "volume").getOrElse(layerName.getOrElse(""))}.ome.tif"
            else
              s"${formatDateForFilename(new Date())}__${dataset.name}__${annotationLayerName.map(_ => "volume").getOrElse(layerName.getOrElse(""))}.zip"
          commandArgs = Json.obj(
            "dataset_id" -> dataset._id,
            "dataset_directory_name" -> dataset.directoryName,
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "nd_bbox" -> ndBoundingBox.toWkLibsDict,
            "export_file_name" -> exportFileName,
            "layer_name" -> layerName,
            "mag" -> mag,
            "annotation_layer_name" -> annotationLayerName,
            "annotation_id" -> annotationId
          )
          job <- jobService.submitJob(
            command,
            commandArgs,
            request.identity,
            dataset._dataStore
          ) ?~> Msg.Job.ExportTiff.submitFailed
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runMaterializeVolumeAnnotationJob(
      datasetId: ObjectId,
      fallbackLayerName: String,
      annotationId: ObjectId,
      annotationType: String,
      newDatasetName: String,
      outputSegmentationLayerName: String,
      mergeSegments: Boolean,
      volumeLayerName: Option[String],
      includesEditableMapping: Boolean,
      boundingBox: Option[String]
  ): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(using GlobalAccessContext) ?~> Msg.Organization
            .notFound(dataset._organization)
          _ <- Fox.fromBool(
            request.identity._organization == organization._id
          ) ?~> Msg.Job.MaterializeVolumeAnnotation.wrongOrga ~> FORBIDDEN
          _ <- datasetService.assertValidLayerNameLax(fallbackLayerName)
          command = JobCommand.materialize_volume_annotation
          _ <- datasetService.assertValidDatasetName(newDatasetName)
          _ <- datasetService.assertValidLayerNameLax(outputSegmentationLayerName)
          multiUser <- multiUserDAO.findOne(request.identity._multiUser)
          _ <- Fox.runIf(!multiUser.isSuperUser && includesEditableMapping)(
            Fox.runOptional(boundingBox)(bbox => jobService.assertBoundingBoxLimits(bbox, None))
          )
          commandArgs = Json.obj(
            "dataset_id" -> dataset._id,
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "fallback_layer_name" -> fallbackLayerName,
            "annotation_id" -> annotationId,
            "output_segmentation_layer_name" -> outputSegmentationLayerName,
            "annotation_type" -> annotationType,
            "new_dataset_name" -> newDatasetName,
            "merge_segments" -> mergeSegments,
            "volume_layer_name" -> volumeLayerName,
            "use_zarr_streaming" -> includesEditableMapping,
            "bounding_box" -> boundingBox
          )
          job <- jobService.submitJob(
            command,
            commandArgs,
            request.identity,
            dataset._dataStore
          ) ?~> Msg.Job.MaterializeVolumeAnnotation.submitFailed
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runFindLargestSegmentIdJob(datasetId: ObjectId, layerName: String): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(using GlobalAccessContext) ?~> Msg.Organization
            .notFound(dataset._organization)
          _ <- Fox.fromBool(
            request.identity._organization == organization._id
          ) ?~> Msg.Job.FindLargestSegmentId.wrongOrga ~> FORBIDDEN
          _ <- datasetService.assertValidLayerNameLax(layerName)
          command = JobCommand.find_largest_segment_id
          commandArgs = Json.obj(
            "dataset_id" -> dataset._id,
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "layer_name" -> layerName
          )
          job <- jobService.submitJob(
            command,
            commandArgs,
            request.identity,
            dataset._dataStore
          ) ?~> Msg.Job.FindLargestSegmentId.submitFailed
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def runRenderAnimationJob(datasetId: ObjectId): Action[AnimationJobOptions] =
    sil.SecuredAction.fox(validateJson[AnimationJobOptions]) { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        for {
          dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(using GlobalAccessContext) ?~> Msg.Organization
            .notFound(dataset._organization)
          userOrganization <- organizationDAO.findOne(request.identity._organization)
          animationJobOptions = request.body
          _ <- Fox.runIf(!PricingPlan.isPaidPlan(userOrganization.pricingPlan)) {
            Fox.fromBool(animationJobOptions.includeWatermark) ?~> Msg.Job.RenderAnimation.mustIncludeWatermark
          }
          _ <- Fox.runIf(!PricingPlan.isPaidPlan(userOrganization.pricingPlan)) {
            Fox.fromBool(
              animationJobOptions.movieResolution == MovieResolutionSetting.SD
            ) ?~> Msg.Job.RenderAnimation.resolutionMustBeSD
          }
          _ <- Fox.runIf(animationJobOptions.saveBlenderFile) {
            userService.assertIsSuperUser(request.identity) ?~> Msg.notAllowed ~> FORBIDDEN
          }
          layerName = animationJobOptions.layerName
          _ <- datasetService.assertValidLayerNameLax(layerName)
          exportFileName = s"webknossos_animation_${formatDateForFilename(new Date())}__${dataset.name}__$layerName.mp4"
          command = JobCommand.render_animation
          commandArgs = Json.obj(
            "dataset_id" -> dataset._id,
            "organization_id" -> organization._id,
            "dataset_name" -> dataset.name,
            "dataset_directory_name" -> dataset.directoryName,
            "export_file_name" -> exportFileName,
            "layer_name" -> animationJobOptions.layerName,
            "bounding_box" -> animationJobOptions.boundingBox.toLiteral,
            "include_watermark" -> animationJobOptions.includeWatermark,
            "meshes" -> animationJobOptions.meshes,
            "movie_resolution" -> animationJobOptions.movieResolution,
            "movie_duration" -> animationJobOptions.movieDuration,
            "camera_position" -> animationJobOptions.cameraPosition,
            "mag_for_textures" -> animationJobOptions.magForTextures,
            "annotation_id" -> animationJobOptions.annotationId,
            "include_skeletons" -> animationJobOptions.includeSkeletons,
            "hide_image_data" -> animationJobOptions.hideImageData,
            "save_blender_file" -> animationJobOptions.saveBlenderFile
          )
          job <- jobService.submitJob(
            command,
            commandArgs,
            request.identity,
            dataset._dataStore
          ) ?~> Msg.Job.RenderAnimation.submitFailed
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  def redirectToExport(jobId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        job <- jobDAO.findOne(jobId)
        dataStore <- dataStoreDAO.findOneByName(job._dataStore) ?~> Msg.DataStore.notFound
        userAuthToken <- Fox.fromFuture(
          wkSilhouetteEnvironment.combinedAuthenticatorService.findOrCreateToken(request.identity.loginInfo)
        )
        uri = s"${dataStore.publicUrl}/data/exports/$jobId/download"
      } yield Redirect(uri, Map(("token", Seq(userAuthToken.id))))
    }

  def getJobCreditCost(command: String, boundingBoxInMag: String): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        boundingBox <- BoundingBox.fromLiteral(boundingBoxInMag).toFox
        jobCommand <- JobCommand.fromString(command).toFox
        jobCostInMilliCredits <- jobService.calculateJobCostInMilliCredits(boundingBox, jobCommand)
        organizationCreditBalance <- creditTransactionDAO.getMilliCreditBalance(request.identity._organization)
        hasEnoughCredits = jobCostInMilliCredits <= organizationCreditBalance
        js = Json.obj(
          "costInMilliCredits" -> jobCostInMilliCredits,
          "hasEnoughCredits" -> hasEnoughCredits,
          "organizationMilliCredits" -> organizationCreditBalance
        )
      } yield Ok(js)
    }

}
