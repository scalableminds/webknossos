package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.collections.SequenceUtils
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonHelper.optionFormat
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{
  GetSegmentIndexParameters,
  ProtoGeometryImplicits,
  SegmentStatisticsParameters
}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.{
  LengthUnit,
  VoxelSize,
  WebknossosAdHocMeshRequest,
  WebknossosDataRequest
}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.datastore.services.mesh.FullMeshRequest
import com.scalableminds.webknossos.tracingstore.annotation.{AnnotationTransactionService, TSAnnotationService}
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.scalableminds.webknossos.tracingstore.tracings.volume._
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingSelector}
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteDatastoreClient,
  TSRemoteWebknossosClient,
  TracingStoreAccessTokenService,
  TracingStoreConfig
}
import play.api.i18n.Messages
import play.api.libs.Files.TemporaryFile
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}

import java.io.File
import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

class VolumeTracingController @Inject()(
    val volumeTracingService: VolumeTracingService,
    val config: TracingStoreConfig,
    val remoteDataStoreClient: TSRemoteDatastoreClient,
    val accessTokenService: TracingStoreAccessTokenService,
    annotationService: TSAnnotationService,
    editableMappingService: EditableMappingService,
    val slackNotificationService: TSSlackNotificationService,
    val remoteWebknossosClient: TSRemoteWebknossosClient,
    annotationTransactionService: AnnotationTransactionService,
    volumeSegmentStatisticsService: VolumeSegmentStatisticsService,
    volumeSegmentIndexService: VolumeSegmentIndexService,
    fullMeshService: TSFullMeshService,
    val rpc: RPC)(implicit val ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller
    with ProtoGeometryImplicits
    with KeyValueStoreImplicits {

  implicit val tracingsCompanion: VolumeTracings.type = VolumeTracings

  implicit def packMultiple(tracings: List[VolumeTracing]): VolumeTracings =
    VolumeTracings(tracings.map(t => VolumeTracingOpt(Some(t))))

  implicit def packMultipleOpt(tracings: List[Option[VolumeTracing]]): VolumeTracings =
    VolumeTracings(tracings.map(t => VolumeTracingOpt(t)))

  implicit def unpackMultiple(tracings: VolumeTracings): List[Option[VolumeTracing]] =
    tracings.tracings.toList.map(_.tracing)

  def save(newTracingId: String): Action[VolumeTracing] = Action.async(validateProto[VolumeTracing]) {
    implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
            for {
              _ <- volumeTracingService.saveVolume(newTracingId, version = 0, request.body)
            } yield Ok
          }
        }
      }
  }

  def get(tracingId: String, annotationId: ObjectId, version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
          for {
            tracing <- annotationService.findVolume(annotationId, tracingId, version) ?~> Messages("tracing.notFound")
          } yield Ok(tracing.toByteArray).as(protobufMimeType)
        }
      }
    }

  def getMultiple: Action[List[Option[TracingSelector]]] =
    Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            tracings <- annotationService.findMultipleVolumes(request.body)
          } yield {
            Ok(tracings.toByteArray).as(protobufMimeType)
          }
        }
      }
    }

  def initialData(annotationId: ObjectId,
                  tracingId: String,
                  minMag: Option[Int],
                  maxMag: Option[Int]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
            for {
              initialData <- request.body.asRaw.map(_.asFile).toFox ?~> Messages("zipFile.notFound")
              // The annotation object may not yet exist here. Caller is responsible to save that too.
              tracing <- annotationService.findVolumeRaw(tracingId) ?~> Messages("tracing.notFound")
              magRestrictions = MagRestrictions(minMag, maxMag)
              mags <- volumeTracingService.initializeWithData(annotationId,
                                                              tracingId,
                                                              tracing.value,
                                                              initialData,
                                                              magRestrictions)
              _ <- volumeTracingService.updateMagList(tracingId, tracing.value, mags)
            } yield Ok(Json.toJson(tracingId))
          }
        }
      }
    }

  def mergedFromContents(newTracingId: String): Action[VolumeTracings] =
    Action.async(validateProto[VolumeTracings]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          val tracingsFlat = request.body.flatten
          val shouldCreateSegmentIndex = volumeSegmentIndexService.shouldCreateSegmentIndexForMerged(tracingsFlat)
          for {
            mergedTracingRaw <- volumeTracingService
              .merge(tracingsFlat,
                     MergedVolumeStats.empty(shouldCreateSegmentIndex),
                     None,
                     newVersion = 0L,
                     additionalBoundingBoxes = Seq.empty)
              .toFox
            // segment lists for multi-volume uploads are not supported yet, compare https://github.com/scalableminds/webknossos/issues/6887
            mergedTracing = mergedTracingRaw.copy(segments = List.empty)
            _ <- volumeTracingService.saveVolume(newTracingId, mergedTracing.version, mergedTracing)
          } yield Ok
        }
      }
    }

  def initialDataMultiple(annotationId: ObjectId, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
            for {
              initialData <- request.body.asRaw.map(_.asFile).toFox ?~> Messages("zipFile.notFound")
              // The annotation object may not yet exist here. Caller is responsible to save that too.
              tracing <- annotationService.findVolumeRaw(tracingId) ?~> Messages("tracing.notFound")
              mags <- volumeTracingService.initializeWithDataMultiple(annotationId,
                                                                      tracingId,
                                                                      tracing.value,
                                                                      initialData)
              _ <- volumeTracingService.updateMagList(tracingId, tracing.value, mags)
            } yield Ok(Json.toJson(tracingId))
          }
        }
      }
    }

  def allDataZip(tracingId: String,
                 annotationId: Option[ObjectId],
                 version: Option[Long],
                 volumeDataZipFormat: String,
                 voxelSizeFactor: Option[String],
                 voxelSizeUnit: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(
          annotationId.map(UserAccessRequest.readAnnotation).getOrElse(UserAccessRequest.readTracing(tracingId))) {
          for {
            _ <- Fox.fromBool(if (version.isDefined) annotationId.isDefined else true) ?~> "Volume data request with version needs passed annotationId"
            annotationIdFilled <- Fox.fillOption(annotationId)(
              remoteWebknossosClient.getAnnotationIdForTracing(tracingId))
            tracing <- annotationService.findVolume(annotationIdFilled, tracingId, version) ?~> Messages(
              "tracing.notFound")
            volumeDataZipFormatParsed <- VolumeDataZipFormat.fromString(volumeDataZipFormat).toFox
            voxelSizeFactorParsedOpt <- Fox.runOptional(voxelSizeFactor)(f => Vec3Double.fromUriLiteral(f).toFox)
            voxelSizeUnitParsedOpt <- Fox.runOptional(voxelSizeUnit)(u => LengthUnit.fromString(u).toFox)
            voxelSize = voxelSizeFactorParsedOpt.map(voxelSizeParsed =>
              VoxelSize.fromFactorAndUnitWithDefault(voxelSizeParsed, voxelSizeUnitParsedOpt))
            data <- volumeTracingService.allDataZip(
              annotationIdFilled,
              tracingId,
              tracing,
              volumeDataZipFormatParsed,
              voxelSize
            )
          } yield Ok.sendPath(data)
        }
      }
    }

  def data(tracingId: String, annotationId: ObjectId): Action[List[WebknossosDataRequest]] =
    Action.async(validateJson[List[WebknossosDataRequest]]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
          for {
            requestedVersion <- SequenceUtils
              .findUniqueElement(request.body.map(_.version))
              .toFox ?~> "All data requests must request the same volume version"
            tracing <- annotationService.findVolume(annotationId, tracingId, requestedVersion) ?~> Messages(
              "tracing.notFound")
            (data, indices) <- if (tracing.getHasEditableMapping) {
              val mappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
              editableMappingService.volumeData(mappingLayer, request.body)
            } else volumeTracingService.data(annotationId, tracingId, tracing, request.body)
          } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
        }
      }
    }

  private def getMissingBucketsHeaders(indices: List[Int]): Seq[(String, String)] =
    List("MISSING-BUCKETS" -> formatMissingBucketList(indices), "Access-Control-Expose-Headers" -> "MISSING-BUCKETS")

  private def formatMissingBucketList(indices: List[Int]): String =
    "[" + indices.mkString(", ") + "]"

  def importVolumeData(tracingId: String): Action[MultipartFormData[TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeTracing(tracingId)) {
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
            tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound")
            currentVersion <- request.body.dataParts("currentVersion").headOption.flatMap(_.toIntOpt).toFox
            zipFile <- request.body.files.headOption.map(f => new File(f.ref.path.toString)).toFox
            largestSegmentId <- volumeTracingService.importVolumeData(annotationId,
                                                                      tracingId,
                                                                      tracing,
                                                                      zipFile,
                                                                      currentVersion)
            _ <- annotationTransactionService.handleSingleUpdateAction(
              annotationId,
              tracing.version,
              ImportVolumeDataVolumeAction(tracingId, Some(largestSegmentId)))
          } yield Ok(Json.toJson(largestSegmentId))
        }
      }
    }

  def requestAdHocMesh(tracingId: String): Action[WebknossosAdHocMeshRequest] =
    Action.async(validateJson[WebknossosAdHocMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          // The client expects the ad-hoc mesh as a flat float-array. Three consecutive floats form a 3D point, three
          // consecutive 3D points (i.e., nine floats) form a triangle.
          // There are no shared vertices between triangles.
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound")
          (vertices: Array[Float], neighbors: List[Int]) <- if (tracing.getHasEditableMapping) {
            val editableMappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
            editableMappingService.createAdHocMesh(editableMappingLayer, request.body)
          } else volumeTracingService.createAdHocMesh(annotationId, tracingId, tracing, request.body)
        } yield {
          // We need four bytes for each float
          val responseBuffer = ByteBuffer.allocate(vertices.length * 4).order(ByteOrder.LITTLE_ENDIAN)
          responseBuffer.asFloatBuffer().put(vertices)
          Ok(responseBuffer.array()).withHeaders(getNeighborIndices(neighbors): _*)
        }
      }
    }

  def loadFullMeshStl(tracingId: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          data: Array[Byte] <- fullMeshService.loadFor(annotationId, tracingId, request.body) ?~> "mesh.file.loadChunk.failed"
        } yield Ok(data)
      }
    }

  private def getNeighborIndices(neighbors: List[Int]) =
    List("NEIGHBORS" -> formatNeighborList(neighbors), "Access-Control-Expose-Headers" -> "NEIGHBORS")

  private def formatNeighborList(neighbors: List[Int]): String =
    "[" + neighbors.mkString(", ") + "]"

  def findData(tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
      for {
        annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
        tracing <- annotationService.findVolume(annotationId, tracingId)
        positionOpt <- volumeTracingService.findData(annotationId, tracingId, tracing)
      } yield {
        Ok(Json.obj("position" -> positionOpt, "mag" -> positionOpt.map(_ => Vec3Int.ones)))
      }
    }
  }

  def getSegmentVolume(tracingId: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId)
          mappingName <- annotationService.baseMappingName(annotationId, tracingId, tracing)
          segmentVolumes <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            volumeSegmentStatisticsService.getSegmentVolume(annotationId,
                                                            tracingId,
                                                            segmentId,
                                                            request.body.mag,
                                                            mappingName,
                                                            request.body.additionalCoordinates)
          }
        } yield Ok(Json.toJson(segmentVolumes))
      }
    }

  def getSegmentBoundingBox(tracingId: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId)
          mappingName <- annotationService.baseMappingName(annotationId, tracingId, tracing)
          segmentBoundingBoxes: List[BoundingBox] <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            volumeSegmentStatisticsService.getSegmentBoundingBox(annotationId,
                                                                 tracingId,
                                                                 segmentId,
                                                                 request.body.mag,
                                                                 mappingName,
                                                                 request.body.additionalCoordinates)
          }
        } yield Ok(Json.toJson(segmentBoundingBoxes))
      }
    }

  def getSegmentIndex(tracingId: String, segmentId: Long): Action[GetSegmentIndexParameters] =
    Action.async(validateJson[GetSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId)
          fallbackLayer <- volumeTracingService.getFallbackLayer(annotationId, tracing)
          mappingName <- annotationService.baseMappingName(annotationId, tracingId, tracing)
          _ <- Fox.fromBool(DataLayer.bucketSize <= request.body.cubeSize) ?~> "cubeSize must be at least one bucket (32³)"
          bucketPositions: Set[Vec3IntProto] <- volumeSegmentIndexService.getSegmentToBucketIndex(
            tracing,
            fallbackLayer,
            tracingId,
            segmentId,
            request.body.mag,
            additionalCoordinates = request.body.additionalCoordinates,
            mappingName = mappingName,
            editableMappingTracingId = volumeTracingService.editableMappingTracingId(tracing, tracingId)
          )
          bucketPositionsForCubeSize = bucketPositions.toSeq
            .map(vec3IntFromProto)
            .map(_.scale(DataLayer.bucketLength)) // bucket positions raw are indices of 32³ buckets
            .map(_ / request.body.cubeSize)
            .distinct // divide by requested cube size to map them to larger buckets, select unique
            .map(_ * request.body.cubeSize) // return positions, not indices
        } yield Ok(Json.toJson(bucketPositionsForCubeSize))
      }
    }

  // Used in task creation. History is dropped. Caller is responsible to create and save a matching AnnotationProto object
  def duplicate(tracingId: String,
                newAnnotationId: ObjectId,
                newTracingId: String,
                ownerId: ObjectId,
                requestingUserId: ObjectId,
                minMag: Option[Int],
                maxMag: Option[Int],
                editPosition: Option[String],
                editRotation: Option[String],
                boundingBox: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
            for {
              annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
              editPositionParsed <- Fox.runOptional(editPosition)(p => Vec3Int.fromUriLiteral(p).toFox)
              editRotationParsed <- Fox.runOptional(editRotation)(r => Vec3Double.fromUriLiteral(r).toFox)
              boundingBoxParsed <- Fox.runOptional(boundingBox)(b => BoundingBox.fromLiteral(b).toFox)
              magRestrictions = MagRestrictions(minMag, maxMag)
              newestSourceVersion <- annotationService.currentMaterializableVersion(annotationId)
              _ <- annotationService.duplicateVolumeTracing(
                annotationId,
                sourceTracingId = tracingId,
                sourceVersion = newestSourceVersion,
                newAnnotationId = newAnnotationId,
                newTracingId = newTracingId,
                newVersion = 0,
                ownerId = ownerId,
                requestingUserId = requestingUserId,
                editPosition = editPositionParsed,
                editRotation = editRotationParsed,
                boundingBox = boundingBoxParsed,
                datasetBoundingBox = None,
                isFromTask = false,
                magRestrictions = magRestrictions
              )
            } yield Ok
          }
        }
      }
    }
}
