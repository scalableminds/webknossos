package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrCoordinatesParser
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffGroupHeader, NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.models.{VoxelPosition, VoxelSize}
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.services._
import net.liftweb.common.Box.tryo
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc._

import scala.concurrent.ExecutionContext

class ZarrStreamingController @Inject()(
    dataSourceRepository: DataSourceRepository,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    remoteTracingstoreClient: DSRemoteTracingstoreClient,
)(implicit ec: ExecutionContext)
    extends Controller {

  override def defaultErrorCode: Int = NOT_FOUND

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService

  override def allowRemoteOrigin: Boolean = true

  /**
    * Serve .zattrs file for a dataset
    * Uses the OME-NGFF standard (see https://ngff.openmicroscopy.org/latest/)
    */
  def requestZAttrs(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  datasetName,
                                                                                  dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        omeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(dataLayerName, dataSource.scale, dataLayer.resolutions)
      } yield Ok(Json.toJson(omeNgffHeader))
    }
  }

  def zAttrsWithAnnotationPrivateLink(token: Option[String],
                                      accessToken: String,
                                      dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
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
                annotationSource.datasetName,
                dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
              dataSourceOmeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(dataLayerName,
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
      datasetName: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        dataSource <- dataSourceRepository.findUsable(DataSourceId(datasetName, organizationName)).toFox ~> NOT_FOUND
        dataLayers = dataSource.dataLayers
        zarrLayers = dataLayers.map(convertLayerToZarrLayer)
        zarrSource = GenericDataSource[DataLayer](dataSource.id, zarrLayers, dataSource.scale)
        zarrSourceJson <- replaceVoxelSizeByLegacyFormat(Json.toJson(zarrSource))
      } yield Ok(Json.toJson(zarrSourceJson))
    }
  }

  private def replaceVoxelSizeByLegacyFormat(jsValue: JsValue): Fox[JsValue] = {
    val jsObject = jsValue.as[JsObject]
    val voxelSizeOpt = (jsObject \ "scale").asOpt[VoxelSize]
    voxelSizeOpt match {
      case None => Fox.successful(jsObject)
      case Some(voxelSize) =>
        val inNanometer = voxelSize.toNanometer
        for {
          newDataSource <- tryo(jsObject - "scale" + ("scale" -> Json.toJson(inNanometer)))
        } yield newDataSource
    }
  }

  private def convertLayerToZarrLayer(layer: DataLayer): ZarrLayer =
    layer match {
      case s: SegmentationLayer =>
        ZarrSegmentationLayer(
          s.name,
          s.boundingBox,
          s.elementClass,
          mags = s.resolutions.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz), None, None)),
          mappings = s.mappings,
          largestSegmentId = s.largestSegmentId,
          numChannels = Some(if (s.elementClass == ElementClass.uint24) 3 else 1),
            defaultViewConfiguration = s.defaultViewConfiguration,
          adminViewConfiguration = s.adminViewConfiguration,
          coordinateTransformations = s.coordinateTransformations,
          additionalAxes = s.additionalAxes
        )
      case d: DataLayer =>
        ZarrDataLayer(
          d.name,
          d.category,
          d.boundingBox,
          d.elementClass,
          mags = d.resolutions.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz), None, None)),
          numChannels = Some(if (d.elementClass == ElementClass.uint24) 3 else 1),
          defaultViewConfiguration = d.defaultViewConfiguration,
          adminViewConfiguration = d.adminViewConfiguration,
          coordinateTransformations = d.coordinateTransformations,
          additionalAxes = d.additionalAxes

        )
    }

  def dataSourceWithAnnotationPrivateLink(token: Option[String], accessToken: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
        relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
        else urlOrHeaderToken(token, request)
        volumeAnnotationLayers = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(annotationSource.datasetName, annotationSource.organizationName))
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
        zarrSourceJson <- replaceVoxelSizeByLegacyFormat(Json.toJson(zarrSource))
      } yield Ok(Json.toJson(zarrSourceJson))
    }

  def requestRawZarrCube(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mag: String,
      cxyz: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      rawZarrCube(organizationName, datasetName, dataLayerName, mag, cxyz)
    }
  }

  def rawZarrCubePrivateLink(token: Option[String],
                             accessToken: String,
                             dataLayerName: String,
                             mag: String,
                             cxyz: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
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
            rawZarrCube(annotationSource.organizationName, annotationSource.datasetName, dataLayerName, mag, cxyz)
        }
      } yield result
    }

  private def rawZarrCube(
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mag: String,
      cxyz: String,
  )(implicit m: MessagesProvider): Fox[Result] =
    for {
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                datasetName,
                                                                                dataLayerName) ~> NOT_FOUND
      (c, x, y, z) <- ZarrCoordinatesParser.parseDotCoordinates(cxyz) ?~> "zarr.invalidChunkCoordinates" ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      _ <- bool2Fox(c == 0) ~> "zarr.invalidFirstChunkCoord" ~> NOT_FOUND
      cubeSize = DataLayer.bucketLength
      request = DataServiceDataRequest(
        dataSource,
        dataLayer,
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
                    datasetName: String,
                    dataLayerName: String,
                    mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      zArray(organizationName, datasetName, dataLayerName, mag)
    }
  }

  private def zArray(organizationName: String, datasetName: String, dataLayerName: String, mag: String)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, datasetName, dataLayerName) ?~> Messages(
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
      annotationSource <- remoteWebknossosClient
        .getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
      relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken) else urlOrHeaderToken(token, request)
      layer = annotationSource.getAnnotationLayer(dataLayerName)
      result <- layer match {
        case Some(annotationLayer) =>
          remoteTracingstoreClient
            .getZArray(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl, relevantToken)
            .map(z => Ok(Json.toJson(z)))
        case None =>
          zArray(annotationSource.organizationName, annotationSource.datasetName, dataLayerName, mag)
      }
    } yield result
  }

  def requestDataLayerMagFolderContents(token: Option[String],
                                        organizationName: String,
                                        datasetName: String,
                                        dataLayerName: String,
                                        mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        dataLayerMagFolderContents(organizationName, datasetName, dataLayerName, mag)
      }
    }

  private def dataLayerMagFolderContents(organizationName: String,
                                         datasetName: String,
                                         dataLayerName: String,
                                         mag: String)(implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, datasetName, dataLayerName) ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
    } yield
      Ok(
        views.html.datastoreZarrDatasourceDir(
          "Datastore",
          "%s/%s/%s/%s".format(organizationName, datasetName, dataLayerName, mag),
          List(".zarray")
        )).withHeaders()

  def dataLayerMagFolderContentsPrivateLink(token: Option[String],
                                            accessToken: String,
                                            dataLayerName: String,
                                            mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
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
                                       annotationSource.datasetName,
                                       dataLayerName,
                                       mag)
        }
      } yield result
    }

  def requestDataLayerFolderContents(token: Option[String],
                                     organizationName: String,
                                     datasetName: String,
                                     dataLayerName: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      dataLayerFolderContents(organizationName, datasetName, dataLayerName)
    }
  }

  private def dataLayerFolderContents(organizationName: String, datasetName: String, dataLayerName: String)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, datasetName, dataLayerName) ?~> Messages(
        "dataSource.notFound") ~> NOT_FOUND
      mags = dataLayer.resolutions
    } yield
      Ok(
        views.html.datastoreZarrDatasourceDir(
          "Datastore",
          "%s/%s/%s".format(organizationName, datasetName, dataLayerName),
          List(".zattrs", ".zgroup") ++ mags.map(_.toMagLiteral(allowScalar = true))
        )).withHeaders()

  def dataLayerFolderContentsPrivateLink(token: Option[String],
                                         accessToken: String,
                                         dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
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
            dataLayerFolderContents(annotationSource.organizationName, annotationSource.datasetName, dataLayerName)
        }
      } yield result
    }

  def requestDataSourceFolderContents(token: Option[String],
                                      organizationName: String,
                                      datasetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          dataSource <- dataSourceRepository.findUsable(DataSourceId(datasetName, organizationName)).toFox ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND
          layerNames = dataSource.dataLayers.map((dataLayer: DataLayer) => dataLayer.name)
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Datastore",
              s"$organizationName/$datasetName",
              List(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON, ".zgroup") ++ layerNames
            ))
      }
    }

  def dataSourceFolderContentsPrivateLink(token: Option[String], accessToken: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request))
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(annotationSource.datasetName, annotationSource.organizationName))
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
            List(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON, ".zgroup") ++ layerNames
          ))
    }

  def requestZGroup(token: Option[String],
                    organizationName: String,
                    datasetName: String,
                    dataLayerName: String = ""): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
      urlOrHeaderToken(token, request)) {
      Ok(zGroupJson)
    }
  }

  private def zGroupJson: JsValue = Json.toJson(NgffGroupHeader(zarr_format = 2))

  def zGroupPrivateLink(token: Option[String], accessToken: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
        layer = annotationSource.getAnnotationLayer(dataLayerName)
        relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
        else urlOrHeaderToken(token, request)
        result <- layer match {
          case Some(annotationLayer) =>
            remoteTracingstoreClient
              .getZGroup(annotationLayer.tracingId, annotationSource.tracingStoreUrl, relevantToken)
              .map(Ok(_))
          case None =>
            Fox.successful(Ok(zGroupJson))
        }
      } yield result
    }
}
