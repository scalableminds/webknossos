package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.DSRemoteWebknossosClient
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo

import java.net.URI
import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class RemoteSourceDescriptor(uri: URI, credential: Option[DataVaultCredential])

class RemoteSourceDescriptorService @Inject()(dSRemoteWebknossosClient: DSRemoteWebknossosClient,
                                              dataStoreConfig: DataStoreConfig,
                                              dataVaultService: DataVaultService)
    extends LazyLogging
    with FoxImplicits {

  def vaultPathFor(baseDir: Path, datasetId: DataSourceId, layerName: String, magLocator: MagLocator)(
      implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      remoteSourceDescriptor <- remoteSourceDescriptorFor(baseDir, datasetId, layerName, magLocator)
      vaultPath <- dataVaultService.getVaultPath(remoteSourceDescriptor)
    } yield vaultPath

  def removeVaultFromCache(baseDir: Path, datasetId: DataSourceId, layerName: String, magLocator: MagLocator)(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      remoteSource <- remoteSourceDescriptorFor(baseDir, datasetId, layerName, magLocator)
      _ = dataVaultService.removeVaultFromCache(remoteSource)
    } yield ()

  private def remoteSourceDescriptorFor(
      baseDir: Path,
      datasetId: DataSourceId,
      layerName: String,
      magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[RemoteSourceDescriptor] =
    for {
      credentialBox <- credentialFor(magLocator: MagLocator).shiftBox
      uri <- uriForMagLocator(baseDir, datasetId, layerName, magLocator).toFox
      remoteSource = RemoteSourceDescriptor(uri, credentialBox.toOption)
    } yield remoteSource

  def uriFromPathLiteral(pathLiteral: String, localDatasetDir: Path, layerName: String): URI = {
    val uri = new URI(pathLiteral)
    if (DataVaultService.isRemoteScheme(uri.getScheme)) {
      uri
    } else if (uri.getScheme == null || uri.getScheme == DataVaultService.schemeFile) {
      val localPath = Paths.get(uri.getPath)
      if (localPath.isAbsolute) {
        if (localPath.toString.startsWith(localDatasetDir.toAbsolutePath.toString) || dataStoreConfig.Datastore.localDirectoryWhitelist
              .exists(whitelistEntry => localPath.toString.startsWith(whitelistEntry)))
          uri
        else
          throw new Exception(
            s"Absolute path $localPath in local file system is not in path whitelist. Consider adding it to datastore.localDirectoryWhitelist")
      } else { // relative local path, resolve in dataset dir
        val pathRelativeToDataset = localDatasetDir.resolve(localPath)
        val pathRelativeToLayer = localDatasetDir.resolve(layerName).resolve(localPath)
        if (pathRelativeToDataset.toFile.exists) {
          pathRelativeToDataset.toUri
        } else {
          pathRelativeToLayer.toUri
        }
      }
    } else {
      throw new Exception(s"Unsupported path: $localDatasetDir")
    }
  }

  def resolveMagPath(datasetDir: Path, layerDir: Path, layerName: String, magLocator: MagLocator): URI =
    magLocator.path match {
      case Some(magLocatorPath) =>
        uriFromPathLiteral(magLocatorPath, datasetDir, layerName)
      case _ =>
        val localDirWithScalarMag = layerDir.resolve(magLocator.mag.toMagLiteral(allowScalar = true))
        val localDirWithVec3Mag = layerDir.resolve(magLocator.mag.toMagLiteral())
        if (localDirWithScalarMag.toFile.exists) {
          localDirWithScalarMag.toUri
        } else {
          localDirWithVec3Mag.toUri
        }
    }

  private def uriForMagLocator(baseDir: Path,
                               dataSourceId: DataSourceId,
                               layerName: String,
                               magLocator: MagLocator): Box[URI] = tryo {
    val localDatasetDir = baseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    val localLayerDir = localDatasetDir.resolve(layerName)
    val uri = resolveMagPath(localDatasetDir, localLayerDir, layerName, magLocator)
    if (DataVaultService.isRemoteScheme(uri.getScheme)) {
      uri
    } else {
      Paths.get(uri.getPath).toAbsolutePath.toUri
    }
  }

  private lazy val globalCredentials = {
    val res = dataStoreConfig.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }
    logger.info(s"Parsed ${res.length} global data vault credentials from datastore config.")
    res
  }

  private def findGlobalCredentialFor(magLocator: MagLocator)(implicit ec: ExecutionContext) =
    magLocator.path match {
      case Some(magPath) => globalCredentials.find(c => magPath.startsWith(c.name)).toFox
      case None          => Fox.empty
    }

  private def credentialFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[DataVaultCredential] =
    magLocator.credentialId match {
      case Some(credentialId) =>
        dSRemoteWebknossosClient.getCredential(credentialId)
      case None =>
        magLocator.credentials match {
          case Some(credential) => Fox.successful(credential)
          case None             => findGlobalCredentialFor(magLocator)
        }
    }
}
