package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.layers.{WKWDataLayer, WKWSegmentationLayer}
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
    dataSourceId: DataSourceId,
    sourceName: String,
    newName: String,
    transformations: Seq[CoordinateTransformation]
)

object ComposeRequestLayer {
  implicit val composeLayerFormat: OFormat[ComposeRequestLayer] = Json.format[ComposeRequestLayer]
}

class ComposeService @Inject()(dataSourceRepository: DataSourceRepository,
                               remoteWebknossosClient: DSRemoteWebknossosClient,
                               dataSourceService: DataSourceService,
                               datasetSymlinkService: DatasetSymlinkService)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  val dataBaseDir: Path = datasetSymlinkService.dataBaseDir

  private def uploadDirectory(organizationId: String, datasetDirectoryName: String): Path =
    dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName)

  def composeDataset(composeRequest: ComposeRequest)(implicit tc: TokenContext): Fox[(DataSource, String)] =
    for {
      _ <- dataSourceService.assertDataDirWritable(composeRequest.organizationId)
      reserveUploadInfo = ReserveUploadInformation(
        "",
        composeRequest.newDatasetName,
        composeRequest.organizationId,
        1,
        None,
        None,
        List(),
        Some(composeRequest.targetFolderId)
      )
      reservedAdditionalInfo <- remoteWebknossosClient.reserveDataSourceUpload(reserveUploadInfo) ?~> "Failed to reserve upload."
      directory = uploadDirectory(composeRequest.organizationId, reservedAdditionalInfo.directoryName)
      _ = PathUtils.ensureDirectory(directory)
      dataSource <- createDatasource(composeRequest,
                                     reservedAdditionalInfo.directoryName,
                                     composeRequest.organizationId,
                                     directory)
      properties = Json.toJson(dataSource).toString().getBytes(StandardCharsets.UTF_8)
      _ = Files.write(directory.resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON), properties)
    } yield (dataSource, reservedAdditionalInfo.newDatasetId.toString)

  private def getLayerFromComposeLayer(composeLayer: ComposeRequestLayer, uploadDir: Path): Fox[DataLayer] =
    for {
      dataSource <- Fox.option2Fox(dataSourceRepository.get(composeLayer.dataSourceId))
      ds <- Fox.option2Fox(dataSource.toUsable)
      layer <- Fox.option2Fox(ds.dataLayers.find(_.name == composeLayer.sourceName))
      applyCoordinateTransformations = (cOpt: Option[List[CoordinateTransformation]]) =>
        cOpt match {
          case Some(c) => Some(c ++ composeLayer.transformations.toList)
          case None    => Some(composeLayer.transformations.toList)
      }
      linkedLayerIdentifier = LinkedLayerIdentifier(composeLayer.dataSourceId.organizationId,
                                                    composeLayer.dataSourceId.directoryName,
                                                    composeLayer.sourceName,
                                                    Some(composeLayer.newName))
      layerIsRemote = isLayerRemote(composeLayer.dataSourceId, composeLayer.sourceName)
      _ <- Fox.runIf(!layerIsRemote)(
        datasetSymlinkService.addSymlinksToOtherDatasetLayers(uploadDir, List(linkedLayerIdentifier)))
      editedLayer: DataLayer = layer match {
        case l: DataLayerWithMagLocators =>
          l.mapped(name = composeLayer.newName,
                   coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: WKWDataLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
        case l: WKWSegmentationLayer =>
          l.copy(name = composeLayer.newName,
                 coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations))
      }
    } yield editedLayer

  private def createDatasource(composeRequest: ComposeRequest,
                               datasetDirectoryName: String,
                               organizationId: String,
                               uploadDir: Path): Fox[DataSource] =
    for {
      layers <- Fox.serialCombined(composeRequest.layers.toList)(getLayerFromComposeLayer(_, uploadDir))
      dataSource = GenericDataSource(
        DataSourceId(datasetDirectoryName, organizationId),
        layers,
        composeRequest.voxelSize,
        None
      )

    } yield dataSource

  private def isLayerRemote(dataSourceId: DataSourceId, layerName: String) = {
    val layerPath =
      dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName).resolve(layerName)
    !Files.exists(layerPath)
  }
}
