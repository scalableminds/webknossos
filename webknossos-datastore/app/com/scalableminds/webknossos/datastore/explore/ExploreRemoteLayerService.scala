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
import com.scalableminds.webknossos.datastore.storage.{DataVaultCredential, DataVaultService, RemoteSourceDescriptor}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Empty, Failure, Full}
import play.api.libs.json.{Json, OFormat}

import java.net.URI
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ExploreRemoteLayerParameters(remoteUri: String,
                                        credentialId: Option[String],
                                        preferredVoxelSize: Option[Vec3Double])

object ExploreRemoteLayerParameters {
  implicit val jsonFormat: OFormat[ExploreRemoteLayerParameters] = Json.format[ExploreRemoteLayerParameters]
}

class ExploreRemoteLayerService @Inject()(dataVaultService: DataVaultService, dataStoreConfig: DataStoreConfig)
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
      credentialOpt: Option[DataVaultCredential] <- lookUpCredentials(credentialId)
      remoteSource = RemoteSourceDescriptor(uri, credentialOpt)
      remotePath <- dataVaultService.getVaultPath(remoteSource) ?~> "dataVault.setup.failed"
      layersWithVoxelSizes <- exploreRemoteLayersForRemotePath(
        remotePath,
        credentialId,
        reportMutable,
        List(
          new ZarrArrayExplorer(Vec3Int.ones),
          new NgffExplorer,
          new WebknossosZarrExplorer,
          new N5ArrayExplorer,
          new N5MultiscalesExplorer,
          new PrecomputedExplorer,
          new Zarr3ArrayExplorer,
          new NeuroglancerUriExplorer(dataVaultService)
        )
      )
    } yield layersWithVoxelSizes

  private def lookUpCredentials(credentailId: Option[String]): Fox[Option[DataVaultCredential]] = ??? // TODO

  private def assertLocalPathInWhitelist(uri: URI)(implicit ec: ExecutionContext): Fox[Unit] =
    if (uri.getScheme == DataVaultService.schemeFile) {
      bool2Fox(dataStoreConfig.Datastore.localFolderWhitelist.exists(whitelistEntry =>
        uri.getPath.startsWith(whitelistEntry))) ?~> s"Absolute path ${uri.getPath} in local file system is not in path whitelist. Consider adding it to datastore.localFolderWhitelist"
    } else Fox.successful(())

  private def exploreRemoteLayersForRemotePath(remotePath: VaultPath,
                                               credentialId: Option[String],
                                               reportMutable: ListBuffer[String],
                                               explorers: List[RemoteLayerExplorer])(
      implicit ec: ExecutionContext): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    explorers match {
      case Nil => Fox.empty
      case currentExplorer :: remainingExplorers =>
        reportMutable += s"\nTrying to explore $remotePath as ${currentExplorer.name}..."
        currentExplorer.explore(remotePath, credentialId).futureBox.flatMap {
          case Full(layersWithVoxelSizes) =>
            reportMutable += s"Found ${layersWithVoxelSizes.length} ${currentExplorer.name} layers at $remotePath."
            Fox.successful(layersWithVoxelSizes)
          case f: Failure =>
            reportMutable += s"Error when reading $remotePath as ${currentExplorer.name}: ${Fox.failureChainAsString(f)}"
            exploreRemoteLayersForRemotePath(remotePath, credentialId, reportMutable, remainingExplorers)
          case Empty =>
            reportMutable += s"Error when reading $remotePath as ${currentExplorer.name}: Empty"
            exploreRemoteLayersForRemotePath(remotePath, credentialId, reportMutable, remainingExplorers)
        }
    }

}
