package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.SegmentStatistics
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models.{UnsignedInteger, UnsignedIntegerArray, VoxelPosition, datasource}
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
                       segmentId: Long): Fox[(Array[Vec3Int], Vec3Int)] =
    for {
      segmentIndexPath <- getSegmentIndexFile(organizationName, datasetName, dataLayerName).toFox
      segmentIndex = meshFileCache.withCache(segmentIndexPath)(CachedHdf5File.fromPath)
      hashFunction = getHashFunction(segmentIndex.reader.string().getAttr("/", "hash_function"))
      nBuckets = segmentIndex.reader.uint64().getAttr("/", "n_hash_buckets")
      mag <- Vec3Int.fromArray(segmentIndex.reader.uint64().getArrayAttr("/", "mag").map(_.toInt)).toFox
      bucketIndex = hashFunction(segmentId) % nBuckets
      bucketOffsets = segmentIndex.reader.uint64().readArrayBlockWithOffset("hash_bucket_offsets", 2, bucketIndex)
      bucketStart = bucketOffsets(0)
      bucketEnd = bucketOffsets(1)
      _ <- bool2Fox(bucketEnd - bucketStart != 0)
      buckets = segmentIndex.reader
        .uint64()
        .readMatrixBlockWithOffset("hash_buckets", (bucketEnd - bucketStart + 1).toInt, 3, bucketStart, 0)
      bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
      _ <- bool2Fox(bucketLocalOffset >= 0)
      topLeftStart = buckets(bucketLocalOffset)(1)
      topLeftEnd = buckets(bucketLocalOffset)(2)
      topLefts = segmentIndex.reader
        .uint16() // Read datatype from attributes?
        .readMatrixBlockWithOffset("top_lefts", (topLeftEnd - topLeftStart).toInt, 3, topLeftStart, 0)

    } yield (topLefts.flatMap(topLeft => Vec3Int.fromArray(topLeft.map(_.toInt))), mag)

  def getSegmentVolume(organizationName: String,
                       datasetName: String,
                       dataLayerName: String,
                       segmentId: Long,
                       mag: Vec3Int,
                       dataLayerMapping: Option[String])(implicit m: MessagesProvider): Fox[Long] = {

    def getTypedDataForSegment(organizationName: String, datasetName: String, dataLayerName: String)(
        segmentId: Long,
        mag: Vec3Int)(implicit m: MessagesProvider) =
      for {
        (bucketPositions, fileMag) <- readSegmentIndex(organizationName, datasetName, dataLayerName, segmentId)
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  datasetName,
                                                                                  dataLayerName)
        data <- getDataForBucketPositions(dataSource,
                                          dataLayer,
                                          mag,
                                          bucketPositions.map(_ / fileMag).distinct.toSeq,
                                          dataLayerMapping)
        dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(data, dataLayer.elementClass)
      } yield dataTyped
    for {
      volume <- calculateSegmentVolume(segmentId,
                                       mag,
                                       getTypedDataForSegment(organizationName, datasetName, dataLayerName))
    } yield volume
  }

  def getSegmentBoundingBox(organizationName: String,
                            datasetName: String,
                            dataLayerName: String,
                            segmentId: Long,
                            mag: Vec3Int,
                            dataLayerMapping: Option[String])(implicit m: MessagesProvider): Fox[BoundingBox] = {

    def getBucketPositions(organizationName: String, datasetName: String, dataLayerName: String)(segmentId: Long,
                                                                                                 mag: Vec3Int) =
      for {
        (bucketPositionsInFileMag, fileMag) <- readSegmentIndex(organizationName, datasetName, dataLayerName, segmentId)
        bucketPositions = bucketPositionsInFileMag.map(_ / (mag / fileMag)).distinct.toSeq
      } yield ListOfVec3IntProto.of(bucketPositions.map(vec3IntToProto))

    def getTypedDataForBucketPosition(organizationName: String, datasetName: String, dataLayerName: String)(
        bucketPosition: Vec3Int,
        mag: Vec3Int)(implicit m: MessagesProvider) =
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  datasetName,
                                                                                  dataLayerName)
        data <- getDataForBucketPositions(dataSource, dataLayer, mag, Seq(bucketPosition * mag), dataLayerMapping)
        dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(data, dataLayer.elementClass)
      } yield dataTyped

    for {

      bb <- calculateSegmentBoundingBox(
        segmentId,
        mag,
        getBucketPositions(organizationName, datasetName, dataLayerName),
        getTypedDataForBucketPosition(organizationName, datasetName, dataLayerName)
      )
    } yield bb

  }

  def assertSegmentIndexFileExists(organizationName: String, datasetName: String, dataLayerName: String) =
    Fox.box2Fox(getSegmentIndexFile(organizationName, datasetName, dataLayerName)) ?~> "segmentIndexFile.notFound"

  private def getDataForBucketPositions(dataSource: datasource.DataSource,
                                        dataLayer: DataLayer,
                                        mag: Vec3Int,
                                        mag1BucketPositions: Seq[Vec3Int],
                                        dataLayerMapping: Option[String]): Fox[Array[Byte]] = {
    val dataRequests = mag1BucketPositions.map { position =>
      DataServiceDataRequest(
        dataSource = dataSource,
        dataLayer = dataLayer,
        dataLayerMapping = dataLayerMapping,
        cuboid = Cuboid(
          VoxelPosition(position.x * DataLayer.bucketLength,
                        position.y * DataLayer.bucketLength,
                        position.z * DataLayer.bucketLength,
                        mag),
          DataLayer.bucketLength,
          DataLayer.bucketLength,
          DataLayer.bucketLength
        ),
        settings = DataServiceRequestSettings(halfByte = false,
                                              appliedAgglomerate = None,
                                              version = None,
                                              additionalCoordinates = None),
      )
    }.toList
    for {
      (data, _) <- binaryDataServiceHolder.binaryDataService.handleDataRequests(dataRequests)
    } yield data
  }

}
