package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{JsonAutoFormat, Fox}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datavault.{S3DataVault, VaultPath}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, StaticLayer, UsableDataSource}
import com.scalableminds.webknossos.datastore.services.DSRemoteWebknossosClient
import com.scalableminds.webknossos.datastore.storage.{
  CredentializedUPath,
  DataVaultCredential,
  DataVaultService,
  S3ClientPoolHolder
}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.webknossos.datastore.helpers.{S3UriUtils, UPath, ZipEntryUPath}

import java.nio.file.Path
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ExploreRemoteDatasetRequest(layerParameters: List[ExploreRemoteLayerParameters], organizationId: String)
    derives JsonAutoFormat

case class ExploreRemoteDatasetResponse(dataSource: Option[UsableDataSource], report: String) derives JsonAutoFormat

case class ExploreRemoteLayerParameters(
    remoteUri: String,
    credentialId: Option[String],
    preferredVoxelSize: Option[VoxelSize]
) derives JsonAutoFormat

// Calls explorers on dataset uris compatible with DataVaults (can also be file:/// for local)
class ExploreRemoteLayerService @Inject() (
    dataVaultService: DataVaultService,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    dataStoreConfig: DataStoreConfig,
    s3ClientPoolHolder: S3ClientPoolHolder
) extends ExploreLayerUtils
    with Formatter
    with LazyLogging {

  def exploreRemoteDatasource(
      parameters: List[ExploreRemoteLayerParameters],
      reportMutable: ListBuffer[String]
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[UsableDataSource] =
    for {
      exploredLayersNested <- Fox.serialCombined(parameters)(parameters =>
        exploreRemoteLayersForOneUri(
          parameters.remoteUri,
          parameters.credentialId,
          reportMutable
        )
      )
      layersWithVoxelSizes = exploredLayersNested.flatten
      preferredVoxelSize = parameters.flatMap(_.preferredVoxelSize).headOption
      _ <- Fox.fromBool(layersWithVoxelSizes.nonEmpty) ?~> "Detected zero layers"
      (layers, voxelSize) <- adaptLayersAndVoxelSize(layersWithVoxelSizes, preferredVoxelSize)
      dataSource = UsableDataSource(
        DataSourceId("", ""), // Frontend will prompt user for a good name
        layers,
        voxelSize
      )
    } yield dataSource

  private def exploreRemoteLayersForOneUri(
      layerUri: String,
      credentialId: Option[String],
      reportMutable: ListBuffer[String]
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[(StaticLayer, VoxelSize)]] =
    for {
      parsedUPath <- UPath
        .fromString(removeNeuroglancerPrefixesFromUri(removeHeaderFileNamesFromUriSuffix(layerUri)))
        .toFox ?~> s"Received invalid URI: $layerUri"
      credentialOpt: Option[DataVaultCredential] <- Fox.runOptional(credentialId)(remoteWebknossosClient.getCredential)
      upath <- insertS3EndpointIfMissing(parsedUPath, credentialOpt)
      upathForExplore = upath match {
        case _: ZipEntryUPath                                                                      => upath
        case _ if ZipEntryUPath.relevantFileExtensions.exists(upath.toString.toLowerCase.endsWith) =>
          ZipEntryUPath(upath, "")
        case _ => upath
      }
      _ <- assertLocalPathInWhitelist(upathForExplore)
      remotePath <- dataVaultService.vaultPathFor(
        CredentializedUPath(upathForExplore, credentialOpt)
      ) ?~> Msg.DataVault.setupFailed
      layersWithVoxelSizes <- recursivelyExploreRemoteLayerAtPaths(
        List((remotePath, 0)),
        credentialId,
        List(
          // Explorers are ordered to prioritize the explorer reading meta information over raw Zarr, N5, ... data.
          new WebknossosZarrExplorer,
          new NgffV0_4Explorer,
          new NgffV0_5Explorer,
          new Zarr3ArrayExplorer,
          new ZarrArrayExplorer(Vec3Int.ones),
          new N5MultiscalesExplorer,
          new N5CompactMultiscalesExplorer,
          new N5ArrayExplorer,
          new PrecomputedExplorer,
          new NeuroglancerUriExplorer(dataVaultService)
        ),
        reportMutable
      )
    } yield layersWithVoxelSizes

  // Rewrites s3://bucket/key to s3://s3.<region>.amazonaws.com/bucket/key, since not all clients (e.g. the python
  // library) support the short style. Falls back to the global endpoint if the region cannot be determined.
  private def insertS3EndpointIfMissing(upath: UPath, credentialOpt: Option[DataVaultCredential])(implicit
      ec: ExecutionContext
  ): Fox[UPath] =
    upath match {
      case ZipEntryUPath(outerPath, innerPath) =>
        insertS3EndpointIfMissing(outerPath, credentialOpt).map(ZipEntryUPath(_, innerPath))
      case _ =>
        upath.toRemoteUri match {
          case Full(uri) if S3UriUtils.isShortStyle(uri) =>
            for {
              bucket <- S3UriUtils.hostBucketFromUri(uri).toFox
              regionBox <- s3ClientPoolHolder.s3ClientPool
                .getBucketRegion(S3DataVault.s3CredentialFrom(credentialOpt), uri, bucket)
                .shiftBox
              _ = regionBox match {
                case f: Failure =>
                  logger.info(s"Could not look up region of s3 bucket $bucket, using global endpoint: ${f.msg}")
                case _ => ()
              }
              endpointHost = S3UriUtils.awsEndpointHost(regionBox.toOption)
              withEndpoint <- UPath.fromString(S3UriUtils.withEndpointHost(uri, endpointHost)).toFox
            } yield withEndpoint
          case _ => Fox.successful(upath)
        }
    }

  private def assertLocalPathInWhitelist(upath: UPath)(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.fromBool(
      upath.isRemote || dataStoreConfig.Datastore.localDirectoryWhitelist
        .exists(whitelistEntry => upath.startsWith(UPath.fromLocalPath(Path.of(whitelistEntry))))
    ) ?~> s"Absolute path $upath in local file system is not in path whitelist. Consider adding it to datastore.localDirectoryWhitelist"

  private val MAX_RECURSIVE_SEARCH_DEPTH = 3

  private val MAX_EXPLORED_ITEMS_PER_LEVEL = 10

  private def recursivelyExploreRemoteLayerAtPaths(
      remotePathsWithDepth: Seq[(VaultPath, Int)],
      credentialId: Option[String],
      explorers: List[RemoteLayerExplorer],
      reportMutable: ListBuffer[String]
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[(StaticLayer, VoxelSize)]] =
    remotePathsWithDepth match {
      case Nil =>
        Fox.empty
      case (path, searchDepth) :: remainingPaths =>
        if (searchDepth > MAX_RECURSIVE_SEARCH_DEPTH) Fox.empty
        else {
          explorePathsWithAllExplorersAndGetFirstMatch(path, explorers, credentialId, reportMutable).shiftBox.flatMap(
            explorationResultOfPath =>
              handleExploreResultOfPath(
                explorationResultOfPath,
                path,
                searchDepth,
                remainingPaths,
                credentialId,
                explorers,
                reportMutable
              )
          )
        }
    }

  private def explorePathsWithAllExplorersAndGetFirstMatch(
      path: VaultPath,
      explorers: List[RemoteLayerExplorer],
      credentialId: Option[String],
      reportMutable: ListBuffer[String]
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[(StaticLayer, VoxelSize)]] =
    Fox
      .fromFuture(Fox.sequence(explorers.map { explorer =>
        explorer.explore(path, credentialId).shiftBox.flatMap {
          handleExploreResult(_, explorer, path, reportMutable)
        }
      }))
      .map(explorationResults => Fox.firstSuccess(explorationResults.map(_.toFox)))
      .flatten

  private def handleExploreResult(
      explorationResult: Box[List[(StaticLayer, VoxelSize)]],
      explorer: RemoteLayerExplorer,
      path: VaultPath,
      reportMutable: ListBuffer[String]
  )(implicit ec: ExecutionContext): Fox[List[(StaticLayer, VoxelSize)]] =
    explorationResult match {
      case Full(layersWithVoxelSizes) =>
        reportMutable += s"Found ${layersWithVoxelSizes.length} ${explorer.name} layers at $path."
        Fox.successful(layersWithVoxelSizes)
      case f: Failure =>
        reportMutable += s"Error when reading $path as ${explorer.name}: ${formatFailureChain(f)}"
        Fox.empty
      case Empty =>
        reportMutable += s"Error when reading $path as ${explorer.name}: Empty"
        Fox.empty
    }

  private def handleExploreResultOfPath(
      explorationResultOfPath: Box[List[(StaticLayer, VoxelSize)]],
      path: VaultPath,
      searchDepth: Int,
      remainingPaths: List[(VaultPath, Int)],
      credentialId: Option[String],
      explorers: List[RemoteLayerExplorer],
      reportMutable: ListBuffer[String]
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[(StaticLayer, VoxelSize)]] =
    explorationResultOfPath match {
      case Full(layersWithVoxelSizes) =>
        Fox.successful(layersWithVoxelSizes)
      case Empty =>
        for {
          extendedRemainingPaths <- path
            .listDirectory(maxItems = MAX_EXPLORED_ITEMS_PER_LEVEL)
            .map(dirs => remainingPaths ++ dirs.map((_, searchDepth + 1)))
          foundLayers <- recursivelyExploreRemoteLayerAtPaths(
            extendedRemainingPaths,
            credentialId,
            explorers,
            reportMutable
          )
        } yield foundLayers
      case _ =>
        Fox.successful(List.empty)
    }

}
