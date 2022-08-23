package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrCoordinatesParser.parseDotCoordinates
import com.scalableminds.webknossos.datastore.dataformats.zarr.{ZarrDataLayer, ZarrLayer, ZarrMag, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.jzarr.{
  ArrayOrder,
  AxisOrder,
  OmeNgffGroupHeader,
  OmeNgffHeader,
  ZarrHeader
}
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
    config: DataStoreConfig,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    remoteWebKnossosClient: DSRemoteWebKnossosClient,
    remoteTracingstoreClient: DSRemoteTracingstoreClient,
)(implicit ec: ExecutionContext)
    extends Controller {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService

  override def allowRemoteOrigin: Boolean = true

  /**
    * Handles a request for .zattrs file for a wkw dataset via a HTTP GET.
    * Uses the OME-NGFF standard (see https://ngff.openmicroscopy.org/latest/)
    * Used by zarr-streaming.
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
        existingMags = dataLayer.resolutions

        omeNgffHeader = OmeNgffHeader.fromDataLayerName(dataLayerName,
                                                        dataSourceScale = dataSource.scale,
                                                        mags = existingMags)
      } yield Ok(Json.toJson(omeNgffHeader))
    }
  }

  def zAttrsWithAnnotationPrivateLink(accessToken: String, dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessToken) ~> NOT_FOUND
        annotationLayer = annotationSource.getAnnotationLayer(dataLayerName)

        omeNgffHeader <- annotationLayer match {
          case Some(layer) =>
            remoteTracingstoreClient.getOmeNgffHeader(layer.tracingId, annotationSource.tracingStoreUrl, accessToken)
          case None =>
            for {
              (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(
                annotationSource.organizationName,
                annotationSource.dataSetName,
                dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
              existingMags = dataLayer.resolutions

              dataSourceOmeNgffHeader = OmeNgffHeader.fromDataLayerName(dataLayerName,
                                                                        dataSourceScale = dataSource.scale,
                                                                        mags = existingMags)
            } yield dataSourceOmeNgffHeader
        }
      } yield Ok(Json.toJson(omeNgffHeader))
    }

  /**
    * Zarr-specific datasource-properties.json file for a datasource. Note that the result here is not necessarily equal to the file used in the underlying storage.
    */
  def requestDataSource(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
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
          d.resolutions.map(x => ZarrMag(x, None, None, Some(AxisOrder.cxyz))),
          numChannels = Some(if (d.elementClass == ElementClass.uint24) 3 else 1)
        )
      case s: WKWSegmentationLayer =>
        ZarrSegmentationLayer(
          s.name,
          s.boundingBox,
          s.elementClass,
          s.resolutions.map(x => ZarrMag(x, None, None, Some(AxisOrder.cxyz))),
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
          z.resolutions.map(x => ZarrMag(x, None, None, Some(AxisOrder.cxyz))),
          numChannels = Some(if (z.elementClass == ElementClass.uint24) 3 else 1)
        )
      case zs: ZarrSegmentationLayer =>
        ZarrSegmentationLayer(
          zs.name,
          zs.boundingBox,
          zs.elementClass,
          zs.resolutions.map(x => ZarrMag(x, None, None, Some(AxisOrder.cxyz))),
          mappings = zs.mappings,
          largestSegmentId = zs.largestSegmentId,
          numChannels = Some(if (zs.elementClass == ElementClass.uint24) 3 else 1)
        )
    }

  def dataSourceWithAnnotationPrivateLink(accessToken: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessToken) ~> NOT_FOUND
      volumeAnnotationLayers = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume)

      _ <- accessTokenService.validateAccess(
        UserAccessRequest.readDataSources(
          DataSourceId(annotationSource.dataSetName, annotationSource.organizationName)),
        Some(accessToken)) {
        Future.successful(Ok("Ok"))
      } ?~> "Access Denied" ~> NOT_FOUND

      dataSource <- dataSourceRepository
        .findUsable(DataSourceId(annotationSource.dataSetName, annotationSource.organizationName))
        .toFox ~> NOT_FOUND
      dataSourceLayers = dataSource.dataLayers
        .filter(dL => !volumeAnnotationLayers.exists(_.name == dL.name))
        .map(convertLayerToZarrLayer)
      annotationLayers <- Fox.serialCombined(volumeAnnotationLayers)(
        l =>
          remoteTracingstoreClient
            .getVolumeLayerAsZarrLayer(l.tracingId, Some(l.name), annotationSource.tracingStoreUrl, accessToken))
      allLayer = dataSourceLayers ++ annotationLayers
      zarrSource = GenericDataSource[DataLayer](dataSource.id, allLayer, dataSource.scale)
    } yield Ok(Json.toJson(zarrSource))
  }

  /**
    * Handles requests for raw binary data via HTTP GET. Used by zarr streaming.
    */
  def requestRawZarrCube(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mag: String,
      cxyz: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    for {
      result <- rawZarrCube(urlOrHeaderToken(token, request), organizationName, dataSetName, dataLayerName, mag, cxyz)
    } yield result
  }

  def rawZarrCubePrivateLink(accessToken: String,
                             dataLayerName: String,
                             mag: String,
                             cxyz: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessToken) ~> NOT_FOUND
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        // ensures access to volume layers if fallback layer with equal name exists
        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getRawZarrCube(annotationLayer.tracingId, mag, cxyz, annotationSource.tracingStoreUrl, accessToken)
              .map(Ok(_))
          case None =>
            rawZarrCube(Some(accessToken),
                        annotationSource.organizationName,
                        annotationSource.dataSetName,
                        dataLayerName,
                        mag,
                        cxyz)
        }
      } yield result
    }

  private def rawZarrCube(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mag: String,
      cxyz: String,
  )(implicit m: MessagesProvider): Fox[Result] =
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
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
    }

  /**
    * Handles a request for .zarray file for a wkw dataset via a HTTP GET. Used by zarr-streaming.
    */
  def requestZArray(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String,
                    mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    for {
      result <- zArray(urlOrHeaderToken(token, request), organizationName, dataSetName, dataLayerName, mag)
    } yield result
  }

  def zArray(token: Option[String], organizationName: String, dataSetName: String, dataLayerName: String, mag: String)(
      implicit m: MessagesProvider): Fox[Result] =
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      for {
        (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
        _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
        zarrHeader = ZarrHeader.fromLayer(dataLayer, magParsed)
      } yield Ok(Json.toJson(zarrHeader))
    }

  def zArrayPrivateLink(accessToken: String, dataLayerName: String, mag: String): Action[AnyContent] = Action.async {
    implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessToken) ~> NOT_FOUND
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getZArray(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl, accessToken)
              .map(z => Ok(Json.toJson(z)))
          case None =>
            zArray(Some(accessToken),
                   annotationSource.organizationName,
                   annotationSource.dataSetName,
                   dataLayerName,
                   mag)
        }
      } yield result
  }

  def requestDataLayerMagFolderContents(token: Option[String],
                                        organizationName: String,
                                        dataSetName: String,
                                        dataLayerName: String,
                                        mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        result <- dataLayerMagFolderContents(urlOrHeaderToken(token, request),
                                             organizationName,
                                             dataSetName,
                                             dataLayerName,
                                             mag)
      } yield result
    }

  private def dataLayerMagFolderContents(token: Option[String],
                                         organizationName: String,
                                         dataSetName: String,
                                         dataLayerName: String,
                                         mag: String)(implicit m: MessagesProvider): Fox[Result] =
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
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
    }

  def dataLayerMagFolderContentsPrivateLink(accessToken: String,
                                            dataLayerName: String,
                                            mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessToken) ~> NOT_FOUND
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getDataLayerMagFolderContents(annotationLayer.tracingId,
                                             mag,
                                             annotationSource.tracingStoreUrl,
                                             accessToken)
              .map(
                layers =>
                  Ok(
                    views.html.datastoreZarrDatasourceDir(
                      "Combined Annotation Route",
                      s"${annotationLayer.tracingId}",
                      layers
                    )).withHeaders())
          case None =>
            dataLayerMagFolderContents(Some(accessToken),
                                       annotationSource.organizationName,
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
    for {
      result <- dataLayerFolderContents(urlOrHeaderToken(token, request), organizationName, dataSetName, dataLayerName)
    } yield result
  }

  def dataLayerFolderContents(token: Option[String],
                              organizationName: String,
                              dataSetName: String,
                              dataLayerName: String)(implicit m: MessagesProvider): Fox[Result] =
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
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
    }

  def dataLayerFolderContentsPrivateLink(accessToken: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessToken) ~> NOT_FOUND
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getDataLayerFolderContents(annotationLayer.tracingId, annotationSource.tracingStoreUrl, accessToken)
              .map(
                layers =>
                  Ok(
                    views.html.datastoreZarrDatasourceDir(
                      "Tracingstore",
                      s"${annotationLayer.tracingId}",
                      layers
                    )).withHeaders())
          case None =>
            dataLayerFolderContents(Some(accessToken),
                                    annotationSource.organizationName,
                                    annotationSource.dataSetName,
                                    dataLayerName)
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

  def dataSourceFolderContentsPrivateLink(accessToken: String): Action[AnyContent] = Action.async { implicit request =>
    remoteWebKnossosClient.getAnnotationForPrivateLink(accessToken).flatMap { annotationSource =>
      accessTokenService.validateAccess(
        UserAccessRequest.readDataSources(
          DataSourceId(annotationSource.dataSetName, annotationSource.organizationName)),
        Some(accessToken)) {
        for {
          dataSource <- dataSourceRepository
            .findUsable(DataSourceId(annotationSource.dataSetName, annotationSource.organizationName))
            .toFox ?~> Messages("dataSource.notFound") ~> NOT_FOUND

          annotationLayerNames = annotationSource.annotationLayers
            .filter(_.typ == AnnotationLayerType.Volume)
            .map(_.name)
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
    }
  }

  def requestZGroup(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String = ""): Action[AnyContent] = Action.async { implicit request =>
    for {
      result <- zGroup(urlOrHeaderToken(token, request), organizationName, dataSetName)
    } yield result
  }

  private def zGroup(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
  ): Fox[Result] =
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      Future(Ok(Json.toJson(OmeNgffGroupHeader(zarr_format = 2))))
    }

  def zGroupPrivateLink(accessToken: String, dataLayerName: String): Action[AnyContent] = Action.async {
    implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessToken) ~> NOT_FOUND
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getZGroup(annotationLayer.tracingId, annotationSource.tracingStoreUrl, accessToken)
              .map(Ok(_))
          case None =>
            zGroup(Some(accessToken), annotationSource.organizationName, annotationSource.dataSetName)
        }
      } yield result
  }
}
