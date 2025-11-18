package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.image.{Color, JPEGWriter}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, Full, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.image.{ImageCreator, ImageCreatorParameters}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection._
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.{
  DataServiceDataRequest,
  DataServiceMappingRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models._
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.services.mesh.{AdHocMeshRequest, AdHocMeshService, AdHocMeshServiceHolder}
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.services.mapping.MappingService
import org.apache.pekko.actor.{Actor, ActorRef, ActorSystem, Props}
import org.apache.pekko.stream.{Materializer, OverflowStrategy}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.libs.streams.ActorFlow
import play.api.mvc.{AnyContent, _}

import scala.concurrent.duration.DurationInt
import java.io.{ByteArrayInputStream, ByteArrayOutputStream, InputStream, OutputStream}
import java.nio.{ByteBuffer, ByteOrder}
import java.util.zip.GZIPOutputStream
import scala.concurrent.{Await, ExecutionContext}

class BinaryDataController @Inject()(
    datasetCache: DatasetCache,
    config: DataStoreConfig,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    mappingService: MappingService,
    slackNotificationService: DSSlackNotificationService,
    adHocMeshServiceHolder: AdHocMeshServiceHolder,
    findDataService: FindDataService
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers, mat: Materializer, system: ActorSystem)
    extends Controller
    with MissingBucketHeaders {

  private object MyBucketWebSocketActor {
    def props(out: ActorRef, datasetId: ObjectId, dataLayerName: String, token: Option[String]): Props =
      Props(new MyBucketWebSocketActor(out, datasetId, dataLayerName, token))
  }

  private class MyBucketWebSocketActor(out: ActorRef, datasetId: ObjectId, dataLayerName: String, token: Option[String])
      extends Actor {
    def receive: Receive = {
      case requestBytes: Array[Byte] =>
        val parsedRequestBox = JsonHelper.parseAs[WebknossosDataRequest](requestBytes)
        parsedRequestBox match {
          case Full(parsedRequest) =>
            val messageId = parsedRequest.messageId.getOrElse(0L)
            val messageIdBytes = BigInt(messageId).toByteArray
            val messageIdBytesPadded: Array[Byte] = messageIdBytes.reverse.padTo(8, 0.toByte).reverse
            val bucketFox = for {
              (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName)
              bucketResult <- requestData(dataSource.id, dataLayer, List(parsedRequest))(TokenContext(token))
            } yield bucketResult._1
            val bucketAndMessageIdBox = Await.result(bucketFox.futureBox, 15 seconds)
            val result: Array[Byte] = bucketAndMessageIdBox.getOrElse(Array[Byte]())
            out ! compressGzip(messageIdBytesPadded ++ result)
          case _ => logger.info("received malformed data request!")
        }
      case _ =>
        logger.info("received malformed data request!")
    }
  }

  private def compressGzip(input: Array[Byte]): Array[Byte] = {
    val is = new ByteArrayInputStream(input)
    val os = new ByteArrayOutputStream()

    val dos = new GZIPOutputStream(os, 1)
    try passThrough(is, dos)
    finally if (dos != null) dos.close()
    os.toByteArray
  }

  private def passThrough(is: InputStream, os: OutputStream): Unit = {
    val bytes = new Array[Byte](4096)
    var read = is.read(bytes)
    while ({
      read >= 0
    }) {
      if (read > 0)
        os.write(bytes, 0, read)
      read = is.read(bytes)
    }
  }

  def bucketWS(datasetId: ObjectId, dataLayerName: String): WebSocket = WebSocket.accept[Array[Byte], Array[Byte]] {
    request =>
      ActorFlow.actorRef(
        out => MyBucketWebSocketActor.props(out, datasetId, dataLayerName, request.getQueryString("token")),
        bufferSize = 2048,
        overflowStrategy = OverflowStrategy.dropTail
      )
  }

  override def allowRemoteOrigin: Boolean = true

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  def requestViaWebknossos(datasetId: ObjectId, dataLayerName: String): Action[List[WebknossosDataRequest]] =
    Action.async(validateJson[List[WebknossosDataRequest]]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        logTime(slackNotificationService.noticeSlowRequest) {
          val t = Instant.now
          for {
            (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
              "dataSource.notFound") ~> NOT_FOUND
            (data, indices) <- requestData(dataSource.id, dataLayer, request.body)
            duration = Instant.since(t)
            _ = if (duration > (10 seconds))
              logger.info(
                s"Complete data request for $datasetId/$dataLayerName took ${formatDuration(duration)}."
                  + request.body.headOption
                    .map(firstReq => s" First of ${request.body.size} requests was $firstReq")
                    .getOrElse(""))
          } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
        }
      }
    }

  /**
    * Handles requests for raw binary data via HTTP GET.
    */
  def requestRawCuboid(
      datasetId: ObjectId,
      dataLayerName: String,
      // Mag1 coordinates of the top-left corner of the bounding box
      x: Int,
      y: Int,
      z: Int,
      // Target-mag size of the bounding box
      width: Int,
      height: Int,
      depth: Int,
      // Mag in three-component format (e.g. 1-1-1 or 16-16-8)
      mag: String,
      // If true, use lossy compression by sending only half-bytes of the data
      halfByte: Boolean,
      mappingName: Option[String]
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        magParsed <- Vec3Int.fromMagLiteral(mag).toFox ?~> "malformedMag"
        dataRequest = DataRequest(
          VoxelPosition(x, y, z, magParsed),
          width,
          height,
          depth,
          DataServiceRequestSettings(halfByte = halfByte, appliedAgglomerate = mappingName)
        )
        (data, indices) <- requestData(dataSource.id, dataLayer, dataRequest)
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
    }
  }

  def requestRawCuboidPost(datasetId: ObjectId, dataLayerName: String): Action[RawCuboidRequest] =
    Action.async(validateJson[RawCuboidRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          (data, indices) <- requestData(dataSource.id, dataLayer, request.body)
        } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
      }
    }

  /**
    * Handles a request for raw binary data via a HTTP GET. Used by knossos.
    */
  def requestViaKnossos(datasetId: ObjectId,
                        dataLayerName: String,
                        mag: Int,
                        x: Int,
                        y: Int,
                        z: Int,
                        cubeSize: Int): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        dataRequest = DataRequest(
          VoxelPosition(x * cubeSize * mag, y * cubeSize * mag, z * cubeSize * mag, Vec3Int(mag, mag, mag)),
          cubeSize,
          cubeSize,
          cubeSize
        )
        (data, indices) <- requestData(dataSource.id, dataLayer, dataRequest)
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
    }
  }

  def thumbnailJpeg(datasetId: ObjectId,
                    dataLayerName: String,
                    x: Int,
                    y: Int,
                    z: Int,
                    width: Int,
                    height: Int,
                    mag: String,
                    mappingName: Option[String],
                    intensityMin: Option[Double],
                    intensityMax: Option[Double],
                    color: Option[String],
                    invertColor: Option[Boolean]): Action[RawBuffer] = Action.async(parse.raw) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        magParsed <- Vec3Int.fromMagLiteral(mag).toFox ?~> "malformedMag"
        dataRequest = DataRequest(
          VoxelPosition(x, y, z, magParsed),
          width,
          height,
          depth = 1,
          DataServiceRequestSettings(appliedAgglomerate = mappingName)
        )
        (data, _) <- requestData(dataSource.id, dataLayer, dataRequest)
        intensityRange: Option[(Double, Double)] = intensityMin.flatMap(min => intensityMax.map(max => (min, max)))
        layerColor = color.flatMap(Color.fromHTML)
        params = ImageCreatorParameters(
          dataLayer.elementClass,
          useHalfBytes = false,
          slideWidth = width,
          slideHeight = height,
          imagesPerRow = 1,
          blackAndWhite = false,
          intensityRange = intensityRange,
          isSegmentation = dataLayer.category == LayerCategory.segmentation,
          color = layerColor,
          invertColor = invertColor
        )
        dataWithFallback = if (data.length == 0)
          new Array[Byte](width * height * dataLayer.bytesPerElement)
        else data
        spriteSheet <- ImageCreator.spriteSheetFor(dataWithFallback, params).toFox ?~> "image.create.failed"
        firstSheet <- spriteSheet.pages.headOption.toFox ?~> "image.page.failed"
        outputStream = new ByteArrayOutputStream()
        _ = new JPEGWriter().writeToOutputStream(firstSheet.image)(outputStream)
      } yield Ok(outputStream.toByteArray).as(jpegMimeType)
    }
  }

  def mappingJson(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> Messages("dataLayer.notFound")
        mappingRequest = DataServiceMappingRequest(Some(dataSource.id), segmentationLayer, mappingName)
        result <- mappingService.handleMappingRequest(mappingRequest)
      } yield Ok(result)
    }
  }

  /**
    * Handles ad-hoc mesh requests.
    */
  def requestAdHocMesh(datasetId: ObjectId, dataLayerName: String): Action[WebknossosAdHocMeshRequest] =
    Action.async(validateJson[WebknossosAdHocMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND
          segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> "dataLayer.mustBeSegmentation"
          adHocMeshRequest = AdHocMeshRequest(
            Some(dataSource.id),
            segmentationLayer,
            request.body.cuboid,
            request.body.segmentId,
            request.body.voxelSizeFactorInUnit,
            tokenContextForRequest(request),
            request.body.mapping,
            request.body.mappingType,
            request.body.additionalCoordinates,
            request.body.findNeighbors,
          )
          // The client expects the ad-hoc mesh as a flat float-array. Three consecutive floats form a 3D point, three
          // consecutive 3D points (i.e., nine floats) form a triangle.
          // There are no shared vertices between triangles.
          (vertices, neighbors) <- adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
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

  def findData(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND
          positionAndMagOpt <- findDataService.findPositionWithData(dataSource.id, dataLayer)
        } yield Ok(Json.obj("position" -> positionAndMagOpt.map(_._1), "mag" -> positionAndMagOpt.map(_._2)))
      }
    }

  def histogram(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND ?~> Messages("histogram.layerMissing", dataLayerName)
          listOfHistograms <- findDataService.createHistogram(dataSource.id, dataLayer) ?~> Messages("histogram.failed",
                                                                                                     dataLayerName)
        } yield Ok(Json.toJson(listOfHistograms))
      }
    }

  private def requestData(
      dataSourceId: DataSourceId,
      dataLayer: DataLayer,
      dataRequests: DataRequestCollection
  )(implicit tc: TokenContext): Fox[(Array[Byte], List[Int])] = {
    val requests =
      dataRequests.map(r => DataServiceDataRequest(Some(dataSourceId), dataLayer, r.cuboid(dataLayer), r.settings))
    binaryDataService.handleDataRequests(requests)
  }

}
