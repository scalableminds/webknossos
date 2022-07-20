package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrCoordinatesParser.parseDotCoordinates
import com.scalableminds.webknossos.datastore.dataformats.zarr.{ZarrDataLayer, ZarrMag, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.jzarr.{OmeNgffHeader, ZarrHeader}
import com.scalableminds.webknossos.datastore.models.VoxelPosition
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
          "dataSource.notFound") ~> 404
        existingMags = dataLayer.resolutions

        omeNgffHeader = OmeNgffHeader.fromDataLayerName(dataLayerName,
                                                        dataSourceScale = dataSource.scale,
                                                        mags = existingMags)
      } yield Ok(Json.toJson(omeNgffHeader))
    }
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
                                      urlOrHeaderToken(token, request)) {
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

  def rawZarrCubePrivateLink(accessId: String, dataLayerName: String, mag: String, cxyz: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessId)
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getRawZarrCube(annotationLayer.tracingId, mag, cxyz, annotationSource.tracingStoreUrl)
              .map(Ok(_))
          case None =>
            rawZarrCube(Some(accessId),
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
                                                                                  dataLayerName) ~> 404
        (c, x, y, z) <- parseDotCoordinates(cxyz) ?~> "zarr.invalidChunkCoordinates" ~> 404
        magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> 404
        _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> 404
        _ <- bool2Fox(c == 0) ~> "zarr.invalidFirstChunkCoord" ~> 404
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
        (data, _) <- binaryDataService.handleDataRequests(List(request))
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
          "dataSource.notFound") ~> 404
        magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> 404
        _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> 404
        zarrHeader = ZarrHeader.fromLayer(dataLayer, magParsed)
      } yield Ok(Json.toJson(zarrHeader))
    }

  def zArrayPrivateLink(accessId: String, dataLayerName: String, mag: String): Action[AnyContent] = Action.async {
    implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessId)
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getZArray(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl)
              .map(z => Ok(Json.toJson(z)))
          case None =>
            zArray(Some(accessId), annotationSource.organizationName, annotationSource.dataSetName, dataLayerName, mag)
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
        (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName) ~> 404
        magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> 404
        _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> 404
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            "%s/%s/%s/%s".format(organizationName, dataSetName, dataLayerName, mag),
            Map(mag -> ".")
          )).withHeaders()
    }

  def dataLayerMagFolderContentsPrivateLink(accessId: String, dataLayerName: String, mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessId)
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getDataLayerMagFolderContents(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl)
              .map(Ok(_))
          case None =>
            dataLayerMagFolderContents(Some(accessId),
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

  def dataLayerFolderContentsPrivateLink(accessId: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessId)
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getDataLayerFolderContents(annotationLayer.tracingId, annotationSource.tracingStoreUrl)
              .map(Ok(_))
          case None =>
            dataLayerFolderContents(Some(accessId),
                                    annotationSource.organizationName,
                                    annotationSource.dataSetName,
                                    dataLayerName)
        }
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

  def requestDataSourceFolderContents(token: Option[String],
                                      organizationName: String,
                                      dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
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

  def dataSourceFolderContentsPrivateLink(accessId: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessId)
      dataSource <- dataSourceRepository
        .findUsable(DataSourceId(annotationSource.dataSetName, annotationSource.organizationName))
        .toFox ?~> Messages("dataSource.notFound") ~> 404

      dataSourceLayerNames = dataSource.dataLayers.map((dataLayer: DataLayer) => dataLayer.name)
      annotationLayerNames = annotationSource.annotationLayers.map(_.name)
      layerNames = dataSourceLayerNames ++ annotationLayerNames
    } yield
      Ok(
        views.html.datastoreZarrDatasourceDir(
          "Datastore",
          s"$accessId",
          Map(s"$accessId" -> ".") ++ layerNames.map { x =>
            (x, s"$accessId/$x")
          }.toMap
        ))
  }

  def requestZGroup(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String = ""): Action[AnyContent] = Action.async { implicit request =>
    for {
      result <- zGroup(urlOrHeaderToken(token, request), organizationName, dataSetName, dataLayerName)
    } yield result
  }

  private def zGroup(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String = "",
  ): Fox[Result] =
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      Future(Ok(Json.obj("zarr_format" -> 2)))

    }

  def zGroupPrivateLink(accessId: String, dataLayerName: String): Action[AnyContent] = Action.async {
    implicit request =>
      for {
        annotationSource <- remoteWebKnossosClient.getAnnotationForPrivateLink(accessId)
        layer = annotationSource.getAnnotationLayer(dataLayerName)

        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient.getZGroup(annotationLayer.tracingId, annotationSource.tracingStoreUrl).map(Ok(_))
          case None =>
            zGroup(Some(accessId), annotationSource.organizationName, annotationSource.dataSetName, dataLayerName)
        }
      } yield result
  }
}
