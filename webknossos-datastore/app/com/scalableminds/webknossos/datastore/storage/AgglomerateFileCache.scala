package com.scalableminds.webknossos.datastore.storage

import java.nio.file.Path
import java.util

import ch.systemsx.cisd.hdf5.{HDF5DataSet, IHDF5Reader}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.webknossos.datastore.dataformats.SafeCachable
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceDataRequest}
import com.typesafe.scalalogging.LazyLogging

import scala.collection.mutable

case class CachedAgglomerateFile(reader: IHDF5Reader,
                                 dataset: HDF5DataSet,
                                 agglomerateIdCache: AgglomerateIdCache,
                                 cache: Either[AgglomerateIdCache, BoundingBoxCache])
    extends SafeCachable {
  override protected def onFinalize(): Unit = { dataset.close(); reader.close() }
}

case class AgglomerateFileKey(
    organizationId: String,
    datasetDirectoryName: String,
    layerName: String,
    mappingName: String
) {
  def path(dataBaseDir: Path, agglomerateDir: String, agglomerateFileExtension: String): Path =
    dataBaseDir
      .resolve(organizationId)
      .resolve(datasetDirectoryName)
      .resolve(layerName)
      .resolve(agglomerateDir)
      .resolve(s"$mappingName.$agglomerateFileExtension")

  def zarrGroupPath(dataBaseDir: Path, agglomerateDir: String): Path =
    dataBaseDir
      .resolve(organizationId)
      .resolve(datasetDirectoryName)
      .resolve(layerName)
      .resolve(agglomerateDir)
      .resolve(mappingName)
}

object AgglomerateFileKey {
  def fromDataRequest(dataRequest: DataServiceDataRequest): AgglomerateFileKey =
    AgglomerateFileKey(
      dataRequest.dataSourceIdOrVolumeDummy.organizationId,
      dataRequest.dataSourceIdOrVolumeDummy.directoryName,
      dataRequest.dataLayer.name,
      dataRequest.settings.appliedAgglomerate.get
    )
}

class AgglomerateFileCache(val maxEntries: Int) extends LRUConcurrentCache[AgglomerateFileKey, CachedAgglomerateFile] {
  override def onElementRemoval(key: AgglomerateFileKey, value: CachedAgglomerateFile): Unit =
    value.scheduleForRemoval()

