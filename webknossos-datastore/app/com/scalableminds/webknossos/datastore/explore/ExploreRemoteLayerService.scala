package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
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
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.MessagesProvider
import play.api.libs.json.{Json, OFormat}

import java.net.URI
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ExploreRemoteDatasetRequest(layerParameters: List[ExploreRemoteLayerParameters], organizationId: String)

object ExploreRemoteDatasetRequest {
  implicit val jsonFormat: OFormat[ExploreRemoteDatasetRequest] = Json.format[ExploreRemoteDatasetRequest]
}

case class ExploreRemoteDatasetResponse(dataSource: Option[GenericDataSource[DataLayer]], report: String)

object ExploreRemoteDatasetResponse {
  implicit val jsonFormat: OFormat[ExploreRemoteDatasetResponse] = Json.format[ExploreRemoteDatasetResponse]
}

case class ExploreRemoteLayerParameters(remoteUri: String,
                                        credentialId: Option[String],
                                        preferredVoxelSize: Option[VoxelSize])

object ExploreRemoteLayerParameters {
  implicit val jsonFormat: OFormat[ExploreRemoteLayerParameters] = Json.format[ExploreRemoteLayerParameters]
}

// Calls explorers on dataset uris compatible with DataVaults (can also be file:/// for local)
class ExploreRemoteLayerService @Inject()(dataVaultService: DataVaultService,
                                          remoteWebknossosClient: DSRemoteWebknossosClient,
                                          dataStoreConfig: DataStoreConfig)
    extends ExploreLayerUtils
    with FoxImplicits
    with Formatter
    with LazyLogging {

  def exploreRemoteDatasource(parameters: List[ExploreRemoteLayerParameters], reportMutable: ListBuffer[String])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      mp: MessagesProvider): Fox[GenericDataSource[DataLayer]] =
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
      implicit ec: ExecutionContext,
      tc: TokenContext,
      mp: MessagesProvider): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      uri <- tryo(new URI(removeNeuroglancerPrefixesFromUri(removeHeaderFileNamesFromUriSuffix(layerUri)))) ?~> s"Received invalid URI: $layerUri"
      _ <- bool2Fox(uri.getScheme != null) ?~> s"Received invalid URI: $layerUri"
      _ <- assertLocalPathInWhitelist(uri)
      credentialOpt: Option[DataVaultCredential] <- Fox.runOptional(credentialId)(remoteWebknossosClient.getCredential)
      remoteSource = RemoteSourceDescriptor(uri, credentialOpt)
      remotePath <- dataVaultService.getVaultPath(remoteSource) ?~> "dataVault.setup.failed"
      layersWithVoxelSizes <- recursivelyExploreRemoteLayerAtPaths(
        List((remotePath, 0)),
        credentialId,
        List(
          // Explorers are ordered to prioritize the explorer reading meta information over raw Zarr, N5, ... data.
          new NgffV0_4Explorer,
          new NgffV0_5Explorer,
          new WebknossosZarrExplorer,
          new Zarr3ArrayExplorer,
          new ZarrArrayExplorer(Vec3Int.ones),
          new N5MultiscalesExplorer,
          new N5CompactMultiscalesExplorer,
          new N5ArrayExplorer,
          new PrecomputedExplorer,
          new NeuroglancerUriExplorer(dataVaultService)
        ),
        reportMutable,
      )
    } yield layersWithVoxelSizes

  private def assertLocalPathInWhitelist(uri: URI)(implicit ec: ExecutionContext): Fox[Unit] =
    if (uri.getScheme == DataVaultService.schemeFile) {
      bool2Fox(dataStoreConfig.Datastore.localDirectoryWhitelist.exists(whitelistEntry =>
        uri.getPath.startsWith(whitelistEntry))) ?~> s"Absolute path ${uri.getPath} in local file system is not in path whitelist. Consider adding it to datastore.localDirectoryWhitelist"
    } else Fox.successful(())

  private val MAX_RECURSIVE_SEARCH_DEPTH = 3

  private val MAX_EXPLORED_ITEMS_PER_LEVEL = 10

  private def recursivelyExploreRemoteLayerAtPaths(remotePathsWithDepth: List[(VaultPath, Int)],
                                                   credentialId: Option[String],
                                                   explorers: List[RemoteLayerExplorer],
                                                   reportMutable: ListBuffer[String])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      mp: MessagesProvider): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    remotePathsWithDepth match {
      case Nil =>
        Fox.empty
      case (path, searchDepth) :: remainingPaths =>
        if (searchDepth > MAX_RECURSIVE_SEARCH_DEPTH) Fox.empty
        else {
          explorePathsWithAllExplorersAndGetFirstMatch(path, explorers, credentialId, reportMutable).futureBox.flatMap(
            explorationResultOfPath =>
              handleExploreResultOfPath(explorationResultOfPath,
                                        path,
                                        searchDepth,
                                        remainingPaths,
                                        credentialId,
                                        explorers,
                                        reportMutable))
        }
    }

  private def explorePathsWithAllExplorersAndGetFirstMatch(path: VaultPath,
                                                           explorers: List[RemoteLayerExplorer],
                                                           credentialId: Option[String],
                                                           reportMutable: ListBuffer[String])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      mp: MessagesProvider): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    Fox
      .sequence(explorers.map { explorer =>
        {
          explorer
            .explore(path, credentialId)
            .futureBox
            .flatMap {
              handleExploreResult(_, explorer, path, reportMutable)
            }
            .toFox
        }
      })
      .map(explorationResults => Fox.firstSuccess(explorationResults.map(_.toFox)))
      .toFox
      .flatten

  private def handleExploreResult(explorationResult: Box[List[(DataLayerWithMagLocators, VoxelSize)]],
                                  explorer: RemoteLayerExplorer,
                                  path: VaultPath,
                                  reportMutable: ListBuffer[String])(
      implicit ec: ExecutionContext,
      mp: MessagesProvider): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] = explorationResult match {
    case Full(layersWithVoxelSizes) =>
      reportMutable += s"Found ${layersWithVoxelSizes.length} ${explorer.name} layers at $path."
      Fox.successful(layersWithVoxelSizes)
    case f: Failure =>
      reportMutable += s"Error when reading $path as ${explorer.name}: ${formatFailureChain(f, messagesProviderOpt = Some(mp))}"
      Fox.empty
    case Empty =>
      reportMutable += s"Error when reading $path as ${explorer.name}: Empty"
      Fox.empty
  }

  private def handleExploreResultOfPath(explorationResultOfPath: Box[List[(DataLayerWithMagLocators, VoxelSize)]],
                                        path: VaultPath,
                                        searchDepth: Int,
                                        remainingPaths: List[(VaultPath, Int)],
                                        credentialId: Option[String],
                                        explorers: List[RemoteLayerExplorer],
                                        reportMutable: ListBuffer[String])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      mp: MessagesProvider): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    explorationResultOfPath match {
      case Full(layersWithVoxelSizes) =>
        Fox.successful(layersWithVoxelSizes)
      case Empty =>
        for {
          extendedRemainingPaths <- path
            .listDirectory(maxItems = MAX_EXPLORED_ITEMS_PER_LEVEL)
            .map(dirs => remainingPaths ++ dirs.map((_, searchDepth + 1)))
          foundLayers <- recursivelyExploreRemoteLayerAtPaths(extendedRemainingPaths,
                                                              credentialId,
                                                              explorers,
                                                              reportMutable)
        } yield foundLayers
      case _ =>
        Fox.successful(List.empty)
    }

}
