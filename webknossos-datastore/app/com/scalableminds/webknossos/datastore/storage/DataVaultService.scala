package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
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
import net.liftweb.common.Full
import play.api.libs.ws.WSClient

import javax.inject.Inject
import scala.concurrent.ExecutionContext

object DataVaultService {
  val schemeS3: String = "s3"
  val schemeHttps: String = "https"
  val schemeHttp: String = "http"
  val schemeGS: String = "gs"
  val schemeFile: String = "file"

  def isRemoteScheme(uriScheme: String): Boolean =
    List(schemeS3, schemeHttps, schemeHttp, schemeGS).contains(uriScheme)
}

class DataVaultService @Inject()(ws: WSClient, config: DataStoreConfig) extends LazyLogging {

  private val vaultCache: AlfuCache[RemoteSourceDescriptor, DataVault] =
    AlfuCache(maxCapacity = 100)

  def getVaultPath(remoteSourceDescriptor: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      vault <- vaultCache.getOrLoad(remoteSourceDescriptor, createVault) ?~> "dataVault.setup.failed"
    } yield new VaultPath(remoteSourceDescriptor.uri, vault)

  def removeVaultFromCache(remoteSourceDescriptor: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.successful(vaultCache.remove(remoteSourceDescriptor))

  private def createVault(remoteSource: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[DataVault] = {
    val scheme = remoteSource.uri.getScheme
    try {
      val fs: DataVault = if (scheme == DataVaultService.schemeGS) {
        GoogleCloudDataVault.create(remoteSource)
      } else if (scheme == DataVaultService.schemeS3) {
        S3DataVault.create(remoteSource, ws)
      } else if (scheme == DataVaultService.schemeHttps || scheme == DataVaultService.schemeHttp) {
        HttpsDataVault.create(remoteSource, ws, config.Http.uri)
      } else if (scheme == DataVaultService.schemeFile) {
        FileSystemDataVault.create
      } else {
        throw new Exception(s"Unknown file system scheme $scheme")
      }
      logger.info(s"Created data vault for ${remoteSource.uri.toString}")
      Fox.successful(fs)
    } catch {
      case e: Exception =>
        val msg = s"Creating data vault errored for ${remoteSource.uri.toString}:"
        logger.error(msg, e)
        Fox.failure(msg, Full(e))
    }
  }

}
