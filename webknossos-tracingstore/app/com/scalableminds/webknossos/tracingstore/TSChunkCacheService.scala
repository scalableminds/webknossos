package com.scalableminds.webknossos.tracingstore

import com.scalableminds.webknossos.datastore.services.ChunkCacheService
import jakarta.inject.Inject

/* Currently the only usage of this cache is in editablemapping upload. There, the full arrays are read, so
 * the cache is not really useful and just added to satisfy the DatasetArray parameters. Because of that it is
 * configured to be pretty small to not waste RAM. When more usages are added, remove this comment and increase the
 * size in application.conf
 */
class TSChunkCacheService @Inject()(config: TracingStoreConfig) extends ChunkCacheService {
  protected val maxSizeBytes: Long = config.Tracingstore.Cache.chunkCacheMaxSizeBytes
}
