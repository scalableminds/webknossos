package com.scalableminds.webknossos.tracingstore.controllers

import java.io.File
import java.nio.{ByteBuffer, ByteOrder}

import akka.stream.scaladsl.Source
import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int, Vec3Double}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrCoordinatesParser
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.jzarr.{ArrayOrder, OmeNgffHeader, ZarrHeader}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.{WebKnossosDataRequest, WebKnossosIsosurfaceRequest}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingService,
  EditableMappingUpdateActionGroup,
  RemoteFallbackLayer
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

import scala.concurrent.{ExecutionContext, Future}

class VolumeTracingController @Inject()(
    val tracingService: VolumeTracingService,
    val config: TracingStoreConfig,
    val remoteWebKnossosClient: TSRemoteWebKnossosClient,
    val remoteDataStoreClient: TSRemoteDatastoreClient,
    val accessTokenService: TracingStoreAccessTokenService,
    editableMappingService: EditableMappingService,
    val slackNotificationService: TSSlackNotificationService,
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
          accessTokenService.validateAccess(UserAccessRequest.webknossos, token) {
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
        accessTokenService.validateAccess(UserAccessRequest.webknossos, token) {
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
          accessTokenService.validateAccess(UserAccessRequest.webknossos, token) {
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
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
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
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
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
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            (data, indices) <- if (tracing.getMappingIsEditable)
              editableMappingService.volumeData(tracing, request.body, token)
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
        accessTokenService.validateAccess(UserAccessRequest.webknossos, token) {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            _ <- bool2Fox(!tracing.getMappingIsEditable) ?~> "Duplicate is not yet implemented for editable mapping annotations"
            dataSetBoundingBox = request.body.asJson.flatMap(_.validateOpt[BoundingBox].asOpt.flatten)
            resolutionRestrictions = ResolutionRestrictions(minResolution, maxResolution)
            editPositionParsed <- Fox.runOptional(editPosition)(Vec3Int.fromUriLiteral)
            editRotationParsed <- Fox.runOptional(editRotation)(Vec3Double.fromUriLiteral)
            boundingBoxParsed <- Fox.runOptional(boundingBox)(BoundingBox.fromLiteral)
            (newId, newTracing) <- tracingService.duplicate(tracingId,
                                                            tracing,
                                                            fromTask.getOrElse(false),
                                                            dataSetBoundingBox,
                                                            resolutionRestrictions,
                                                            editPositionParsed,
                                                            editRotationParsed,
                                                            boundingBoxParsed)
            _ <- Fox.runIfOptionTrue(downsample)(tracingService.downsample(newId, newTracing))
          } yield Ok(Json.toJson(newId))
        }
      }
    }
  }

  def importVolumeData(token: Option[String], tracingId: String): Action[MultipartFormData[TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId), token) {
          for {
            tracing <- tracingService.find(tracingId)
            currentVersion <- request.body.dataParts("currentVersion").headOption.flatMap(_.toIntOpt).toFox
            zipFile <- request.body.files.headOption.map(f => new File(f.ref.path.toString)).toFox
            largestSegmentId <- tracingService.importVolumeData(tracingId, tracing, zipFile, currentVersion)
          } yield Ok(Json.toJson(largestSegmentId))
        }
      }
    }

  def updateActionLog(token: Option[String], tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
        for {
          updateLog <- tracingService.updateActionLog(tracingId)
        } yield Ok(updateLog)
      }
    }
  }

  def requestIsosurface(token: Option[String], tracingId: String): Action[WebKnossosIsosurfaceRequest] =
    Action.async(validateJson[WebKnossosIsosurfaceRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
        for {
          // The client expects the isosurface as a flat float-array. Three consecutive floats form a 3D point, three
          // consecutive 3D points (i.e., nine floats) form a triangle.
          // There are no shared vertices between triangles.
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
          (vertices, neighbors) <- if (tracing.getMappingIsEditable)
            editableMappingService.createIsosurface(tracing, request.body, token)
          else tracingService.createIsosurface(tracingId, request.body)
        } yield {
          // We need four bytes for each float
          val responseBuffer = ByteBuffer.allocate(vertices.length * 4).order(ByteOrder.LITTLE_ENDIAN)
          responseBuffer.asFloatBuffer().put(vertices)
          Ok(responseBuffer.array()).withHeaders(getNeighborIndices(neighbors): _*)
        }
      }
    }

  def volumeTracingFolderContent(token: Option[String], tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> 404
          existingMags = tracing.resolutions.map(vec3IntFromProto)
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Tracingstore",
              "%s".format(tracingId),
              Map(tracingId -> ".") ++ existingMags.map { mag =>
                (mag.toMagLiteral(allowScalar = true), mag.toMagLiteral(allowScalar = true))
              }.toMap
            )).withHeaders()
      }
    }

  def volumeTracingMagFolderContent(token: Option[String], tracingId: String, mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> 404

          existingMags = tracing.resolutions.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> 404
          _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> 404
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Tracingstore",
              "%s".format(tracingId),
              Map(mag -> ".")
            )).withHeaders()
      }
    }

  def zArray(token: Option[String], tracingId: String, mag: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> 404

          existingMags = tracing.resolutions.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> 404
          _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> 404

          cubeLength = DataLayer.bucketLength
          (channels, dtype) = ElementClass.toChannelAndZarrString(tracing.elementClass)
          // data request method always decompresses before sending
          compressor = None

          shape = Array(
            channels,
            // Zarr can't handle data sets that don't start at 0, so we extend shape to include "true" coords
            (tracing.boundingBox.width + tracing.boundingBox.topLeft.x) / magParsed.x,
            (tracing.boundingBox.height + tracing.boundingBox.topLeft.y) / magParsed.y,
            (tracing.boundingBox.depth + tracing.boundingBox.topLeft.z) / magParsed.z
          )

          chunks = Array(channels, cubeLength, cubeLength, cubeLength)

          zarrHeader = ZarrHeader(zarr_format = 2,
                                  shape = shape,
                                  chunks = chunks,
                                  compressor = compressor,
                                  dtype = dtype,
                                  order = ArrayOrder.F)
        } yield
          Ok(
            // Json.toJson doesn't work on zarrHeader at the moment, because it doesn't write None values in Options
            Json.obj(
              "dtype" -> zarrHeader.dtype,
              "fill_value" -> 0,
              "zarr_format" -> zarrHeader.zarr_format,
              "order" -> zarrHeader.order,
              "chunks" -> zarrHeader.chunks,
              "compressor" -> compressor,
              "filters" -> None,
              "shape" -> zarrHeader.shape,
              "dimension_seperator" -> zarrHeader.dimension_separator
            ))
      }
  }

  def zGroup(token: Option[String], tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
      Future(Ok(Json.obj("zarr_format" -> 2)))
    }
  }

  /**
    * Handles a request for .zattrs file for a Volume Tracing via a HTTP GET.
    * Uses the OME-NGFF standard (see https://ngff.openmicroscopy.org/latest/)
    * Used by zarr-streaming.
    */
  def zAttrs(
      token: Option[String],
      tracingId: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
      for {
        tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> 404

        existingMags = tracing.resolutions.map(vec3IntFromProto)
        dataSource <- remoteWebKnossosClient.getDataSource(tracing.organizationName, tracing.dataSetName) ~> 404

        omeNgffHeader = OmeNgffHeader.fromDataLayerName(tracingId,
                                                        dataSourceScale = dataSource.scale,
                                                        mags = existingMags.toList)
      } yield Ok(Json.toJson(omeNgffHeader))
    }
  }

  def rawZarrCube(token: Option[String], tracingId: String, mag: String, cxyz: String): Action[AnyContent] =
    Action.async { implicit request =>
      {
        val combinedToken = urlOrHeaderToken(token, request)
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), combinedToken) {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> 404

            existingMags = tracing.resolutions.map(vec3IntFromProto)
            magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> 404
            _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> 404

            (c, x, y, z) <- ZarrCoordinatesParser.parseDotCoordinates(cxyz) ?~> Messages("zarr.invalidChunkCoordinates") ~> 404
            _ <- bool2Fox(c == 0) ~> Messages("zarr.invalidFirstChunkCoord") ~> 404
            cubeSize = DataLayer.bucketLength
            request = WebKnossosDataRequest(
              position = Vec3Int(x * cubeSize * magParsed.x, y * cubeSize * magParsed.y, z * cubeSize * magParsed.z),
              mag = magParsed,
              cubeSize = cubeSize,
              fourBit = Some(false),
              applyAgglomerate = None,
              version = None
            )
            (data, missingBucketIndices) <- if (tracing.getMappingIsEditable)
              editableMappingService.volumeData(tracing, List(request), token)
            else tracingService.data(tracingId, tracing, List(request))
            dataWithFallback <- getFallbackLayerDataIfEmpty(tracing,
                                                            data,
                                                            missingBucketIndices,
                                                            magParsed,
                                                            Vec3Int(x, y, z),
                                                            cubeSize,
                                                            combinedToken) ?~> "Getting fallback layer failed" ~> 400
          } yield Ok(dataWithFallback).withHeaders()
        }
      }
    }

  private def getFallbackLayerDataIfEmpty(tracing: VolumeTracing,
                                          data: Array[Byte],
                                          missingBucketIndices: List[Int],
                                          mag: Vec3Int,
                                          position: Vec3Int,
                                          cubeSize: Int,
                                          urlToken: Option[String]): Fox[Array[Byte]] = {
    def fallbackLayerData(): Fox[Array[Byte]] = {
      val organizationName = tracing.organizationName
      val dataSetName = tracing.dataSetName
      val dataLayerName = tracing.getFallbackLayer
      val request = WebKnossosDataRequest(
        position = Vec3Int(position.x * cubeSize * mag.x, position.y * cubeSize * mag.y, position.z * cubeSize * mag.z),
        mag = mag,
        cubeSize = cubeSize,
        fourBit = Some(false),
        applyAgglomerate = tracing.mappingName,
        version = None
      )

      organizationName match {
        case Some(orgName) =>
          for {
            // ignoring missing bucket indices, if data is empty overall response is empty anyways
            (fallbackData, _) <- remoteDataStoreClient.getData(
              RemoteFallbackLayer(orgName, dataSetName, dataLayerName, tracing.elementClass),
              List(request),
              urlToken)
          } yield fallbackData
        case None => Fox.failure("Organization Name is not set (Consider creating a new annotation).")
      }
    }
    if (missingBucketIndices.nonEmpty && tracing.fallbackLayer.isDefined) {
      fallbackLayerData()
    } else {
      Fox.successful(data)
    }
  }

  private def getNeighborIndices(neighbors: List[Int]) =
    List("NEIGHBORS" -> formatNeighborList(neighbors), "Access-Control-Expose-Headers" -> "NEIGHBORS")

  private def formatNeighborList(neighbors: List[Int]): String =
    "[" + neighbors.mkString(", ") + "]"

  def findData(token: Option[String], tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
      for {
        positionOpt <- tracingService.findData(tracingId)
      } yield {
        Ok(Json.obj("position" -> positionOpt, "resolution" -> positionOpt.map(_ => Vec3Int(1, 1, 1))))
      }
    }
  }

  def agglomerateSkeleton(token: Option[String], tracingId: String, agglomerateId: Long): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
        for {
          tracing <- tracingService.find(tracingId)
          _ <- bool2Fox(tracing.getMappingIsEditable) ?~> "Cannot query agglomerate skeleton for volume annotation"
          mappingName <- tracing.mappingName ?~> "annotation.agglomerateSkeleton.noMappingSet"
          remoteFallbackLayer <- editableMappingService.remoteFallbackLayer(tracing)
          agglomerateSkeletonBytes <- editableMappingService.getAgglomerateSkeletonWithFallback(mappingName,
                                                                                                remoteFallbackLayer,
                                                                                                agglomerateId,
                                                                                                token)
        } yield Ok(agglomerateSkeletonBytes)
      }
    }

  def makeMappingEditable(token: Option[String], tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
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

  def updateEditableMapping(token: Option[String], tracingId: String): Action[List[EditableMappingUpdateActionGroup]] =
    Action.async(validateJson[List[EditableMappingUpdateActionGroup]]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId), token) {
        for {
          tracing <- tracingService.find(tracingId)
          mappingName <- tracing.mappingName.toFox
          _ <- bool2Fox(tracing.getMappingIsEditable) ?~> "Mapping is not editable"
          currentVersion <- editableMappingService.newestMaterializableVersion(mappingName)
          _ <- bool2Fox(request.body.length == 1) ?~> "Editable mapping update group must contain exactly one update group"
          updateGroup <- request.body.headOption.toFox
          _ <- bool2Fox(updateGroup.version == currentVersion + 1) ?~> "version mismatch"
          _ <- bool2Fox(updateGroup.actions.length == 1) ?~> "Editable mapping update group must contain exactly one update action"
          _ <- editableMappingService.update(mappingName, updateGroup, updateGroup.version)
        } yield Ok
      }
    }

  def editableMappingUpdateActionLog(token: Option[String], tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
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
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
          for {
            tracing <- tracingService.find(tracingId)
            mappingName <- tracing.mappingName.toFox
            remoteFallbackLayer <- editableMappingService.remoteFallbackLayer(tracing)
            editableMapping <- editableMappingService.get(mappingName, remoteFallbackLayer, token)
            infoJson <- editableMappingService.infoJson(tracingId = tracingId,
                                                        editableMappingId = mappingName,
                                                        editableMapping = editableMapping)
          } yield Ok(infoJson)
        }
      }
  }

}
