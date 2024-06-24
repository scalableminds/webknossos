package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayer,
  DataLayerWithMagLocators,
  DataSourceId,
  GenericDataSource
}
import com.scalableminds.webknossos.datastore.services.DSRemoteWebknossosClient
import com.scalableminds.webknossos.datastore.storage.{DataVaultCredential, DataVaultService, RemoteSourceDescriptor}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Empty, Failure, Full}
import play.api.libs.json.{Json, OFormat}

import java.net.URI
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ExploreRemoteDatasetRequest(layerParameters: List[ExploreRemoteLayerParameters], organizationName: String)

object ExploreRemoteDatasetRequest {
  implicit val jsonFormat: OFormat[ExploreRemoteDatasetRequest] = Json.format[ExploreRemoteDatasetRequest]
}

case class ExploreRemoteDatasetResponse(dataSource: Option[GenericDataSource[DataLayer]], report: String)

object ExploreRemoteDatasetResponse {
  implicit val jsonFormat: OFormat[ExploreRemoteDatasetResponse] = Json.format[ExploreRemoteDatasetResponse]
}

case class ExploreRemoteLayerParameters(remoteUri: String,
                                        credentialId: Option[String],
                                        preferredVoxelSize: Option[Vec3Double])

object ExploreRemoteLayerParameters {
  implicit val jsonFormat: OFormat[ExploreRemoteLayerParameters] = Json.format[ExploreRemoteLayerParameters]
}

