package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.DSRemoteWebknossosClient
import com.scalableminds.util.tools.Box
import com.scalableminds.util.tools.Box.tryo

import java.net.URI
import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class RemoteSourceDescriptor(uri: URI, credential: Option[DataVaultCredential])

class RemoteSourceDescriptorService @Inject() (
    dSRemoteWebknossosClient: DSRemoteWebknossosClient,
    dataStoreConfig: DataStoreConfig,
    dataVaultService: DataVaultService
) {

  def vaultPathFor(baseDir: Path, datasetId: DataSourceId, layerName: String, magLocator: MagLocator)(implicit
      ec: ExecutionContext
  ): Fox[VaultPath] =
    for {
      remoteSourceDescriptor <- remoteSourceDescriptorFor(baseDir, datasetId, layerName, magLocator)
      vaultPath <- dataVaultService.getVaultPath(remoteSourceDescriptor)
    } yield vaultPath

  def removeVaultFromCache(baseDir: Path, datasetId: DataSourceId, layerName: String, magLocator: MagLocator)(implicit
      ec: ExecutionContext
  ): Fox[Unit] =
    for {
      remoteSource <- remoteSourceDescriptorFor(baseDir, datasetId, layerName, magLocator)
      _ = dataVaultService.removeVaultFromCache(remoteSource)
    } yield ()

  private def remoteSourceDescriptorFor(
      baseDir: Path,
      datasetId: DataSourceId,
      layerName: String,
      magLocator: MagLocator
  )(implicit ec: ExecutionContext): Fox[RemoteSourceDescriptor] =
    for {
      credentialBox <- credentialFor(magLocator: MagLocator).futureBox
      uri <- uriForMagLocator(baseDir, datasetId, layerName, magLocator).toFox
      remoteSource = RemoteSourceDescriptor(uri, credentialBox.toOption)
    } yield remoteSource

  private def uriForMagLocator(
      baseDir: Path,
      dataSourceId: DataSourceId,
      layerName: String,
      magLocator: MagLocator
  ): Box[URI] = tryo {
    val localDatasetDir = baseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    val localLayerDir = localDatasetDir.resolve(layerName)
    magLocator.path match {
      case Some(magLocatorPath) =>
        val uri = new URI(magLocatorPath)
        if (DataVaultService.isRemoteScheme(uri.getScheme)) {
          uri
        } else if (uri.getScheme == null || uri.getScheme == DataVaultService.schemeFile) {
          val localPath = Paths.get(uri.getPath)
          if (localPath.isAbsolute) {
            if (
              dataStoreConfig.Datastore.localDirectoryWhitelist
                .exists(whitelistEntry => localPath.toString.startsWith(whitelistEntry))
            )
              uri
            else
              throw new Exception(
                s"Absolute path $localPath in local file system is not in path whitelist. Consider adding it to datastore.localDirectoryWhitelist"
              )
          } else { // relative local path, resolve in dataset dir
            val magPathRelativeToDataset = localDatasetDir.resolve(localPath)
            val magPathRelativeToLayer = localDatasetDir.resolve(layerName).resolve(localPath)
            if (magPathRelativeToDataset.toFile.exists) {
              localFileUriFromPath(magPathRelativeToDataset)
            } else {
              localFileUriFromPath(magPathRelativeToLayer)
            }
          }
        } else {
          throw new Exception(s"Unsupported mag path: $magLocatorPath")
        }
      case _ =>
        val localDirWithScalarMag = localLayerDir.resolve(magLocator.mag.toMagLiteral(allowScalar = true))
        val localDirWithVec3Mag = localLayerDir.resolve(magLocator.mag.toMagLiteral())
        if (localDirWithScalarMag.toFile.exists) {
          localFileUriFromPath(localDirWithScalarMag)
        } else localFileUriFromPath(localDirWithVec3Mag)
    }
  }

  private def localFileUriFromPath(path: Path) =
    path.toAbsolutePath.toUri

  private def credentialFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[DataVaultCredential] =
    magLocator.credentialId match {
      case Some(credentialId) =>
        dSRemoteWebknossosClient.getCredential(credentialId)
      case None =>
        magLocator.credentials match {
          case Some(credential) => Fox.successful(credential)
          case None             => Fox.empty
        }
    }
}
