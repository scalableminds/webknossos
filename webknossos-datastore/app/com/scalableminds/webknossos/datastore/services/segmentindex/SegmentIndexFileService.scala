package com.scalableminds.webknossos.datastore.services.segmentindex

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NativeBucketScanner, SegmentStatistics}
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayer,
  DataSourceId,
  ElementClass,
  LayerAttachment,
  LayerAttachmentDataformat
}
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, VoxelPosition}
import com.scalableminds.webknossos.datastore.services.{
  AgglomerateService,
  BinaryDataServiceHolder,
  ArrayArtifactHashing
}
import com.scalableminds.webknossos.datastore.storage.{AgglomerateFileKey, RemoteSourceDescriptorService}
import net.liftweb.common.Box.tryo
import net.liftweb.common.Box

import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class SegmentIndexFileKey(dataSourceId: DataSourceId, layerName: String, attachment: LayerAttachment)

class SegmentIndexFileService @Inject()(config: DataStoreConfig,
                                        hdf5SegmentIndexFileService: Hdf5SegmentIndexFileService,
                                        zarrSegmentIndexFileService: ZarrSegmentIndexFileService,
                                        remoteSourceDescriptorService: RemoteSourceDescriptorService,
                                        agglomerateService: AgglomerateService,
                                        binaryDataServiceHolder: BinaryDataServiceHolder)
    extends FoxImplicits
    with ArrayArtifactHashing
    with SegmentStatistics {
  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val localSegmentIndexDir = "segmentIndex"
  private val hdf5SegmentIndexFileExtension = "hdf5"

  protected lazy val bucketScanner = new NativeBucketScanner()

  private val segmentIndexFileKeyCache
    : AlfuCache[(DataSourceId, String), SegmentIndexFileKey] = AlfuCache() // dataSourceId, layerName → SegmentIndexFileKey

  def lookUpSegmentIndexFileKey(dataSourceId: DataSourceId, dataLayer: DataLayer)(
      implicit ec: ExecutionContext): Fox[SegmentIndexFileKey] =
    segmentIndexFileKeyCache.getOrLoad((dataSourceId, dataLayer.name),
                                       _ => lookUpSegmentIndexFileKeyImpl(dataSourceId, dataLayer))

  private def lookUpSegmentIndexFileKeyImpl(dataSourceId: DataSourceId, dataLayer: DataLayer)(
      implicit ec: ExecutionContext): Fox[SegmentIndexFileKey] = {
    val registeredAttachment: Option[LayerAttachment] = dataLayer.attachments.flatMap(_.segmentIndex)
    val localDatasetDir = dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    val localAttachment: Option[LayerAttachment] = findLocalSegmentIndexFile(localDatasetDir, dataLayer).toOption
    for {
      registeredAttachmentNormalized <- tryo(registeredAttachment.map { attachment =>
        attachment.copy(
          path =
            remoteSourceDescriptorService.uriFromPathLiteral(attachment.path.toString, localDatasetDir, dataLayer.name))
      }).toFox
      selectedAttachment <- registeredAttachmentNormalized.orElse(localAttachment).toFox ?~> "segmentIndexFile.notFound"
    } yield
      SegmentIndexFileKey(
        dataSourceId,
        dataLayer.name,
        selectedAttachment
      )
  }

  private def findLocalSegmentIndexFile(localDatasetDir: Path, dataLayer: DataLayer): Box[LayerAttachment] = {
    val segmentIndexDir = localDatasetDir.resolve(dataLayer.name).resolve(this.localSegmentIndexDir)
    for {
      files <- PathUtils.listFiles(segmentIndexDir,
                                   silent = true,
                                   PathUtils.fileExtensionFilter(hdf5SegmentIndexFileExtension))
      file <- files.headOption
    } yield
      LayerAttachment(
        file.getFileName.toString,
        file.toUri,
        LayerAttachmentDataformat.hdf5
      )
  }

  /**
    * Read the segment index file and return the bucket positions for the given segment id.
    * The bucket positions are the top left corners of the buckets that contain the segment in the file mag.
    * The bucket positions are in mag1 coordinates though!
    */
  def readSegmentIndex(segmentIndexFileKey: SegmentIndexFileKey,
                       segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Vec3Int]] =
    segmentIndexFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrSegmentIndexFileService.readSegmentIndex(segmentIndexFileKey: SegmentIndexFileKey, segmentId: Long)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5SegmentIndexFileService.readSegmentIndex(segmentIndexFileKey: SegmentIndexFileKey, segmentId: Long)
      case _ => unsupportedDataFormat(segmentIndexFileKey)
    }

  def topLeftsToDistinctTargetMagBucketPositions(topLefts: Array[Vec3Int], targetMag: Vec3Int): Array[Vec3Int] =
    topLefts
      .map(_.scale(DataLayer.bucketLength)) // map indices to positions
      .map(_ / targetMag)
      .map(_ / Vec3Int.full(DataLayer.bucketLength)) // map positions to cube indices
      .distinct

  def getSegmentVolume(dataSourceId: DataSourceId,
                       dataLayer: DataLayer,
                       segmentIndexFileKey: SegmentIndexFileKey,
                       agglomerateFileKeyOpt: Option[AgglomerateFileKey],
                       segmentId: Long,
                       mag: Vec3Int)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    calculateSegmentVolume(
      segmentId,
      mag,
      None, // see #7556
      getBucketPositions(segmentIndexFileKey, agglomerateFileKeyOpt),
      getDataForBucketPositions(dataSourceId, dataLayer, agglomerateFileKeyOpt)
    )

  def getSegmentBoundingBox(dataSourceId: DataSourceId,
                            dataLayer: DataLayer,
                            segmentIndexFileKey: SegmentIndexFileKey,
                            agglomerateFileKeyOpt: Option[AgglomerateFileKey],
                            segmentId: Long,
                            mag: Vec3Int)(implicit ec: ExecutionContext, tc: TokenContext): Fox[BoundingBox] =
    calculateSegmentBoundingBox(
      segmentId,
      mag,
      None, // see #7556
      getBucketPositions(segmentIndexFileKey, agglomerateFileKeyOpt),
      getDataForBucketPositions(dataSourceId, dataLayer, agglomerateFileKeyOpt)
    )

  private def getDataForBucketPositions(dataSourceId: DataSourceId,
                                        dataLayer: DataLayer,
                                        agglomerateFileKeyOpt: Option[AgglomerateFileKey])(
      bucketPositionsInRequestedMag: Seq[Vec3Int],
      requestedMag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Seq[Box[Array[Byte]]], ElementClass.Value)] = {
    // Additional coordinates parameter ignored, see #7556

    val mag1BucketPositions = bucketPositionsInRequestedMag.map(_ * requestedMag)

    val bucketRequests = mag1BucketPositions.map(
      mag1BucketPosition =>
        DataServiceDataRequest(
          dataSourceId = Some(dataSourceId),
          dataLayer = dataLayer,
          cuboid = Cuboid(
            VoxelPosition(mag1BucketPosition.x * DataLayer.bucketLength,
                          mag1BucketPosition.y * DataLayer.bucketLength,
                          mag1BucketPosition.z * DataLayer.bucketLength,
                          requestedMag),
            DataLayer.bucketLength,
            DataLayer.bucketLength,
            DataLayer.bucketLength
          ),
          settings = DataServiceRequestSettings(halfByte = false,
                                                appliedAgglomerate = agglomerateFileKeyOpt.map(_.attachment.name),
                                                version = None,
                                                additionalCoordinates = None),
      ))
    for {
      bucketData <- binaryDataServiceHolder.binaryDataService.handleMultipleBucketRequests(bucketRequests)
    } yield (bucketData, dataLayer.elementClass)
  }

  // Reads bucket positions froms egment index file. Returns target-mag bucket positions
  // (even though the file stores mag1 bucket positions)
  private def getBucketPositions(segmentIndexFileKey: SegmentIndexFileKey,
                                 agglomerateFileKeyOpt: Option[AgglomerateFileKey])(
      segmentOrAgglomerateId: Long,
      requestedMag: Vec3Int)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Set[Vec3IntProto]] =
    for {
      segmentIds <- getSegmentIdsForAgglomerateIdIfNeeded(agglomerateFileKeyOpt, segmentOrAgglomerateId)
      positionsPerSegment <- Fox.serialCombined(segmentIds)(segmentId =>
        getBucketPositions(segmentIndexFileKey, segmentId, requestedMag))
      positionsCollected = positionsPerSegment.flatten.toSet.map(vec3IntToProto)
    } yield positionsCollected

  private def getBucketPositions(segmentIndexFileKey: SegmentIndexFileKey, segmentId: Long, requestedMag: Vec3Int)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Array[Vec3Int]] =
    for {
      mag1BucketPositions <- readSegmentIndex(segmentIndexFileKey, segmentId)
      bucketPositionsInRequestedMag = mag1BucketPositions.map(_ / requestedMag)
    } yield bucketPositionsInRequestedMag

  private def getSegmentIdsForAgglomerateIdIfNeeded(
      agglomerateFileKeyOpt: Option[AgglomerateFileKey],
      segmentOrAgglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    // Editable mappings cannot happen here since those requests go to the tracingstore
    agglomerateFileKeyOpt match {
      case Some(agglomerateFileKey) =>
        for {
          largestAgglomerateId <- agglomerateService.largestAgglomerateId(agglomerateFileKey)
          segmentIds <- if (segmentOrAgglomerateId <= largestAgglomerateId) {
            agglomerateService.segmentIdsForAgglomerateId(
              agglomerateFileKey,
              segmentOrAgglomerateId
            )
          } else
            Fox.successful(List.empty) // agglomerate id is outside of file range, was likely created during brushing
        } yield segmentIds
      case None => Fox.successful(List(segmentOrAgglomerateId))
    }

  private def unsupportedDataFormat(segmentIndexFileKey: SegmentIndexFileKey)(implicit ec: ExecutionContext) =
    Fox.failure(
      s"Trying to load segment index file with unsupported data format ${segmentIndexFileKey.attachment.dataFormat}")
}
