package com.scalableminds.webknossos.datastore.jzarr

import com.scalableminds.util.cache.LRUConcurrentCache
import ucar.ma2.{Array => MultiArray}

class ChunkContentsCache(maxSizeBytes: Int, bytesPerEntry: Int) extends LRUConcurrentCache[String, MultiArray] {
  def maxEntries: Int = maxSizeBytes / bytesPerEntry
}
