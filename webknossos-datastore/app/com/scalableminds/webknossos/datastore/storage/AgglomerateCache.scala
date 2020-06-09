package com.scalableminds.webknossos.datastore.storage

import ch.systemsx.cisd.hdf5.{HDF5DataSet, IHDF5Reader}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.dataformats.SafeCachable
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage
import spire.math.ULong
import com.scalableminds.util.tools.TimeLogger
import com.typesafe.scalalogging.LazyLogging

case class CachedReader(reader: IHDF5Reader, dataset: HDF5DataSet, size: ULong) extends SafeCachable {
  override protected def onFinalize(): Unit = { dataset.close(); reader.close() }
}

case class CachedAgglomerateFile(
    organization: String,
    dataSourceName: String,
    dataLayerName: String,
    agglomerateName: String
)

object CachedAgglomerateFile {

  def from(dataRequest: DataServiceDataRequest): CachedAgglomerateFile =
    storage.CachedAgglomerateFile(dataRequest.dataSource.id.team,
                                  dataRequest.dataSource.id.name,
                                  dataRequest.dataLayer.name,
                                  dataRequest.settings.appliedAgglomerate.get)
}

case class CachedAgglomerateKey(organization: String,
                                dataSourceName: String,
                                dataLayerName: String,
                                agglomerateName: String,
                                segmentId: Long)

object CachedAgglomerateKey {
  def from(dataRequest: DataServiceDataRequest, segmentId: Long) =
    storage.CachedAgglomerateKey(dataRequest.dataSource.id.team,
                                 dataRequest.dataSource.id.name,
                                 dataRequest.dataLayer.name,
                                 dataRequest.settings.appliedAgglomerate.get,
                                 segmentId)
}

class AgglomerateFileCache(val maxEntries: Int)
    extends LRUConcurrentCache[CachedAgglomerateFile, CachedReader]
    with LazyLogging {
  override def onElementRemoval(key: CachedAgglomerateFile, value: CachedReader): Unit =
    value.scheduleForRemoval()

  def withCache(dataRequest: DataServiceDataRequest)(loadFn: DataServiceDataRequest => CachedReader): CachedReader = {
    val cachedAgglomerateFile = CachedAgglomerateFile.from(dataRequest)

    def handleUncachedAgglomerateFile() =
      TimeLogger.logTime("handle uncached agglomerate file", logger) {
        val reader = loadFn(dataRequest)
        // We don't need to check the return value of the `tryAccess` call as we just created the reader and use it only to increase the access counter.
        reader.tryAccess()
        put(cachedAgglomerateFile, reader)
        reader
      }

    get(cachedAgglomerateFile) match {
      case Some(reader) => if (reader.tryAccess()) reader else handleUncachedAgglomerateFile()
      case _            => handleUncachedAgglomerateFile()
    }
  }
}

class AgglomerateCache(val maxEntries: Int, val standardBlockSize: Int)
    extends LRUConcurrentCache[CachedAgglomerateKey, Long]
    with LazyLogging {

  def withCache(dataRequest: DataServiceDataRequest, segmentId: ULong, cachedFileHandles: AgglomerateFileCache)(
      readFromFile: (IHDF5Reader, HDF5DataSet, Long, Long) => Array[Long])(
      loadReader: DataServiceDataRequest => CachedReader): Long = {
    val cachedAgglomerateKey = CachedAgglomerateKey.from(dataRequest, segmentId.toLong)

    def handleUncachedAgglomerate(): Long =
      TimeLogger.logTime("handle uncached agglomerate", logger) {
        val cachedReader = cachedFileHandles.withCache(dataRequest)(loadReader)

        val minId =
          if (segmentId < ULong(standardBlockSize / 2)) ULong(0) else segmentId - ULong(standardBlockSize / 2)
        val blockSize = spire.math.min(cachedReader.size - minId, ULong(standardBlockSize))

        val agglomerateIds = readFromFile(cachedReader.reader, cachedReader.dataset, minId.toLong, blockSize.toInt)
        cachedReader.finishAccess()

        agglomerateIds.zipWithIndex.foreach {
          case (id, index) => put(CachedAgglomerateKey.from(dataRequest, index + minId.toLong), id)
        }

        agglomerateIds((segmentId - minId).toInt)
      }

    getOrHandleUncachedKey(cachedAgglomerateKey, handleUncachedAgglomerate)
  }
}
