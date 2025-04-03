package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, ElementClass}
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NativeBucketScanner, ProtoGeometryImplicits}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  RemoteFallbackLayer,
  TemporaryTracingService,
  TracingDataStore
}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo

import scala.concurrent.ExecutionContext

object VolumeSegmentIndexService {
  def canHaveSegmentIndex(remoteDatastoreClient: TSRemoteDatastoreClient, fallbackLayer: Option[RemoteFallbackLayer])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Boolean] =
    fallbackLayer match {
      case Some(layer) => remoteDatastoreClient.hasSegmentIndexFile(layer)
      case None        => Fox.successful(true)
    }
}

// Segment-to-Bucket index for volume tracings in FossilDB
// key: tracing id, segment id, mag – value: list of buckets
// used for calculating segment statistics
class VolumeSegmentIndexService @Inject()(val tracingDataStore: TracingDataStore,
                                          remoteDatastoreClient: TSRemoteDatastoreClient,
                                          temporaryTracingService: TemporaryTracingService)
    extends KeyValueStoreImplicits
    with ProtoGeometryImplicits
    with VolumeBucketCompression
    with SegmentIndexKeyHelper
    with ReversionHelper
    with LazyLogging {

  private val volumeSegmentIndexClient: FossilDBClient = tracingDataStore.volumeSegmentIndex

  // Add segment index to merged tracing if all source tracings have a segment index
  def shouldCreateSegmentIndexForMerged(tracings: Seq[VolumeTracing]): Boolean =
    tracings.forall(_.hasSegmentIndex.getOrElse(false))

  def updateFromBucket(volumeLayer: VolumeTracingLayer,
                       segmentIndexBuffer: VolumeSegmentIndexBuffer,
                       bucketPosition: BucketPosition,
                       bucketBytes: Array[Byte],
                       previousBucketBytesBox: Box[Array[Byte]],
                       editableMappingTracingId: Option[String])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      bucketBytesDecompressed <- if (isRevertedElement(bucketBytes)) {
        Fox.successful(segmentIndexBuffer.emptyBucketArrayForElementClass)
      } else {
        tryo(
          decompressIfNeeded(bucketBytes,
                             volumeLayer.expectedUncompressedBucketSize,
                             "updating segment index, new bucket data")).toFox
      }
      previousBucketBytesWithEmptyFallback <- segmentIndexBuffer.bytesWithEmptyFallback(previousBucketBytesBox) ?~> "volumeSegmentIndex.update.getPreviousBucket.failed"
      segmentIds: Set[Long] <- collectSegmentIds(bucketBytesDecompressed, volumeLayer.elementClass).toFox
      previousSegmentIds: Set[Long] <- collectSegmentIds(previousBucketBytesWithEmptyFallback, volumeLayer.elementClass) ?~> "volumeSegmentIndex.update.collectSegmentIds.failed"
      additions = segmentIds.diff(previousSegmentIds)
      removals = previousSegmentIds.diff(segmentIds)
      _ <- Fox.serialCombined(removals.toList)(
        segmentId =>
          // When fallback layer is used we also need to include relevant segments here into the fossildb since otherwise the fallback layer would be used with invalid data
          removeBucketFromSegmentIndex(segmentIndexBuffer, segmentId, bucketPosition, editableMappingTracingId)) ?~> "volumeSegmentIndex.update.removeBucket.failed"
      // When fallback layer is used, copy the entire bucketlist for this segment instead of one bucket
      _ <- Fox.runIf(additions.nonEmpty)(addBucketToSegmentIndex(
        segmentIndexBuffer,
        additions.toList,
        bucketPosition,
        editableMappingTracingId)) ?~> "volumeSegmentIndex.update.addBucket.failed"
    } yield ()

  private def removeBucketFromSegmentIndex(
      segmentIndexBuffer: VolumeSegmentIndexBuffer,
      segmentId: Long,
      bucketPosition: BucketPosition,
      editableMappingTracingId: Option[String])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      previousBucketPositions: Set[Vec3IntProto] <- segmentIndexBuffer.getOne(segmentId,
                                                                              bucketPosition.mag,
                                                                              editableMappingTracingId,
                                                                              bucketPosition.additionalCoordinates)
      bucketPositionProto = bucketPosition.toVec3IntProto
      newBucketPositions = previousBucketPositions - bucketPositionProto
      _ = segmentIndexBuffer.put(segmentId,
                                 bucketPosition.mag,
                                 bucketPosition.additionalCoordinates,
                                 newBucketPositions,
                                 markAsChanged = true)
    } yield ()

  private def addBucketToSegmentIndex(
      segmentIndexBuffer: VolumeSegmentIndexBuffer,
      segmentIds: List[Long],
      bucketPosition: BucketPosition,
      editableMappingTracingId: Option[String])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      previousBucketPositionsBySegment: Seq[(Long, Set[Vec3IntProto])] <- segmentIndexBuffer.getMultiple(
        segmentIds,
        bucketPosition.mag,
        editableMappingTracingId,
        bucketPosition.additionalCoordinates)
      _ <- previousBucketPositionsBySegment.foreach {
        case (segmentId, previousBucketPositions) =>
          val newBucketPositions = previousBucketPositions + bucketPosition.toVec3IntProto
          segmentIndexBuffer.put(segmentId,
                                 bucketPosition.mag,
                                 bucketPosition.additionalCoordinates,
                                 newBucketPositions,
                                 markAsChanged = true)
      }
    } yield ()

  private lazy val nativeBucketScanner = new NativeBucketScanner()

  private def collectSegmentIds(bytes: Array[Byte], elementClass: ElementClass.Value): Box[Set[Long]] =
    tryo(
      nativeBucketScanner
        .collectSegmentIds(bytes,
                           ElementClass.bytesPerElement(elementClass),
                           ElementClass.isSigned(elementClass),
                           skipZeroes = true)
        .toSet)

  def getSegmentToBucketIndex(tracing: VolumeTracing,
                              fallbackLayer: Option[RemoteFallbackLayer],
                              tracingId: String,
                              segmentId: Long,
                              mag: Vec3Int,
                              mappingName: Option[String],
                              editableMappingTracingId: Option[String],
                              additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Set[Vec3IntProto]] =
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
      segmentIndexReader = new VolumeSegmentIndexBuffer(
        tracingId = tracingId,
        elementClass = tracing.elementClass,
        mappingName = mappingName,
        volumeSegmentIndexClient = volumeSegmentIndexClient,
        version = tracing.version,
        remoteDatastoreClient = remoteDatastoreClient,
        fallbackLayer = fallbackLayer,
        additionalAxes = AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
        temporaryTracingService = temporaryTracingService,
        tc = tc,
        isReadOnly = true,
        toTemporaryStore = isTemporaryTracing
      )
      bucketPositions <- segmentIndexReader.getOne(segmentId, mag, editableMappingTracingId, additionalCoordinates)
    } yield bucketPositions

}
