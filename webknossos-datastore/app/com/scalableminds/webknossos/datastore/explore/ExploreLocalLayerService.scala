package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.n5.{N5DataLayer, N5SegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.precomputed.{
  PrecomputedDataLayer,
  PrecomputedSegmentationLayer
}
import com.scalableminds.webknossos.datastore.dataformats.zarr.{ZarrDataLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, DataSourceId, GenericDataSource}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import net.liftweb.common.Box.tryo
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
        exploreLocalZarrArray(path, dataSourceId, layerDirectory),
        exploreLocalNeuroglancerPrecomputed(path, dataSourceId, layerDirectory),
        exploreLocalN5Multiscales(path, dataSourceId, layerDirectory)
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
      relativeLayers = layers.map {
        case l: ZarrDataLayer         => makeZarrDataLayerPathRelative(l)
        case l: ZarrSegmentationLayer => makeZarrSegmentationLayerPathRelative(l)
      }
      dataSource = new DataSource(dataSourceId, relativeLayers, voxelSize)
    } yield dataSource

  private def exploreLocalNgffArray(path: Path, dataSourceId: DataSourceId)(
      implicit ec: ExecutionContext): Fox[DataSource] =
    exploreLocalLayer(
      layers =>
        layers.map {
          case l: ZarrDataLayer => makeZarrDataLayerPathRelative(l)
          case l: ZarrSegmentationLayer =>
            makeZarrSegmentationLayerPathRelative(l)
      },
      new NgffExplorer
    )(path, dataSourceId, "")

  private def exploreLocalNeuroglancerPrecomputed(path: Path, dataSourceId: DataSourceId, layerDirectory: String)(
      implicit ec: ExecutionContext): Fox[DataSource] =
    exploreLocalLayer(
      layers =>
        layers.map {
          case l: PrecomputedDataLayer => l.copy(mags = l.mags.map(m => m.copy(path = m.path.map(_.split("/").last))))
          case l: PrecomputedSegmentationLayer =>
            l.copy(mags = l.mags.map(m => m.copy(path = m.path.map(_.split("/").last))))
      },
      new PrecomputedExplorer
    )(path, dataSourceId, layerDirectory)

  private def exploreLocalN5Multiscales(path: Path, dataSourceId: DataSourceId, layerDirectory: String)(
      implicit ec: ExecutionContext): Fox[DataSource] =
    exploreLocalLayer(
      layers =>
        layers.map {
          case l: N5DataLayer         => l.copy(mags = l.mags.map(m => m.copy(path = m.path.map(_.split("/").last))))
          case l: N5SegmentationLayer => l.copy(mags = l.mags.map(m => m.copy(path = m.path.map(_.split("/").last))))
      },
      new N5MultiscalesExplorer
    )(path, dataSourceId, layerDirectory)

  private def exploreLocalLayer(makeLayersRelative: List[DataLayer] => List[DataLayer], explorer: RemoteLayerExplorer)(
      path: Path,
      dataSourceId: DataSourceId,
      layerDirectory: String)(implicit ec: ExecutionContext): Fox[DataSource] =
    for {
      fullPath <- Fox.successful(path.resolve(layerDirectory))
      remoteSourceDescriptor <- Fox.successful(RemoteSourceDescriptor(fullPath.toUri, None))
      vaultPath <- dataVaultService.getVaultPath(remoteSourceDescriptor) ?~> "dataVault.setup.failed"
      layersWithVoxelSizes <- explorer.explore(vaultPath, None)
      (layers, voxelSize) <- adaptLayersAndVoxelSize(layersWithVoxelSizes, None)
      relativeLayers = makeLayersRelative(layers)
      dataSource = new DataSource(dataSourceId, relativeLayers, voxelSize)
    } yield dataSource

  private def makeZarrDataLayerPathRelative(layer: ZarrDataLayer): DataLayer =
    layer.copy(mags = layer.mags.map(m => m.copy(path = m.path.map(_.split("/").takeRight(2).mkString("/")))))

  private def makeZarrSegmentationLayerPathRelative(layer: ZarrSegmentationLayer): DataLayer =
    layer.copy(mags = layer.mags.map(m => m.copy(path = m.path.map(_.split("/").takeRight(2).mkString("/")))))

  def writeLocalDatasourceProperties(dataSource: DataSource, path: Path)(implicit ec: ExecutionContext): Fox[Path] =
    tryo {
      val properties = Json.toJson(dataSource).toString().getBytes(StandardCharsets.UTF_8)
      Files.write(path.resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON), properties)
    }.toFox
}
