package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.Msg
import com.scalableminds.util.box.{Empty, Failure, Full}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datavault.{
  DataVault,
  FileSystemDataVault,
  GoogleCloudDataVault,
  HttpsDataVault,
  S3DataVault,
  VaultPath,
  ZipDataVault
}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.helpers.{PathSchemes, UPath, ZipEntryUPath}
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachment
import com.scalableminds.webknossos.datastore.services.{DSRemoteWebknossosClient, ManagedS3Service}
import play.api.libs.ws.WSClient

import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class CredentializedUPath(upath: UPath, credential: Option[DataVaultCredential])

class DataVaultService @Inject() (
    ws: WSClient,
    config: DataStoreConfig,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    managedS3Service: ManagedS3Service,
    s3ClientPoolHolder: S3ClientPoolHolder
) extends LazyLogging
    with Formatter {

  private val vaultCache: AlfuCache[CredentializedUPath, DataVault] =
    AlfuCache(maxCapacity = 200)

  def vaultPathFor(upath: UPath)(implicit ec: ExecutionContext): Fox[VaultPath] = {
    val credentialOpt = managedS3Service.findGlobalCredentialFor(Some(upath))
    vaultPathFor(CredentializedUPath(upath, credentialOpt))
  }

  def vaultPathFor(localPath: Path)(implicit ec: ExecutionContext): Fox[VaultPath] =
    vaultPathFor(UPath.fromLocalPath(localPath))

  def vaultPathFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      credentializedUPath <- credentializedUPathForMag(magLocator)
      vaultPath <- vaultPathFor(credentializedUPath)
    } yield vaultPath

  // Note that attachment paths are already resolved with baseDir in local case so we don’t need to do it here.
  def vaultPathFor(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      credentialBox <- credentialFor(attachment).shiftBox
      vaultPath <- vaultPathFor(CredentializedUPath(attachment.path, credentialBox.toOption))
    } yield vaultPath

  def removeVaultFromCache(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      credentializedUPath <- credentializedUPathForMag(magLocator)
      _ = removeVaultFromCache(credentializedUPath)
    } yield ()

  def removeVaultFromCache(attachment: LayerAttachment)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      credentialBox <- credentialFor(attachment).shiftBox
      _ = removeVaultFromCache(CredentializedUPath(attachment.path, credentialBox.toOption))
    } yield ()

  private def credentializedUPathForMag(
      magLocator: MagLocator
  )(implicit ec: ExecutionContext): Fox[CredentializedUPath] =
    for {
      credentialBox <- credentialFor(magLocator).shiftBox
      magPath <- magLocator.path.toFox
      _ <- Fox.fromBool(magPath.isAbsolute) ?~> Msg.Dataset.Mag.pathNotAbsolute
    } yield CredentializedUPath(magPath, credentialBox.toOption)

  def resolveMagPath(magLocator: MagLocator, localDatasetDir: Path, layerDir: Path): UPath =
    magLocator.path match {
      case Some(magLocatorPath) =>
        magLocatorPath.resolvedIn(UPath.fromLocalPath(localDatasetDir))

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
    if (path.isLocal) {
      val workingDir = UPath.fromLocalPath(Path.of(".").toAbsolutePath.normalize)
      val inWorkingDir = (workingDir / path).toAbsolute
      !path.isAbsolute && inWorkingDir.startsWith(workingDir)
    } else false

  private def pathIsInLocalDirectoryWhitelist(path: UPath): Boolean =
    path.isLocal &&
      config.Datastore.localDirectoryWhitelist.exists { whitelistEntry =>
        val whitelistPath = UPath.fromLocalPath(Path.of(whitelistEntry).toAbsolutePath.normalize)
        path.toAbsolute.startsWith(whitelistPath)
      }

  // Zip vaults are keyed by the root zip reference (ZipEntryUPath with empty inner path) to distinguish
  // them from the underlying vault for the same outer path (e.g. the S3DataVault for the zip file itself).
  private def vaultCacheKeyFor(credentializedUPath: CredentializedUPath): CredentializedUPath =
    credentializedUPath.upath match {
      case zipPath: ZipEntryUPath => credentializedUPath.copy(upath = ZipEntryUPath(zipPath.outerPath, ""))
      case _                      => credentializedUPath
    }

  def vaultPathFor(credentializedUPath: CredentializedUPath)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      vault <- vaultCache.getOrLoad(vaultCacheKeyFor(credentializedUPath), createVault(_)) ?~> Msg.DataVault.setupFailed
    } yield new VaultPath(credentializedUPath.upath, vault)

  private def removeVaultFromCache(
      credentializedUPath: CredentializedUPath
  )(implicit ec: ExecutionContext): Fox[Unit] = {
    vaultCache.remove(vaultCacheKeyFor(credentializedUPath))
    Fox.successful(())
  }

  private def createVault(credentializedUPath: CredentializedUPath)(implicit ec: ExecutionContext): Fox[DataVault] =
    credentializedUPath.upath match {
      case ZipEntryUPath(outerPath, _) =>
        val credentializedOuterPath = credentializedUPath.copy(upath = outerPath)
        for {
          _ <- Fox.fromBool(!outerPath.isInstanceOf[ZipEntryUPath]) ?~> "Nested zip paths are not supported."
          outerVaultPath <- vaultPathFor(credentializedOuterPath)
        } yield new ZipDataVault(outerVaultPath)
      case _ =>
        val vaultBox = credentializedUPath.upath.getScheme match {
          case Some(PathSchemes.schemeGS) => GoogleCloudDataVault.create(credentializedUPath)
          case Some(PathSchemes.schemeS3) => S3DataVault.create(credentializedUPath, s3ClientPoolHolder.s3ClientPool)
          case Some(PathSchemes.schemeHttps) | Some(PathSchemes.schemeHttp) =>
            HttpsDataVault.create(credentializedUPath, ws, config.Http.uri)
          case None => Full(FileSystemDataVault.create)
          case _    => Failure(s"Unknown file system scheme ${credentializedUPath.upath.getScheme}")
        }
        vaultBox match {
          case Full(_)    => logger.info(s"Created data vault for ${credentializedUPath.upath.toString}.")
          case f: Failure =>
            logger.warn(
              s"Failed to create DataVault for ${credentializedUPath.upath.toString}: ${formatFailureChain(f)}"
            )
          case Empty => logger.warn(s"Failed to create DataVault for ${credentializedUPath.upath.toString}.")
        }
        vaultBox.toFox
    }

}
