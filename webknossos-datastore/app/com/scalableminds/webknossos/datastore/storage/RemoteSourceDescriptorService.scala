package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.{ConfigReader, Fox}
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.DSRemoteWebknossosClient
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo
import play.api.Configuration

import java.net.URI
import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class RemoteSourceDescriptor(uri: URI, credential: Option[DataVaultCredential])

class RemoteSourceDescriptorService @Inject()(dSRemoteWebknossosClient: DSRemoteWebknossosClient,
                                              dataStoreConfig: DataStoreConfig,
                                              dataVaultService: DataVaultService)
    extends LazyLogging {

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
      credentialBox <- credentialFor(magLocator: MagLocator).futureBox
      uri <- uriForMagLocator(baseDir, datasetId, layerName, magLocator).toFox
      remoteSource = RemoteSourceDescriptor(uri, credentialBox.toOption)
    } yield remoteSource

  def resolveMagPath(datasetDir: Path, layerDir: Path, layerName: String, magLocator: MagLocator): URI =
    magLocator.path match {
      case Some(magLocatorPath) =>
        val uri = new URI(magLocatorPath)
        if (DataVaultService.isRemoteScheme(uri.getScheme)) {
          uri
        } else if (uri.getScheme == null || uri.getScheme == DataVaultService.schemeFile) {
          val localPath = Paths.get(uri.getPath)
          if (localPath.isAbsolute) {
            if (dataStoreConfig.Datastore.localDirectoryWhitelist.exists(whitelistEntry =>
                  localPath.toString.startsWith(whitelistEntry)))
              uri
            else
              throw new Exception(
                s"Absolute path $localPath in local file system is not in path whitelist. Consider adding it to datastore.localDirectoryWhitelist")
          } else { // relative local path, resolve in dataset dir
            val magPathRelativeToDataset = datasetDir.resolve(localPath)
            val magPathRelativeToLayer = datasetDir.resolve(layerName).resolve(localPath)
            if (magPathRelativeToDataset.toFile.exists) {
              magPathRelativeToDataset.toUri
            } else {
              magPathRelativeToLayer.toUri
            }
          }
        } else {
          throw new Exception(s"Unsupported mag path: $magLocatorPath")
        }
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

  private lazy val globalCredentials = dataStoreConfig.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
    new CredentialConfigReader(credentialConfig).getCredential
  }

  private def credentialFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[DataVaultCredential] = {
    logger.info(s"globalCredentials: ${globalCredentials.mkString(",")}")
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
}

class CredentialConfigReader(underlyingConfig: Config) extends ConfigReader {
  override val raw: Configuration = Configuration(underlyingConfig)
  def getCredential: Option[DataVaultCredential] =
    for {
      typeLiteral <- getOptional[String]("type")
      typParsed <- CredentialType.fromString(typeLiteral)
      credential <- typParsed match {
        case CredentialType.S3AccessKey => getAsS3
        case _                          => None
      }
    } yield credential

  private def getAsS3: Option[S3AccessKeyCredential] =
    for {
      name <- getOptional[String]("name")
      keyId <- getOptional[String]("identifier")
      key <- getOptional[String]("secret")
    } yield
      S3AccessKeyCredential(
        name,
        keyId,
        key,
        None,
        None
      )
}
