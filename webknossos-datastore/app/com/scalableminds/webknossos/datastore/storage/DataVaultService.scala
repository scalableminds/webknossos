package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.Msg
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{Box, Failure, Fox, FoxImplicits, Full, Empty}
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
import com.scalableminds.webknossos.datastore.services.{DSRemoteWebknossosClient, ManagedS3Service}
import play.api.libs.ws.WSClient

import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class CredentializedUPath(upath: UPath, credential: Option[DataVaultCredential])

class DataVaultService @Inject()(ws: WSClient,
                                 config: DataStoreConfig,
                                 remoteWebknossosClient: DSRemoteWebknossosClient,
                                 managedS3Service: ManagedS3Service,
                                 s3ClientPoolHolder: S3ClientPoolHolder)
    extends LazyLogging
    with Formatter
    with FoxImplicits {

  private val vaultCache: AlfuCache[CredentializedUPath, DataVault] =
    AlfuCache(maxCapacity = 100)

  def vaultPathFor(upath: UPath)(implicit ec: ExecutionContext): Fox[VaultPath] = {
    val credentialOpt = managedS3Service.findGlobalCredentialFor(Some(upath))
    vaultPathFor(CredentializedUPath(upath, credentialOpt))
  }

  def vaultPathFor(localPath: Path)(implicit ec: ExecutionContext): Fox[VaultPath] =
    vaultPathFor(UPath.fromLocalPath(localPath))

  def vaultPathFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      credentializedUpath <- credentializedUPathForMag(magLocator)
      vaultPath <- vaultPathFor(credentializedUpath)
    } yield vaultPath

  // Note that attachment paths are already resolved with baseDir in local case so we don’t need to do it here.
  def vaultPathFor(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      credentialBox <- credentialFor(attachment).shiftBox
      vaultPath <- vaultPathFor(CredentializedUPath(attachment.path, credentialBox.toOption))
    } yield vaultPath

  def removeVaultFromCache(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      credentializedUpath <- credentializedUPathForMag(magLocator)
      _ = removeVaultFromCache(credentializedUpath)
    } yield ()

  def removeVaultFromCache(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      credentialBox <- credentialFor(attachment).shiftBox
      _ = removeVaultFromCache(CredentializedUPath(attachment.path, credentialBox.toOption))
    } yield ()

  private def credentializedUPathForMag(magLocator: MagLocator)(
      implicit ec: ExecutionContext): Fox[CredentializedUPath] =
    for {
      credentialBox <- credentialFor(magLocator: MagLocator).shiftBox
      magPath <- magLocator.path.toFox
      _ <- Fox.fromBool(magPath.isAbsolute) ?~> Msg.Dataset.Mag.pathNotAbsolute
    } yield CredentializedUPath(magPath, credentialBox.toOption)

  def resolveMagPath(magLocator: MagLocator, localDatasetDir: Path, layerDir: Path): UPath =
    magLocator.path match {
      case Some(magLocatorPath) =>
        magLocatorPath.toLocalPath match {
          case Full(localPath) =>
            if (localPath.isAbsolute) {
              // absolute local path, keep unchanged
              magLocatorPath
            } else {
              // relative local path, resolve in dataset dir
              UPath.fromLocalPath(localDatasetDir.resolve(localPath).normalize)
            }
          case _ => // remote path, keep unchanged
            magLocatorPath
        }

      case _ =>
        val localDirWithScalarMag = layerDir.resolve(magLocator.mag.toMagLiteral(allowScalar = true))
        val localDirWithVec3Mag = layerDir.resolve(magLocator.mag.toMagLiteral(allowScalar = false))
        if (localDirWithScalarMag.toFile.exists) {
          UPath.fromLocalPath(localDirWithScalarMag)
        } else {
          UPath.fromLocalPath(localDirWithVec3Mag)
        }
    }

  private def credentialFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[DataVaultCredential] =
    magLocator.credentialId match {
      case Some(credentialId) =>
        remoteWebknossosClient.getCredential(credentialId)
      case None =>
        magLocator.credentials match {
          case Some(credential) => Fox.successful(credential)
          case None             => managedS3Service.findGlobalCredentialFor(magLocator.path).toFox
        }
    }

  private def credentialFor(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[DataVaultCredential] =
    attachment.credentialId match {
      case Some(credentialId) =>
        remoteWebknossosClient.getCredential(credentialId)
      case None =>
        managedS3Service.findGlobalCredentialFor(Some(attachment.path)).toFox
    }

  def pathIsAllowedToAddDirectly(path: UPath): Boolean =
    if (path.isLocal)
      pathIsDataSourceLocal(path) || pathIsInLocalDirectoryWhitelist(path)
    else
      !managedS3Service.pathIsInManagedS3(path)

  private def pathIsDataSourceLocal(path: UPath): Boolean =
    path.toLocalPath match {
      case Full(localPath) =>
        val workingDir = Path.of(".").toAbsolutePath.normalize
        val inWorkingDir = workingDir.resolve(localPath).toAbsolutePath.normalize
        !localPath.isAbsolute && inWorkingDir.startsWith(workingDir)
      case _ => false
    }

  private def pathIsInLocalDirectoryWhitelist(path: UPath): Boolean =
    path.isLocal &&
      config.Datastore.localDirectoryWhitelist.exists(whitelistEntry => path.toString.startsWith(whitelistEntry))

  def vaultPathFor(credentializedUpath: CredentializedUPath)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      vault <- vaultCache.getOrLoad(credentializedUpath, createVault(_).toFox) ?~> Msg.DataVault.setupFailed
    } yield new VaultPath(credentializedUpath.upath, vault)

  private def removeVaultFromCache(credentializedUpath: CredentializedUPath)(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.successful(vaultCache.remove(credentializedUpath))

  private def createVault(credentializedUpath: CredentializedUPath)(implicit ec: ExecutionContext): Box[DataVault] = {
    val scheme = credentializedUpath.upath.getScheme
    val vaultBox = scheme match {
      case Some(PathSchemes.schemeGS) => GoogleCloudDataVault.create(credentializedUpath)
      case Some(PathSchemes.schemeS3) => S3DataVault.create(credentializedUpath, s3ClientPoolHolder.s3ClientPool)
      case Some(PathSchemes.schemeHttps) | Some(PathSchemes.schemeHttp) =>
        HttpsDataVault.create(credentializedUpath, ws, config.Http.uri)
      case None => Full(FileSystemDataVault.create)
      case _    => Failure(s"Unknown file system scheme $scheme")
    }
    vaultBox match {
      case Full(_) => logger.info(s"Created data vault for ${credentializedUpath.upath.toString}.")
      case f: Failure =>
        logger.warn(s"Failed to create DataVault for ${credentializedUpath.upath.toString}: ${formatFailureChain(f)}")
      case Empty =>
        logger.warn(s"Failed to create DataVault for ${credentializedUpath.upath.toString}.")
    }

    vaultBox
  }

}
