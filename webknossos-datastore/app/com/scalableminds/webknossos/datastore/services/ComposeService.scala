package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.n5.{N5DataLayer, N5SegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.precomputed.{
  PrecomputedDataLayer,
  PrecomputedSegmentationLayer
}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.{ZarrDataLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr3.{Zarr3DataLayer, Zarr3SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.datasource.{
  CoordinateTransformation,
  DataLayer,
  DataSource,
  DataSourceId,
  GenericDataSource
}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{Json, OFormat}

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class ComposeRequest(
    newDatasetName: String,
    targetFolderId: String,
    dataStoreHost: String,
    organizationName: String,
    scale: Vec3Double,
    layers: Seq[ComposeLayer]
)

object ComposeRequest {
  implicit val composeRequestFormat: OFormat[ComposeRequest] = Json.format[ComposeRequest]
}
case class ComposeLayer(
    id: DataSourceId,
    sourceName: String,
    newName: String,
    transformations: Seq[CoordinateTransformation]
)

object ComposeLayer {
  implicit val composeLayerFormat: OFormat[ComposeLayer] = Json.format[ComposeLayer]
}

class SymlinkHelper(dataSourceService: DataSourceService)(implicit ec: ExecutionContext) extends FoxImplicits {

  val dataBaseDir: Path = dataSourceService.dataBaseDir
  def addSymlinksToOtherDatasetLayers(dataSetDir: Path, layersToLink: List[LinkedLayerIdentifier]): Fox[Unit] =
    Fox
      .serialCombined(layersToLink) { layerToLink =>
        val layerPath = layerToLink.pathIn(dataBaseDir)
        val newLayerPath = dataSetDir.resolve(layerToLink.newLayerName.getOrElse(layerToLink.layerName))
        for {
          _ <- bool2Fox(!Files.exists(newLayerPath)) ?~> s"Cannot symlink layer at $newLayerPath: a layer with this name already exists."
          _ <- bool2Fox(Files.exists(layerPath)) ?~> s"Cannot symlink to layer at $layerPath: The layer does not exist."
          _ <- tryo {
            Files.createSymbolicLink(newLayerPath, newLayerPath.getParent.relativize(layerPath))
          } ?~> s"Failed to create symlink at $newLayerPath."
        } yield ()
      }
      .map { _ =>
        ()
      }
}

class ComposeService @Inject()(dataSourceRepository: DataSourceRepository,
                               dataSourceService: DataSourceService,
                               remoteWebKnossosClient: DSRemoteWebKnossosClient)(implicit ec: ExecutionContext)
    extends SymlinkHelper(dataSourceService)(ec)
    with FoxImplicits {

  private def uploadDirectory(organizationName: String, name: String): Path =
    dataBaseDir.resolve(organizationName).resolve(name)

  def composeDataset(composeRequest: ComposeRequest, userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.bool2Fox(Files.isWritable(dataBaseDir)) ?~> "Datastore can not write to its data directory."
      reserveUploadInfo = ReserveUploadInformation("",
                                                   composeRequest.newDatasetName,
                                                   composeRequest.organizationName,
                                                   1,
                                                   None,
                                                   List(),
                                                   Some(composeRequest.targetFolderId))
      _ <- remoteWebKnossosClient.reserveDataSourceUpload(reserveUploadInfo, userToken) ?~> "Failed to reserve upload."
      directory = uploadDirectory(composeRequest.organizationName, composeRequest.newDatasetName)
      _ = PathUtils.ensureDirectory(directory)
      dataSource <- createDatasource(composeRequest, composeRequest.organizationName)
      properties = Json.toJson(dataSource).toString().getBytes(StandardCharsets.UTF_8)
      _ = Files.write(directory.resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON), properties)
    } yield ()

  private def getLayerFromComposeLayer(composeLayer: ComposeLayer, uploadDir: Path): Fox[DataLayer] =
    for {
      dataSource <- Fox.option2Fox(dataSourceRepository.find(composeLayer.id))
      ds <- Fox.option2Fox(dataSource.toUsable)
      layer <- Fox.option2Fox(ds.dataLayers.find(_.name == composeLayer.sourceName))
      applyCoordinateTransformations = (cOpt: Option[List[CoordinateTransformation]]) =>
        cOpt match {
          case Some(c) => Some(c ++ composeLayer.transformations.toList)
          case None    => Some(composeLayer.transformations.toList)
      }
      linkedLayerIdentifier = LinkedLayerIdentifier(composeLayer.id.team,
                                                    composeLayer.id.name,
                                                    composeLayer.sourceName,
                                                    Some(composeLayer.newName))
      layerIsRemote = isLayerRemote(composeLayer.id, composeLayer.sourceName)
      _ <- Fox.runIf(!layerIsRemote)(addSymlinksToOtherDatasetLayers(uploadDir, List(linkedLayerIdentifier)))
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

  private def createDatasource(composeRequest: ComposeRequest, organizationName: String): Fox[DataSource] = {
    val uploadDir = uploadDirectory(organizationName, composeRequest.newDatasetName)
    for {
      layers <- Fox.serialCombined(composeRequest.layers.toList)(getLayerFromComposeLayer(_, uploadDir))
      dataSource = GenericDataSource(
        DataSourceId(composeRequest.newDatasetName, organizationName),
        layers,
        composeRequest.scale,
        None
      )

    } yield dataSource
  }

  private def isLayerRemote(dataSourceId: DataSourceId, layerName: String) = {
    val layerPath = dataBaseDir.resolve(dataSourceId.team).resolve(dataSourceId.name).resolve(layerName)
    !Files.exists(layerPath)
  }
}
