package com.scalableminds.webknossos.datastore.storage

import java.util
import ch.systemsx.cisd.hdf5.{HDF5DataSet, IHDF5Reader}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.dataformats.SafeCachable
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceDataRequest}
import com.scalableminds.webknossos.datastore.storage
import spire.math.{ULong, min, max}
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.typesafe.scalalogging.LazyLogging

import scala.collection.mutable

case class CachedAgglomerateFile(reader: IHDF5Reader,
                                 dataset: HDF5DataSet,
                                 cache: Either[AgglomerateIdCache, BoundingBoxCache])
    extends SafeCachable {
  override protected def onFinalize(): Unit = { dataset.close(); reader.close() }
}

case class AgglomerateFileKey(
    organization: String,
    dataSourceName: String,
    dataLayerName: String,
    agglomerateName: String
)

object AgglomerateFileKey {
  def from(dataRequest: DataServiceDataRequest): AgglomerateFileKey =
    storage.AgglomerateFileKey(dataRequest.dataSource.id.team,
                               dataRequest.dataSource.id.name,
                               dataRequest.dataLayer.name,
                               dataRequest.settings.appliedAgglomerate.get)
}

class AgglomerateFileCache(val maxEntries: Int) extends LRUConcurrentCache[AgglomerateFileKey, CachedAgglomerateFile] {
  override def onElementRemoval(key: AgglomerateFileKey, value: CachedAgglomerateFile): Unit =
    value.scheduleForRemoval()

  def withCache(dataRequest: DataServiceDataRequest)(
      loadFn: DataServiceDataRequest => CachedAgglomerateFile): CachedAgglomerateFile = {
    val agglomerateFileKey = AgglomerateFileKey.from(dataRequest)

    def handleUncachedAgglomerateFile() = {
      val agglomerateFile = loadFn(dataRequest)
      // We don't need to check the return value of the `tryAccess` call as we just created the agglomerate file and use it only to increase the access counter.
      agglomerateFile.tryAccess()
      put(agglomerateFileKey, agglomerateFile)
      agglomerateFile
    }

    this.synchronized {
      get(agglomerateFileKey) match {
        case Some(agglomerateFile) =>
          if (agglomerateFile.tryAccess()) agglomerateFile else handleUncachedAgglomerateFile()
        case _ => handleUncachedAgglomerateFile()
      }
    }
  }
}

class AgglomerateIdCache(val maxEntries: Int, val standardBlockSize: Int) extends LRUConcurrentCache[Long, Long] {
  // On cache miss, reads whole blocks of IDs (number of elements is standardBlockSize)

  def withCache(segmentId: ULong, reader: IHDF5Reader, dataSet: HDF5DataSet)(
      readFromFile: (IHDF5Reader, HDF5DataSet, Long, Long) => Array[Long]): Long = {

    def handleUncachedAgglomerate(): Long = {
      val minId =
        if (segmentId < ULong(standardBlockSize / 2)) ULong(0) else segmentId - ULong(standardBlockSize / 2)

      val agglomerateIds = readFromFile(reader, dataSet, minId.toLong, standardBlockSize)

      agglomerateIds.zipWithIndex.foreach {
        case (id, index) => put(index + minId.toLong, id)
      }

      agglomerateIds((segmentId - minId).toInt)
    }

    getOrHandleUncachedKey(segmentId.toLong, () => handleUncachedAgglomerate())
  }
}

case class BoundingBoxValues(idRange: (ULong, ULong), dimensions: (Long, Long, Long))

case class BoundingBoxFinder(
    xCoordinates: util.TreeSet[Long], // TreeSets allow us to find the largest coordinate, which is smaller than the requested cuboid
    yCoordinates: util.TreeSet[Long],
    zCoordinates: util.TreeSet[Long],
    minBoundingBox: (Long, Long, Long)) {
  def findInitialBoundingBox(cuboid: Cuboid): (Long, Long, Long) = {
    val x = Option(xCoordinates.floor(cuboid.topLeft.x))
    val y = Option(yCoordinates.floor(cuboid.topLeft.y))
    val z = Option(zCoordinates.floor(cuboid.topLeft.z))
    (x.getOrElse(minBoundingBox._1), y.getOrElse(minBoundingBox._2), z.getOrElse(minBoundingBox._3)) // if the request is outside the layer box, use the minimal bb as start point
  }
}

