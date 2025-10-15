package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits, Full}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datavault.{
  DataVault,
  FileSystemDataVault,
  GoogleCloudDataVault,
  HttpsDataVault,
  S3DataVault,
  VaultPath
}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.helpers.{PathSchemes, UPath}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, LayerAttachment}
import com.scalableminds.webknossos.datastore.services.DSRemoteWebknossosClient
import play.api.libs.ws.WSClient

import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class CredentializedUPath(upath: UPath, credential: Option[DataVaultCredential])

class DataVaultService @Inject()(ws: WSClient,
                                 config: DataStoreConfig,
                                 remoteWebknossosClient: DSRemoteWebknossosClient)
    extends LazyLogging
    with FoxImplicits {

  private val vaultCache: AlfuCache[CredentializedUPath, DataVault] =
    AlfuCache(maxCapacity = 100)

  def vaultPathFor(upath: UPath)(implicit ec: ExecutionContext): Fox[VaultPath] = {
    val credentialOpt = findGlobalCredentialFor(Some(upath))
    vaultPathFor(CredentializedUPath(upath, credentialOpt))
  }

  def vaultPathFor(localPath: Path)(implicit ec: ExecutionContext): Fox[VaultPath] =
    vaultPathFor(UPath.fromLocalPath(localPath))

  def vaultPathFor(magLocator: MagLocator, dataSourceId: DataSourceId, layerName: String)(
      implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      credentializedUpath <- credentializedUPathForMag(dataSourceId, layerName, magLocator)
      vaultPath <- vaultPathFor(credentializedUpath)
    } yield vaultPath

  // Note that attachment paths are already resolved with baseDir in local case so we don’t need to do it here.
  def vaultPathFor(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      credentialBox <- credentialFor(attachment).shiftBox
      vaultPath <- vaultPathFor(CredentializedUPath(attachment.path, credentialBox.toOption))
    } yield vaultPath

  def removeVaultFromCache(magLocator: MagLocator, datasetId: DataSourceId, layerName: String)(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      credentializedUpath <- credentializedUPathForMag(datasetId, layerName, magLocator)
      _ = removeVaultFromCache(credentializedUpath)
    } yield ()

  def removeVaultFromCache(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      credentialBox <- credentialFor(attachment).shiftBox
      _ = removeVaultFromCache(CredentializedUPath(attachment.path, credentialBox.toOption))
    } yield ()

  private def credentializedUPathForMag(datasetId: DataSourceId, layerName: String, magLocator: MagLocator)(
      implicit ec: ExecutionContext): Fox[CredentializedUPath] =
    for {
      credentialBox <- credentialFor(magLocator: MagLocator).shiftBox
      resolvedMagPath <- resolveMagPath(datasetId, layerName, magLocator).toFox
    } yield CredentializedUPath(resolvedMagPath, credentialBox.toOption)

  def resolveMagPath(magLocator: MagLocator, localDatasetDir: Path, layerDir: Path, layerName: String): UPath =
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

  private def resolveMagPath(dataSourceId: DataSourceId, layerName: String, magLocator: MagLocator): Box[UPath] = tryo {
    val localDatasetDir =
      config.Datastore.baseDirectory.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    val localLayerDir = localDatasetDir.resolve(layerName)
    resolveMagPath(magLocator, localDatasetDir, localLayerDir, layerName)
  }

  private lazy val globalCredentials = {
    val res = config.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
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
        remoteWebknossosClient.getCredential(credentialId)
      case None =>
        magLocator.credentials match {
          case Some(credential) => Fox.successful(credential)
          case None             => findGlobalCredentialFor(magLocator.path).toFox
        }
    }

  private def credentialFor(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[DataVaultCredential] =
    attachment.credentialId match {
      case Some(credentialId) =>
        remoteWebknossosClient.getCredential(credentialId)
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
      config.Datastore.localDirectoryWhitelist.exists(whitelistEntry => path.toString.startsWith(whitelistEntry))

  def vaultPathFor(credentializedUpath: CredentializedUPath)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      vault <- vaultCache.getOrLoad(credentializedUpath, createVault) ?~> "dataVault.setup.failed"
    } yield new VaultPath(credentializedUpath.upath, vault)

  private def removeVaultFromCache(credentializedUpath: CredentializedUPath)(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.successful(vaultCache.remove(credentializedUpath))

  private def createVault(credentializedUpath: CredentializedUPath)(implicit ec: ExecutionContext): Fox[DataVault] = {
    val scheme = credentializedUpath.upath.getScheme
    try {
      val fs: DataVault = scheme match {
        case Some(PathSchemes.schemeGS) => GoogleCloudDataVault.create(credentializedUpath)
        case Some(PathSchemes.schemeS3) => S3DataVault.create(credentializedUpath, ws)
        case Some(PathSchemes.schemeHttps) | Some(PathSchemes.schemeHttp) =>
          HttpsDataVault.create(credentializedUpath, ws, config.Http.uri)
        case None => FileSystemDataVault.create
        case _    => throw new Exception(s"Unknown file system scheme $scheme")
      }
      logger.info(s"Created data vault for ${credentializedUpath.upath.toString}")
      Fox.successful(fs)
    } catch {
      case e: Exception =>
        val msg = s"Creating data vault errored for ${credentializedUpath.upath.toString}:"
        logger.error(msg, e)
        Fox.failure(msg, Full(e))
    }
  }

}
