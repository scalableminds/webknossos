package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.{ZarrDataLayer, ZarrMag, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.services._
import io.swagger.annotations._
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc._

import scala.concurrent.{ExecutionContext, Future}

@Api(tags = Array("datastore", "zarr-streaming"))
class ZarrStreamingController @Inject()(
    dataSourceRepository: DataSourceRepository,
    config: DataStoreConfig,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
)(implicit ec: ExecutionContext)
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService

  def dataSourceFolderContents(token: Option[String],
                               organizationName: String,
                               dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        getTokenFromHeader(token, request)) {
        for {
          dataSource <- dataSourceRepository.findUsable(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages(
            "dataSource.notFound") ~> 404
          layerNames = dataSource.dataLayers.map((dataLayer: DataLayer) => dataLayer.name)
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Datastore",
              s"$organizationName/$dataSetName",
              Map(s"$dataSetName" -> ".") ++ layerNames.map { x =>
                (x, s"$dataSetName/$x")
              }.toMap
            ))
      }
    }

  def dataLayerFolderContents(token: Option[String],
                              organizationName: String,
                              dataSetName: String,
                              dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        getTokenFromHeader(token, request)) {
        for {
          (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName) ?~> Messages(
            "dataSource.notFound") ~> 404
          mags = dataLayer.resolutions
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Datastore",
              "%s/%s/%s".format(organizationName, dataSetName, dataLayerName),
              Map(s"$dataLayerName" -> ".") ++ mags.map { mag =>
                (mag.toMagLiteral(), s"$dataLayerName/${mag.toMagLiteral()}")
              }.toMap
            )).withHeaders()
      }
    }

  def dataLayerMagFolderContents(token: Option[String],
                                 organizationName: String,
                                 dataSetName: String,
                                 dataLayerName: String,
                                 mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        getTokenFromHeader(token, request)) {
        for {
          (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName) ~> 404
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag)
          _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> 404
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Datastore",
              "%s/%s/%s/%s".format(organizationName, dataSetName, dataLayerName, mag),
              Map(mag -> ".")
            )).withHeaders()
      }
    }

  /**
    * Handles a request for .zarray file for a wkw dataset via a HTTP GET. Used by zarr-streaming.
    */
  def zArray(token: Option[String], organizationName: String, dataSetName: String, dataLayerName: String, mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      getTokenFromHeader(token, request)) {
      for {
        (_, dataLayer) <- dataSourceRepository
          .getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName) ?~> Messages("dataSource.notFound") ~> 404
        magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag)
        _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> 404
        cubeLength = DataLayer.bucketLength
        (channels, dtype) = zarrDtypeFromElementClass(dataLayer.elementClass)
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
              (dataLayer.boundingBox.width + dataLayer.boundingBox.topLeft.x) / magParsed.x,
              (dataLayer.boundingBox.height + dataLayer.boundingBox.topLeft.y) / magParsed.y,
              (dataLayer.boundingBox.depth + dataLayer.boundingBox.topLeft.z) / magParsed.z
            ),
            "dimension_seperator" -> "."
          ))
    }
  }

  /**
    * Handles requests for raw binary data via HTTP GET. Used by zarr streaming.
    */
  def rawZarrCube(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mag: String,
      cxyz: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      getTokenFromHeader(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  dataSetName,
                                                                                  dataLayerName) ~> 404
        (c, x, y, z) <- parseDotCoordinates(cxyz) ?~> "zarr.invalidChunkCoordinates" ~> 404
        magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag)
        _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> 404
        _ <- bool2Fox(c == 0) ~> "zarr.invalidFirstChunkCoord" ~> 404
        cubeSize = DataLayer.bucketLength
        request = DataServiceDataRequest(
          dataSource,
          dataLayer,
          None,
          Cuboid(
            topLeft = new VoxelPosition(x * cubeSize * magParsed.x,
                                        y * cubeSize * magParsed.y,
                                        z * cubeSize * magParsed.z,
                                        magParsed),
            width = cubeSize,
            height = cubeSize,
            depth = cubeSize
          ),
          DataServiceRequestSettings(halfByte = false)
        )
        (data, _) <- binaryDataService.handleDataRequests(List(request))
      } yield Ok(data)
    }
  }

  private def parseDotCoordinates(
      cxyz: String,
  ): Fox[(Int, Int, Int, Int)] = {
    val singleRx = "\\s*([0-9]+).([0-9]+).([0-9]+).([0-9]+)\\s*".r

    cxyz match {
      case singleRx(c, x, y, z) =>
        Fox.successful(Integer.parseInt(c), Integer.parseInt(x), Integer.parseInt(y), Integer.parseInt(z))
      case _ => Fox.failure("Coordinates not valid")
    }
  }

  /**
    * Zarr-specific datasource-properties.json file for a datasource. Note that the result here is not necessarily equal to the file used in the underlying storage.
    */
  def dataSource(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      getTokenFromHeader(token, request)) {
      for {
        dataSource <- dataSourceRepository.findUsable(DataSourceId(dataSetName, organizationName)).toFox ~> 404
        dataLayers = dataSource.dataLayers
        zarrLayers = dataLayers.collect({
          case d: WKWDataLayer =>
            ZarrDataLayer(
              d.name,
              d.category,
              d.boundingBox,
              d.elementClass,
              d.resolutions.map(x => ZarrMag(x, None, None)),
              numChannels = Some(if (d.elementClass == ElementClass.uint24) 3 else 1)
            )
          case s: WKWSegmentationLayer =>
            ZarrSegmentationLayer(
              s.name,
              s.boundingBox,
              s.elementClass,
              s.resolutions.map(x => ZarrMag(x, None, None)),
              mappings = s.mappings,
              largestSegmentId = s.largestSegmentId,
              numChannels = Some(if (s.elementClass == ElementClass.uint24) 3 else 1)
            )
          case z: ZarrDataLayer =>
            ZarrDataLayer(
              z.name,
              z.category,
              z.boundingBox,
              z.elementClass,
              z.resolutions.map(x => ZarrMag(x, None, None)),
              numChannels = Some(if (z.elementClass == ElementClass.uint24) 3 else 1)
            )
          case zs: ZarrSegmentationLayer =>
            ZarrSegmentationLayer(
              zs.name,
              zs.boundingBox,
              zs.elementClass,
              zs.resolutions.map(x => ZarrMag(x, None, None)),
              mappings = zs.mappings,
              largestSegmentId = zs.largestSegmentId,
              numChannels = Some(if (zs.elementClass == ElementClass.uint24) 3 else 1)
            )
        })
        zarrSource = GenericDataSource[DataLayer](dataSource.id, zarrLayers, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }
  }

  def zGroup(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      getTokenFromHeader(token, request)) {
      Future(Ok(Json.obj("zarr_format" -> 2)))
    }
  }

  private def getTokenFromHeader(token: Option[String], request: Request[AnyContent]) =
    token.orElse(request.headers.get("X-Auth-Token"))

  private def zarrDtypeFromElementClass(elementClass: ElementClass.Value): (Int, String) = elementClass match {
    case ElementClass.uint8  => (1, "|u1")
    case ElementClass.uint16 => (1, "<u2")
    case ElementClass.uint24 => (3, "<u1")
    case ElementClass.uint32 => (1, "<u4")
    case ElementClass.uint64 => (1, "<u8")
    case ElementClass.float  => (1, "<f4")
    case ElementClass.double => (1, "<f8")
    case ElementClass.int8   => (1, "|i1")
    case ElementClass.int16  => (1, "<i2")
    case ElementClass.int32  => (1, "<i4")
    case ElementClass.int64  => (1, "<i8")
  }
}
