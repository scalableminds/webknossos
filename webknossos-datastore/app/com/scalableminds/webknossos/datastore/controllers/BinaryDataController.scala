package com.scalableminds.webknossos.datastore.controllers

import java.io.{ByteArrayOutputStream, OutputStream}
import java.nio.{ByteBuffer, ByteOrder}
import java.util.Base64
import akka.stream.scaladsl.StreamConverters
import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.image.{ImageCreator, ImageCreatorParameters, JPEGWriter}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.zarr.{ZarrDataLayer, ZarrMag, ZarrSegmentationLayer}
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
import io.swagger.annotations.{Api, ApiOperation, ApiParam, ApiResponse, ApiResponses}
import net.liftweb.util.Helpers.tryo
import play.api.http.HttpEntity
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, RawBuffer, ResponseHeader, Result}

import scala.concurrent.duration._
import scala.concurrent.ExecutionContext

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
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  isosurfaceServiceHolder.dataStoreIsosurfaceConfig =
    (binaryDataService, mappingService, config.Datastore.Isosurface.timeout, config.Datastore.Isosurface.actorPoolSize)
  val isosurfaceService: IsosurfaceService = isosurfaceServiceHolder.dataStoreIsosurfaceService

  /**
    * Handles requests for raw binary data via HTTP POST from webKnossos.
    */
  @ApiOperation(hidden = true, value = "")
  def requestViaWebKnossos(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[List[WebKnossosDataRequest]] = Action.async(validateJson[List[WebKnossosDataRequest]]) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 30 seconds) {
        val t = System.currentTimeMillis()
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
          (data, indices) <- requestData(dataSource, dataLayer, request.body)
          duration = System.currentTimeMillis() - t
          _ = if (duration > 10000)
            logger.info(
              s"Complete data request took $duration ms.\n"
                + s"  dataSource: $organizationName/$dataSetName\n"
                + s"  dataLayer: $dataLayerName\n"
                + s"  requestCount: ${request.body.size}"
                + s"  requestHead: ${request.body.headOption}")
        } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
      }
    }
  }

  def getMissingBucketsHeaders(indices: List[Int]): Seq[(String, String)] =
    List("MISSING-BUCKETS" -> formatMissingBucketList(indices), "Access-Control-Expose-Headers" -> "MISSING-BUCKETS")

  def formatMissingBucketList(indices: List[Int]): String =
    "[" + indices.mkString(", ") + "]"

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
      @ApiParam(value = "Exponent of the dataset mag (e.g. 4 for mag 16-16-8)", required = true) resolution: Int,
      @ApiParam(value = "If true, use lossy compression by sending only half-bytes of the data") halfByte: Boolean
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      for {
        (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
        request = DataRequest(
          new VoxelPosition(x, y, z, dataLayer.lookUpResolution(resolution)),
          width,
          height,
          depth,
          DataServiceRequestSettings(halfByte = halfByte)
        )
        (data, indices) <- requestData(dataSource, dataLayer, request)
      } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
    }
  }

  /**
    * Handles requests for raw binary data via HTTP GET for debugging.
    */
  @ApiOperation(hidden = true, value = "")
  def requestViaAjaxDebug(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      cubeSize: Int,
      x: Int,
      y: Int,
      z: Int,
      resolution: Int,
      halfByte: Boolean
  ): Action[AnyContent] =
    requestRawCuboid(token,
                     organizationName,
                     dataSetName,
                     dataLayerName,
                     x,
                     y,
                     z,
                     cubeSize,
                     cubeSize,
                     cubeSize,
                     resolution,
                     halfByte)

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
                                      token) {
      for {
        (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
        request = DataRequest(
          new VoxelPosition(x * cubeSize * resolution,
                            y * cubeSize * resolution,
                            z * cubeSize * resolution,
                            Vec3Int(resolution, resolution, resolution)),
          cubeSize,
          cubeSize,
          cubeSize
        )
        (data, indices) <- requestData(dataSource, dataLayer, request)
      } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
    }
  }

