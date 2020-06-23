package com.scalableminds.webknossos.datastore.storage

import java.util

import ch.systemsx.cisd.hdf5.{HDF5DataSet, IHDF5Reader}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.webknossos.datastore.dataformats.SafeCachable
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceDataRequest}
import com.scalableminds.webknossos.datastore.storage
import spire.math.ULong
import com.scalableminds.util.tools.TimeLogger
import com.typesafe.scalalogging.LazyLogging

case class BoundingBoxFinder(xCoordinates: util.TreeSet[Long],
                             yCoordinates: util.TreeSet[Long],
                             zCoordinates: util.TreeSet[Long])

case class CachedReader(reader: IHDF5Reader,
                        dataset: HDF5DataSet,
                        size: ULong,
                        cache: Either[AgglomerateCache, (BoundingBoxFinder, BoundingBoxCache)])
    extends SafeCachable {
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

case class BoundingBoxValues(range: (Long, Long), dimensions: (Long, Long, Long))

class AgglomerateFileCache(val maxEntries: Int)
    extends LRUConcurrentCache[CachedAgglomerateFile, CachedReader]
    with LazyLogging {
  override def onElementRemoval(key: CachedAgglomerateFile, value: CachedReader): Unit =
    value.scheduleForRemoval()

  def withCache(dataRequest: DataServiceDataRequest)(loadFn: DataServiceDataRequest => CachedReader): CachedReader = {
    val cachedAgglomerateFile = CachedAgglomerateFile.from(dataRequest)

    def handleUncachedAgglomerateFile() = {
      val reader = loadFn(dataRequest)
      // We don't need to check the return value of the `tryAccess` call as we just created the reader and use it only to increase the access counter.
      reader.tryAccess()
      put(cachedAgglomerateFile, reader)
      reader
    }

    this.synchronized {
      get(cachedAgglomerateFile) match {
        case Some(reader) => if (reader.tryAccess()) reader else handleUncachedAgglomerateFile()
        case _            => handleUncachedAgglomerateFile()
      }
    }
  }
}

class AgglomerateCache(val maxEntries: Int, val standardBlockSize: Int)
    extends LRUConcurrentCache[Long, Long]
    with LazyLogging {

  def withCache(segmentId: ULong, reader: IHDF5Reader, dataSet: HDF5DataSet, size: ULong)(
      readFromFile: (IHDF5Reader, HDF5DataSet, Long, Long, Boolean) => Array[Long]): Long = {

    def handleUncachedAgglomerate(): Long = {
      val minId =
        if (segmentId < ULong(standardBlockSize / 2)) ULong(0) else segmentId - ULong(standardBlockSize / 2)
      val blockSize = spire.math.min(size - minId, ULong(standardBlockSize))

      val agglomerateIds = readFromFile(reader, dataSet, minId.toLong, blockSize.toInt, true)

      agglomerateIds.zipWithIndex.foreach {
        case (id, index) => put(index + minId.toLong, id)
      }

      agglomerateIds((segmentId - minId).toInt)
    }

    getOrHandleUncachedKey(segmentId.toLong, handleUncachedAgglomerate)
  }
}

class BoundingBoxCache(val maxEntries: Int) extends LRUConcurrentCache[(Long, Long, Long), BoundingBoxValues] {
  var minBoundingBox: (Long, Long, Long) = (0, 0, 0)
  def withCache(request: DataServiceDataRequest, initialBoundingBox: (Long, Long, Long)): (Long, Long) = {
    val requestedCuboid = request.cuboid.bottomRight
    val dataLayerBox = request.dataLayer.boundingBox.bottomRight
    val initialValues = get(initialBoundingBox).getOrElse(get(minBoundingBox).get)
    var range = initialValues.range
    var currDimensions = initialValues.dimensions

    var x = initialBoundingBox._1 + currDimensions._1
    var y = initialBoundingBox._2 + currDimensions._2
    var z = initialBoundingBox._3 + currDimensions._3

    while (x < requestedCuboid.x && x < dataLayerBox.x) {
      val prevX = (x, currDimensions._1)
      while (y < requestedCuboid.y && y < dataLayerBox.y) {
        val prevY = (y, currDimensions._2)
        while (z < requestedCuboid.z && z < dataLayerBox.z) {
          get((x, y, z)).foreach { value =>
            range = (math.min(range._1, value.range._1), math.max(range._2, value.range._2))
            currDimensions = value.dimensions
          }
          z = z + currDimensions._3
        }
        y = prevY._1 + prevY._2
      }
      x = prevX._1 + prevX._2
    }
    range
  }

}
