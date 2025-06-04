package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.image.{Color, JPEGWriter}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
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
import net.liftweb.common.Box.tryo
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{AnyContent, _}

import scala.concurrent.duration.DurationInt
import java.io.ByteArrayOutputStream
import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

class BinaryDataController @Inject()(
    dataSourceRepository: DataSourceRepository,
    config: DataStoreConfig,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    mappingService: MappingService,
    slackNotificationService: DSSlackNotificationService,
    adHocMeshServiceHolder: AdHocMeshServiceHolder,
    findDataService: FindDataService,
    datasetCache: DatasetCache
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with MissingBucketHeaders {

  override def allowRemoteOrigin: Boolean = true

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  def requestViaWebknossos(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[List[WebknossosDataRequest]] = Action.async(validateJson[List[WebknossosDataRequest]]) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      logTime(slackNotificationService.noticeSlowRequest) {
        val t = Instant.now
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName) ~> NOT_FOUND
          (data, indices) <- requestData(dataSource.id, dataLayer, request.body)
          duration = Instant.since(t)
          _ = if (duration > (10 seconds))
            logger.info(
              s"Complete data request for $organizationId/$datasetDirectoryName/$dataLayerName took ${formatDuration(duration)}."
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
      organizationId: String,
      datasetDirectoryName: String,
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
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ~> NOT_FOUND
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

  def requestRawCuboidPost(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[RawCuboidRequest] = Action.async(validateJson[RawCuboidRequest]) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ~> NOT_FOUND
        (data, indices) <- requestData(dataSource.id, dataLayer, request.body)
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
    }
  }

  /**
    * Handles a request for raw binary data via a HTTP GET. Used by knossos.
    */
  def requestViaKnossos(organizationId: String,
                        datasetDirectoryName: String,
                        dataLayerName: String,
                        mag: Int,
                        x: Int,
                        y: Int,
                        z: Int,
                        cubeSize: Int): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ~> NOT_FOUND
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

  def thumbnailJpeg(organizationId: String,
                    datasetDirectoryName: String,
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
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ?~> Messages(
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
          isSegmentation = dataLayer.category == Category.segmentation,
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
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ~> NOT_FOUND
        segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> Messages("dataLayer.notFound")
        mappingRequest = DataServiceMappingRequest(Some(dataSource.id), segmentationLayer, mappingName)
        result <- mappingService.handleMappingRequest(mappingRequest)
      } yield Ok(result)
    }
  }

  /**
    * Handles ad-hoc mesh requests.
    */
  def requestAdHocMesh(organizationId: String,
                       datasetDirectoryName: String,
                       dataLayerName: String): Action[WebknossosAdHocMeshRequest] =
    Action.async(validateJson[WebknossosAdHocMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName) ~> NOT_FOUND
          segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> "dataLayer.mustBeSegmentation"
          adHocMeshRequest = AdHocMeshRequest(
            Some(dataSource.id),
            segmentationLayer,
            request.body.cuboid(dataLayer),
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

  def findData(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName) ~> NOT_FOUND
          positionAndMagOpt <- findDataService.findPositionWithData(dataSource.id, dataLayer)
        } yield Ok(Json.obj("position" -> positionAndMagOpt.map(_._1), "mag" -> positionAndMagOpt.map(_._2)))
      }
    }

  def histogram(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName) ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND ?~> Messages("histogram.layerMissing", dataLayerName)
          listOfHistograms <- findDataService.createHistogram(dataSource.id, dataLayer) ?~> Messages("histogram.failed",
                                                                                                     dataLayerName)
        } yield Ok(Json.toJson(listOfHistograms))
      }
    }

  def requestViaWebknossosById(datasetId: String, dataLayerName: String): Action[List[WebknossosDataRequest]] =
    Action.async(validateJson[List[WebknossosDataRequest]]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        // TODO Log time
        for {
          datasetId <- ObjectId.fromString(datasetId)
          dataSource <- datasetCache.getById(datasetId)
          dataLayer <- dataSource.getDataLayer(dataLayerName).toFox ?~> "Data layer not found" ~> NOT_FOUND
          (data, indices) <- requestData(dataSource.id, dataLayer, request.body)
        } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
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