  def withCache(agglomerateFileKey: AgglomerateFileKey)(
      loadFn: AgglomerateFileKey => CachedAgglomerateFile): CachedAgglomerateFile = {

    def handleUncachedAgglomerateFile() = {
      val agglomerateFile = loadFn(agglomerateFileKey)
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

  def withCache(segmentId: Long, reader: IHDF5Reader, hdf5DataSet: HDF5DataSet)(
      readFromFile: (IHDF5Reader, HDF5DataSet, Long, Long) => Array[Long]): Long = {

    def handleUncachedAgglomerate(): Long = {
      val minId =
        if (segmentId < standardBlockSize / 2) 0L else segmentId - standardBlockSize / 2

      val agglomerateIds = readFromFile(reader, hdf5DataSet, minId, standardBlockSize)

      agglomerateIds.zipWithIndex.foreach {
        case (id, index) => put(index + minId, id)
      }

      agglomerateIds((segmentId - minId).toInt)
    }

    getOrHandleUncachedKey(segmentId, () => handleUncachedAgglomerate())
  }
}

case class BoundingBoxValues(idRange: (Long, Long), dimensions: (Long, Long, Long))

case class BoundingBoxFinder(
    xCoordinates: util.TreeSet[Long], // TreeSets allow us to find the largest coordinate, which is smaller than the requested cuboid
    yCoordinates: util.TreeSet[Long],
    zCoordinates: util.TreeSet[Long],
    minBoundingBox: (Long, Long, Long)) {
  def findInitialBoundingBox(cuboid: Cuboid): (Long, Long, Long) = {
    val x = Option(xCoordinates.floor(cuboid.topLeft.voxelXInMag))
    val y = Option(yCoordinates.floor(cuboid.topLeft.voxelYInMag))
    val z = Option(zCoordinates.floor(cuboid.topLeft.voxelZInMag))
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
    val maxReaderRange: Long) // config value for maximum amount of elements that are allowed to be read as once
    extends LazyLogging {

  // get the segment id range for one cuboid
  private def getReaderRange(request: DataServiceDataRequest): (Long, Long) = {
    val requestedCuboidMag1 = request.cuboid.toMag1

    // get min bounds
    val initialBoundingBoxTopleft: (Long, Long, Long) = boundingBoxFinder.findInitialBoundingBox(requestedCuboidMag1)

    // get max bounds
    val requestedCuboidBottomRight = requestedCuboidMag1.bottomRight
    val dataLayerBoxBottomRight = request.dataLayer.boundingBox.bottomRight

    // use the values of first bb to initialize the range and dimensions
    val initialValues = cache(initialBoundingBoxTopleft)
    var range = initialValues.idRange
    var currDimensions = initialValues.dimensions

    var x = initialBoundingBoxTopleft._1
    var y = initialBoundingBoxTopleft._2
    var z = initialBoundingBoxTopleft._3

    // step through each bb, but save starting coordinates to reset iteration once the outer bound is reached
    while (x < requestedCuboidBottomRight.voxelXInMag && x < dataLayerBoxBottomRight.x) {
      val nextBBinX = (x + currDimensions._1, y, z)
      currDimensions = (currDimensions._1, initialValues.dimensions._2, currDimensions._3) // reset currDimensions y to start next loop at beginning
      while (y < requestedCuboidBottomRight.voxelYInMag && y < dataLayerBoxBottomRight.y) {
        val nextBBinY = (x, y + currDimensions._2, z)
        currDimensions = (currDimensions._1, currDimensions._2, initialValues.dimensions._3) // reset currDimensions z to start next loop at beginning
        while (z < requestedCuboidBottomRight.voxelZInMag && z < dataLayerBoxBottomRight.z) {
          // get cached values for current bb and update the reader range by extending if necessary
          cache.get((x, y, z)).foreach { value =>
            range = (Math.min(range._1, value.idRange._1), Math.max(range._2, value.idRange._2))
            currDimensions = value.dimensions
          }
          z = z + currDimensions._3
        }
        y = nextBBinY._2
        z = nextBBinY._3
      }
      x = nextBBinX._1
      y = nextBBinX._2
      z = nextBBinX._3
    }
    range
  }

  def withCache(request: DataServiceDataRequest, input: Array[Long], reader: IHDF5Reader)(
      readHDF: (IHDF5Reader, Long, Long) => Array[Long]): Array[Long] = {
    val readerRange = getReaderRange(request)
    if (readerRange._2 - readerRange._1 < maxReaderRange) {
      val agglomerateIds = readHDF(reader, readerRange._1, (readerRange._2 - readerRange._1) + 1)
      input.map(i => if (i == 0L) 0L else agglomerateIds((i - readerRange._1).toInt))
    } else {
      // if reader range does not fit in main memory, read agglomerate ids in chunks
      var offset = readerRange._1
      val result = Array.ofDim[Long](input.length)
      val isTransformed = Array.fill(input.length)(false)
      while (offset <= readerRange._2) {
        val agglomerateIds: Array[Long] =
          readHDF(reader, offset, Math.min(maxReaderRange, readerRange._2 - offset) + 1)
        for (i <- input.indices) {
          val inputElement = input(i)
          if (!isTransformed(i) && inputElement >= offset && inputElement < offset + maxReaderRange) {
            result(i) = if (inputElement == 0L) 0L else agglomerateIds((inputElement - offset).toInt)
            isTransformed(i) = true
          }
        }
        offset = offset + maxReaderRange
      }
      result
    }
  }

}
