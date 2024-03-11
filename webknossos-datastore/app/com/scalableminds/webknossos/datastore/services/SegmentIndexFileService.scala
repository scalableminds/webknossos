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
import com.scalableminds.webknossos.datastore.models.{
  AdditionalCoordinate,
  UnsignedInteger,
  UnsignedIntegerArray,
  VoxelPosition,
  datasource
}
import com.scalableminds.webknossos.datastore.storage.{AgglomerateFileKey, CachedHdf5File, Hdf5FileCache}
import net.liftweb.common.{Box, Full}
import play.api.i18n.MessagesProvider

import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class SegmentIndexFileService @Inject()(config: DataStoreConfig,
                                        binaryDataServiceHolder: BinaryDataServiceHolder,
                                        dataSourceRepository: DataSourceRepository)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with Hdf5HashedArrayUtils
    with SegmentStatistics {
  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val segmentIndexDir = "segmentIndex"

  private lazy val fileHandleCache = new Hdf5FileCache(10)

  def getSegmentIndexFile(organizationName: String, datasetName: String, dataLayerName: String): Box[Path] =
    for {
      _ <- Full("")
      layerDir = dataBaseDir.resolve(organizationName).resolve(datasetName).resolve(dataLayerName)
      segmentIndexDir = layerDir.resolve(this.segmentIndexDir)
      files <- PathUtils.listFiles(segmentIndexDir, silent = true, PathUtils.fileExtensionFilter(hdf5FileExtension))
      file <- files.headOption
    } yield file

  /**
    * Read the segment index file and return the bucket positions for the given segment id.
    * The bucket positions are the top left corners of the buckets that contain the segment in the file mag.
    * @param organizationName
    * @param datasetName
    * @param dataLayerName
    * @param segmentId
    * @param mag
    * @param cubeSize
    * @param additionalCoordinates
    * @param mappingName
    * @param m
    * @return (bucketPositions, fileMag)
    */
  def readSegmentIndex(organizationName: String,
                       datasetName: String,
                       dataLayerName: String,
                       segmentId: Long): Fox[(Array[Vec3Int], Vec3Int)] =
    for {
      segmentIndexPath <- getSegmentIndexFile(organizationName, datasetName, dataLayerName).toFox
      segmentIndex = fileHandleCache.withCache(segmentIndexPath)(CachedHdf5File.fromPath)
      hashFunction = getHashFunction(segmentIndex.reader.string().getAttr("/", "hash_function"))
      nBuckets = segmentIndex.reader.uint64().getAttr("/", "n_hash_buckets")
      mag <- Vec3Int.fromArray(segmentIndex.reader.uint64().getArrayAttr("/", "mag").map(_.toInt)).toFox

      bucketIndex = hashFunction(segmentId) % nBuckets
      bucketOffsets = segmentIndex.reader.uint64().readArrayBlockWithOffset("hash_bucket_offsets", 2, bucketIndex)
      bucketStart = bucketOffsets(0)
      bucketEnd = bucketOffsets(1)

      hashBucketExists = bucketEnd - bucketStart != 0
      topLeftsOpt <- Fox.runIf(hashBucketExists)(readTopLefts(segmentIndex, bucketStart, bucketEnd, segmentId))
      topLefts = topLeftsOpt.flatten
    } yield
      topLefts match {
        case Some(topLefts) => (topLefts.flatMap(topLeft => Vec3Int.fromArray(topLeft.map(_.toInt))), mag)
        case None           => (Array.empty, mag)
      }

  private def readTopLefts(segmentIndex: CachedHdf5File,
                           bucketStart: Long,
                           bucketEnd: Long,
                           segmentId: Long): Fox[Option[Array[Array[Short]]]] =
    for {
      _ <- Fox.successful(())
      buckets = segmentIndex.reader
        .uint64()
        .readMatrixBlockWithOffset("hash_buckets", (bucketEnd - bucketStart + 1).toInt, 3, bucketStart, 0)
      bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
      topLeftOpts <- Fox.runIf(bucketLocalOffset >= 0)(for {
        _ <- Fox.successful(())
        topLeftStart = buckets(bucketLocalOffset)(1)
        topLeftEnd = buckets(bucketLocalOffset)(2)
        topLefts = segmentIndex.reader
          .uint16() // Read datatype from attributes?
          .readMatrixBlockWithOffset("top_lefts", (topLeftEnd - topLeftStart).toInt, 3, topLeftStart, 0)
      } yield topLefts)
    } yield topLeftOpts

  def topLeftsToDistinctBucketPositions(topLefts: Array[Vec3Int],
                                        targetMag: Vec3Int,
                                        fileMag: Vec3Int): Array[Vec3Int] =
    topLefts
      .map(_.scale(DataLayer.bucketLength)) // map indices to positions
      .map(_ / (targetMag / fileMag))
      .map(_ / Vec3Int.full(DataLayer.bucketLength)) // map positions to cube indices
      .distinct

  def getSegmentVolume(organizationName: String,
                       datasetName: String,
                       dataLayerName: String,
                       segmentId: Long,
                       mag: Vec3Int,
                       mappingName: Option[String])(implicit m: MessagesProvider): Fox[Long] =
    calculateSegmentVolume(
      segmentId,
      mag,
      None, // see #7556
      getBucketPositions(organizationName, datasetName, dataLayerName, mappingName),
      getTypedDataForBucketPosition(organizationName, datasetName, dataLayerName, mappingName)
    )

  def getSegmentBoundingBox(organizationName: String,
                            datasetName: String,
                            dataLayerName: String,
                            segmentId: Long,
                            mag: Vec3Int,
                            mappingName: Option[String])(implicit m: MessagesProvider): Fox[BoundingBox] =
    for {

      bb <- calculateSegmentBoundingBox(
        segmentId,
        mag,
        None, // see #7556
        getBucketPositions(organizationName, datasetName, dataLayerName, mappingName),
        getTypedDataForBucketPosition(organizationName, datasetName, dataLayerName, mappingName)
      )
    } yield bb

  def assertSegmentIndexFileExists(organizationName: String, datasetName: String, dataLayerName: String): Fox[Path] =
    Fox.box2Fox(getSegmentIndexFile(organizationName, datasetName, dataLayerName)) ?~> "segmentIndexFile.notFound"

  private def getTypedDataForBucketPosition(organizationName: String,
                                            datasetName: String,
                                            dataLayerName: String,
                                            mappingName: Option[String])(
      bucketPosition: Vec3Int,
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(implicit m: MessagesProvider) =
    for {
      // Additional coordinates parameter ignored, see #7556
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                datasetName,
                                                                                dataLayerName)
      data <- getDataForBucketPositions(dataSource, dataLayer, mag, Seq(bucketPosition * mag), mappingName)
      dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(data, dataLayer.elementClass)
    } yield dataTyped

  private def getBucketPositions(
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mappingName: Option[String])(segmentOrAgglomerateId: Long, mag: Vec3Int): Fox[ListOfVec3IntProto] =
    for {
      segmentIds <- getSegmentIdsForAgglomerateIdIfNeeded(organizationName,
                                                          datasetName,
                                                          dataLayerName,
                                                          segmentOrAgglomerateId,
                                                          mappingName)
      positionsPerSegment <- Fox.serialCombined(segmentIds)(segmentId =>
        getBucketPositions(organizationName, datasetName, dataLayerName, segmentId, mag))
      positionsCollected = positionsPerSegment.flatten.distinct
    } yield ListOfVec3IntProto.of(positionsCollected.map(vec3IntToProto))

  private def getBucketPositions(organizationName: String,
                                 datasetName: String,
                                 dataLayerName: String,
                                 segmentId: Long,
                                 mag: Vec3Int): Fox[Array[Vec3Int]] =
    for {
      (bucketPositionsInFileMag, fileMag) <- readSegmentIndex(organizationName, datasetName, dataLayerName, segmentId)
      bucketPositions = bucketPositionsInFileMag.map(_ / (mag / fileMag))
    } yield bucketPositions

  def getSegmentIdsForAgglomerateIdIfNeeded(organizationName: String,
                                            datasetName: String,
                                            dataLayerName: String,
                                            segmentOrAgglomerateId: Long,
                                            mappingNameOpt: Option[String]): Fox[List[Long]] =
    mappingNameOpt match {
      case Some(mappingName) =>
        for {
          agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
          agglomerateFileKey = AgglomerateFileKey(
            organizationName,
            datasetName,
            dataLayerName,
            mappingName
          )
          segmentIds <- agglomerateService.segmentIdsForAgglomerateId(
            agglomerateFileKey,
            segmentOrAgglomerateId
          )
        } yield segmentIds
      case None => Fox.successful(List(segmentOrAgglomerateId))
    }

  private def getDataForBucketPositions(dataSource: datasource.DataSource,
                                        dataLayer: DataLayer,
                                        mag: Vec3Int,
                                        mag1BucketPositions: Seq[Vec3Int],
                                        mappingName: Option[String]): Fox[Array[Byte]] = {
    val dataRequests = mag1BucketPositions.map { position =>
      DataServiceDataRequest(
        dataSource = dataSource,
        dataLayer = dataLayer,
        dataLayerMapping = None,
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
                                              appliedAgglomerate = mappingName,
                                              version = None,
                                              additionalCoordinates = None),
      )
    }.toList
    for {
      (data, _) <- binaryDataServiceHolder.binaryDataService.handleDataRequests(dataRequests)
    } yield data
  }

}
