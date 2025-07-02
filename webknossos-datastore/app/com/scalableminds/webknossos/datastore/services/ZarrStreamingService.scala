package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.{Zarr3OutputHelper, ZarrCoordinatesParser}
import com.scalableminds.webknossos.datastore.datareaders.zarr._
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{NgffZarr3GroupHeader, Zarr3ArrayHeader}
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests._
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsValue, Json}

import scala.concurrent.ExecutionContext
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder

class ZarrStreamingService @Inject()(
    dataSourceRepository: DataSourceRepository,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    remoteTracingstoreClient: DSRemoteTracingstoreClient,
)(implicit ec: ExecutionContext)
    extends Zarr3OutputHelper
    with FoxImplicits {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService

  def getHeader(
      dataSource: DataSource,
      dataLayer: DataLayer,
  ): NgffMetadata =
    NgffMetadata.fromNameVoxelSizeAndMags(dataLayer.name, dataSource.scale, dataLayer.sortedMags)

  def getGroupHeader(
      dataSource: DataSource,
      dataLayer: DataLayer
  ): NgffZarr3GroupHeader = {
    val omeNgffHeaderV0_5 = NgffMetadataV0_5.fromNameVoxelSizeAndMags(dataLayer.name,
                                                                      dataSource.scale,
                                                                      dataLayer.sortedMags,
                                                                      dataLayer.additionalAxes)

    val zarr3GroupHeader = NgffZarr3GroupHeader(3, "group", omeNgffHeaderV0_5)
    zarr3GroupHeader
  }

  def zGroupJson: JsValue = Json.toJson(NgffGroupHeader(zarr_format = 2))

  def getZarrDataSource(
      dataSource: DataSource,
      zarrVersion: Int
  ): DataSource = {
    val dataLayers = dataSource.dataLayers
    val zarrLayers = dataLayers.map(convertLayerToZarrLayer(_, zarrVersion))
    val zarrSource = GenericDataSource[DataLayer](dataSource.id, zarrLayers, dataSource.scale)
    zarrSource
  }

  private def convertLayerToZarrLayer(layer: DataLayer, zarrVersion: Int): ZarrLayer = {
    val dataFormat = if (zarrVersion == 2) DataFormat.zarr else DataFormat.zarr3
    layer match {
      case s: SegmentationLayer =>
        val rank = s.additionalAxes.map(_.length).getOrElse(0) + 4
        ZarrSegmentationLayer(
          s.name,
          s.boundingBox,
          s.elementClass,
          mags = s.sortedMags.map(
            m =>
              MagLocator(m,
                         Some(s"./${s.name}/${m.toMagLiteral(allowScalar = true)}"),
                         None,
                         Some(AxisOrder.cAdditionalxyz(rank)),
                         None,
                         None)),
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
        val rank = d.additionalAxes.map(_.length).getOrElse(0) + 4
        ZarrDataLayer(
          d.name,
          d.category,
          d.boundingBox,
          d.elementClass,
          mags = d.sortedMags.map(
            m =>
              MagLocator(m,
                         Some(s"./${d.name}/${m.toMagLiteral(allowScalar = true)}"),
                         None,
                         Some(AxisOrder.cAdditionalxyz(rank)),
                         None,
                         None)),
          numChannels = Some(if (d.elementClass == ElementClass.uint24) 3 else 1),
          defaultViewConfiguration = d.defaultViewConfiguration,
          adminViewConfiguration = d.adminViewConfiguration,
          coordinateTransformations = d.coordinateTransformations,
          additionalAxes = d.additionalAxes.map(reorderAdditionalAxes),
          dataFormat = dataFormat
        )
    }
  }

  def rawZarrCube(
      dataSource: DataSource,
      dataLayer: DataLayer,
      mag: String,
      coordinates: String
  )(implicit m: MessagesProvider, tc: TokenContext): Fox[Array[Byte]] =
    for {
      _ <- Fox.successful(())
      reorderedAdditionalAxes = dataLayer.additionalAxes.map(reorderAdditionalAxes)
      (x, y, z, additionalCoordinates) <- ZarrCoordinatesParser.parseNDimensionalDotCoordinates(
        coordinates,
        reorderedAdditionalAxes) ?~> "zarr.invalidChunkCoordinates"
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Messages("dataLayer.invalidMag", mag)
      dataLayerName = dataLayer.name
      _ <- Fox.fromBool(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag)
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
      _ <- Fox.fromBool(notFoundIndices.isEmpty) ~> "zarr.chunkNotFound"
    } yield data

  def getZArray(
      dataLayer: DataLayer,
      mag: String
  )(implicit m: MessagesProvider): Fox[ZarrHeader] =
    for {
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Messages("dataLayer.invalidMag", mag)
      dataLayerName = dataLayer.name
      _ <- Fox.fromBool(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag)
    } yield ZarrHeader.fromLayer(dataLayer, magParsed)

  def requestZarrJsonForMag(
      dataSource: DataSource,
      dataLayer: DataLayer,
      mag: String
  )(implicit m: MessagesProvider): Fox[Zarr3ArrayHeader] =
    for {
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Messages("dataLayer.invalidMag", mag)
      dataLayerName = dataLayer.name
      _ <- Fox.fromBool(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag)
      zarrHeader = Zarr3ArrayHeader.fromDataLayer(dataLayer, magParsed)
    } yield zarrHeader

  def dataLayerDirectoryContents(
      dataSource: DataSource,
      dataLayer: DataLayer,
      zarrVersion: Int
  )(implicit m: MessagesProvider): Fox[List[String]] =
    for {
      _ <- Fox.successful(())
      mags = dataLayer.sortedMags
      additionalFiles = if (zarrVersion == 2)
        List(NgffMetadata.FILENAME_DOT_ZATTRS, NgffGroupHeader.FILENAME_DOT_ZGROUP)
      else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
    } yield (additionalFiles ++ mags.map(_.toMagLiteral(allowScalar = true)))

  def dataLayerMagDirectoryContents(
      dataSource: DataSource,
      dataLayer: DataLayer,
      mag: String,
      zarrVersion: Int
  )(implicit m: MessagesProvider): Fox[List[String]] =
    for {
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Messages("dataLayer.invalidMag", mag)
      dataLayerName = dataLayer.name
      _ <- Fox.fromBool(dataLayer.containsMag(magParsed)) ?~> Messages("dataLayer.wrongMag", dataLayerName, mag)
      additionalEntries = if (zarrVersion == 2) List(ZarrHeader.FILENAME_DOT_ZARRAY)
      else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
    } yield additionalEntries

  def dataSourceDirectoryContents(
      dataSource: DataSource,
      zarrVersion: Int
  ): Fox[List[String]] =
    for {
      _ <- Fox.successful(())
      layerNames = dataSource.dataLayers.map((dataLayer: DataLayer) => dataLayer.name)
      additionalVersionDependantFiles = if (zarrVersion == 2) List(NgffGroupHeader.FILENAME_DOT_ZGROUP)
      else List.empty
    } yield (layerNames ++ additionalVersionDependantFiles)

  def dataSourceDirectoryContentsPrivateLink(accessToken: String, zarrVersion: Int)(
      implicit tc: TokenContext): Fox[List[String]] =
    for {
      annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken)
      dataSource <- dataSourceRepository // TODO: Use datasetcache here
        .findUsable(DataSourceId(annotationSource.datasetDirectoryName, annotationSource.organizationId))
        .toFox
      annotationLayerNames = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume).map(_.name)
      dataSourceLayerNames = dataSource.dataLayers
        .map((dataLayer: DataLayer) => dataLayer.name)
        .filter(!annotationLayerNames.contains(_))
      layerNames = annotationLayerNames ++ dataSourceLayerNames
      additionalEntries = if (zarrVersion == 2)
        List(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON, NgffGroupHeader.FILENAME_DOT_ZGROUP)
      else
        List(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
    } yield additionalEntries ++ layerNames

}
