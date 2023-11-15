package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrDataLayer
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, DataSourceId, GenericDataSource}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.Json

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters.IteratorHasAsScala

class ExploreLocalLayerService @Inject()(dataVaultService: DataVaultService)
    extends ExploreLayerService
    with FoxImplicits {

  def exploreLocal(path: Path, dataSourceId: DataSourceId, layerDirectory: String = "color")(
      implicit ec: ExecutionContext): Fox[DataSource] =
    for {
      _ <- Fox.successful(())
      explored = Seq(
        exploreLocalNgffArray(path, dataSourceId),
        exploreLocalZarrArray(path, dataSourceId, layerDirectory)
      )
      dataSource <- Fox.firstSuccess(explored) ?~> "Could not explore local data source"
    } yield dataSource

  private def exploreLocalZarrArray(path: Path, dataSourceId: DataSourceId, layerDirectory: String)(
      implicit ec: ExecutionContext): Fox[DataSource] =
    for {
      magDirectories <- tryo(Files.list(path.resolve(layerDirectory)).iterator().asScala.toList).toFox ?~> s"Could not resolve color directory as child of $path"
      layersWithVoxelSizes <- Fox.combined(magDirectories.map(dir =>
        for {
          remoteSourceDescriptor <- Fox.successful(RemoteSourceDescriptor(dir.toUri, None))
          mag <- Fox
            .option2Fox(Vec3Int.fromMagLiteral(dir.getFileName.toString, allowScalar = true)) ?~> s"invalid mag: ${dir.getFileName}"
          vaultPath <- dataVaultService.getVaultPath(remoteSourceDescriptor) ?~> "dataVault.setup.failed"
          layersWithVoxelSizes <- (new ZarrArrayExplorer(mag, ec)).explore(vaultPath, None)
        } yield layersWithVoxelSizes))
      (layers, voxelSize) <- adaptLayersAndVoxelSize(layersWithVoxelSizes.flatten, None)
      zarrLayers = layers.map(_.asInstanceOf[ZarrDataLayer])
      relativeLayers = makePathsRelative(zarrLayers).toList
      dataSource = new DataSource(dataSourceId, relativeLayers, voxelSize)
    } yield dataSource

  private def exploreLocalNgffArray(path: Path, dataSourceId: DataSourceId)(
      implicit ec: ExecutionContext): Fox[DataSource] =
    for {
      remoteSourceDescriptor <- Fox.successful(RemoteSourceDescriptor(path.toUri, None))
      vaultPath <- dataVaultService.getVaultPath(remoteSourceDescriptor) ?~> "dataVault.setup.failed"
      layersWithVoxelSizes <- (new NgffExplorer).explore(vaultPath, None)
      (layers, voxelSize) <- adaptLayersAndVoxelSize(layersWithVoxelSizes, None)
      zarrLayers = layers.map(_.asInstanceOf[ZarrDataLayer])
      relativeLayers = makePathsRelative(zarrLayers).toList
      dataSource = new DataSource(dataSourceId, relativeLayers, voxelSize)
    } yield dataSource

  private def makePathsRelative(layers: Seq[ZarrDataLayer]): Seq[DataLayer] =
    layers.map(l => l.copy(mags = l.mags.map(m => m.copy(path = m.path.map(_.split("/").takeRight(2).mkString("/"))))))

  def writeLocalDatasourceProperties(dataSource: DataSource, path: Path)(implicit ec: ExecutionContext): Fox[Path] =
    tryo {
      val properties = Json.toJson(dataSource).toString().getBytes(StandardCharsets.UTF_8)
      Files.write(path.resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON), properties)
    }.toFox
}
