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
import com.scalableminds.util.tools.Full
import com.scalableminds.webknossos.datastore.helpers.PathSchemes
import play.api.libs.ws.WSClient

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DataVaultService @Inject()(ws: WSClient, config: DataStoreConfig) extends LazyLogging {

  private val vaultCache: AlfuCache[RemoteSourceDescriptor, DataVault] =
    AlfuCache(maxCapacity = 100)

  def getVaultPath(remoteSourceDescriptor: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[VaultPath] =
    for {
      vault <- vaultCache.getOrLoad(remoteSourceDescriptor, createVault) ?~> "dataVault.setup.failed"
    } yield new VaultPath(remoteSourceDescriptor.upath, vault)

  def removeVaultFromCache(remoteSourceDescriptor: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.successful(vaultCache.remove(remoteSourceDescriptor))

  private def createVault(remoteSource: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[DataVault] = {
    val scheme = remoteSource.upath.getScheme
    try {
      val fs: DataVault = scheme match {
        case Some(PathSchemes.schemeGS) => GoogleCloudDataVault.create(remoteSource)
        case Some(PathSchemes.schemeS3) => S3DataVault.create(remoteSource, ws)
        case Some(PathSchemes.schemeHttps) | Some(PathSchemes.schemeHttp) =>
          HttpsDataVault.create(remoteSource, ws, config.Http.uri)
        case None => FileSystemDataVault.create
        case _    => throw new Exception(s"Unknown file system scheme $scheme")
      }
      logger.info(s"Created data vault for ${remoteSource.upath.toString}")
      Fox.successful(fs)
    } catch {
      case e: Exception =>
        val msg = s"Creating data vault errored for ${remoteSource.upath.toString}:"
        logger.error(msg, e)
        Fox.failure(msg, Full(e))
    }
  }

}
