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
import com.scalableminds.webknossos.datastore.helpers.UPath

import java.net.URI
import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class RemoteSourceDescriptor(upath: UPath, credential: Option[DataVaultCredential]) {
  def toUriUnsafe: URI = upath.toRemoteUriUnsafe
}

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

  def vaultPathFor(upath: UPath)(implicit ec: ExecutionContext): Fox[VaultPath] = {
    val credentialBox = findGlobalCredentialFor(Some(upath))
    val remoteSourceDescriptor = RemoteSourceDescriptor(upath, credentialBox)
    dataVaultService.getVaultPath(remoteSourceDescriptor)
  }

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
      uri <- resolveMagPath(baseDir, datasetId, layerName, magLocator).toFox
      remoteSource = RemoteSourceDescriptor(UPath.fromStringUnsafe(uri.toString), credentialBox.toOption)
    } yield remoteSource

  def resolveMagPath(localDatasetDir: Path, layerDir: Path, layerName: String, magLocator: MagLocator): UPath =
    magLocator.path match {
      case Some(magLocatorPath) =>
        if (magLocatorPath.isAbsolute) {
          magLocatorPath
        } else {
          // relative local path, resolve in dataset dir
          val pathRelativeToDataset = localDatasetDir.resolve(magLocatorPath.toLocalPathUnsafe).normalize
          val pathRelativeToLayer =
            localDatasetDir.resolve(layerName).resolve(magLocatorPath.toLocalPathUnsafe).normalize
          if (pathRelativeToDataset.toFile.exists) {
            UPath.fromLocalPath(pathRelativeToDataset)
          } else {
            UPath.fromLocalPath(pathRelativeToLayer)
          }
        }
      case _ =>
        val localDirWithScalarMag = layerDir.resolve(magLocator.mag.toMagLiteral(allowScalar = true))
        val localDirWithVec3Mag = layerDir.resolve(magLocator.mag.toMagLiteral())
        if (localDirWithScalarMag.toFile.exists) {
          UPath.fromLocalPath(localDirWithScalarMag)
        } else {
          UPath.fromLocalPath(localDirWithVec3Mag)
        }
    }

  private def resolveMagPath(baseDir: Path,
                             dataSourceId: DataSourceId,
                             layerName: String,
                             magLocator: MagLocator): Box[UPath] = tryo {
    val localDatasetDir = baseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    val localLayerDir = localDatasetDir.resolve(layerName)
    resolveMagPath(localDatasetDir, localLayerDir, layerName, magLocator)
  }

  private lazy val globalCredentials = {
    val res = dataStoreConfig.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }
    logger.info(s"Parsed ${res.length} global data vault credentials from datastore config.")
    res
  }

  private def findGlobalCredentialFor(pathOpt: Option[UPath]): Option[DataVaultCredential] =
    pathOpt.flatMap(path => globalCredentials.find(c => path.toString.startsWith(c.name)))

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
        findGlobalCredentialFor(Some(attachment.path)).toFox
    }

  def pathIsAllowedToAddDirectly(path: UPath): Boolean =
    if (path.isLocal)
      pathIsDataSourceLocal(path) || pathIsInLocalDirectoryWhitelist(path)
    else
      !pathMatchesGlobalCredentials(path)

  private def pathIsDataSourceLocal(path: UPath): Boolean =
    path.isLocal && {
      val workingDir = Path.of(".").toAbsolutePath.normalize
      val inWorkingDir = workingDir.resolve(path.toLocalPathUnsafe).toAbsolutePath.normalize
      !path.isAbsolute && inWorkingDir.startsWith(workingDir)
    }

  private def pathMatchesGlobalCredentials(path: UPath): Boolean =
    findGlobalCredentialFor(Some(path)).isDefined

  private def pathIsInLocalDirectoryWhitelist(path: UPath): Boolean =
    path.isLocal &&
      dataStoreConfig.Datastore.localDirectoryWhitelist.exists(whitelistEntry =>
        path.toString.startsWith(whitelistEntry))
}
