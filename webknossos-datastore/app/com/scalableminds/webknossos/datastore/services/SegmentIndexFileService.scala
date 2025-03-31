package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NativeBucketScanner, SegmentStatistics}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, VoxelPosition, datasource}
import com.scalableminds.webknossos.datastore.storage.{AgglomerateFileKey, CachedHdf5File, Hdf5FileCache}
import net.liftweb.common.Box.tryo
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
  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val segmentIndexDir = "segmentIndex"

  private lazy val fileHandleCache = new Hdf5FileCache(10)

  protected lazy val bucketScanner = new NativeBucketScanner()

  def getSegmentIndexFile(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Box[Path] =
    for {
      _ <- Full("")
      layerDir = dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName).resolve(dataLayerName)
      segmentIndexDir = layerDir.resolve(this.segmentIndexDir)
      files <- PathUtils.listFiles(segmentIndexDir, silent = true, PathUtils.fileExtensionFilter(hdf5FileExtension))
      file <- files.headOption
    } yield file

  /**
    * Read the segment index file and return the bucket positions for the given segment id.
    * The bucket positions are the top left corners of the buckets that contain the segment in the file mag.
    */
  def readSegmentIndex(organizationId: String,
                       datasetDirectoryName: String,
                       dataLayerName: String,
                       segmentId: Long): Fox[Array[Vec3Int]] =
    for {
      segmentIndexPath <- getSegmentIndexFile(organizationId, datasetDirectoryName, dataLayerName).toFox
      segmentIndex = fileHandleCache.getCachedHdf5File(segmentIndexPath)(CachedHdf5File.fromPath)
      nBuckets = segmentIndex.uint64Reader.getAttr("/", "n_hash_buckets")

      bucketIndex = segmentIndex.hashFunction(segmentId) % nBuckets
      bucketOffsets = segmentIndex.uint64Reader.readArrayBlockWithOffset("hash_bucket_offsets", 2, bucketIndex)
      bucketStart = bucketOffsets(0)
      bucketEnd = bucketOffsets(1)

      hashBucketExists = bucketEnd - bucketStart != 0
      topLeftsOpt <- Fox.runIf(hashBucketExists)(readTopLefts(segmentIndex, bucketStart, bucketEnd, segmentId))
      topLefts = topLeftsOpt.flatten
    } yield
      topLefts match {
        case Some(topLefts) => topLefts.flatMap(topLeft => Vec3Int.fromArray(topLeft.map(_.toInt)))
        case None           => Array.empty
      }

  def readFileMag(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Fox[Vec3Int] =
    for {
      segmentIndexPath <- getSegmentIndexFile(organizationId, datasetDirectoryName, dataLayerName).toFox
      segmentIndex = fileHandleCache.getCachedHdf5File(segmentIndexPath)(CachedHdf5File.fromPath)
      mag <- Vec3Int.fromArray(segmentIndex.uint64Reader.getArrayAttr("/", "mag").map(_.toInt)).toFox
    } yield mag

  private def readTopLefts(segmentIndex: CachedHdf5File,
                           bucketStart: Long,
                           bucketEnd: Long,
                           segmentId: Long): Fox[Option[Array[Array[Short]]]] =
    for {
      _ <- Fox.successful(())
      buckets = segmentIndex.uint64Reader.readMatrixBlockWithOffset("hash_buckets",
                                                                    (bucketEnd - bucketStart + 1).toInt,
                                                                    3,
                                                                    bucketStart,
                                                                    0)
      bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
      topLeftOpts <- Fox.runIf(bucketLocalOffset >= 0)(for {
        _ <- Fox.successful(())
        topLeftStart = buckets(bucketLocalOffset)(1)
        topLeftEnd = buckets(bucketLocalOffset)(2)
        bucketEntriesDtype <- tryo(segmentIndex.stringReader.getAttr("/", "dtype_bucket_entries")).toFox
        _ <- Fox
          .bool2Fox(bucketEntriesDtype == "uint16") ?~> "value for dtype_bucket_entries in segment index file is not supported, only uint16 is supported"
        topLefts = segmentIndex.uint16Reader.readMatrixBlockWithOffset("top_lefts",
                                                                       (topLeftEnd - topLeftStart).toInt,
                                                                       3,
                                                                       topLeftStart,
                                                                       0)
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

  def getSegmentVolume(organizationId: String,
                       datasetDirectoryName: String,
                       dataLayerName: String,
                       segmentId: Long,
                       mag: Vec3Int,
                       mappingName: Option[String])(implicit m: MessagesProvider, tc: TokenContext): Fox[Long] =
    for {
      volume <- calculateSegmentVolume(
        segmentId,
        mag,
        None, // see #7556
        getBucketPositions(organizationId, datasetDirectoryName, dataLayerName, mappingName),
        getDataForBucketPositions(organizationId, datasetDirectoryName, dataLayerName, mappingName)
      )
    } yield volume

  def getSegmentBoundingBox(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      segmentId: Long,
      mag: Vec3Int,
      mappingName: Option[String])(implicit m: MessagesProvider, tc: TokenContext): Fox[BoundingBox] =
    for {
      bb <- calculateSegmentBoundingBox(
        segmentId,
        mag,
        None, // see #7556
        getBucketPositions(organizationId, datasetDirectoryName, dataLayerName, mappingName),
        getDataForBucketPositions(organizationId, datasetDirectoryName, dataLayerName, mappingName)
      )
    } yield bb

  def assertSegmentIndexFileExists(organizationId: String,
                                   datasetDirectoryName: String,
                                   dataLayerName: String): Fox[Path] =
    Fox.box2Fox(getSegmentIndexFile(organizationId, datasetDirectoryName, dataLayerName)) ?~> "segmentIndexFile.notFound"

  private def getDataForBucketPositions(organizationId: String,
                                        datasetDirectoryName: String,
                                        dataLayerName: String,
                                        mappingName: Option[String])(
      bucketPositions: Seq[Vec3Int],
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit m: MessagesProvider,
      tc: TokenContext): Fox[(List[Box[Array[Byte]]], ElementClass.Value)] =
    for {
      // Additional coordinates parameter ignored, see #7556
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                datasetDirectoryName,
                                                                                dataLayerName)
      bucketData <- Fox.serialSequenceBox(bucketPositions)(bucketPosition =>
        getDataForBucketPositions(dataSource, dataLayer, mag, Seq(bucketPosition * mag), mappingName))
    } yield (bucketData, dataLayer.elementClass)

  private def getBucketPositions(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mappingName: Option[String])(segmentOrAgglomerateId: Long, mag: Vec3Int): Fox[Set[Vec3IntProto]] =
    for {
      segmentIds <- getSegmentIdsForAgglomerateIdIfNeeded(organizationId,
                                                          datasetDirectoryName,
                                                          dataLayerName,
                                                          segmentOrAgglomerateId,
                                                          mappingName)
      positionsPerSegment <- Fox.serialCombined(segmentIds)(segmentId =>
        getBucketPositions(organizationId, datasetDirectoryName, dataLayerName, segmentId, mag))
      positionsCollected = positionsPerSegment.flatten.toSet.map(vec3IntToProto)
    } yield positionsCollected

  private def getBucketPositions(organizationId: String,
                                 datasetDirectoryName: String,
                                 dataLayerName: String,
                                 segmentId: Long,
                                 mag: Vec3Int): Fox[Array[Vec3Int]] =
    for {
      fileMag <- readFileMag(organizationId, datasetDirectoryName, dataLayerName)
      bucketPositionsInFileMag <- readSegmentIndex(organizationId, datasetDirectoryName, dataLayerName, segmentId)
      bucketPositions = bucketPositionsInFileMag.map(_ / (mag / fileMag))
    } yield bucketPositions

  private def getSegmentIdsForAgglomerateIdIfNeeded(organizationId: String,
                                                    datasetDirectoryName: String,
                                                    dataLayerName: String,
                                                    segmentOrAgglomerateId: Long,
                                                    mappingNameOpt: Option[String]): Fox[List[Long]] =
    // Editable mappings cannot happen here since those requests go to the tracingstore
    mappingNameOpt match {
      case Some(mappingName) =>
        for {
          agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
          agglomerateFileKey = AgglomerateFileKey(
            organizationId,
            datasetDirectoryName,
            dataLayerName,
            mappingName
          )
          largestAgglomerateId <- agglomerateService.largestAgglomerateId(agglomerateFileKey).toFox
          segmentIds <- if (segmentOrAgglomerateId <= largestAgglomerateId) {
            agglomerateService
              .segmentIdsForAgglomerateId(
                agglomerateFileKey,
                segmentOrAgglomerateId
              )
              .toFox
          } else
            Fox.successful(List.empty) // agglomerate id is outside of file range, was likely created during brushing
        } yield segmentIds
      case None => Fox.successful(List(segmentOrAgglomerateId))
    }

  private def getDataForBucketPositions(dataSource: datasource.DataSource,
                                        dataLayer: DataLayer,
                                        mag: Vec3Int,
                                        mag1BucketPositions: Seq[Vec3Int],
                                        mappingName: Option[String])(implicit tc: TokenContext): Fox[Array[Byte]] = {
    val dataRequests = mag1BucketPositions.map { position =>
      DataServiceDataRequest(
        dataSource = dataSource,
        dataLayer = dataLayer,
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
