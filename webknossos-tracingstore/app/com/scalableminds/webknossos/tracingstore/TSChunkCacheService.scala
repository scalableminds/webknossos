package com.scalableminds.webknossos.tracingstore

import com.scalableminds.webknossos.datastore.services.ChunkCacheService
import jakarta.inject.Inject

class TSChunkCacheService @Inject()(config: TracingStoreConfig) extends ChunkCacheService {
  protected val maxSizeBytes: Long = config.Tracingstore.Cache.chunkCacheMaxSizeBytes
}
