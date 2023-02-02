package com.scalableminds.webknossos.tracingstore.controllers

import akka.stream.scaladsl.Source
import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.EditableMapping.EditableMappingProto
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
  ResolutionRestrictions,
  UpdateMappingNameAction,
  VolumeTracingService
}
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, UpdateActionGroup}
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteDatastoreClient,
  TSRemoteWebKnossosClient,
  TracingStoreAccessTokenService,
  TracingStoreConfig
}
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
          val tracings: List[Option[VolumeTracing]] = request.body
          val mergedTracing = tracingService.merge(tracings.flatten)
          tracingService.save(mergedTracing, None, mergedTracing.version, toCache = !persist).map { newId =>
            Ok(Json.toJson(newId))
          }
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
            dataSetBoundingBox = request.body.asJson.flatMap(_.validateOpt[BoundingBox].asOpt.flatten)
            resolutionRestrictions = ResolutionRestrictions(minResolution, maxResolution)
            editPositionParsed <- Fox.runOptional(editPosition)(Vec3Int.fromUriLiteral)
            editRotationParsed <- Fox.runOptional(editRotation)(Vec3Double.fromUriLiteral)
            boundingBoxParsed <- Fox.runOptional(boundingBox)(BoundingBox.fromLiteral)
            newEditableMappingId <- Fox.runIf(tracing.mappingIsEditable.contains(true))(
              editableMappingService.duplicate(tracing.mappingName, tracing, tracingId, userToken))
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
            largestSegmentId <- tracingService.importVolumeData(tracingId, tracing, zipFile, currentVersion)
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
            (editableMappingId, editableMapping) <- editableMappingService.create(baseMappingName = tracingMappingName)
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
                                               None,
                                               None,
                                               None),
              tracing.version
            )
            infoJson <- editableMappingService.infoJson(tracingId = tracingId,
                                                        editableMappingId = editableMappingId,
                                                        editableMapping = editableMapping)
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
          currentVersion <- editableMappingService.newestMaterializableVersion(mappingName)
          _ <- bool2Fox(request.body.length == 1) ?~> "Editable mapping update group must contain exactly one update group"
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

  def editableMappingInfo(token: Option[String], tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId)
            mappingName <- tracing.mappingName.toFox
            remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            editableMapping <- editableMappingService.get(mappingName,
                                                          remoteFallbackLayer,
                                                          urlOrHeaderToken(token, request))
            infoJson <- editableMappingService.infoJson(tracingId = tracingId,
                                                        editableMappingId = mappingName,
                                                        editableMapping = editableMapping)
          } yield Ok(infoJson)
        }
      }
  }

  def editableMappingProto(token: Option[String], tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId)
            mappingName <- tracing.mappingName.toFox
            remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            editableMapping <- editableMappingService.get(mappingName,
                                                          remoteFallbackLayer,
                                                          urlOrHeaderToken(token, request))
          } yield Ok(toProtoBytes[EditableMappingProto](editableMapping.toProto))
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
            editableMapping <- editableMappingService.get(mappingName,
                                                          remoteFallbackLayer,
                                                          urlOrHeaderToken(token, request))
            agglomerateIdIsPresent = editableMapping.agglomerateToGraph.contains(agglomerateId)
            segmentIds = if (agglomerateIdIsPresent) {
              editableMapping.agglomerateToGraph(agglomerateId).segments
            } else List.empty
          } yield Ok(Json.toJson(EditableMappingSegmentListResult(segmentIds.toList, agglomerateIdIsPresent)))
        }
      }
  }

}
