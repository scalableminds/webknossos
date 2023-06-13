package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datavault.{
  DataVault,
  GoogleCloudDataVault,
  HttpsDataVault,
  S3DataVault,
  VaultPath
}
import com.scalableminds.webknossos.datastore.services.DSRemoteWebKnossosClient
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full
import play.api.libs.ws.WSClient

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class RemoteSourceDescriptor(uri: URI, credential: Option[DataVaultCredential])

object DataVaultService {
  val schemeS3: String = "s3"
  val schemeHttps: String = "https"
  val schemeHttp: String = "http"
  val schemeGS: String = "gs"

  def isSupportedRemoteScheme(uriScheme: String): Boolean =
    List(schemeS3, schemeHttps, schemeHttp, schemeGS).contains(uriScheme)
}

class DataVaultService @Inject()(dSRemoteWebKnossosClient: DSRemoteWebKnossosClient, ws: WSClient) extends LazyLogging {

  private val vaultCache: AlfuFoxCache[RemoteSourceDescriptor, DataVault] =
    AlfuFoxCache(maxEntries = 100)

  def vaultPathFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      remoteSourceDescriptor <- remoteSourceDescriptorFor(magLocator)
      vaultPath <- getVaultPath(remoteSourceDescriptor)
    } yield vaultPath

  def getVaultPath(remoteSourceDescriptor: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      vault <- vaultCache.getOrLoad(remoteSourceDescriptor, createVault) ?~> "dataVault.setup.failed"
    } yield new VaultPath(remoteSourceDescriptor.uri, vault)

  def removeVaultFromCache(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      remoteSource <- remoteSourceDescriptorFor(magLocator)
      _ = vaultCache.remove(remoteSource)
    } yield ()

  private def remoteSourceDescriptorFor(magLocator: MagLocator)(
      implicit ec: ExecutionContext): Fox[RemoteSourceDescriptor] =
    for {
      credentialBox <- credentialFor(magLocator: MagLocator).futureBox
      remoteSource = RemoteSourceDescriptor(magLocator.uri, credentialBox.toOption)
    } yield remoteSource

  private def credentialFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[DataVaultCredential] =
    magLocator.credentialId match {
      case Some(credentialId) =>
        dSRemoteWebKnossosClient.getCredential(credentialId)
      case None =>
        magLocator.credentials match {
          case Some(credential) => Fox.successful(credential)
          case None             => Fox.empty
        }
    }

  private def createVault(remoteSource: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[DataVault] = {
    val scheme = remoteSource.uri.getScheme
    try {
      val fs: DataVault = if (scheme == DataVaultService.schemeGS) {
        GoogleCloudDataVault.create(remoteSource)
      } else if (scheme == DataVaultService.schemeS3) {
        S3DataVault.create(remoteSource)
      } else if (scheme == DataVaultService.schemeHttps || scheme == DataVaultService.schemeHttp) {
        HttpsDataVault.create(remoteSource, ws)
      } else {
        throw new Exception(s"Unknown file system scheme $scheme")
      }
      logger.info(s"Successfully created data vault for ${remoteSource.uri.toString}")
      Fox.successful(fs)
    } catch {
      case e: Exception =>
        val msg = s"get vault path errored for ${remoteSource.uri.toString}:"
        logger.error(msg, e)
        Fox.failure(msg, Full(e))
    }
  }

}