// Calls explorers on dataset uris compatible with DataVaults (can also be file:/// for local)
class ExploreRemoteLayerService @Inject()(dataVaultService: DataVaultService,
                                          remoteWebknossosClient: DSRemoteWebknossosClient,
                                          dataStoreConfig: DataStoreConfig)
    extends ExploreLayerUtils
    with FoxImplicits
    with LazyLogging {

  def exploreRemoteDatasource(parameters: List[ExploreRemoteLayerParameters], reportMutable: ListBuffer[String])(
      implicit ec: ExecutionContext): Fox[GenericDataSource[DataLayer]] =
    for {
      exploredLayersNested <- Fox.serialCombined(parameters)(
        parameters =>
          exploreRemoteLayersForOneUri(
            parameters.remoteUri,
            parameters.credentialId,
            reportMutable
        ))
      layersWithVoxelSizes = exploredLayersNested.flatten
      preferredVoxelSize = parameters.flatMap(_.preferredVoxelSize).headOption
      _ <- bool2Fox(layersWithVoxelSizes.nonEmpty) ?~> "Detected zero layers"
      (layers, voxelSize) <- adaptLayersAndVoxelSize(layersWithVoxelSizes, preferredVoxelSize)
      dataSource = GenericDataSource[DataLayer](
        DataSourceId("", ""), // Frontend will prompt user for a good name
        layers,
        voxelSize
      )
    } yield dataSource

  private def exploreRemoteLayersForOneUri(layerUri: String,
                                           credentialId: Option[String],
                                           reportMutable: ListBuffer[String])(
      implicit ec: ExecutionContext): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    for {
      uri <- tryo(new URI(removeHeaderFileNamesFromUriSuffix(layerUri))) ?~> s"Received invalid URI: $layerUri"
      _ <- bool2Fox(uri.getScheme != null) ?~> s"Received invalid URI: $layerUri"
      _ <- assertLocalPathInWhitelist(uri)
      credentialOpt: Option[DataVaultCredential] <- Fox.runOptional(credentialId)(remoteWebknossosClient.getCredential)
      remoteSource = RemoteSourceDescriptor(uri, credentialOpt)
      remotePath <- dataVaultService.getVaultPath(remoteSource) ?~> "dataVault.setup.failed"
      layersWithVoxelSizes <- exploreRemoteLayersForRemotePath(
        remotePath,
        credentialId,
        reportMutable,
        List(
          // Explorers are ordered to prioritize the explorer reading meta information over raw Zarr, N5, ... data.
          new NgffExplorer,
          new WebknossosZarrExplorer,
          new Zarr3ArrayExplorer,
          new ZarrArrayExplorer(Vec3Int.ones),
          new N5MultiscalesExplorer,
          new N5ArrayExplorer,
          new PrecomputedExplorer,
          new NeuroglancerUriExplorer(dataVaultService)
        )
      )
    } yield layersWithVoxelSizes

  private def assertLocalPathInWhitelist(uri: URI)(implicit ec: ExecutionContext): Fox[Unit] =
    if (uri.getScheme == DataVaultService.schemeFile) {
      bool2Fox(dataStoreConfig.Datastore.localFolderWhitelist.exists(whitelistEntry =>
        uri.getPath.startsWith(whitelistEntry))) ?~> s"Absolute path ${uri.getPath} in local file system is not in path whitelist. Consider adding it to datastore.localFolderWhitelist"
    } else Fox.successful(())

  // TODO: Add max layer depth

  private val MAX_RECURSIVE_SEARCH_DEPTH = 8

  private def recursiveExploreRemoteLayerAtWith(remotePathsWithDepth: List[(VaultPath, Int)],
                                                explorer: RemoteLayerExplorer,
                                                credentialId: Option[String],
                                                reportMutable: ListBuffer[String])(
      implicit ec: ExecutionContext): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    remotePathsWithDepth match {
      case Nil =>
        Fox.empty
      case (path, searchDepth) :: remainingPaths =>
        if (searchDepth > MAX_RECURSIVE_SEARCH_DEPTH) return Fox.empty
        explorer
          .explore(path, credentialId)
          .futureBox
          .flatMap {
            case Full(layersWithVoxelSizes) =>
              reportMutable += s"Found ${layersWithVoxelSizes.length} ${explorer.name} layers at $path."
              val sameParentRemainingPaths = remainingPaths.filter(_._1.parent == path.parent)
              for {
                layersWithVoxelSizesInSiblingPaths <- Fox
                  .sequenceOfFulls(sameParentRemainingPaths.map(path =>
                    recursiveExploreRemoteLayerAtWith(List(path), explorer, credentialId, reportMutable)))
                  .toFox
                allLayersWithVoxelSizes = layersWithVoxelSizes +: layersWithVoxelSizesInSiblingPaths
              } yield allLayersWithVoxelSizes.flatten
            case f: Failure =>
              reportMutable += s"Error when reading $path as ${explorer.name}: ${Fox.failureChainAsString(f)}"
              for {
                extendedRemainingPaths <- path
                  .listDirectory()
                  .map(dirs => remainingPaths ++ dirs.map((_, searchDepth + 1)))
                foundLayers <- recursiveExploreRemoteLayerAtWith(extendedRemainingPaths,
                                                                 explorer,
                                                                 credentialId,
                                                                 reportMutable)
              } yield foundLayers
            case Empty =>
              reportMutable += s"Error when reading $path as ${explorer.name}: Empty"
              for {
                extendedRemainingPaths <- path
                  .listDirectory()
                  .map(dirs => remainingPaths ++ dirs.map((_, searchDepth + 1)))
                foundLayers <- recursiveExploreRemoteLayerAtWith(extendedRemainingPaths,
                                                                 explorer,
                                                                 credentialId,
                                                                 reportMutable)
              } yield foundLayers
          }
          .toFox
    }

  private def exploreRemoteLayersForRemotePath(remotePath: VaultPath,
                                               credentialId: Option[String],
                                               reportMutable: ListBuffer[String],
                                               explorers: List[RemoteLayerExplorer])(
      implicit ec: ExecutionContext): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    explorers match {
      case Nil => Fox.empty
      case currentExplorer :: remainingExplorers =>
        reportMutable += s"\nTrying to explore $remotePath as ${currentExplorer.name}..."
        recursiveExploreRemoteLayerAtWith(List((remotePath, 0)), currentExplorer, credentialId, reportMutable).futureBox
          .flatMap({
            case Full(layersWithVoxelSizes) => Fox.successful(layersWithVoxelSizes)
            case _ =>
              exploreRemoteLayersForRemotePath(remotePath, credentialId, reportMutable, explorers)
          })
    }
}
