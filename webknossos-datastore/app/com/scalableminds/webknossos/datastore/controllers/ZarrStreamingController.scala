package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr.{Zarr3OutputHelper, ZarrCoordinatesParser}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr.{
  NgffGroupHeader,
  NgffMetadata,
  NgffMetadataV0_5,
  ZarrHeader
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{NgffZarr3GroupHeader, Zarr3ArrayHeader}
import com.scalableminds.webknossos.datastore.helpers.UriPath
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType, AnnotationSource}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.services._
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsValue, Json}
import play.api.mvc._

import java.nio.file.Path
import scala.concurrent.ExecutionContext

class ZarrStreamingController @Inject()(
    datasetCache: DatasetCache,
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
      datasetId: ObjectId,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        omeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(dataLayerName, dataSource.scale, dataLayer.sortedMags)
      } yield Ok(Json.toJson(omeNgffHeader))
    }
  }

  def requestZarrJson(
      datasetId: ObjectId,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        omeNgffHeaderV0_5 = NgffMetadataV0_5.fromNameVoxelSizeAndMags(dataLayerName,
                                                                      dataSource.scale,
                                                                      dataLayer.sortedMags,
                                                                      dataLayer.additionalAxes)
        zarr3GroupHeader = NgffZarr3GroupHeader(3, "group", omeNgffHeaderV0_5)
      } yield Ok(Json.toJson(zarr3GroupHeader))
    }
  }

  def zAttrsWithAnnotationPrivateLink(accessToken: String, dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) => {
          remoteTracingstoreClient
            .getOmeNgffHeader(annotationLayer.tracingId, annotationSource.tracingStoreUrl)(relevantTokenContext)
            .map(ngffMetadata => Ok(Json.toJson(ngffMetadata)))
        },
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            dataSourceOmeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(dataLayerName,
                                                                            dataSource.scale,
                                                                            dataLayer.sortedMags)
          } yield Ok(Json.toJson(dataSourceOmeNgffHeader))
      )
    }

  def zarrJsonWithAnnotationPrivateLink(accessToken: String, dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) => {
          remoteTracingstoreClient
            .getZarrJsonGroupHeaderWithNgff(annotationLayer.tracingId, annotationSource.tracingStoreUrl)(
              relevantTokenContext)
            .map(header => Ok(Json.toJson(header)))
        },
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            dataSourceOmeNgffHeader = NgffMetadataV0_5.fromNameVoxelSizeAndMags(dataLayerName,
                                                                                dataSource.scale,
                                                                                dataLayer.sortedMags,
                                                                                dataLayer.additionalAxes)
            zarr3GroupHeader = NgffZarr3GroupHeader(3, "group", dataSourceOmeNgffHeader)
          } yield Ok(Json.toJson(zarr3GroupHeader))
      )
    }

  /**
    * Zarr-specific datasource-properties.json file for a datasource.
    * Note that the result here is not necessarily equal to the file used in the underlying storage.
    */
  def requestDataSource(
      datasetId: ObjectId,
      zarrVersion: Int,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        dataSource <- datasetCache.getById(datasetId) ~> NOT_FOUND
        dataLayers = dataSource.dataLayers
        zarrLayers = dataLayers.map(convertLayerToZarrLayer(_, zarrVersion))
        zarrSource = UsableDataSource(dataSource.id, zarrLayers, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }
  }

  private def convertLayerToZarrLayer(layer: DataLayer, zarrVersion: Int): StaticLayer = {
    val dataFormat = if (zarrVersion == 2) DataFormat.zarr else DataFormat.zarr3
    layer match {
      case s: SegmentationLayer =>
        val rank = s.additionalAxes.map(_.length).getOrElse(0) + 4 // We’re writing c, additionalAxes, xyz
        StaticSegmentationLayer(
          s.name,
          dataFormat,
          s.boundingBox,
          s.elementClass,
          mags = s.sortedMags.map(
            m =>
              MagLocator(m,
                         Some(UriPath.fromLocalPath(Path.of(s"./${s.name}/${m.toMagLiteral(allowScalar = true)}"))),
                         None,
                         Some(AxisOrder.cAdditionalxyz(rank)),
                         None,
                         None)),
          mappings = s.mappings,
          largestSegmentId = s.largestSegmentId,
          defaultViewConfiguration = s.defaultViewConfiguration,
          adminViewConfiguration = s.adminViewConfiguration,
          coordinateTransformations = s.coordinateTransformations,
          additionalAxes = s.additionalAxes.map(reorderAdditionalAxes)
        )
      case d: DataLayer =>
        val rank = d.additionalAxes.map(_.length).getOrElse(0) + 4 // We’re writing c, additionalAxes, xyz
        StaticColorLayer(
          d.name,
          dataFormat,
          d.boundingBox,
          d.elementClass,
          mags = d.sortedMags.map(
            m =>
              MagLocator(m,
                         Some(UriPath.fromLocalPath(Path.of(s"./${d.name}/${m.toMagLiteral(allowScalar = true)}"))),
                         None,
                         Some(AxisOrder.cAdditionalxyz(rank)),
                         None,
                         None)),
          defaultViewConfiguration = d.defaultViewConfiguration,
          adminViewConfiguration = d.adminViewConfiguration,
          coordinateTransformations = d.coordinateTransformations,
          additionalAxes = d.additionalAxes.map(reorderAdditionalAxes)
        )
    }
  }

  def dataSourceWithAnnotationPrivateLink(accessToken: String, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND
        relevantTokenContext = if (annotationSource.accessViaPrivateLink) TokenContext(Some(accessToken))
        else tokenContextForRequest
        volumeAnnotationLayers = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
        dataSource <- datasetCache.getById(annotationSource.datasetId) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
        dataSourceLayers = dataSource.dataLayers
          .filter(dL => !volumeAnnotationLayers.exists(_.name == dL.name))
          .map(convertLayerToZarrLayer(_, zarrVersion))
        annotationLayers <- Fox.serialCombined(volumeAnnotationLayers)(
          l =>
            remoteTracingstoreClient.getVolumeLayerAsZarrLayer(l.tracingId,
                                                               Some(l.name),
                                                               annotationSource.tracingStoreUrl,
                                                               zarrVersion)(relevantTokenContext))
        allLayer = dataSourceLayers ++ annotationLayers
        zarrSource = UsableDataSource(dataSource.id, allLayer, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }

  def requestRawZarrCube(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      rawZarrCube(datasetId, dataLayerName, mag, coordinates)
    }
  }

  def rawZarrCubePrivateLink(accessToken: String,
                             dataLayerName: String,
                             mag: String,
                             coordinates: String): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getRawZarrCube(annotationLayer.tracingId, mag, coordinates, annotationSource.tracingStoreUrl)(
              relevantTokenContext)
            .map(Ok(_)),
        orElse = annotationSource => rawZarrCube(annotationSource.datasetId, dataLayerName, mag, coordinates)
      )
    }

  private def rawZarrCube(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  )(implicit m: MessagesProvider, tc: TokenContext): Fox[Result] =
    for {
      (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> SERVICE_UNAVAILABLE
      reorderedAdditionalAxes = dataLayer.additionalAxes.map(reorderAdditionalAxes)
      (x, y, z, additionalCoordinates) <- ZarrCoordinatesParser.parseNDimensionalDotCoordinates(
        coordinates,
        reorderedAdditionalAxes) ?~> "zarr.invalidChunkCoordinates" ~> NOT_FOUND
      magParsed <- Vec3Int
        .fromMagLiteral(mag, allowScalar = true)
        .toFox ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- Fox.fromBool(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      cubeSize = DataLayer.bucketLength
      request = DataServiceDataRequest(
        Some(dataSource.id),
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
      _ <- Fox.fromBool(notFoundIndices.isEmpty) ~> "zarr.chunkNotFound" ~> NOT_FOUND
    } yield Ok(data)

  def requestZArray(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      zArray(datasetId, dataLayerName, mag)
    }
  }

  private def zArray(datasetId: ObjectId, dataLayerName: String, mag: String)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
      magParsed <- Vec3Int
        .fromMagLiteral(mag, allowScalar = true)
        .toFox ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- Fox.fromBool(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      zarrHeader = ZarrHeader.fromLayer(dataLayer, magParsed)
    } yield Ok(Json.toJson(zarrHeader))

  def requestZarrJsonForMag(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      zarrJsonForMag(datasetId, dataLayerName, mag)
    }
  }

  private def zarrJsonForMag(datasetId: ObjectId, dataLayerName: String, mag: String)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
      magParsed <- Vec3Int
        .fromMagLiteral(mag, allowScalar = true)
        .toFox ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- Fox.fromBool(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      zarrHeader = Zarr3ArrayHeader.fromDataLayer(dataLayer, magParsed)
    } yield Ok(Json.toJson(zarrHeader))

  def zArrayPrivateLink(accessToken: String, dataLayerName: String, mag: String): Action[AnyContent] = Action.async {
    implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZArray(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl)(relevantTokenContext)
            .map(z => Ok(Json.toJson(z))),
        orElse = annotationSource => zArray(annotationSource.datasetId, dataLayerName, mag)
      )
  }

  def zarrJsonPrivateLink(accessToken: String, dataLayerName: String, mag: String): Action[AnyContent] = Action.async {
    implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZarrJson(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl)(relevantTokenContext)
            .map(z => Ok(Json.toJson(z))),
        orElse = annotationSource => zarrJsonForMag(annotationSource.datasetId, dataLayerName, mag)
      )
  }

  private def ifIsAnnotationLayerOrElse(
      accessToken: String,
      dataLayerName: String,
      ifIsAnnotationLayer: (AnnotationLayer, AnnotationSource, TokenContext) => Fox[Result],
      orElse: AnnotationSource => Fox[Result])(implicit request: Request[Any]): Fox[Result] =
    for {
      annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND
      relevantTokenContext = if (annotationSource.accessViaPrivateLink) TokenContext(Some(accessToken))
      else tokenContextForRequest
      layer = annotationSource.getAnnotationLayer(dataLayerName)
      result <- layer match {
        case Some(annotationLayer) => ifIsAnnotationLayer(annotationLayer, annotationSource, relevantTokenContext)
        case None                  => orElse(annotationSource)
      }
    } yield result

  def requestDataLayerMagDirectoryContents(datasetId: ObjectId,
                                           dataLayerName: String,
                                           mag: String,
                                           zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        dataLayerMagDirectoryContents(datasetId, dataLayerName, mag, zarrVersion)
      }
    }

  private def dataLayerMagDirectoryContents(datasetId: ObjectId, dataLayerName: String, mag: String, zarrVersion: Int)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
      magParsed <- Vec3Int
        .fromMagLiteral(mag, allowScalar = true)
        .toFox ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- Fox.fromBool(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      additionalEntries = if (zarrVersion == 2) List(ZarrHeader.FILENAME_DOT_ZARRAY)
      else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
    } yield
      Ok(
        views.html.datastoreZarrDatasourceDir(
          "Datastore",
          "%s/%s/%s".format(datasetId, dataLayerName, mag),
          additionalEntries
        )).withHeaders()

  def dataLayerMagDirectoryContentsPrivateLink(accessToken: String,
                                               dataLayerName: String,
                                               mag: String,
                                               zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getDataLayerMagDirectoryContents(annotationLayer.tracingId,
                                              mag,
                                              annotationSource.tracingStoreUrl,
                                              zarrVersion)(relevantTokenContext)
            .map(
              layers =>
                Ok(
                  views.html.datastoreZarrDatasourceDir(
                    "Combined Annotation Route",
                    s"${annotationLayer.tracingId}",
                    layers
                  )).withHeaders()),
        orElse =
          annotationSource => dataLayerMagDirectoryContents(annotationSource.datasetId, dataLayerName, mag, zarrVersion)
      )
    }

  def requestDataLayerDirectoryContents(datasetId: ObjectId,
                                        dataLayerName: String,
                                        zarrVersion: Int): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      dataLayerDirectoryContents(datasetId, dataLayerName, zarrVersion)
    }
  }

  private def dataLayerDirectoryContents(datasetId: ObjectId, dataLayerName: String, zarrVersion: Int)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
      mags = dataLayer.sortedMags
      additionalFiles = if (zarrVersion == 2)
        List(NgffMetadata.FILENAME_DOT_ZATTRS, NgffGroupHeader.FILENAME_DOT_ZGROUP)
      else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
    } yield
      Ok(
        views.html.datastoreZarrDatasourceDir(
          "Datastore",
          "%s/%s".format(datasetId, dataLayerName),
          additionalFiles ++ mags.map(_.toMagLiteral(allowScalar = true))
        )).withHeaders()

  def dataLayerDirectoryContentsPrivateLink(accessToken: String,
                                            dataLayerName: String,
                                            zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getDataLayerDirectoryContents(annotationLayer.tracingId, annotationSource.tracingStoreUrl, zarrVersion)(
              relevantTokenContext)
            .map(
              layers =>
                Ok(
                  views.html.datastoreZarrDatasourceDir(
                    "Tracingstore",
                    s"${annotationLayer.tracingId}",
                    layers
                  )).withHeaders()),
        orElse = annotationSource => dataLayerDirectoryContents(annotationSource.datasetId, dataLayerName, zarrVersion)
      )
    }

  def requestDataSourceDirectoryContents(datasetId: ObjectId, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          dataSource <- datasetCache.getById(datasetId) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
          layerNames = dataSource.dataLayers.map((dataLayer: DataLayer) => dataLayer.name)
          additionalVersionDependantFiles = if (zarrVersion == 2) List(NgffGroupHeader.FILENAME_DOT_ZGROUP)
          else List.empty
        } yield
          Ok(views.html.datastoreZarrDatasourceDir(
            "Datastore",
            s"$datasetId",
            List(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON) ++ additionalVersionDependantFiles ++ layerNames
          ))
      }
    }

  def dataSourceDirectoryContentsPrivateLink(accessToken: String, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken)
        dataSource <- datasetCache.getById(annotationSource.datasetId) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
        annotationLayerNames = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume).map(_.name)
        dataSourceLayerNames = dataSource.dataLayers
          .map((dataLayer: DataLayer) => dataLayer.name)
          .filter(!annotationLayerNames.contains(_))
        layerNames = annotationLayerNames ++ dataSourceLayerNames
        additionalEntries = if (zarrVersion == 2)
          List(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON, NgffGroupHeader.FILENAME_DOT_ZGROUP)
        else
          List(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Combined datastore and tracingstore directory",
            s"$accessToken",
            additionalEntries ++ layerNames
          ))
    }

  def requestZGroup(datasetId: ObjectId, dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContextForSyncBlock(UserAccessRequest.readDataset(datasetId)) {
        Ok(zGroupJson)
      }
    }

  private def zGroupJson: JsValue = Json.toJson(NgffGroupHeader(zarr_format = 2))

  def zGroupPrivateLink(accessToken: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZGroup(annotationLayer.tracingId, annotationSource.tracingStoreUrl)(relevantTokenContext)
            .map(Ok(_)),
        orElse = _ => Fox.successful(Ok(zGroupJson))
      )
    }
}
