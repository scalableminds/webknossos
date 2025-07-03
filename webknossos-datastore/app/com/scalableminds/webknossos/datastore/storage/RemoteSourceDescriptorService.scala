package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, LayerAttachment}
import com.scalableminds.webknossos.datastore.services.DSRemoteWebknossosClient
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box
import com.scalableminds.util.tools.Box.tryo

import java.net.URI
import java.nio.file.Path
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
      remoteSourceDescriptor <- remoteSourceDescriptorFor(baseDir, datasetId, layerName, magLocator)
      _ = dataVaultService.removeVaultFromCache(remoteSourceDescriptor)
    } yield ()

  // Note that attachment paths are already resolved with baseDir in local case so we don’t need to do it here.
  def vaultPathFor(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      credentialBox <- credentialFor(attachment).shiftBox
      remoteSourceDescriptor = RemoteSourceDescriptor(attachment.path, credentialBox.toOption)
      vaultPath <- dataVaultService.getVaultPath(remoteSourceDescriptor)
    } yield vaultPath

  def removeVaultFromCache(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      credentialBox <- credentialFor(attachment).shiftBox
      remoteSourceDescriptor = RemoteSourceDescriptor(attachment.path, credentialBox.toOption)
      _ = dataVaultService.removeVaultFromCache(remoteSourceDescriptor)
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
      val localPath = Path.of(uri.getPath)
      if (localPath.isAbsolute) {
        if (localPath.toString.startsWith(localDatasetDir.getParent.toAbsolutePath.toString) || dataStoreConfig.Datastore.localDirectoryWhitelist
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
      Path.of(uri.getPath).toAbsolutePath.toUri
    }
  }

  private lazy val globalCredentials = {
    val res = dataStoreConfig.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }
    logger.info(s"Parsed ${res.length} global data vault credentials from datastore config.")
    res
  }

  private def findGlobalCredentialFor(pathOpt: Option[String]): Option[DataVaultCredential] =
    pathOpt.flatMap(path => globalCredentials.find(c => path.startsWith(c.name)))

  private def credentialFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[DataVaultCredential] =
    magLocator.credentialId match {
      case Some(credentialId) =>
        dSRemoteWebknossosClient.getCredential(credentialId)
      case None =>
        magLocator.credentials match {
          case Some(credential) => Fox.successful(credential)
          case None             => findGlobalCredentialFor(magLocator.path).toFox
        }
    }

  private def credentialFor(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[DataVaultCredential] =
    attachment.credentialId match {
      case Some(credentialId) =>
        dSRemoteWebknossosClient.getCredential(credentialId)
      case None =>
        findGlobalCredentialFor(Some(attachment.path.toString)).toFox
    }

  def pathIsAllowedToAddDirectly(pathLiteral: String): Boolean =
    if (pathIsLocal(pathLiteral))
      pathIsDataSourceLocal(pathLiteral) || pathIsInLocalDirectoryWhitelist(pathLiteral)
    else
      !pathMatchesGlobalCredentials(pathLiteral)

  private def pathIsLocal(pathLiteral: String): Boolean = {
    val uri = new URI(pathLiteral)
    uri.getScheme == null || uri.getScheme == DataVaultService.schemeFile
  }

  private def pathIsDataSourceLocal(pathLiteral: String): Boolean =
    pathIsLocal(pathLiteral) && {
      val path = Path.of(pathLiteral)
      val workingDir = Path.of(".").toAbsolutePath.normalize
      val inWorkingDir = workingDir.resolve(path).toAbsolutePath.normalize
      !path.isAbsolute && inWorkingDir.startsWith(workingDir)
    }

  private def pathMatchesGlobalCredentials(pathLiteral: String): Boolean =
    findGlobalCredentialFor(Some(pathLiteral)).isDefined

  private def pathIsInLocalDirectoryWhitelist(pathLiteral: String): Boolean =
    pathIsLocal(pathLiteral) &&
      dataStoreConfig.Datastore.localDirectoryWhitelist.exists(whitelistEntry => pathLiteral.startsWith(whitelistEntry))

}
