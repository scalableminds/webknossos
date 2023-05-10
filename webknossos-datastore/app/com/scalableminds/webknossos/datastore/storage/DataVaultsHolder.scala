package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datavault.{
  DataVault,
  GoogleCloudDataVault,
  HttpsDataVault,
  S3DataVault,
  VaultPath
}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full

import scala.concurrent.ExecutionContext

object DataVaultsHolder extends LazyLogging {

  val schemeS3: String = "s3"
  val schemeHttps: String = "https"
  val schemeHttp: String = "http"
  val schemeGS: String = "gs"

  private val vaultCache: AlfuCache[RemoteSourceDescriptor, DataVault] =
    AlfuCache(maxCapacity = 100)

  def isSupportedRemoteScheme(uriScheme: String): Boolean =
    List(schemeS3, schemeHttps, schemeHttp, schemeGS).contains(uriScheme)

  def getVaultPath(remoteSourceDescriptor: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      vault <- vaultCache.getOrLoad(remoteSourceDescriptor, create)
    } yield new VaultPath(remoteSourceDescriptor.uri, vault)

  def clearVaultPathCache(remoteSourceDescriptor: RemoteSourceDescriptor): Unit =
    vaultCache.remove(remoteSourceDescriptor)

  private def create(remoteSource: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[DataVault] = {
    val scheme = remoteSource.uri.getScheme
    try {
      val fs: DataVault = if (scheme == schemeGS) {
        GoogleCloudDataVault.create(remoteSource)
      } else if (scheme == schemeS3) {
        S3DataVault.create(remoteSource)
      } else if (scheme == schemeHttps || scheme == schemeHttp) {
        HttpsDataVault.create(remoteSource)
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
