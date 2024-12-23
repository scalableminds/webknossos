package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayerWithMagLocators,
  DataSource,
  DataSourceId,
  DataSourceWithMagLocators,
  GenericDataSource
}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import net.liftweb.common.Box.tryo
import play.api.libs.json.Json

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters.IteratorHasAsScala

// Calls explorers on local datasets that have already been uploaded to the binaryData dir
class ExploreLocalLayerService @Inject()(dataVaultService: DataVaultService)
    extends ExploreLayerUtils
    with FoxImplicits {

  def exploreLocal(path: Path, dataSourceId: DataSourceId, layerDirectory: String = "")(
      implicit ec: ExecutionContext): Fox[DataSourceWithMagLocators] =
    for {
      _ <- Fox.successful(())
      explored = Seq(
        exploreLocalNgffV0_4Array(path, dataSourceId),
        exploreLocalNgffV0_5Array(path, dataSourceId),
        exploreLocalZarrArray(path, dataSourceId, layerDirectory),
        exploreLocalNeuroglancerPrecomputed(path, dataSourceId, layerDirectory),
        exploreLocalN5Multiscales(path, dataSourceId, layerDirectory),
        exploreLocalN5Array(path, dataSourceId)
      )
      dataSource <- Fox.firstSuccess(explored) ?~> "Could not explore local data source"
    } yield dataSource

  private def exploreLocalZarrArray(path: Path, dataSourceId: DataSourceId, layerDirectory: String)(
      implicit ec: ExecutionContext): Fox[DataSourceWithMagLocators] =
    for {
      magDirectories <- tryo(Files.list(path.resolve(layerDirectory)).iterator().asScala.toList).toFox ?~> s"Could not resolve color directory as child of $path"
      layersWithVoxelSizes <- Fox.combined(magDirectories.map(dir =>
        for {
          remoteSourceDescriptor <- Fox.successful(RemoteSourceDescriptor(dir.toUri, None))
          mag <- Fox
            .option2Fox(Vec3Int.fromMagLiteral(dir.getFileName.toString, allowScalar = true)) ?~> s"invalid mag: ${dir.getFileName}"
          vaultPath <- dataVaultService.getVaultPath(remoteSourceDescriptor) ?~> "dataVault.setup.failed"
          layersWithVoxelSizes <- new ZarrArrayExplorer(mag).explore(vaultPath, None)
        } yield layersWithVoxelSizes))
      (layers, voxelSize) <- adaptLayersAndVoxelSize(layersWithVoxelSizes.flatten, None)
      relativeLayers = layers.map(selectLastTwoDirectories)
      dataSource = new DataSourceWithMagLocators(dataSourceId, relativeLayers, voxelSize)
    } yield dataSource

  private def exploreLocalNgffV0_4Array(path: Path, dataSourceId: DataSourceId)(
      implicit ec: ExecutionContext): Fox[DataSourceWithMagLocators] =
    exploreLocalLayer(
      layers => layers.map(selectLastTwoDirectories),
      new NgffV0_4Explorer
    )(path, dataSourceId, "")

  private def exploreLocalNgffV0_5Array(path: Path, dataSourceId: DataSourceId)(
      implicit ec: ExecutionContext): Fox[DataSourceWithMagLocators] =
    exploreLocalLayer(
      layers => layers.map(selectLastTwoDirectories),
      new NgffV0_5Explorer
    )(path, dataSourceId, "")

  private def exploreLocalNeuroglancerPrecomputed(path: Path, dataSourceId: DataSourceId, layerDirectory: String)(
      implicit ec: ExecutionContext): Fox[DataSourceWithMagLocators] =
    exploreLocalLayer(
      layers => layers.map(selectLastDirectory),
      new PrecomputedExplorer
    )(path, dataSourceId, layerDirectory)

  private def exploreLocalN5Multiscales(path: Path, dataSourceId: DataSourceId, layerDirectory: String)(
      implicit ec: ExecutionContext): Fox[DataSourceWithMagLocators] =
    exploreLocalLayer(
      layers => layers.map(selectLastDirectory),
      new N5MultiscalesExplorer
    )(path, dataSourceId, layerDirectory)

  private def exploreLocalN5Array(path: Path, dataSourceId: DataSourceId)(
      implicit ec: ExecutionContext): Fox[DataSourceWithMagLocators] =
    for {
      _ <- Fox.successful(())
      // Go down subdirectories until we find a directory with an attributes.json file that matches N5Header
      layerPath <- PathUtils
        .recurseSubdirsUntil(
          path,
          (p: Path) =>
            try {
              val attributesBytes = Files.readAllBytes(p.resolve(N5Header.FILENAME_ATTRIBUTES_JSON))
              Json.parse(new String(attributesBytes)).validate[N5Header].isSuccess
            } catch {
              case _: Exception => false
          }
        )
        .getOrElse(path)
      explored <- exploreLocalLayer(
        layers =>
          layers.map(l =>
            l.mapped(magMapping = m => m.copy(path = m.path.map(_.stripPrefix(path.toAbsolutePath.toUri.toString))))),
        new N5ArrayExplorer
      )(layerPath, dataSourceId, "")
    } yield explored

  private def selectLastDirectory(l: DataLayerWithMagLocators) =
    l.mapped(magMapping = m => m.copy(path = m.path.map(_.split("/").last)))

  private def selectLastTwoDirectories(l: DataLayerWithMagLocators) =
    l.mapped(magMapping = m => m.copy(path = m.path.map(_.split("/").takeRight(2).mkString("/"))))

  private def exploreLocalLayer(
      makeLayersRelative: List[DataLayerWithMagLocators] => List[DataLayerWithMagLocators],
      explorer: RemoteLayerExplorer)(path: Path, dataSourceId: DataSourceId, layerDirectory: String)(
      implicit ec: ExecutionContext): Fox[DataSourceWithMagLocators] =
    for {
      fullPath <- Fox.successful(path.resolve(layerDirectory))
      remoteSourceDescriptor <- Fox.successful(RemoteSourceDescriptor(fullPath.toUri, None))
      vaultPath <- dataVaultService.getVaultPath(remoteSourceDescriptor) ?~> "dataVault.setup.failed"
      layersWithVoxelSizes <- explorer.explore(vaultPath, None)
      (layers, voxelSize) <- adaptLayersAndVoxelSize(layersWithVoxelSizes, None)
      relativeLayers = makeLayersRelative(layers)
      dataSource = new DataSourceWithMagLocators(dataSourceId, relativeLayers, voxelSize)
    } yield dataSource

  def writeLocalDatasourceProperties(dataSource: DataSource, path: Path)(implicit ec: ExecutionContext): Fox[Path] =
    tryo {
      val properties = Json.toJson(dataSource).toString().getBytes(StandardCharsets.UTF_8)
      Files.write(path.resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON), properties)
    }.toFox
}
