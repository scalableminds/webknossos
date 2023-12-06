package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.SegmentStatistics
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.models.{DataRequest, UnsignedInteger, UnsignedIntegerArray, VoxelPosition}
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import net.liftweb.common.{Box, Full}
import play.api.i18n.MessagesProvider

import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class SegmentIndexFileService @Inject()(config: DataStoreConfig,
                                        binaryDataServiceHolder: BinaryDataServiceHolder,
                                        dataSourceRepository: DataSourceRepository)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with Hdf5Utils
    with SegmentStatistics {
  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val segmentIndexDir = "segment-index"
  private val segmentIndexFileExtension = "hdf5"

  private lazy val meshFileCache = new Hdf5FileCache(10)

  def getSegmentIndexFile(organizationName: String, datasetName: String, dataLayerName: String): Box[Path] =
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

  def getSegmentVolume(organizationName: String,
                       datasetName: String,
                       dataLayerName: String,
                       segmentId: Long,
                       mag: Vec3Int)(implicit m: MessagesProvider): Fox[Long] = {
    def getTypedDataForSegment(organizationName: String, datasetName: String, dataLayerName: String)(
        segmentId: Long,
        mag: Vec3Int)(implicit m: MessagesProvider) =
      for {
        bucketPositions <- readSegmentIndex(organizationName, datasetName, dataLayerName, segmentId)
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  datasetName,
                                                                                  dataLayerName)
        request = DataRequest(
          VoxelPosition(bucketPositions.head.x, bucketPositions.head.y, bucketPositions.head.z, mag),
          DataLayer.bucketLength,
          DataLayer.bucketLength,
          DataLayer.bucketLength
        )
        data <- binaryDataServiceHolder.binaryDataService.handleDataRequest(
          DataServiceDataRequest(dataSource, dataLayer, None, request.cuboid(dataLayer), request.settings))
        dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(data, dataLayer.elementClass)
      } yield dataTyped
    for {
      _ <- Fox.successful(())
      volume <- calculateSegmentVolume(segmentId,
                                       mag,
                                       getTypedDataForSegment(organizationName, datasetName, dataLayerName))
    } yield volume
  }

}
