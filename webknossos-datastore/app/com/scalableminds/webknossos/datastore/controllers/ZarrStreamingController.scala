package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.{Zarr3OutputHelper, ZarrCoordinatesParser}
import com.scalableminds.webknossos.datastore.datareaders.zarr.{
  NgffGroupHeader,
  NgffMetadata,
  NgffMetadataV0_5,
  ZarrHeader
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{Zarr3ArrayHeader, Zarr3GroupHeader}
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType, AnnotationSource}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.services._
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsValue, Json}
import play.api.mvc._

import scala.concurrent.ExecutionContext
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder

class ZarrStreamingController @Inject()(
    dataSourceRepository: DataSourceRepository,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    remoteTracingstoreClient: DSRemoteTracingstoreClient,
)(implicit ec: ExecutionContext)
    extends Controller
    with Zarr3OutputHelper {

  override def defaultErrorCode: Int = NOT_FOUND

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService

  override def allowRemoteOrigin: Boolean = true

  /**
    * Serve .zattrs file for a dataset
    * Uses the OME-NGFF standard (see https://ngff.openmicroscopy.org/latest/)
    */
  def requestZAttrs(
      token: Option[String],
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
      urlOrHeaderToken(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        omeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(dataLayerName, dataSource.scale, dataLayer.sortedMags)
      } yield Ok(Json.toJson(omeNgffHeader))
    }
  }

  def requestZarrJson(
      token: Option[String],
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
      urlOrHeaderToken(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        omeNgffHeaderV0_5 = NgffMetadataV0_5.fromNameVoxelSizeAndMags(dataLayerName,
                                                                      dataSource.scale,
                                                                      dataLayer.sortedMags,
                                                                      dataLayer.additionalAxes)
        zarr3GroupHeader = Zarr3GroupHeader(3, "group", Some(omeNgffHeaderV0_5))
      } yield Ok(Json.toJson(zarr3GroupHeader))
    }
  }

  def zAttrsWithAnnotationPrivateLink(token: Option[String],
                                      accessToken: String,
                                      dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        token,
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantToken) => {
          remoteTracingstoreClient
            .getOmeNgffHeader(annotationLayer.tracingId, annotationSource.tracingStoreUrl, relevantToken)
            .map(ngffMetadata => Ok(Json.toJson(ngffMetadata)))
        },
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(
              annotationSource.organizationId,
              annotationSource.datasetDirectoryName,
              dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            dataSourceOmeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(dataLayerName,
                                                                            dataSource.scale,
                                                                            dataLayer.sortedMags)
          } yield Ok(Json.toJson(dataSourceOmeNgffHeader))
      )
    }

  def zarrJsonWithAnnotationPrivateLink(token: Option[String],
                                        accessToken: String,
                                        dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        token,
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantToken) => {
          remoteTracingstoreClient
            .getZarrJsonGroupHeaderWithNgff(annotationLayer.tracingId, annotationSource.tracingStoreUrl, relevantToken)
            .map(header => Ok(Json.toJson(header)))
        },
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(
              annotationSource.organizationId,
              annotationSource.datasetDirectoryName,
              dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            dataSourceOmeNgffHeader = NgffMetadataV0_5.fromNameVoxelSizeAndMags(dataLayerName,
                                                                                dataSource.scale,
                                                                                dataLayer.sortedMags,
                                                                                dataLayer.additionalAxes)
            zarr3GroupHeader = Zarr3GroupHeader(3, "group", Some(dataSourceOmeNgffHeader))
          } yield Ok(Json.toJson(zarr3GroupHeader))
      )
    }

  /**
    * Zarr-specific datasource-properties.json file for a datasource.
    * Note that the result here is not necessarily equal to the file used in the underlying storage.
    */
  def requestDataSource(
      token: Option[String],
      organizationId: String,
      datasetDirectoryName: String,
      zarrVersion: Int,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
      urlOrHeaderToken(token, request)) {
      for {
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(datasetDirectoryName, organizationId))
          .toFox ~> NOT_FOUND
        dataLayers = dataSource.dataLayers
        zarrLayers = dataLayers.map(convertLayerToZarrLayer(_, zarrVersion))
        zarrSource = GenericDataSource[DataLayer](dataSource.id, zarrLayers, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }
  }

  private def convertLayerToZarrLayer(layer: DataLayer, zarrVersion: Int): ZarrLayer = {
    val dataFormat = if (zarrVersion == 2) DataFormat.zarr else DataFormat.zarr3
    layer match {
      case s: SegmentationLayer =>
        val rank = s.additionalAxes.map(_.length).getOrElse(0) + 4 // We’re writing c, additionalAxes, xyz
        ZarrSegmentationLayer(
          s.name,
          s.boundingBox,
          s.elementClass,
          mags = s.sortedMags.map(x => MagLocator(x, None, None, Some(AxisOrder.cAdditionalxyz(rank)), None, None)),
          mappings = s.mappings,
          largestSegmentId = s.largestSegmentId,
          numChannels = Some(if (s.elementClass == ElementClass.uint24) 3 else 1),
          defaultViewConfiguration = s.defaultViewConfiguration,
          adminViewConfiguration = s.adminViewConfiguration,
          coordinateTransformations = s.coordinateTransformations,
          additionalAxes = s.additionalAxes.map(reorderAdditionalAxes),
          dataFormat = dataFormat
        )
      case d: DataLayer =>
        val rank = d.additionalAxes.map(_.length).getOrElse(0) + 4 // We’re writing c, additionalAxes, xyz
        ZarrDataLayer(
          d.name,
          d.category,
          d.boundingBox,
          d.elementClass,
          mags = d.sortedMags.map(x => MagLocator(x, None, None, Some(AxisOrder.cAdditionalxyz(rank)), None, None)),
          numChannels = Some(if (d.elementClass == ElementClass.uint24) 3 else 1),
          defaultViewConfiguration = d.defaultViewConfiguration,
          adminViewConfiguration = d.adminViewConfiguration,
          coordinateTransformations = d.coordinateTransformations,
          additionalAxes = d.additionalAxes.map(reorderAdditionalAxes),
          dataFormat = dataFormat
        )
    }
  }

  def dataSourceWithAnnotationPrivateLink(token: Option[String],
                                          accessToken: String,
                                          zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
        relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
        else urlOrHeaderToken(token, request)
        volumeAnnotationLayers = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(annotationSource.datasetDirectoryName, annotationSource.organizationId))
          .toFox ~> NOT_FOUND
        dataSourceLayers = dataSource.dataLayers
          .filter(dL => !volumeAnnotationLayers.exists(_.name == dL.name))
          .map(convertLayerToZarrLayer(_, zarrVersion))
        annotationLayers <- Fox.serialCombined(volumeAnnotationLayers)(
          l =>
            remoteTracingstoreClient.getVolumeLayerAsZarrLayer(l.tracingId,
                                                               Some(l.name),
                                                               annotationSource.tracingStoreUrl,
                                                               relevantToken,
                                                               zarrVersion))
        allLayer = dataSourceLayers ++ annotationLayers
        zarrSource = GenericDataSource[DataLayer](dataSource.id, allLayer, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }

  def requestRawZarrCube(
      token: Option[String],
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
      urlOrHeaderToken(token, request)) {
      rawZarrCube(organizationId, datasetDirectoryName, dataLayerName, mag, coordinates)
    }
  }

  def rawZarrCubePrivateLink(token: Option[String],
                             accessToken: String,
                             dataLayerName: String,
                             mag: String,
                             coordinates: String): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        token,
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantToken) =>
          remoteTracingstoreClient
            .getRawZarrCube(annotationLayer.tracingId,
                            mag,
                            coordinates,
                            annotationSource.tracingStoreUrl,
                            relevantToken)
            .map(Ok(_)),
        orElse = annotationSource =>
          rawZarrCube(annotationSource.organizationId,
                      annotationSource.datasetDirectoryName,
                      dataLayerName,
                      mag,
                      coordinates)
      )
    }

  private def rawZarrCube(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  )(implicit m: MessagesProvider): Fox[Result] =
    for {
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                datasetDirectoryName,
                                                                                dataLayerName) ~> NOT_FOUND
      reorderedAdditionalAxes = dataLayer.additionalAxes.map(reorderAdditionalAxes)
      (x, y, z, additionalCoordinates) <- ZarrCoordinatesParser.parseNDimensionalDotCoordinates(
        coordinates,
        reorderedAdditionalAxes) ?~> "zarr.invalidChunkCoordinates" ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
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
        DataServiceRequestSettings(halfByte = false, additionalCoordinates = additionalCoordinates)
      )
      (data, notFoundIndices) <- binaryDataService.handleDataRequests(List(request))
      _ <- bool2Fox(notFoundIndices.isEmpty) ~> "zarr.chunkNotFound" ~> NOT_FOUND
    } yield Ok(data)

  def requestZArray(token: Option[String],
                    organizationId: String,
                    datasetDirectoryName: String,
                    dataLayerName: String,
                    mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
      urlOrHeaderToken(token, request)) {
      zArray(organizationId, datasetDirectoryName, dataLayerName, mag)
    }
  }

  private def zArray(organizationId: String, datasetDirectoryName: String, dataLayerName: String, mag: String)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                       datasetDirectoryName,
                                                                       dataLayerName) ?~> Messages(
        "dataSource.notFound") ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      zarrHeader = ZarrHeader.fromLayer(dataLayer, magParsed)
    } yield Ok(Json.toJson(zarrHeader))

  def requestZarrJsonForMag(token: Option[String],
                            organizationId: String,
                            datasetDirectoryName: String,
                            dataLayerName: String,
                            mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
      urlOrHeaderToken(token, request)) {
      zarrJsonForMag(organizationId, datasetDirectoryName, dataLayerName, mag)
    }
  }

  private def zarrJsonForMag(organizationId: String, datasetDirectoryName: String, dataLayerName: String, mag: String)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                       datasetDirectoryName,
                                                                       dataLayerName) ?~> Messages(
        "dataSource.notFound") ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      zarrHeader = Zarr3ArrayHeader.fromDataLayer(dataLayer, magParsed)
    } yield Ok(Json.toJson(zarrHeader))

  def zArrayPrivateLink(token: Option[String],
                        accessToken: String,
                        dataLayerName: String,
                        mag: String): Action[AnyContent] = Action.async { implicit request =>
    ifIsAnnotationLayerOrElse(
      token,
      accessToken,
      dataLayerName,
      ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantToken) =>
        remoteTracingstoreClient
          .getZArray(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl, relevantToken)
          .map(z => Ok(Json.toJson(z))),
      orElse = annotationSource =>
        zArray(annotationSource.organizationId, annotationSource.datasetDirectoryName, dataLayerName, mag)
    )
  }

  def zarrJsonPrivateLink(token: Option[String],
                          accessToken: String,
                          dataLayerName: String,
                          mag: String): Action[AnyContent] = Action.async { implicit request =>
    ifIsAnnotationLayerOrElse(
      token,
      accessToken,
      dataLayerName,
      ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantToken) =>
        remoteTracingstoreClient
          .getZarrJson(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl, relevantToken)
          .map(z => Ok(Json.toJson(z))),
      orElse = annotationSource =>
        zarrJsonForMag(annotationSource.organizationId, annotationSource.datasetDirectoryName, dataLayerName, mag)
    )
  }

  private def ifIsAnnotationLayerOrElse(
      token: Option[String],
      accessToken: String,
      dataLayerName: String,
      ifIsAnnotationLayer: (AnnotationLayer, AnnotationSource, Option[String]) => Fox[Result],
      orElse: AnnotationSource => Fox[Result])(implicit request: Request[Any]): Fox[Result] =
    for {
      annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request)) ~> NOT_FOUND
      relevantToken = if (annotationSource.accessViaPrivateLink) Some(accessToken)
      else urlOrHeaderToken(token, request)
      layer = annotationSource.getAnnotationLayer(dataLayerName)
      result <- layer match {
        case Some(annotationLayer) => ifIsAnnotationLayer(annotationLayer, annotationSource, relevantToken)
        case None                  => orElse(annotationSource)
      }
    } yield result

  def requestDataLayerMagFolderContents(token: Option[String],
                                        organizationId: String,
                                        datasetDirectoryName: String,
                                        dataLayerName: String,
                                        mag: String,
                                        zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
        urlOrHeaderToken(token, request)) {
        dataLayerMagFolderContents(organizationId, datasetDirectoryName, dataLayerName, mag, zarrVersion)
      }
    }

  private def dataLayerMagFolderContents(organizationId: String,
                                         datasetDirectoryName: String,
                                         dataLayerName: String,
                                         mag: String,
                                         zarrVersion: Int)(implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                       datasetDirectoryName,
                                                                       dataLayerName) ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      additionalEntries = if (zarrVersion == 2) List(ZarrHeader.FILENAME_DOT_ZARRAY)
      else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
    } yield
      Ok(
        views.html.datastoreZarrDatasourceDir(
          "Datastore",
          "%s/%s/%s/%s".format(organizationId, datasetDirectoryName, dataLayerName, mag),
          additionalEntries
        )).withHeaders()

  def dataLayerMagFolderContentsPrivateLink(token: Option[String],
                                            accessToken: String,
                                            dataLayerName: String,
                                            mag: String,
                                            zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        token,
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantToken) =>
          remoteTracingstoreClient
            .getDataLayerMagFolderContents(annotationLayer.tracingId,
                                           mag,
                                           annotationSource.tracingStoreUrl,
                                           relevantToken,
                                           zarrVersion)
            .map(
              layers =>
                Ok(
                  views.html.datastoreZarrDatasourceDir(
                    "Combined Annotation Route",
                    s"${annotationLayer.tracingId}",
                    layers
                  )).withHeaders()),
        orElse = annotationSource =>
          dataLayerMagFolderContents(annotationSource.organizationId,
                                     annotationSource.datasetDirectoryName,
                                     dataLayerName,
                                     mag,
                                     zarrVersion)
      )
    }

  def requestDataLayerFolderContents(token: Option[String],
                                     organizationId: String,
                                     datasetDirectoryName: String,
                                     dataLayerName: String,
                                     zarrVersion: Int): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
      urlOrHeaderToken(token, request)) {
      dataLayerFolderContents(organizationId, datasetDirectoryName, dataLayerName, zarrVersion)
    }
  }

  private def dataLayerFolderContents(organizationId: String,
                                      datasetDirectoryName: String,
                                      dataLayerName: String,
                                      zarrVersion: Int)(implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                       datasetDirectoryName,
                                                                       dataLayerName) ?~> Messages(
        "dataSource.notFound") ~> NOT_FOUND
      mags = dataLayer.sortedMags
      additionalFiles = if (zarrVersion == 2)
        List(NgffMetadata.FILENAME_DOT_ZATTRS, NgffGroupHeader.FILENAME_DOT_ZGROUP)
      else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
    } yield
      Ok(
        views.html.datastoreZarrDatasourceDir(
          "Datastore",
          "%s/%s/%s".format(organizationId, datasetDirectoryName, dataLayerName),
          additionalFiles ++ mags.map(_.toMagLiteral(allowScalar = true))
        )).withHeaders()

  def dataLayerFolderContentsPrivateLink(token: Option[String],
                                         accessToken: String,
                                         dataLayerName: String,
                                         zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        token,
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantToken) =>
          remoteTracingstoreClient
            .getDataLayerFolderContents(annotationLayer.tracingId,
                                        annotationSource.tracingStoreUrl,
                                        relevantToken,
                                        zarrVersion)
            .map(
              layers =>
                Ok(
                  views.html.datastoreZarrDatasourceDir(
                    "Tracingstore",
                    s"${annotationLayer.tracingId}",
                    layers
                  )).withHeaders()),
        orElse = annotationSource =>
          dataLayerFolderContents(annotationSource.organizationId,
                                  annotationSource.datasetDirectoryName,
                                  dataLayerName,
                                  zarrVersion)
      )
    }

  def requestDataSourceFolderContents(token: Option[String],
                                      organizationId: String,
                                      datasetDirectoryName: String,
                                      zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
        urlOrHeaderToken(token, request)) {
        for {
          dataSource <- dataSourceRepository
            .findUsable(DataSourceId(datasetDirectoryName, organizationId))
            .toFox ?~> Messages("dataSource.notFound") ~> NOT_FOUND
          layerNames = dataSource.dataLayers.map((dataLayer: DataLayer) => dataLayer.name)
          additionalVersionDependantFiles = if (zarrVersion == 2) List(NgffGroupHeader.FILENAME_DOT_ZGROUP)
          else List.empty
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Datastore",
              s"$organizationId/$datasetDirectoryName",
              List(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON) ++ additionalVersionDependantFiles ++ layerNames
            ))
      }
    }

  def dataSourceFolderContentsPrivateLink(token: Option[String],
                                          accessToken: String,
                                          zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken, urlOrHeaderToken(token, request))
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(annotationSource.datasetDirectoryName, annotationSource.organizationId))
          .toFox ?~> Messages("dataSource.notFound") ~> NOT_FOUND
        annotationLayerNames = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume).map(_.name)
        dataSourceLayerNames = dataSource.dataLayers
          .map((dataLayer: DataLayer) => dataLayer.name)
          .filter(!annotationLayerNames.contains(_))
        layerNames = annotationLayerNames ++ dataSourceLayerNames
        additionalEntries = if (zarrVersion == 2)
          List(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON, NgffGroupHeader.FILENAME_DOT_ZGROUP)
        else
          List(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Combined datastore and tracingstore directory",
            s"$accessToken",
            additionalEntries ++ layerNames
          ))
    }

  def requestZGroup(token: Option[String],
                    organizationId: String,
                    datasetDirectoryName: String,
                    dataLayerName: String = ""): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
      urlOrHeaderToken(token, request)) {
      Ok(zGroupJson)
    }
  }

  private def zGroupJson: JsValue = Json.toJson(NgffGroupHeader(zarr_format = 2))

  def zGroupPrivateLink(token: Option[String], accessToken: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        token,
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantToken) =>
          remoteTracingstoreClient
            .getZGroup(annotationLayer.tracingId, annotationSource.tracingStoreUrl, relevantToken)
            .map(Ok(_)),
        orElse = _ => Fox.successful(Ok(zGroupJson))
      )
    }
}
