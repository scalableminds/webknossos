package com.scalableminds.webknossos.tracingstore.controllers

import java.io.File
import java.nio.{ByteBuffer, ByteOrder}
import akka.stream.scaladsl.Source
import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceLike}
import com.scalableminds.webknossos.datastore.models.{VoxelPosition, WebKnossosDataRequest, WebKnossosIsosurfaceRequest}
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.volume.{ResolutionRestrictions, VolumeTracingService}
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebKnossosClient, TracingStoreAccessTokenService}
import play.api.i18n.Messages
import play.api.libs.Files.TemporaryFile
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.streams.IterateeStreams
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}

import scala.concurrent.{ExecutionContext, Future}

class VolumeTracingController @Inject()(val tracingService: VolumeTracingService,
                                        val remoteWebKnossosClient: TSRemoteWebKnossosClient,
                                        val accessTokenService: TracingStoreAccessTokenService,
                                        val slackNotificationService: TSSlackNotificationService)(
    implicit val ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends TracingController[VolumeTracing, VolumeTracings] {

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
            (data, indices) <- tracingService.data(tracingId, tracing, request.body)
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
                downsample: Option[Boolean]): Action[AnyContent] = Action.async { implicit request =>
    log() {
      logTime(slackNotificationService.noticeSlowRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, token) {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            dataSetBoundingBox = request.body.asJson.flatMap(_.validateOpt[BoundingBox].asOpt.flatten)
            resolutionRestrictions = ResolutionRestrictions(minResolution, maxResolution)
            (newId, newTracing) <- tracingService.duplicate(tracingId,
                                                            tracing,
                                                            fromTask.getOrElse(false),
                                                            dataSetBoundingBox,
                                                            resolutionRestrictions)
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
          (vertices, neighbors) <- tracingService.createIsosurface(tracingId, request.body)
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
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
          mags = tracing.resolutions.map(v => Vec3Int(v.x, v.y, v.z))
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Tracingstore",
              "%s".format(tracingId),
              Map(tracingId -> ".") ++ mags.map { mag =>
                (mag.toURLString, mag.toURLString)
              }.toMap
            )).withHeaders()
      }
    }

  def volumeTracingMagFolderContent(token: Option[String], tracingId: String, mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
          parsedMag <- parseMagIfExists(tracing, mag) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> 404
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Tracingstore",
              "%s".format(tracingId),
              Map(parsedMag -> ".")
            )).withHeaders()
      }
    }

  def zArray(token: Option[String], tracingId: String, mag: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
          parsedMag <- parseMagIfExists(tracing, mag) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> 404
          cubeLength = DataLayer.bucketLength
          (channels, dtype) <- zarrDtypeFromElementClass(tracing.elementClass)
          // data request method always decompresses before sending
          compressor = None
        } yield
          Ok(
            Json.obj(
              "dtype" -> dtype,
              "fill_value" -> 0,
              "zarr_format" -> 2,
              "order" -> "F",
              "chunks" -> List(channels, cubeLength, cubeLength, cubeLength),
              "compressor" -> compressor,
              "filters" -> None,
              "shape" -> List(
                channels,
                // Zarr can't handle data sets that don't start at 0, so we extend shape to include "true" coords
                (tracing.boundingBox.width + tracing.boundingBox.topLeft.x) / parsedMag.x,
                (tracing.boundingBox.height + tracing.boundingBox.topLeft.y) / parsedMag.y,
                (tracing.boundingBox.depth + tracing.boundingBox.topLeft.z) / parsedMag.z
              ),
              "dimension_seperator" -> "."
            ))
      }
  }

  def zGroup(token: Option[String], tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
      Future(Ok(Json.obj("zarr_format" -> 2)))
    }
  }

  def rawZarrCube(token: Option[String], tracingId: String, mag: String, cxyz: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
          parsedMag <- parseMagIfExists(tracing, mag) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> 404
          (c, x, y, z) <- parseDotCoordinates(cxyz) ?~> "zarr.invalidChunkCoordinates" ~> 404

          _ <- bool2Fox(c == 0) ~> "zarr.invalidFirstChunkCoord" ~> 404
          cubeSize = DataLayer.bucketLength
          request = WebKnossosDataRequest(
            position = Vec3Int(x, y, z),
            zoomStep = parsedMag.maxDim,
            cubeSize = cubeSize,
            fourBit = Some(false),
            applyAgglomerate = None,
            version = None
          )
          (data, indices) <- tracingService.data(tracingId, tracing, List(request))
        } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
      }
    }

  def parseDotCoordinates(
      cxyz: String,
  ): Fox[(Int, Int, Int, Int)] = {
    val singleRx = "\\s*([0-9]+).([0-9]+).([0-9]+).([0-9]+)\\s*".r

    cxyz match {
      case singleRx(c, x, y, z) =>
        Fox.successful(Integer.parseInt(c), Integer.parseInt(x), Integer.parseInt(y), Integer.parseInt(z))
      case _ => Fox.failure("Coordinates not valid")
    }
  }

  private def parseMagIfExists(tracing: VolumeTracing, mag: String): Option[Vec3Int] = {
    val singleRx = "\\s*([0-9]+)\\s*".r
    val longMag = mag match {
      case singleRx(x) => "%s-%s-%s".format(x, x, x)
      case _           => mag
    }
    val parsedMag = Vec3Int.fromForm(longMag)
    val existingMags = tracing.resolutions.map(v => Vec3Int(v.x, v.y, v.z))
    Some(parsedMag).filter(mag => existingMags.contains(mag))
  }

  private def zarrDtypeFromElementClass(elementClass: VolumeTracing.ElementClass): Option[(Int, String)] =
    elementClass match {
      case ElementClass.uint8  => Some(1, "<u1")
      case ElementClass.uint16 => Some(1, "<u2")
      case ElementClass.uint24 => Some(3, "<u1")
      case ElementClass.uint32 => Some(1, "<u3")
      case ElementClass.uint64 => Some(1, "<u4")
      case _                   => None
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

}
