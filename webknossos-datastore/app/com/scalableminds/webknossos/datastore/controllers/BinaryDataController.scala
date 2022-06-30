package com.scalableminds.webknossos.datastore.controllers

import java.io.ByteArrayOutputStream
import java.nio.{ByteBuffer, ByteOrder}

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.image.{ImageCreator, ImageCreatorParameters, JPEGWriter}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.models.DataRequestCollection._
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.{
  DataServiceDataRequest,
  DataServiceMappingRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models.{
  DataRequest,
  ImageThumbnail,
  VoxelPosition,
  WebKnossosDataRequest,
  _
}
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import io.swagger.annotations._
import net.liftweb.util.Helpers.tryo
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc._

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

@Api(tags = Array("datastore"))
class BinaryDataController @Inject()(
    dataSourceRepository: DataSourceRepository,
    config: DataStoreConfig,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    mappingService: MappingService,
    slackNotificationService: DSSlackNotificationService,
    isosurfaceServiceHolder: IsosurfaceServiceHolder,
    findDataService: FindDataService,
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with MissingBucketHeaders {

  override def allowRemoteOrigin: Boolean = true

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  isosurfaceServiceHolder.dataStoreIsosurfaceConfig =
    (binaryDataService, mappingService, config.Datastore.Isosurface.timeout, config.Datastore.Isosurface.actorPoolSize)
  val isosurfaceService: IsosurfaceService = isosurfaceServiceHolder.dataStoreIsosurfaceService

  @ApiOperation(hidden = true, value = "")
  def requestViaWebKnossos(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[List[WebKnossosDataRequest]] = Action.async(validateJson[List[WebKnossosDataRequest]]) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 30 seconds) {
        val t = System.currentTimeMillis()
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                    dataSetName,
                                                                                    dataLayerName) ~> 404
          (data, indices) <- requestData(dataSource, dataLayer, request.body)
          duration = System.currentTimeMillis() - t
          _ = if (duration > 10000)
            logger.info(
              s"Complete data request took $duration ms.\n"
                + s"  dataSource: $organizationName/$dataSetName\n"
                + s"  dataLayer: $dataLayerName\n"
                + s"  requestCount: ${request.body.size}"
                + s"  requestHead: ${request.body.headOption}")
        } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
      }
    }
  }

  /**
    * Handles requests for raw binary data via HTTP GET.
    */
  @ApiOperation(value = "Get raw binary data from a bounding box in a dataset layer", nickname = "datasetDownload")
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "Raw bytes from the dataset"),
      new ApiResponse(code = 400, message = "Operation could not be performed. See JSON body for more information.")
    ))
  def requestRawCuboid(
      @ApiParam(value = "Datastore token identifying the requesting user") token: Option[String],
      @ApiParam(value = "Name of the dataset’s organization", required = true) organizationName: String,
      @ApiParam(value = "Dataset name", required = true) dataSetName: String,
      @ApiParam(value = "Layer name of the dataset", required = true) dataLayerName: String,
      @ApiParam(value = "Mag1 x coordinate of the top-left corner of the bounding box", required = true) x: Int,
      @ApiParam(value = "Mag1 y coordinate of the top-left corner of the bounding box", required = true) y: Int,
      @ApiParam(value = "Mag1 z coordinate of the top-left corner of the bounding box", required = true) z: Int,
      @ApiParam(value = "Target-mag width of the bounding box", required = true) width: Int,
      @ApiParam(value = "Target-mag height of the bounding box", required = true) height: Int,
      @ApiParam(value = "Target-mag depth of the bounding box", required = true) depth: Int,
      @ApiParam(value = "Mag in three-component format (e.g. 1-1-1 or 16-16-8)", required = true) mag: Option[String],
      resolution: Option[Int],
      @ApiParam(value = "If true, use lossy compression by sending only half-bytes of the data") halfByte: Boolean,
      @ApiParam(value = "If set, apply set mapping name") mappingName: Option[String]
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  dataSetName,
                                                                                  dataLayerName) ~> 404
        _ <- bool2Fox(!(resolution.isDefined && mag.isDefined)) ?~> "Can only interpret mag or zoomStep. Use only mag instead."
        magFromZoomStep = resolution.map(dataLayer.magFromExponent(_, snapToClosest = true))
        magParsedOpt <- Fox.runOptional(mag)(Vec3Int.fromMagLiteral(_).toFox)
        magParsed <- magParsedOpt.orElse(magFromZoomStep).toFox ?~> "No mag supplied"
        request = DataRequest(
          VoxelPosition(x, y, z, magParsed),
          width,
          height,
          depth,
          DataServiceRequestSettings(halfByte = halfByte, appliedAgglomerate = mappingName)
        )
        (data, indices) <- requestData(dataSource, dataLayer, request)
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
    }
  }

  /**
    * Handles a request for raw binary data via a HTTP GET. Used by knossos.
    */
  @ApiOperation(hidden = true, value = "")
  def requestViaKnossos(token: Option[String],
                        organizationName: String,
                        dataSetName: String,
                        dataLayerName: String,
                        resolution: Int,
                        x: Int,
                        y: Int,
                        z: Int,
                        cubeSize: Int): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  dataSetName,
                                                                                  dataLayerName) ~> 404
        request = DataRequest(
          VoxelPosition(x * cubeSize * resolution,
                        y * cubeSize * resolution,
                        z * cubeSize * resolution,
                        Vec3Int(resolution, resolution, resolution)),
          cubeSize,
          cubeSize,
          cubeSize
        )
        (data, indices) <- requestData(dataSource, dataLayer, request)
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
    }
  }

  @ApiOperation(hidden = true, value = "")
  def thumbnailJpeg(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String,
                    width: Int,
                    height: Int,
                    centerX: Option[Int],
                    centerY: Option[Int],
                    centerZ: Option[Int],
                    zoom: Option[Double]): Action[RawBuffer] = Action.async(parse.raw) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  dataSetName,
                                                                                  dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> 404
        position = ImageThumbnail.goodThumbnailParameters(dataLayer, width, height, centerX, centerY, centerZ, zoom)
        request = DataRequest(position, width, height, 1)
        (data, _) <- requestData(dataSource, dataLayer, request)
        params = ImageCreatorParameters(
          dataLayer.bytesPerElement,
          request.settings.halfByte,
          request.cuboid(dataLayer).width,
          request.cuboid(dataLayer).height,
          imagesPerRow = 1,
          blackAndWhite = false,
          isSegmentation = dataLayer.category == Category.segmentation
        )
        dataWithFallback = if (data.length == 0)
          new Array[Byte](params.slideHeight * params.slideWidth * params.bytesPerElement)
        else data
        spriteSheet <- ImageCreator.spriteSheetFor(dataWithFallback, params) ?~> "image.create.failed"
        firstSheet <- spriteSheet.pages.headOption ?~> "image.page.failed"
        outputStream = new ByteArrayOutputStream()
        _ = new JPEGWriter().writeToOutputStream(firstSheet.image)(outputStream)
      } yield Ok(outputStream.toByteArray).as(jpegMimeType)
    }
  }
  @ApiOperation(hidden = true, value = "")
  def mappingJson(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  dataSetName,
                                                                                  dataLayerName) ~> 404
        segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> Messages("dataLayer.notFound")
        mappingRequest = DataServiceMappingRequest(dataSource, segmentationLayer, mappingName)
        result <- mappingService.handleMappingRequest(mappingRequest)
      } yield Ok(result)
    }
  }

  /**
    * Handles isosurface requests.
    */
  @ApiOperation(hidden = true, value = "")
  def requestIsosurface(token: Option[String],
                        organizationName: String,
                        dataSetName: String,
                        dataLayerName: String): Action[WebKnossosIsosurfaceRequest] =
    Action.async(validateJson[WebKnossosIsosurfaceRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                    dataSetName,
                                                                                    dataLayerName) ~> 404
          segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> "dataLayer.mustBeSegmentation"
          isosurfaceRequest = IsosurfaceRequest(
            Some(dataSource),
            segmentationLayer,
            request.body.cuboid(dataLayer),
            request.body.segmentId,
            request.body.subsamplingStrides,
            request.body.scale,
            request.body.mapping,
            request.body.mappingType
          )
          // The client expects the isosurface as a flat float-array. Three consecutive floats form a 3D point, three
          // consecutive 3D points (i.e., nine floats) form a triangle.
          // There are no shared vertices between triangles.
          (vertices, neighbors) <- isosurfaceService.requestIsosurfaceViaActor(isosurfaceRequest)
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

  @ApiOperation(hidden = true, value = "")
  def colorStatistics(token: Option[String],
                      organizationName: String,
                      dataSetName: String,
                      dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                    dataSetName,
                                                                                    dataLayerName) ~> 404
          meanAndStdDev <- findDataService.meanAndStdDev(dataSource, dataLayer)
        } yield
          Ok(
            Json.obj("mean" -> meanAndStdDev._1, "stdDev" -> meanAndStdDev._2)
          )
      }
    }

  @ApiOperation(hidden = true, value = "")
  def findData(token: Option[String],
               organizationName: String,
               dataSetName: String,
               dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                    dataSetName,
                                                                                    dataLayerName) ~> 404
          positionAndResolutionOpt <- findDataService.findPositionWithData(dataSource, dataLayer)
        } yield
          Ok(
            Json.obj("position" -> positionAndResolutionOpt.map(_._1),
                     "resolution" -> positionAndResolutionOpt.map(_._2)))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def histogram(token: Option[String],
                organizationName: String,
                dataSetName: String,
                dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                    dataSetName,
                                                                                    dataLayerName) ?~> Messages(
            "dataSource.notFound") ~> 404 ?~> Messages("histogram.layerMissing", dataLayerName)
          listOfHistograms <- findDataService.createHistogram(dataSource, dataLayer) ?~> Messages("histogram.failed",
                                                                                                  dataLayerName)
        } yield Ok(Json.toJson(listOfHistograms))
      }
    }

  private def requestData(
      dataSource: DataSource,
      dataLayer: DataLayer,
      dataRequests: DataRequestCollection
  ): Fox[(Array[Byte], List[Int])] = {
    val requests =
      dataRequests.map(r => DataServiceDataRequest(dataSource, dataLayer, None, r.cuboid(dataLayer), r.settings))
    binaryDataService.handleDataRequests(requests)
  }

}
