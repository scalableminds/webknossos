package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.layers.{
  N5DataLayer,
  N5SegmentationLayer,
  PrecomputedDataLayer,
  PrecomputedSegmentationLayer,
  WKWDataLayer,
  WKWSegmentationLayer,
  Zarr3DataLayer,
  Zarr3SegmentationLayer,
  ZarrDataLayer,
  ZarrSegmentationLayer
}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.services.{
  DSRemoteWebknossosClient,
  DataSourceRepository,
  DataSourceService
}
import play.api.libs.json.{Json, OFormat}

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class ComposeRequest(
    newDatasetName: String,
    targetFolderId: String,
    organizationId: String,
    voxelSize: VoxelSize,
    layers: Seq[ComposeRequestLayer]
)

object ComposeRequest {
  implicit val composeRequestFormat: OFormat[ComposeRequest] = Json.format[ComposeRequest]
}
case class ComposeRequestLayer(
    datasetId: DataLayerId,
    sourceName: String,
    newName: String,
    transformations: Seq[CoordinateTransformation]
)

object ComposeRequestLayer {
  implicit val composeLayerFormat: OFormat[ComposeRequestLayer] = Json.format[ComposeRequestLayer]
}

case class DataLayerId(name: String, owningOrganization: String)

object DataLayerId {
  implicit val dataLayerIdFormat: OFormat[DataLayerId] = Json.format[DataLayerId]
}

class ComposeService @Inject()(dataSourceRepository: DataSourceRepository,
                               remoteWebknossosClient: DSRemoteWebknossosClient,
                               dataSourceService: DataSourceService,
                               datasetSymlinkService: DatasetSymlinkService)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  val dataBaseDir: Path = datasetSymlinkService.dataBaseDir

  private def uploadDirectory(organizationId: String, name: String): Path =
    dataBaseDir.resolve(organizationId).resolve(name)

  def composeDataset(composeRequest: ComposeRequest, userToken: Option[String]): Fox[DataSource] =
    for {
      _ <- dataSourceService.assertDataDirWritable(composeRequest.organizationId)
      reserveUploadInfo = ReserveUploadInformation("",
                                                   composeRequest.newDatasetName,
                                                   composeRequest.organizationId,
                                                   1,
                                                   None,
                                                   None,
                                                   List(),
                                                   Some(composeRequest.targetFolderId))
      _ <- remoteWebknossosClient.reserveDataSourceUpload(reserveUploadInfo, userToken) ?~> "Failed to reserve upload."
      directory = uploadDirectory(composeRequest.organizationId, composeRequest.newDatasetName)
      _ = PathUtils.ensureDirectory(directory)
      dataSource <- createDatasource(composeRequest, composeRequest.organizationId)
      properties = Json.toJson(dataSource).toString().getBytes(StandardCharsets.UTF_8)
      _ = Files.write(directory.resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON), properties)
    } yield dataSource

  private def getLayerFromComposeLayer(composeLayer: ComposeRequestLayer, uploadDir: Path): Fox[DataLayer] =
    for {
      dataSourceId <- Fox.successful(
        DataSourceId(composeLayer.datasetId.name, composeLayer.datasetId.owningOrganization))
      dataSource <- Fox.option2Fox(dataSourceRepository.find(dataSourceId))
      ds <- Fox.option2Fox(dataSource.toUsable)
      layer <- Fox.option2Fox(ds.dataLayers.find(_.name == composeLayer.sourceName))
      applyCoordinateTransformations = (cOpt: Option[List[CoordinateTransformation]]) =>
        cOpt match {
          case Some(c) => Some(c ++ composeLayer.transformations.toList)
          case None    => Some(composeLayer.transformations.toList)
      }
      linkedLayerIdentifier = LinkedLayerIdentifier(composeLayer.datasetId.owningOrganization,
                                                    composeLayer.datasetId.name,
                                                    composeLayer.sourceName,
                                                    Some(composeLayer.newName))
      layerIsRemote = isLayerRemote(dataSourceId, composeLayer.sourceName)
      _ <- Fox.runIf(!layerIsRemote)(
        datasetSymlinkService.addSymlinksToOtherDatasetLayers(uploadDir, List(linkedLayerIdentifier)))
      editedLayer: DataLayer = layer match {
        case l: PrecomputedDataLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: PrecomputedSegmentationLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: ZarrDataLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: ZarrSegmentationLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: N5DataLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: N5SegmentationLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: Zarr3DataLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: Zarr3SegmentationLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: WKWDataLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: WKWSegmentationLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
      }
    } yield editedLayer

  private def createDatasource(composeRequest: ComposeRequest, organizationId: String): Fox[DataSource] = {
    val uploadDir = uploadDirectory(organizationId, composeRequest.newDatasetName)
    for {
      layers <- Fox.serialCombined(composeRequest.layers.toList)(getLayerFromComposeLayer(_, uploadDir))
      dataSource = GenericDataSource(
        DataSourceId(composeRequest.newDatasetName, organizationId),
        layers,
        composeRequest.voxelSize,
        None
      )

    } yield dataSource
  }

  private def isLayerRemote(dataSourceId: DataSourceId, layerName: String) = {
    val layerPath = dataBaseDir.resolve(dataSourceId.team).resolve(dataSourceId.name).resolve(layerName)
    !Files.exists(layerPath)
  }
}
