package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datavault.{GoogleCloudDataVault, HttpsDataVault, VaultPath, S3DataVault}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full

import scala.concurrent.ExecutionContext

object DataVaultsHolder extends LazyLogging {

  val schemeS3: String = "s3"
  val schemeHttps: String = "https"
  val schemeHttp: String = "http"
  val schemeGS: String = "gs"

  private val vaultCache: AlfuFoxCache[RemoteSourceDescriptor, VaultPath] =
    AlfuFoxCache(maxEntries = 100)

  def isSupportedRemoteScheme(uriScheme: String): Boolean =
    List(schemeS3, schemeHttps, schemeHttp, schemeGS).contains(uriScheme)

  def getOrCreate(remoteSourceDescriptor: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[VaultPath] =
    vaultCache.getOrLoad(remoteSourceDescriptor, create)

  private def create(remoteSource: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[VaultPath] = {
    val scheme = remoteSource.uri.getScheme
    try {
      val fs: VaultPath = if (scheme == schemeGS) {
        GoogleCloudDataVault.create(remoteSource)
      } else if (scheme == schemeS3) {
        S3DataVault.create(remoteSource)
      } else if (scheme == schemeHttps || scheme == schemeHttp) {
        HttpsDataVault.create(remoteSource)
      } else {
        throw new Exception(s"Unknown file system scheme $scheme")
      }
      logger.info(s"Successfully created file system for ${remoteSource.uri.toString}")
      Fox.successful(fs)
    } catch {
      case e: Exception =>
        val msg = s"get file system errored for ${remoteSource.uri.toString}:"
        logger.error(msg, e)
        Fox.failure(msg, Full(e))
    }
  }
}
