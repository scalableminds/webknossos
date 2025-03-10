package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.cache.AlfuCache

import java.nio.file.Paths
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Full}
import ucar.ma2.{Array => MultiArray}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

/*
 * The BinaryDataService needs to be instantiated as singleton to provide a shared DataCubeCache.
 * There is, however an additional instance for volume tracings in the TracingStore
 * The TracingStore one (for VolumeTracings) already is a singleton, since the surrounding VolumeTracingService is a singleton.
 * The DataStore one is singleton-ized via this holder.
 */

class BinaryDataServiceHolder @Inject()(
    config: DataStoreConfig,
    agglomerateService: AgglomerateService,
    remoteSourceDescriptorService: RemoteSourceDescriptorService,
    datasetErrorLoggingService: DatasetErrorLoggingService,
    remoteWebknossosClient: DSRemoteWebknossosClient)(implicit ec: ExecutionContext)
    extends LazyLogging {

  private lazy val sharedChunkContentsCache: AlfuCache[String, MultiArray] = {
    // Used by DatasetArray-based datasets. Measure item weight in kilobytes because the weigher can only return int, not long

    val maxSizeKiloBytes = Math.floor(config.Datastore.Cache.ImageArrayChunks.maxSizeBytes.toDouble / 1000.0).toInt

    def cacheWeight(key: String, arrayBox: Box[MultiArray]): Int =
      arrayBox match {
        case Full(array) =>
          (array.getSizeBytes / 1000L).toInt
        case _ => 0
      }

    AlfuCache(maxSizeKiloBytes, weighFn = Some(cacheWeight))
  }

  val binaryDataService: BinaryDataService = new BinaryDataService(
    Paths.get(config.Datastore.baseDirectory),
    Some(agglomerateService),
    Some(remoteSourceDescriptorService),
    Some(sharedChunkContentsCache),
    Some(datasetErrorLoggingService),
    Some(remoteWebknossosClient)
  )

}
