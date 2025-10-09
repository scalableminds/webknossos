package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.{Box, Full}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import ucar.ma2.{Array => MultiArray}
import jakarta.inject.Inject

trait ChunkCacheService {
  protected val maxSizeBytes: Long

  lazy val sharedChunkContentsCache: AlfuCache[String, MultiArray] = {
    // Used by DatasetArray-based datasets. Measure item weight in kilobytes because the weigher can only return int, not long

    val maxSizeKiloBytes = Math.floor(maxSizeBytes.toDouble / 1000.0).toInt

    def cacheWeight(key: String, arrayBox: Box[MultiArray]): Int =
      arrayBox match {
        case Full(array) =>
          (array.getSizeBytes / 1000L).toInt
        case _ => 0
      }

    AlfuCache(maxSizeKiloBytes, weighFn = Some(cacheWeight))
  }
}

class DSChunkCacheService @Inject()(config: DataStoreConfig) extends ChunkCacheService {
  protected val maxSizeBytes: Long = config.Datastore.Cache.ImageArrayChunks.maxSizeBytes
}
