package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrCoordinatesParser.parseDotCoordinates
import com.scalableminds.webknossos.datastore.dataformats.zarr.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.jzarr.{OmeNgffGroupHeader, OmeNgffHeader, ZarrHeader}
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.services._
import io.swagger.annotations._
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.Json
import play.api.mvc._

import scala.concurrent.{ExecutionContext, Future}

@Api(tags = Array("datastore", "zarr-streaming"))
class ZarrStreamingController @Inject()(
    dataSourceRepository: DataSourceRepository,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    remoteWebKnossosClient: DSRemoteWebKnossosClient,
    remoteTracingstoreClient: DSRemoteTracingstoreClient,
)(implicit ec: ExecutionContext)
    extends Controller {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService

  override def allowRemoteOrigin: Boolean = true

  /**
    * Serve .zattrs file for a dataset
    * Uses the OME-NGFF standard (see https://ngff.openmicroscopy.org/latest/)
    */
  def requestZAttrs(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  dataSetName,
                                                                                  dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        omeNgffHeader = OmeNgffHeader.fromNameScaleAndMags(dataLayerName, dataSource.scale, dataLayer.resolutions)
      } yield Ok(Json.toJson(omeNgffHeader))
    }
  }

  def zAttrsWithAnnotationPrivateLink(token: Option[String],
                                      accessToken: String,
                                      dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
        relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
        else urlOrHeaderToken(token, request)
        annotationLayer = annotationSource.getAnnotationLayer(dataLayerName)
        omeNgffHeader <- annotationLayer match {
          case Some(layer) =>
            remoteTracingstoreClient.getOmeNgffHeader(layer.tracingId, annotationSource.tracingStoreUrl, relevantToken)
          case None =>
            for {
              (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(
                annotationSource.organizationName,
                annotationSource.dataSetName,
                dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
              dataSourceOmeNgffHeader = OmeNgffHeader.fromNameScaleAndMags(dataLayerName,
                                                                           dataSource.scale,
                                                                           dataLayer.resolutions)
            } yield dataSourceOmeNgffHeader
        }
      } yield Ok(Json.toJson(omeNgffHeader))
    }

  /**
    * Zarr-specific datasource-properties.json file for a datasource.
    * Note that the result here is not necessarily equal to the file used in the underlying storage.
    */
  def requestDataSource(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        dataSource <- dataSourceRepository.findUsable(DataSourceId(dataSetName, organizationName)).toFox ~> NOT_FOUND
        dataLayers = dataSource.dataLayers
        zarrLayers = dataLayers.map(convertLayerToZarrLayer)
        zarrSource = GenericDataSource[DataLayer](dataSource.id, zarrLayers, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }
  }

  private def convertLayerToZarrLayer(layer: DataLayer): ZarrLayer =
    layer match {
      case d: WKWDataLayer =>
        ZarrDataLayer(
          d.name,
          d.category,
          d.boundingBox,
          d.elementClass,
          d.resolutions.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz))),
          numChannels = Some(if (d.elementClass == ElementClass.uint24) 3 else 1)
        )
      case s: WKWSegmentationLayer =>
        ZarrSegmentationLayer(
          s.name,
          s.boundingBox,
          s.elementClass,
          s.resolutions.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz))),
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
          z.resolutions.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz))),
          numChannels = Some(if (z.elementClass == ElementClass.uint24) 3 else 1)
        )
      case zs: ZarrSegmentationLayer =>
        ZarrSegmentationLayer(
          zs.name,
          zs.boundingBox,
          zs.elementClass,
          zs.resolutions.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz))),
          mappings = zs.mappings,
          largestSegmentId = zs.largestSegmentId,
          numChannels = Some(if (zs.elementClass == ElementClass.uint24) 3 else 1)
        )
    }

  def dataSourceWithAnnotationPrivateLink(token: Option[String], accessToken: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
        relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
        else urlOrHeaderToken(token, request)
        volumeAnnotationLayers = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(annotationSource.dataSetName, annotationSource.organizationName))
          .toFox ~> NOT_FOUND
        dataSourceLayers = dataSource.dataLayers
          .filter(dL => !volumeAnnotationLayers.exists(_.name == dL.name))
          .map(convertLayerToZarrLayer)
        annotationLayers <- Fox.serialCombined(volumeAnnotationLayers)(
          l =>
            remoteTracingstoreClient
              .getVolumeLayerAsZarrLayer(l.tracingId, Some(l.name), annotationSource.tracingStoreUrl, relevantToken))
        allLayer = dataSourceLayers ++ annotationLayers
        zarrSource = GenericDataSource[DataLayer](dataSource.id, allLayer, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }

  def requestRawZarrCube(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mag: String,
      cxyz: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      rawZarrCube(organizationName, dataSetName, dataLayerName, mag, cxyz)
    }
  }

  def rawZarrCubePrivateLink(token: Option[String],
                             accessToken: String,
                             dataLayerName: String,
                             mag: String,
                             cxyz: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
        relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
        else urlOrHeaderToken(token, request)
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        // ensures access to volume layers if fallback layer with equal name exists
        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getRawZarrCube(annotationLayer.tracingId, mag, cxyz, annotationSource.tracingStoreUrl, relevantToken)
              .map(Ok(_))
          case None =>
            rawZarrCube(annotationSource.organizationName, annotationSource.dataSetName, dataLayerName, mag, cxyz)
        }
      } yield result
    }

  private def rawZarrCube(
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mag: String,
      cxyz: String,
  )(implicit m: MessagesProvider): Fox[Result] =
    for {
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                dataSetName,
                                                                                dataLayerName) ~> NOT_FOUND
      (c, x, y, z) <- parseDotCoordinates(cxyz) ?~> "zarr.invalidChunkCoordinates" ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      _ <- bool2Fox(c == 0) ~> "zarr.invalidFirstChunkCoord" ~> NOT_FOUND
      cubeSize = DataLayer.bucketLength
      request = DataServiceDataRequest(
        dataSource,
        dataLayer,
        None,
        Cuboid(
          topLeft = VoxelPosition(x * cubeSize * magParsed.x,
                                  y * cubeSize * magParsed.y,
                                  z * cubeSize * magParsed.z,
                                  magParsed),
          width = cubeSize,
          height = cubeSize,
          depth = cubeSize
        ),
        DataServiceRequestSettings(halfByte = false)
      )
      (data, notFoundIndices) <- binaryDataService.handleDataRequests(List(request))
      _ <- bool2Fox(notFoundIndices.isEmpty) ~> "zarr.chunkNotFound" ~> NOT_FOUND
    } yield Ok(data)

  def requestZArray(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String,
                    mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      zArray(organizationName, dataSetName, dataLayerName, mag)
    }
  }

  private def zArray(organizationName: String, dataSetName: String, dataLayerName: String, mag: String)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName) ?~> Messages(
        "dataSource.notFound") ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      zarrHeader = ZarrHeader.fromLayer(dataLayer, magParsed)
    } yield Ok(Json.toJson(zarrHeader))

  def zArrayPrivateLink(token: Option[String],
                        accessToken: String,
                        dataLayerName: String,
                        mag: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      annotationSource <- remoteWebKnossosClient
        .getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
      relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken) else urlOrHeaderToken(token, request)
      layer = annotationSource.getAnnotationLayer(dataLayerName)
      result <- layer match {
        case Some(annotationLayer) =>
          remoteTracingstoreClient
            .getZArray(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl, relevantToken)
            .map(z => Ok(Json.toJson(z)))
        case None =>
          zArray(annotationSource.organizationName, annotationSource.dataSetName, dataLayerName, mag)
      }
    } yield result
  }

  def requestDataLayerMagFolderContents(token: Option[String],
                                        organizationName: String,
                                        dataSetName: String,
                                        dataLayerName: String,
                                        mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        dataLayerMagFolderContents(organizationName, dataSetName, dataLayerName, mag)
      }
    }

  private def dataLayerMagFolderContents(organizationName: String,
                                         dataSetName: String,
                                         dataLayerName: String,
                                         mag: String)(implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName) ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
    } yield
      Ok(
        views.html.datastoreZarrDatasourceDir(
          "Datastore",
          "%s/%s/%s/%s".format(organizationName, dataSetName, dataLayerName, mag),
          List(".zarray")
        )).withHeaders()

  def dataLayerMagFolderContentsPrivateLink(token: Option[String],
                                            accessToken: String,
                                            dataLayerName: String,
                                            mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
        relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
        else urlOrHeaderToken(token, request)
        layer = annotationSource.getAnnotationLayer(dataLayerName)
        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getDataLayerMagFolderContents(annotationLayer.tracingId,
                                             mag,
                                             annotationSource.tracingStoreUrl,
                                             relevantToken)
              .map(
                layers =>
                  Ok(
                    views.html.datastoreZarrDatasourceDir(
                      "Combined Annotation Route",
                      s"${annotationLayer.tracingId}",
                      layers
                    )).withHeaders())
          case None =>
            dataLayerMagFolderContents(annotationSource.organizationName,
                                       annotationSource.dataSetName,
                                       dataLayerName,
                                       mag)
        }
      } yield result
    }

  def requestDataLayerFolderContents(token: Option[String],
                                     organizationName: String,
                                     dataSetName: String,
                                     dataLayerName: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      dataLayerFolderContents(organizationName, dataSetName, dataLayerName)
    }
  }

  private def dataLayerFolderContents(organizationName: String, dataSetName: String, dataLayerName: String)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName) ?~> Messages(
        "dataSource.notFound") ~> NOT_FOUND
      mags = dataLayer.resolutions
    } yield
      Ok(
        views.html.datastoreZarrDatasourceDir(
          "Datastore",
          "%s/%s/%s".format(organizationName, dataSetName, dataLayerName),
          List(".zattrs", ".zgroup") ++ mags.map(_.toMagLiteral(allowScalar = true))
        )).withHeaders()

  def dataLayerFolderContentsPrivateLink(token: Option[String],
                                         accessToken: String,
                                         dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
        layer = annotationSource.getAnnotationLayer(dataLayerName)
        relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
        else urlOrHeaderToken(token, request)
        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getDataLayerFolderContents(annotationLayer.tracingId, annotationSource.tracingStoreUrl, relevantToken)
              .map(
                layers =>
                  Ok(
                    views.html.datastoreZarrDatasourceDir(
                      "Tracingstore",
                      s"${annotationLayer.tracingId}",
                      layers
                    )).withHeaders())
          case None =>
            dataLayerFolderContents(annotationSource.organizationName, annotationSource.dataSetName, dataLayerName)
        }
      } yield result
    }

  def requestDataSourceFolderContents(token: Option[String],
                                      organizationName: String,
                                      dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          dataSource <- dataSourceRepository.findUsable(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND
          layerNames = dataSource.dataLayers.map((dataLayer: DataLayer) => dataLayer.name)
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Datastore",
              s"$organizationName/$dataSetName",
              List("datasource-properties.json", ".zgroup") ++ layerNames
            ))
      }
    }

  def dataSourceFolderContentsPrivateLink(token: Option[String], accessToken: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request))
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(annotationSource.dataSetName, annotationSource.organizationName))
          .toFox ?~> Messages("dataSource.notFound") ~> NOT_FOUND
        annotationLayerNames = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume).map(_.name)
        dataSourceLayerNames = dataSource.dataLayers
          .map((dataLayer: DataLayer) => dataLayer.name)
          .filter(!annotationLayerNames.contains(_))
        layerNames = annotationLayerNames ++ dataSourceLayerNames
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Combined datastore and tracingstore directory",
            s"$accessToken",
            List("datasource-properties.json", ".zgroup") ++ layerNames
          ))
    }

  def requestZGroup(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String = ""): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      zGroup(organizationName, dataSetName)
    }
  }

  private def zGroup(
      organizationName: String,
      dataSetName: String,
  ): Fox[Result] =
    Future(Ok(Json.toJson(OmeNgffGroupHeader(zarr_format = 2))))

  def zGroupPrivateLink(token: Option[String], accessToken: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
        layer = annotationSource.getAnnotationLayer(dataLayerName)
        relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
        else urlOrHeaderToken(token, request)
        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getZGroup(annotationLayer.tracingId, annotationSource.tracingStoreUrl, relevantToken)
              .map(Ok(_))
          case None =>
            zGroup(annotationSource.organizationName, annotationSource.dataSetName)
        }
      } yield result
    }
}
