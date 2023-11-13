package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import net.liftweb.common.{Box, Full}

import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class SegmentIndexFileService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with Hdf5Utils {
  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val segmentIndexDir = "segment-index"
  private val segmentIndexFileExtension = "hdf5"

  private lazy val meshFileCache = new Hdf5FileCache(10)

  private def getSegmentIndexFile(organizationName: String, datasetName: String, dataLayerName: String): Box[Path] =
    for {
      _ <- Full("")
      layerDir = dataBaseDir.resolve(organizationName).resolve(datasetName).resolve(dataLayerName)
      segmentIndexDir = layerDir.resolve(this.segmentIndexDir)
      files <- PathUtils.listFiles(segmentIndexDir,
                                   silent = false,
                                   PathUtils.fileExtensionFilter(segmentIndexFileExtension))
      file <- files.headOption
    } yield file

  def readSegmentIndex(organizationName: String,
                       datasetName: String,
                       dataLayerName: String,
                       segmentId: Long): Fox[Array[Vec3Int]] =
    for {
      segmentIndexPath <- getSegmentIndexFile(organizationName, datasetName, dataLayerName).toFox
      segmentIndex = meshFileCache.withCache(segmentIndexPath)(CachedHdf5File.fromPath)
      hashFunction = getHashFunction(segmentIndex.reader.string().getAttr("/", "hash_function"))
      nBuckets = segmentIndex.reader.uint64().getAttr("/", "n_buckets")
      bucketIndex = hashFunction(segmentId) % nBuckets
      bucketOffsets = segmentIndex.reader.uint64().readArrayBlockWithOffset("bucket_offsets", 2, bucketIndex)
      bucketStart = bucketOffsets(0)
      bucketEnd = bucketOffsets(1)
      _ <- bool2Fox(bucketEnd - bucketStart != 0)
      buckets = segmentIndex.reader
        .uint64()
        .readMatrixBlockWithOffset("buckets", (bucketEnd - bucketStart + 1).toInt, 3, bucketStart, 0)
      bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
      _ <- bool2Fox(bucketLocalOffset >= 0)
      topLeftStart = buckets(bucketLocalOffset)(1)
      topLeftEnd = buckets(bucketLocalOffset)(2)
      topLefts = segmentIndex.reader
        .uint16() // Read datatype from attributes?
        .readMatrixBlockWithOffset("top_lefts", (topLeftEnd - topLeftStart).toInt, 3, topLeftStart, 0)

    } yield topLefts.flatMap(topLeft => Vec3Int.fromArray(topLeft.map(_.toInt)))

}