// This bounding box cache uses the cumsum.json to speed up the agglomerate mapping. The cumsum.json contains information about all bounding boxes of the dataset and the contained segment ids.
// The typical query for the agglomerate file is to map a complete bucket/bbox, not to translate individual IDs.
// Thus, we can load the correct part from the AgglomerateFile without having to maintain an ID cache because we can translate the whole input array.
// One special case is an input value of 0, which is automatically mapped to 0.

class BoundingBoxCache(
    val cache: mutable.HashMap[(Long, Long, Long), BoundingBoxValues], // maps bounding box top left to range and bb dimensions
    val boundingBoxFinder: BoundingBoxFinder, // saves the bb top left positions
    val maxReaderRange: ULong) // config value for maximum amount of elements that are allowed to be read as once
    extends LazyLogging {
  private def getGlobalCuboid(cuboid: Cuboid): Cuboid = {
    val res = cuboid.resolution
    val tl = cuboid.topLeft
    Cuboid(new VoxelPosition(tl.x * res.x, tl.y * res.y, tl.z * res.z, Point3D(1, 1, 1)),
           cuboid.width * res.x,
           cuboid.height * res.y,
           cuboid.depth * res.z)
  }

  // get the segment ID range for one cuboid
  private def getReaderRange(request: DataServiceDataRequest): (ULong, ULong) = {
    // convert cuboid to global coordinates (in res 1)
    val globalCuboid = getGlobalCuboid(request.cuboid)

    // get min bounds
    val initialBoundingBox = boundingBoxFinder.findInitialBoundingBox(globalCuboid)

    // get max bounds
    val requestedCuboid = globalCuboid.bottomRight
    val dataLayerBox = request.dataLayer.boundingBox.bottomRight

    // use the values of first bb to initialize the range and dimensions
    val initialValues = cache(initialBoundingBox)
    var range = initialValues.idRange
    var currDimensions = initialValues.dimensions

    var x = initialBoundingBox._1
    var y = initialBoundingBox._2
    var z = initialBoundingBox._3

    // step through each bb, but save starting coordinates to reset iteration once the outer bound is reached
    while (x < requestedCuboid.x && x < dataLayerBox.x) {
      val nextBBinX = (x + currDimensions._1, y, z)
      while (y < requestedCuboid.y && y < dataLayerBox.y) {
        val nextBBinY = (x, y + currDimensions._2, z)
        while (z < requestedCuboid.z && z < dataLayerBox.z) {
          // get cached values for current bb and update the reader range by extending if necessary
          cache.get((x, y, z)).foreach { value =>
            range = (min(range._1, value.idRange._1), max(range._2, value.idRange._2))
            currDimensions = value.dimensions
          }
          z = z + currDimensions._3
        }
        x = nextBBinY._1
        y = nextBBinY._2
        z = nextBBinY._3
      }
      x = nextBBinX._1
      y = nextBBinX._2
      z = nextBBinX._3
    }
    range
  }

  def withCache(request: DataServiceDataRequest, input: Array[ULong], reader: IHDF5Reader)(
      readHDF: (IHDF5Reader, Long, Long) => Array[Long]): Array[Long] = {
    val readerRange = getReaderRange(request)
    if (readerRange._2 - readerRange._1 < maxReaderRange) {
      val agglomerateIds = readHDF(reader, readerRange._1.toLong, (readerRange._2 - readerRange._1).toLong + 1)
      input.map(i => if (i == ULong(0)) 0L else agglomerateIds((i - readerRange._1).toInt))
    } else {
      // if reader range does not fit in main memory, read agglomerate ids in chunks
      var offset = readerRange._1
      val result = Array.ofDim[Long](input.length)
      val isTransformed = Array.fill(input.length)(false)
      while (offset <= readerRange._2) {
        val agglomerateIds =
          readHDF(reader, offset.toLong, spire.math.min(maxReaderRange, readerRange._2 - offset).toLong + 1)
        for (i <- input.indices) {
          val inputElement = input(i)
          if (!isTransformed(i) && inputElement >= offset && inputElement < offset + maxReaderRange) {
            result(i) = if (inputElement == ULong(0)) 0L else agglomerateIds((inputElement - offset).toInt)
            isTransformed(i) = true
          }
        }
        offset = offset + maxReaderRange
      }
      result
    }
  }

}