//  def redirectToDataset(token: Option[String], organizationName: String, dataSetName: String): Action[AnyContent] =
//    Action {
//      Redirect(routes..requestDatasourceFolderContents(token, organizationName, dataSetName))
//    }

  def requestDatasourceFolderContents(token: Option[String],
                                      organizationName: String,
                                      dataSetName: String): Action[AnyContent] =
    Action { implicit request =>
      {
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            "%s/%s".format(organizationName, dataSetName),
            "http://localhost:9000/data/zarr/sample_organization/l4_sample/",
            Map("datasource" -> ".", "color" -> "color")
          )).withHeaders()
      }
    }

  def requestDatalayerFolderContents(token: Option[String],
                                     organizationName: String,
                                     dataSetName: String,
                                     dataLayerName: String): Action[AnyContent] =
    Action { implicit request =>
      {
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            "%s/%s".format(organizationName, dataSetName),
            "http://localhost:9000/data/zarr/sample_organization/l4_sample/color/",
            Map("color" -> ".", "1-1-1" -> "1-1-1")
          )).withHeaders()
      }
    }

  def requestDatalayerMagFolderContents(token: Option[String],
                                        organizationName: String,
                                        dataSetName: String,
                                        dataLayerName: String,
                                        mag: String): Action[AnyContent] =
    Action { implicit request =>
      {
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            "%s/%s".format(organizationName, dataSetName),
            "http://localhost:9000/data/zarr/sample_organization/l4_sample/color/1-1-1/",
            Map("1-1-1" -> ".")
          )).withHeaders()
      }
    }

  private def parseMagIfExists(layer: DataLayer, mag: String): Option[Vec3Int] = {
    val singleRx = "\\s*([0-9]+)\\s*".r
    val longMag = mag match {
      case singleRx(x) => "%s-%s-%s".format(x, x, x)
      case _           => mag
    }
    val parsedMag = Vec3Int.fromForm(longMag)
    Some(parsedMag).filter(layer.containsResolution)
  }

  /**
    * Handles a request for raw binary data via a HTTP GET. Used by knossos.
    */
  @ApiOperation(hidden = true, value = "")
  def requestZArray(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String,
                    mag: String,
  ): Action[AnyContent] = Action.async { implicit request => //    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
//                                      token)
  {
    logger.info("requesting .zarray")
    for {
      (_, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
      parsedMag <- parseMagIfExists(dataLayer, mag) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> 404
      cubeLength = 512 //dataLayer.lengthOfUnderlyingCubes(parsedMag)
      (channels, dtype) = zarrDtypeFromElementClass(dataLayer.elementClass)
    } yield
      Ok(
        Json.obj(
          "dtype" -> dtype,
          "fill_value" -> 0,
          "zarr_format" -> 2,
          "order" -> "F",
          "chunks" -> List(channels, cubeLength, cubeLength, cubeLength),
          "compressor" -> None, //Json.obj("id" -> "lz4"), // TODO außer es ist uncompressed, lz4 hat vllt noch andere parameter
          "filters" -> None,
          "shape" -> List(
            channels,
            dataLayer.boundingBox.width + dataLayer.boundingBox.topLeft.x,
            dataLayer.boundingBox.height + dataLayer.boundingBox.topLeft.y,
            dataLayer.boundingBox.depth + dataLayer.boundingBox.topLeft.z
          ),
          "dimension_seperator" -> "/",
        ))
  }
  }

  private def zarrDtypeFromElementClass(elementClass: ElementClass.Value): (Int, String) = elementClass match {
    case ElementClass.uint8  => (1, "<u1")
    case ElementClass.uint16 => (1, "<u2")
    case ElementClass.uint24 => (3, "<u1")
    case ElementClass.uint32 => (1, "<u4")
    case ElementClass.uint64 => (1, "<u8")
    case ElementClass.float  => (1, "<f4")
    case ElementClass.double => (1, "<f8")
    case ElementClass.int8   => (1, "<i1")
    case ElementClass.int16  => (1, "<i2")
    case ElementClass.int32  => (1, "<i4")
    case ElementClass.int64  => (1, "<i8")
  }

  def requestRawZarrWithDot(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mag: String,
      cxyz: String,
  ): Action[AnyContent] = {
    val singleRx = "\\s*([0-9]+).([0-9]+).([0-9]+).([0-9]+)\\s*".r
    cxyz match {
      case singleRx(c, x, y, z) =>
        requestRawZarr(token,
                       organizationName,
                       dataSetName,
                       dataLayerName,
                       mag,
                       Integer.parseInt(c),
                       Integer.parseInt(x),
                       Integer.parseInt(y),
                       Integer.parseInt(z))
      case _ => Action { NotFound("Coordinates not valid") }
    }
  }

  /**
    * Handles requests for raw binary data via HTTP GET for debugging.
    */
  @ApiOperation(hidden = true, value = "")
  def requestRawZarr(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mag: String,
      c: Int,
      x: Int,
      y: Int,
      z: Int,
  ): Action[AnyContent] = Action.async { implicit request => //    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
//                                      token)
  {
    logger.info("Requesting %d, %d, %d".format(x, y, z))

    for {
      (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
      parsedMag <- parseMagIfExists(dataLayer, mag) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> 404
      _ <- bool2Fox(c == 0) ~> Messages("Channel must be 0") ~> 404
      cubeSize = 512 //dataLayer.lengthOfUnderlyingCubes(parsedMag)
      _ = logger.info(
        "Requesting %d, %d, %d"
          .format(x * cubeSize * parsedMag.x, y * cubeSize * parsedMag.y, z * cubeSize * parsedMag.z))
      request = DataRequest(
        new VoxelPosition(x * cubeSize * parsedMag.x,
                          y * cubeSize * parsedMag.y,
                          z * cubeSize * parsedMag.z,
                          parsedMag),
        cubeSize,
        cubeSize,
        cubeSize,
        DataServiceRequestSettings(halfByte = false)
      )
      (data, indices) <- requestData(dataSource, dataLayer, request)
    } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
  }
  }

  def requestDataSource(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
  ): Action[AnyContent] = Action.async { implicit request => //    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
//                                      token)
  {
    logger.info("requesting datasource-properties.json")
    for {
      dataSource <- dataSourceRepository.findUsable(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages(
        "dataSource.notFound") ~> 404
      dataLayers = dataSource.dataLayers
      zarrLayers = dataLayers.collect({
//        case b: SegmentationLayer =>
//          ZarrSegmentationLayer(
//            b.name,
//            b.boundingBox,
//            b.elementClass,
//            b.resolutions.map(x => ZarrMag(x, None, None)),
//            b.largestSegmentId,
//            b.mappings,
//            numChannels = if (b.elementClass == ElementClass.uint24) 3 else 1
//          )
        case a: DataLayer =>
          ZarrDataLayer(a.name,
                        a.category,
                        a.boundingBox,
                        a.elementClass,
                        a.resolutions.map(x => ZarrMag(x, None, None)),
                        numChannels = if (a.elementClass == ElementClass.uint24) 3 else 1)
      })
      zarrSource = GenericDataSource[DataLayer](dataSource.id, zarrLayers, dataSource.scale)
    } yield Ok(Json.toJson(zarrSource))
  }

  }

  def requestZGroup(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request => //    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
//                                      token)
  {
    for {
      dataSource <- dataSourceRepository.findUsable(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages(
        "dataSource.notFound") ~> 404
    } yield Ok(Json.obj("zarr_format" -> 2))
  }

  }

  /**
    * Handles requests for data sprite sheets.
    */
  @ApiOperation(hidden = true, value = "")
  def requestSpriteSheet(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      cubeSize: Int,
      imagesPerRow: Int,
      x: Int,
      y: Int,
      z: Int,
      resolution: Int,
      halfByte: Boolean
  ): Action[RawBuffer] = Action.async(parse.raw) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      for {
        (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
        dataRequest = DataRequest(new VoxelPosition(x, y, z, dataLayer.lookUpResolution(resolution)),
                                  cubeSize,
                                  cubeSize,
                                  cubeSize,
                                  DataServiceRequestSettings(halfByte = halfByte))
        imageProvider <- respondWithSpriteSheet(dataSource, dataLayer, dataRequest, imagesPerRow, blackAndWhite = false)
      } yield {
        Result(
          header = ResponseHeader(200),
          body = HttpEntity.Streamed(StreamConverters.asOutputStream().mapMaterializedValue { outputStream =>
            imageProvider(outputStream)
          }, None, Some(contentTypeJpeg))
        )
      }
    }
  }

  /**
    * Handles requests for data images.
    */
  @ApiOperation(hidden = true, value = "")
  def requestImage(token: Option[String],
                   organizationName: String,
                   dataSetName: String,
                   dataLayerName: String,
                   width: Int,
                   height: Int,
                   x: Int,
                   y: Int,
                   z: Int,
                   resolution: Int,
                   halfByte: Boolean,
                   blackAndWhite: Boolean): Action[RawBuffer] = Action.async(parse.raw) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      for {
        (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
        dataRequest = DataRequest(new VoxelPosition(x, y, z, dataLayer.lookUpResolution(resolution)),
                                  width,
                                  height,
                                  1,
                                  DataServiceRequestSettings(halfByte = halfByte))
        imageProvider <- respondWithSpriteSheet(dataSource, dataLayer, dataRequest, 1, blackAndWhite)
      } yield {
        Result(
          header = ResponseHeader(200),
          body = HttpEntity.Streamed(StreamConverters.asOutputStream().mapMaterializedValue { outputStream =>
            imageProvider(outputStream)
          }, None, Some(contentTypeJpeg))
        )
      }
    }
  }

  /**
    * Handles requests for dataset thumbnail images as JPEG.
    */
  @ApiOperation(hidden = true, value = "")
  def requestImageThumbnailJpeg(token: Option[String],
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
                                      token) {
      for {
        thumbnailProvider <- respondWithImageThumbnail(organizationName,
                                                       dataSetName,
                                                       dataLayerName,
                                                       width,
                                                       height,
                                                       centerX,
                                                       centerY,
                                                       centerZ,
                                                       zoom)
      } yield {
        Result(
          header = ResponseHeader(200),
          body = HttpEntity.Streamed(StreamConverters.asOutputStream().mapMaterializedValue { outputStream =>
            thumbnailProvider(outputStream)
          }, None, Some(contentTypeJpeg))
        )
      }
    }
  }

  /**
    * Handles requests for dataset thumbnail images as base64-encoded JSON.
    */
  @ApiOperation(hidden = true, value = "")
  def requestImageThumbnailJson(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      width: Int,
      height: Int,
      centerX: Option[Int],
      centerY: Option[Int],
      centerZ: Option[Int],
      zoom: Option[Double]
  ): Action[RawBuffer] = Action.async(parse.raw) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      for {
        thumbnailProvider <- respondWithImageThumbnail(organizationName,
                                                       dataSetName,
                                                       dataLayerName,
                                                       width,
                                                       height,
                                                       centerX,
                                                       centerY,
                                                       centerZ,
                                                       zoom)
      } yield {
        val os = new ByteArrayOutputStream()
        thumbnailProvider(Base64.getEncoder.wrap(os))
        Ok(Json.toJson(ImageThumbnail(contentTypeJpeg, os.toString)))
      }
    }
  }

  /**
    * Handles mapping requests.
    */
  @ApiOperation(hidden = true, value = "")
  def requestMapping(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      for {
        (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
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
                                        token) {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
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
                                        token) {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
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
                                        token) {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
          positionAndResolutionOpt <- findDataService.findPositionWithData(dataSource, dataLayer)
        } yield
          Ok(
            Json.obj("position" -> positionAndResolutionOpt.map(_._1),
                     "resolution" -> positionAndResolutionOpt.map(_._2)))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def createHistogram(token: Option[String],
                      organizationName: String,
                      dataSetName: String,
                      dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        token) {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName) ?~> Messages(
            "histogram.layerMissing",
            dataLayerName)
          listOfHistograms <- findDataService.createHistogram(dataSource, dataLayer) ?~> Messages("histogram.failed",
                                                                                                  dataLayerName)
        } yield Ok(Json.toJson(listOfHistograms))
      }
    }

  private def getDataSourceAndDataLayer(organizationName: String, dataSetName: String, dataLayerName: String)(
      implicit m: MessagesProvider): Fox[(DataSource, DataLayer)] =
    for {
      dataSource <- dataSourceRepository.findUsable(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages(
        "dataSource.notFound") ~> 404
      dataLayer <- dataSource.getDataLayer(dataLayerName) ?~> Messages("dataLayer.notFound", dataLayerName) ~> 404
    } yield (dataSource, dataLayer)

  private def requestData(
      dataSource: DataSource,
      dataLayer: DataLayer,
      dataRequests: DataRequestCollection
  ): Fox[(Array[Byte], List[Int])] = {
    val requests =
      dataRequests.map(r => DataServiceDataRequest(dataSource, dataLayer, None, r.cuboid(dataLayer), r.settings))
    logger.info(s"requests: $requests")
    binaryDataService.handleDataRequests(requests)
  }

  private def contentTypeJpeg = "image/jpeg"

  private def respondWithSpriteSheet(
      dataSource: DataSource,
      dataLayer: DataLayer,
      request: DataRequest,
      imagesPerRow: Int,
      blackAndWhite: Boolean
  )(implicit m: MessagesProvider): Fox[OutputStream => Unit] = {
    val params = ImageCreatorParameters(
      dataLayer.bytesPerElement,
      request.settings.halfByte,
      request.cuboid(dataLayer).width,
      request.cuboid(dataLayer).height,
      imagesPerRow,
      blackAndWhite = blackAndWhite,
      isSegmentation = dataLayer.category == Category.segmentation
    )
    for {
      (data, _) <- requestData(dataSource, dataLayer, request)
      dataWithFallback = if (data.length == 0)
        new Array[Byte](params.slideHeight * params.slideWidth * params.bytesPerElement)
      else data
      spriteSheet <- ImageCreator.spriteSheetFor(dataWithFallback, params) ?~> Messages("image.create.failed")
      firstSheet <- spriteSheet.pages.headOption ?~> Messages("image.page.failed")
    } yield new JPEGWriter().writeToOutputStream(firstSheet.image)(_)
  }

  private def respondWithImageThumbnail(
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      width: Int,
      height: Int,
      centerX: Option[Int],
      centerY: Option[Int],
      centerZ: Option[Int],
      zoom: Option[Double]
  )(implicit m: MessagesProvider): Fox[OutputStream => Unit] =
    for {
      (dataSource, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
      position = ImageThumbnail.goodThumbnailParameters(dataLayer, width, height, centerX, centerY, centerZ, zoom)
      request = DataRequest(position, width, height, 1)
      image <- respondWithSpriteSheet(dataSource, dataLayer, request, 1, blackAndWhite = false)
    } yield image
}
