package com.scalableminds.webknossos.tracingstore.controllers

import akka.stream.scaladsl.Source
import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{WebKnossosDataRequest, WebKnossosIsosurfaceRequest}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{EditableMappingSegmentListResult, UserAccessRequest}
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingService,
  EditableMappingUpdateActionGroup,
  MinCutParameters
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  MergedVolumeStats,
  ResolutionRestrictions,
  SegmentStatisticsParameters,
  UpdateMappingNameAction,
  VolumeSegmentIndexService,
  VolumeSegmentStatisticsService,
  VolumeTracingService
}
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, UpdateActionGroup}
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteDatastoreClient,
  TSRemoteWebKnossosClient,
  TracingStoreAccessTokenService,
  TracingStoreConfig
}
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.Messages
import play.api.libs.Files.TemporaryFile
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.streams.IterateeStreams
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}

import java.io.File
import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

class VolumeTracingController @Inject()(
    val tracingService: VolumeTracingService,
    val config: TracingStoreConfig,
    val remoteDataStoreClient: TSRemoteDatastoreClient,
    val accessTokenService: TracingStoreAccessTokenService,
    editableMappingService: EditableMappingService,
    val slackNotificationService: TSSlackNotificationService,
    val remoteWebKnossosClient: TSRemoteWebKnossosClient,
    volumeSegmentStatisticsService: VolumeSegmentStatisticsService,
    volumeSegmentIndexService: VolumeSegmentIndexService,
    val rpc: RPC)(implicit val ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends TracingController[VolumeTracing, VolumeTracings]
    with ProtoGeometryImplicits
    with KeyValueStoreImplicits {

  implicit val tracingsCompanion: VolumeTracings.type = VolumeTracings

  implicit def packMultiple(tracings: List[VolumeTracing]): VolumeTracings =
    VolumeTracings(tracings.map(t => VolumeTracingOpt(Some(t))))

  implicit def packMultipleOpt(tracings: List[Option[VolumeTracing]]): VolumeTracings =
    VolumeTracings(tracings.map(t => VolumeTracingOpt(t)))

  implicit def unpackMultiple(tracings: VolumeTracings): List[Option[VolumeTracing]] =
    tracings.tracings.toList.map(_.tracing)

  def initialData(token: Option[String],
                  tracingId: String,
                  minResolution: Option[Int],
                  maxResolution: Option[Int]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
            for {
              initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
              tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
              resolutionRestrictions = ResolutionRestrictions(minResolution, maxResolution)
              resolutions <- tracingService
                .initializeWithData(tracingId, tracing, initialData, resolutionRestrictions)
                .toFox
              _ <- tracingService.updateResolutionList(tracingId, tracing, resolutions)
            } yield Ok(Json.toJson(tracingId))
          }
        }
      }
    }

  def mergedFromContents(token: Option[String], persist: Boolean): Action[VolumeTracings] =
    Action.async(validateProto[VolumeTracings]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
          for {
            _ <- Fox.successful(())
            tracings = request.body
            shouldCreateSegmentIndex = volumeSegmentIndexService.shouldCreateSegmentIndexForMerged(tracings.flatten)
            mt <- tracingService.merge(tracings.flatten, MergedVolumeStats.empty(shouldCreateSegmentIndex), Empty).toFox

            // segment lists for multi-volume uploads are not supported yet, compare https://github.com/scalableminds/webknossos/issues/6887
            mergedTracing = mt.copy(segments = List.empty)

            newId <- tracingService.save(mergedTracing, None, mergedTracing.version, toCache = !persist)
          } yield Ok(Json.toJson(newId))
        }
      }
    }

  def initialDataMultiple(token: Option[String], tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
            for {
              initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
              tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
              resolutions <- tracingService.initializeWithDataMultiple(tracingId, tracing, initialData).toFox
              _ <- tracingService.updateResolutionList(tracingId, tracing, resolutions)
            } yield Ok(Json.toJson(tracingId))
          }
        }
      }
  }

  def allData(token: Option[String], tracingId: String, version: Option[Long]): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId, version) ?~> Messages("tracing.notFound")
          } yield {
            val enumerator: Enumerator[Array[Byte]] = tracingService.allDataEnumerator(tracingId, tracing)
            Ok.chunked(Source.fromPublisher(IterateeStreams.enumeratorToPublisher(enumerator)))
          }
        }
      }
  }

  def allDataBlocking(token: Option[String], tracingId: String, version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId, version) ?~> Messages("tracing.notFound")
            data <- tracingService.allDataFile(tracingId, tracing)
          } yield Ok.sendFile(data)
        }
      }
    }

  def data(token: Option[String], tracingId: String): Action[List[WebKnossosDataRequest]] =
    Action.async(validateJson[List[WebKnossosDataRequest]]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            (data, indices) <- if (tracing.mappingIsEditable.getOrElse(false))
              editableMappingService.volumeData(tracing, tracingId, request.body, urlOrHeaderToken(token, request))
            else tracingService.data(tracingId, tracing, request.body)
          } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
        }
      }
    }

  private def getMissingBucketsHeaders(indices: List[Int]): Seq[(String, String)] =
    List("MISSING-BUCKETS" -> formatMissingBucketList(indices), "Access-Control-Expose-Headers" -> "MISSING-BUCKETS")

  private def formatMissingBucketList(indices: List[Int]): String =
    "[" + indices.mkString(", ") + "]"

  def duplicate(token: Option[String],
                tracingId: String,
                fromTask: Option[Boolean],
                minResolution: Option[Int],
                maxResolution: Option[Int],
                downsample: Option[Boolean],
                editPosition: Option[String],
                editRotation: Option[String],
                boundingBox: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    log() {
      logTime(slackNotificationService.noticeSlowRequest) {
        val userToken = urlOrHeaderToken(token, request)
        accessTokenService.validateAccess(UserAccessRequest.webknossos, userToken) {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            _ = logger.info(s"Duplicating volume tracing $tracingId...")
            dataSetBoundingBox = request.body.asJson.flatMap(_.validateOpt[BoundingBox].asOpt.flatten)
            resolutionRestrictions = ResolutionRestrictions(minResolution, maxResolution)
            editPositionParsed <- Fox.runOptional(editPosition)(Vec3Int.fromUriLiteral)
            editRotationParsed <- Fox.runOptional(editRotation)(Vec3Double.fromUriLiteral)
            boundingBoxParsed <- Fox.runOptional(boundingBox)(BoundingBox.fromLiteral)
            remoteFallbackLayerOpt <- Fox.runIf(tracing.mappingIsEditable.contains(true))(
              tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId))
            newEditableMappingId <- Fox.runIf(tracing.mappingIsEditable.contains(true))(
              editableMappingService.duplicate(tracing.mappingName, version = None, remoteFallbackLayerOpt, userToken))
            (newId, newTracing) <- tracingService.duplicate(
              tracingId,
              tracing,
              fromTask.getOrElse(false),
              dataSetBoundingBox,
              resolutionRestrictions,
              editPositionParsed,
              editRotationParsed,
              boundingBoxParsed,
              newEditableMappingId
            )
            _ <- Fox.runIfOptionTrue(downsample)(tracingService.downsample(newId, tracingId, newTracing))
          } yield Ok(Json.toJson(newId))
        }
      }
    }
  }

  def importVolumeData(token: Option[String], tracingId: String): Action[MultipartFormData[TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId)
            currentVersion <- request.body.dataParts("currentVersion").headOption.flatMap(_.toIntOpt).toFox
            zipFile <- request.body.files.headOption.map(f => new File(f.ref.path.toString)).toFox
            largestSegmentId <- tracingService.importVolumeData(tracingId,
                                                                tracing,
                                                                zipFile,
                                                                currentVersion,
                                                                urlOrHeaderToken(token, request))
          } yield Ok(Json.toJson(largestSegmentId))
        }
      }
    }

  def updateActionLog(token: Option[String],
                      tracingId: String,
                      newestVersion: Option[Long] = None,
                      oldestVersion: Option[Long] = None): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          updateLog <- tracingService.updateActionLog(tracingId, newestVersion, oldestVersion)
        } yield Ok(updateLog)
      }
    }
  }

  def requestIsosurface(token: Option[String], tracingId: String): Action[WebKnossosIsosurfaceRequest] =
    Action.async(validateJson[WebKnossosIsosurfaceRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          // The client expects the isosurface as a flat float-array. Three consecutive floats form a 3D point, three
          // consecutive 3D points (i.e., nine floats) form a triangle.
          // There are no shared vertices between triangles.
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
          (vertices, neighbors) <- if (tracing.mappingIsEditable.getOrElse(false))
            editableMappingService.createIsosurface(tracing, tracingId, request.body, urlOrHeaderToken(token, request))
          else tracingService.createIsosurface(tracingId, request.body, urlOrHeaderToken(token, request))
        } yield {
          // We need four bytes for each float
          val responseBuffer = ByteBuffer.allocate(vertices.length * 4).order(ByteOrder.LITTLE_ENDIAN)
          responseBuffer.asFloatBuffer().put(vertices)
          Ok(responseBuffer.array()).withHeaders(getNeighborIndices(neighbors): _*)
        }
      }
    }

  private def getNeighborIndices(neighbors: List[Int]) =
    List("NEIGHBORS" -> formatNeighborList(neighbors), "Access-Control-Expose-Headers" -> "NEIGHBORS")

  private def formatNeighborList(neighbors: List[Int]): String =
    "[" + neighbors.mkString(", ") + "]"

  def findData(token: Option[String], tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
      for {
        positionOpt <- tracingService.findData(tracingId)
      } yield {
        Ok(Json.obj("position" -> positionOpt, "resolution" -> positionOpt.map(_ => Vec3Int(1, 1, 1))))
      }
    }
  }

  def agglomerateSkeleton(token: Option[String], tracingId: String, agglomerateId: Long): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId)
          _ <- bool2Fox(tracing.getMappingIsEditable) ?~> "Cannot query agglomerate skeleton for volume annotation"
          mappingName <- tracing.mappingName ?~> "annotation.agglomerateSkeleton.noMappingSet"
          remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
          agglomerateSkeletonBytes <- editableMappingService.getAgglomerateSkeletonWithFallback(
            mappingName,
            remoteFallbackLayer,
            agglomerateId,
            urlOrHeaderToken(token, request))
        } yield Ok(agglomerateSkeletonBytes)
      }
    }

  def makeMappingEditable(token: Option[String], tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId)
            tracingMappingName <- tracing.mappingName ?~> "annotation.noMappingSet"
            _ <- bool2Fox(tracingService.volumeBucketsAreEmpty(tracingId)) ?~> "annotation.volumeBucketsNotEmpty"
            (editableMappingId, editableMappingInfo) <- editableMappingService.create(
              baseMappingName = tracingMappingName)
            volumeUpdate = UpdateMappingNameAction(Some(editableMappingId),
                                                   isEditable = Some(true),
                                                   actionTimestamp = Some(System.currentTimeMillis()))
            _ <- tracingService.handleUpdateGroup(
              tracingId,
              UpdateActionGroup[VolumeTracing](tracing.version + 1,
                                               System.currentTimeMillis(),
                                               None,
                                               List(volumeUpdate),
                                               None,
                                               None,
                                               "dummyTransactionId",
                                               1,
                                               0),
              tracing.version,
              urlOrHeaderToken(token, request)
            )
            infoJson <- editableMappingService.infoJson(tracingId = tracingId,
                                                        editableMappingId = editableMappingId,
                                                        editableMappingInfo = editableMappingInfo,
                                                        version = Some(0L))
          } yield Ok(infoJson)
        }
      }
    }

  def agglomerateGraphMinCut(token: Option[String], tracingId: String): Action[MinCutParameters] =
    Action.async(validateJson[MinCutParameters]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId)
            _ <- bool2Fox(tracing.getMappingIsEditable) ?~> "Mapping is not editable"
            remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            edges <- editableMappingService.agglomerateGraphMinCut(request.body, remoteFallbackLayer, token)
          } yield Ok(Json.toJson(edges))
        }
      }
    }

  def updateEditableMapping(token: Option[String], tracingId: String): Action[List[EditableMappingUpdateActionGroup]] =
    Action.async(validateJson[List[EditableMappingUpdateActionGroup]]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId)
          mappingName <- tracing.mappingName.toFox
          _ <- bool2Fox(tracing.getMappingIsEditable) ?~> "Mapping is not editable"
          currentVersion <- editableMappingService.getClosestMaterializableVersionOrZero(mappingName, None)
          _ <- bool2Fox(request.body.length == 1) ?~> "Editable mapping update request must contain exactly one update group"
          updateGroup <- request.body.headOption.toFox
          _ <- bool2Fox(updateGroup.version == currentVersion + 1) ?~> "version mismatch"
          _ <- editableMappingService.update(mappingName, updateGroup, updateGroup.version)
        } yield Ok
      }
    }

  def editableMappingUpdateActionLog(token: Option[String], tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId)
            mappingName <- tracing.mappingName.toFox
            _ <- bool2Fox(tracing.getMappingIsEditable) ?~> "Mapping is not editable"
            updateLog <- editableMappingService.updateActionLog(mappingName)
          } yield Ok(updateLog)
        }
      }
  }

  def editableMappingInfo(token: Option[String], tracingId: String, version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId)
            mappingName <- tracing.mappingName.toFox
            remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            editableMappingInfo <- editableMappingService.getInfo(mappingName,
                                                                  version,
                                                                  remoteFallbackLayer,
                                                                  urlOrHeaderToken(token, request))
            infoJson <- editableMappingService.infoJson(tracingId = tracingId,
                                                        editableMappingId = mappingName,
                                                        editableMappingInfo = editableMappingInfo,
                                                        version = version)
          } yield Ok(infoJson)
        }
      }
    }

  def editableMappingSegmentIdsForAgglomerate(token: Option[String],
                                              tracingId: String,
                                              agglomerateId: Long): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId)
            mappingName <- tracing.mappingName.toFox
            remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            agglomerateGraphBox: Box[AgglomerateGraph] <- editableMappingService
              .getAgglomerateGraphForId(mappingName,
                                        agglomerateId,
                                        remoteFallbackLayer,
                                        urlOrHeaderToken(token, request))
              .futureBox
            segmentIds <- agglomerateGraphBox match {
              case Full(agglomerateGraph) => Fox.successful(agglomerateGraph.segments)
              case Empty                  => Fox.successful(List.empty)
              case f: Failure             => f.toFox
            }
            agglomerateIdIsPresent = agglomerateGraphBox.isDefined
          } yield Ok(Json.toJson(EditableMappingSegmentListResult(segmentIds.toList, agglomerateIdIsPresent)))
        }
      }
  }

  def getSegmentVolume(token: Option[String], tracingId: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          segmentVolumes <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            volumeSegmentStatisticsService.getSegmentVolume(tracingId,
                                                            segmentId,
                                                            request.body.mag,
                                                            urlOrHeaderToken(token, request))
          }
        } yield Ok(Json.toJson(segmentVolumes))
      }
    }

  def getSegmentBoundingBox(token: Option[String], tracingId: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          segmentBoundingBoxes: List[BoundingBox] <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            volumeSegmentStatisticsService.getSegmentBoundingBox(tracingId,
                                                                 segmentId,
                                                                 request.body.mag,
                                                                 urlOrHeaderToken(token, request))
          }
        } yield Ok(Json.toJson(segmentBoundingBoxes))
      }
    }

}
