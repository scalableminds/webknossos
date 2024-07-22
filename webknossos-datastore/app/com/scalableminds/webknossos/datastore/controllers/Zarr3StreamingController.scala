package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrCoordinatesParser
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, BloscCompressor, StringCompressionSetting}
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffGroupHeader, NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{
  BloscCodecConfiguration,
  BytesCodecConfiguration,
  ChunkGridConfiguration,
  ChunkGridSpecification,
  ChunkKeyEncoding,
  ChunkKeyEncodingConfiguration,
  TransposeCodecConfiguration,
  TransposeSetting,
  Zarr3ArrayHeader
}
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, VoxelPosition, VoxelSize}
import com.scalableminds.webknossos.datastore.services._
import net.liftweb.common.Box.tryo
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc._

import scala.concurrent.ExecutionContext

class Zarr3StreamingController @Inject()(
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
          s.resolutions.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz), None, None)),
          mappings = s.mappings,
          largestSegmentId = s.largestSegmentId,
          numChannels = Some(if (s.elementClass == ElementClass.uint24) 3 else 1)
        )
      case d: DataLayer =>
        ZarrDataLayer(
          d.name,
          d.category,
          d.boundingBox,
          d.elementClass,
          d.resolutions.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz), None, None)),
          numChannels = Some(if (d.elementClass == ElementClass.uint24) 3 else 1),
          additionalAxes = None
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

  def requestRawZarr3Cube(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      rawZarr3Cube(organizationName, datasetName, dataLayerName, mag, coordinates)
    }
  }

  def rawZarrCubePrivateLink(token: Option[String],
                             accessToken: String,
                             dataLayerName: String,
                             mag: String,
                             coordinates: String): Action[AnyContent] =
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
              .getRawZarrCube(annotationLayer.tracingId,
                              mag,
                              coordinates,
                              annotationSource.tracingStoreUrl,
                              relevantToken)
              .map(Ok(_))
          case None =>
            rawZarr3Cube(annotationSource.organizationName,
                         annotationSource.datasetName,
                         dataLayerName,
                         mag,
                         coordinates)
        }
      } yield result
    }

  private def rawZarr3Cube(
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  )(implicit m: MessagesProvider): Fox[Result] =
    for {
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                datasetName,
                                                                                dataLayerName) ~> NOT_FOUND
      //  (c, x, y, z)
      parsedCoordinates <- ZarrCoordinatesParser.parseNDimensionalDotCoordinates(coordinates) ?~> "zarr.invalidChunkCoordinates" ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      _ <- bool2Fox(parsedCoordinates.head == 0) ~> "zarr.invalidFirstChunkCoord" ~> NOT_FOUND
      (x, y, z) = (parsedCoordinates(parsedCoordinates.length - 3),
                   parsedCoordinates(parsedCoordinates.length - 2),
                   parsedCoordinates(parsedCoordinates.length - 1))
      additionalCoordinates = Some(
        parsedCoordinates
          .slice(1, parsedCoordinates.length - 3)
          .zipWithIndex
          .map(coordWithIndex => new AdditionalCoordinate(name = s"t${coordWithIndex._2}", value = coordWithIndex._1))
          .toList)
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

  def requestZarrJsonForMag(token: Option[String],
                            organizationName: String,
                            datasetName: String,
                            dataLayerName: String,
                            mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      zarrJsonForMag(organizationName, datasetName, dataLayerName, mag)
    }
  }

  private def zarrJsonForMag(organizationName: String, datasetName: String, dataLayerName: String, mag: String)(
      implicit m: MessagesProvider): Fox[Result] =
    for {
      (_, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName, datasetName, dataLayerName) ?~> Messages(
        "dataSource.notFound") ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
      _ <- bool2Fox(dataLayer.containsResolution(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag) ~> NOT_FOUND
      additionalAxes = dataLayer.additionalAxes.getOrElse(Seq.empty)
      zarrHeader = Zarr3ArrayHeader(
        zarr_format = 3,
        node_type = "array",
        // channel, additional axes, XYZ
        shape = Array(1) ++ additionalAxes.map(_.highestValue).toArray ++ dataLayer.boundingBox.bottomRight.toArray,
        data_type = Left(dataLayer.elementClass.toString),
        chunk_grid = Left(
          ChunkGridSpecification(
            "regular",
            ChunkGridConfiguration(
              chunk_shape = Array.fill(1 + additionalAxes.length)(1) ++ Array(DataLayer.bucketLength,
                                                                              DataLayer.bucketLength,
                                                                              DataLayer.bucketLength))
          )),
        chunk_key_encoding =
          ChunkKeyEncoding("default", configuration = Some(ChunkKeyEncodingConfiguration(separator = Some(".")))),
        fill_value = Right(0),
        attributes = None,
        codecs = Seq(
          TransposeCodecConfiguration(TransposeSetting.fOrderFromRank(additionalAxes.length + 4)),
          BytesCodecConfiguration(Some("little")),
        ),
        storage_transformers = None,
        dimension_names = Some(Array("c") ++ additionalAxes.map(_.name).toArray ++ Seq("x", "y", "z"))
      )
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
          zarrJsonForMag(annotationSource.organizationName, annotationSource.datasetName, dataLayerName, mag)
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
