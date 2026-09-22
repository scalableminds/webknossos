package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.image.Color
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.models.datasource.*
import com.scalableminds.webknossos.datastore.models.requests.{
  DataServiceDataRequest,
  DataServiceMappingRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models.*
import com.scalableminds.webknossos.datastore.services.*
import com.scalableminds.webknossos.datastore.services.mesh.{AdHocMeshRequest, AdHocMeshService, AdHocMeshServiceHolder}
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.webknossos.datastore.services.mapping.MappingService
import play.api.libs.json.Json
import play.api.mvc.*

import scala.concurrent.duration.DurationInt
import java.awt.image.BufferedImage
import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

class BinaryDataController @Inject() (
    datasetCache: DatasetCache,
    config: DataStoreConfig,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    mappingService: MappingService,
    slackNotificationService: DSSlackNotificationService,
    adHocMeshServiceHolder: AdHocMeshServiceHolder,
    findDataService: FindDataService,
    thumbnailService: DSThumbnailService
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with MissingBucketHeaders {

  override def allowRemoteOrigin: Boolean = true

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  def requestViaWebknossos(datasetId: ObjectId, dataLayerName: String): Action[List[WebknossosDataRequest]] =
    Action.fox(validateJson[List[WebknossosDataRequest]]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 10 minutes) {
          val t = Instant.now
          for {
            (dataSource, dataLayer) <- datasetCache.getWithLayer(
              datasetId,
              dataLayerName
            ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
            (data, emptyIndices, failureIndices) <- requestData(datasetId, dataSource.id, dataLayer, request.body)
            duration = Instant.since(t)
            _ = if (duration > (10 seconds))
              logger.info(
                s"Complete data request for $datasetId/$dataLayerName took ${formatDuration(duration)}."
                  + request.body.headOption
                    .map(firstReq => s" First of ${request.body.size} requests was $firstReq")
                    .getOrElse("")
              )
          } yield Ok(data).withHeaders(createMissingBucketsHeaders(emptyIndices, failureIndices)*)
        }
      }
    }

  /** Handles requests for raw binary data via HTTP GET.
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
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        magParsed <- Vec3Int.fromMagLiteral(mag).toFox ?~> Msg.Dataset.Mag.invalid(mag)
        dataRequest = DataRequest(
          VoxelPosition(x, y, z, magParsed),
          width,
          height,
          depth,
          DataServiceRequestSettings(halfByte = halfByte, appliedAgglomerate = mappingName)
        )
        (data, emptyIndices, failureIndices) <- requestData(datasetId, dataSource.id, dataLayer, List(dataRequest))
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(emptyIndices, failureIndices)*)
    }
  }

  def requestRawCuboidPost(datasetId: ObjectId, dataLayerName: String): Action[RawCuboidRequest] =
    Action.fox(validateJson[RawCuboidRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          (data, emptyIndices, failureIndices) <- requestData(datasetId, dataSource.id, dataLayer, List(request.body))
        } yield Ok(data).withHeaders(createMissingBucketsHeaders(emptyIndices, failureIndices)*)
      }
    }

  /** Handles a request for raw binary data via a HTTP GET. Used by knossos.
    */
  def requestViaKnossos(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: Int,
      x: Int,
      y: Int,
      z: Int,
      cubeSize: Int
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(
          datasetId,
          dataLayerName
        ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        dataRequest = DataRequest(
          VoxelPosition(x * cubeSize * mag, y * cubeSize * mag, z * cubeSize * mag, Vec3Int(mag, mag, mag)),
          cubeSize,
          cubeSize,
          cubeSize
        )
        (data, emptyIndices, failureIndices) <- requestData(datasetId, dataSource.id, dataLayer, List(dataRequest))
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(emptyIndices, failureIndices)*)
    }
  }

  def standaloneLayerThumbnail(
      datasetId: ObjectId,
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
      invertColor: Option[Boolean]
  ): Action[RawBuffer] = Action.fox(parse.raw) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        _ <- thumbnailService.validateThumbnailDimensions(width, height)
        (dataSource, dataLayer) <- datasetCache.getWithLayer(
          datasetId,
          dataLayerName
        ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        magParsed <- Vec3Int.fromMagLiteral(mag).toFox ?~> Msg.Dataset.Mag.invalid(mag)
        dataRequest = DataRequest(
          VoxelPosition(x, y, z, magParsed),
          width,
          height,
          depth = 1,
          DataServiceRequestSettings(appliedAgglomerate = mappingName)
        )
        (data, _, _) <- requestData(datasetId, dataSource.id, dataLayer, List(dataRequest))
        intensityRange: Option[(Double, Double)] = intensityMin.flatMap(min => intensityMax.map(max => (min, max)))
        thumbnailBufferedImage <- thumbnailService.renderLayerThumbnail(
          data,
          dataLayer.elementClass,
          width,
          height,
          intensityRange,
          isSegmentation = dataLayer.category == LayerCategory.segmentation,
          color = color.flatMap(Color.fromHTML),
          invertColor = invertColor
        )
        thumbnailJpegBytes <- thumbnailService.bufferedImageToJpeg(thumbnailBufferedImage).toFox
      } yield Ok(thumbnailJpegBytes).as(jpegMimeType)
    }
  }

  private def datasetThumbnailLayerImage(
      datasetId: ObjectId,
      layerParams: DatasetThumbnailLayerParameters,
      outputWidth: Int,
      outputHeight: Int
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Boolean, BufferedImage)] =
    for {
      (dataSource, dataLayer) <- datasetCache.getWithLayer(
        datasetId,
        layerParams.dataLayerName
      ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(layerParams.mag).toFox ?~> Msg.Dataset.Mag.invalid(layerParams.mag)
      dataRequest = DataRequest(
        VoxelPosition(layerParams.x, layerParams.y, layerParams.z, magParsed),
        layerParams.width,
        layerParams.height,
        depth = 1,
        DataServiceRequestSettings(appliedAgglomerate = layerParams.mappingName)
      )
      (data, _, _) <- requestData(datasetId, dataSource.id, dataLayer, List(dataRequest))
      intensityRange: Option[(Double, Double)] = layerParams.intensityMin.flatMap(min =>
        layerParams.intensityMax.map(max => (min, max))
      )
      isSegmentation = dataLayer.category == LayerCategory.segmentation
      image <- thumbnailService.renderLayerThumbnail(
        data,
        dataLayer.elementClass,
        layerParams.width,
        layerParams.height,
        intensityRange,
        isSegmentation,
        layerParams.color.flatMap(Color.fromHTML),
        layerParams.invertColor,
        outputWidth = Some(outputWidth),
        outputHeight = Some(outputHeight),
        preserveAlpha = true,
        opacity = layerParams.opacity
      )
    } yield (isSegmentation, image)

  def datasetThumbnail(datasetId: ObjectId): Action[DatasetThumbnailRequest] =
    Action.fox(validateJson[DatasetThumbnailRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          _ <- thumbnailService.validateThumbnailDimensions(request.body.width, request.body.height)
          _ <- Fox.serialCombined(request.body.layers)(layerParams =>
            thumbnailService.validateThumbnailDimensions(layerParams.width, layerParams.height)
          )
          layerResults <- Fox.serialCombined(request.body.layers)(layerParams =>
            datasetThumbnailLayerImage(datasetId, layerParams, request.body.width, request.body.height)
          )
          colorImages = layerResults.collect { case (false, image) => image }
          segmentationImages = layerResults.collect { case (true, image) => image }
          datasetThumbnailJpeg <- tryo(
            thumbnailService.blendLayersToJpeg(
              colorImages,
              segmentationImages,
              request.body.blendMode,
              request.body.width,
              request.body.height
            )
          ).toFox
        } yield Ok(datasetThumbnailJpeg).as(jpegMimeType)
      }
    }

  def mappingJson(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(
          datasetId,
          dataLayerName
        ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> Msg.Dataset.Layer
          .notFound(dataLayerName)
        mappingRequest = DataServiceMappingRequest(Some(dataSource.id), segmentationLayer, mappingName)
        result <- mappingService.loadMappingBytes(mappingRequest).toFox
      } yield Ok(result)
    }
  }

  /** Handles ad-hoc mesh requests.
    */
  def requestAdHocMesh(datasetId: ObjectId, dataLayerName: String): Action[WebknossosAdHocMeshRequest] =
    Action.fox(validateJson[WebknossosAdHocMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(
            datasetId,
            dataLayerName
          ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
          segmentationLayer <- tryo(
            dataLayer.asInstanceOf[SegmentationLayer]
          ).toFox ?~> Msg.Dataset.Layer.mustBeSegmentation
          adHocMeshRequest = AdHocMeshRequest(
            Some(datasetId),
            Some(dataSource.id),
            segmentationLayer,
            request.body.cuboid,
            request.body.segmentId.toLong,
            request.body.voxelSizeFactorInUnit,
            tokenContextForRequest(using request),
            request.body.mapping,
            request.body.mappingType,
            request.body.additionalCoordinates,
            request.body.annotationVersion,
            request.body.findNeighbors
          )
          // The client expects the ad-hoc mesh as a flat float-array. Three consecutive floats form a 3D point, three
          // consecutive 3D points (i.e., nine floats) form a triangle.
          // There are no shared vertices between triangles.
          (vertices, neighbors) <- adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
        } yield {
          // We need four bytes for each float
          val responseBuffer = ByteBuffer.allocate(vertices.length * 4).order(ByteOrder.LITTLE_ENDIAN)
          responseBuffer.asFloatBuffer().put(vertices)
          Ok(responseBuffer.array()).withHeaders(getNeighborIndices(neighbors)*)
        }
      }
    }

  private def getNeighborIndices(neighbors: List[Int]) =
    List("NEIGHBORS" -> formatNeighborList(neighbors), "Access-Control-Expose-Headers" -> "NEIGHBORS")

  private def formatNeighborList(neighbors: List[Int]): String =
    "[" + neighbors.mkString(", ") + "]"

  def findData(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(
            datasetId,
            dataLayerName
          ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
          positionAndMagOpt <- findDataService.findPositionWithData(datasetId, dataSource.id, dataLayer)
        } yield Ok(Json.obj("position" -> positionAndMagOpt.map(_._1), "mag" -> positionAndMagOpt.map(_._2)))
      }
    }

  def histogram(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Msg.Dataset.Histogram
            .layerMissing(dataLayerName) ~> NOT_FOUND
          histograms <- findDataService.createHistogram(datasetId, dataSource.id, dataLayer) ?~> Msg.Dataset.Histogram
            .failed(dataLayerName)
        } yield Ok(Json.toJson(histograms))
      }
    }

  private def requestData(
      datasetId: ObjectId,
      dataSourceId: DataSourceId,
      dataLayer: DataLayer,
      dataRequests: List[AbstractDataRequest]
  )(using tc: TokenContext): Fox[(Array[Byte], Seq[Int], Seq[Int])] = {
    val requests =
      dataRequests.map(r =>
        DataServiceDataRequest(Some(datasetId), Some(dataSourceId), dataLayer, r.cuboid(dataLayer), r.settings)
      )
    binaryDataService.handleDataRequests(requests)
  }

}
