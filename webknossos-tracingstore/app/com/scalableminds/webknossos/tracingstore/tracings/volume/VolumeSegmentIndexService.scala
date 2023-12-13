package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, ElementClass}
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{
  AdditionalCoordinate,
  BucketPosition,
  UnsignedInteger,
  UnsignedIntegerArray
}
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, KeyValueStoreImplicits, TracingDataStore}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.common.Box.tryo

import scala.concurrent.ExecutionContext

object VolumeSegmentIndexService {
  // Currently, segment index is not supported for volume tracings with fallback layer
  def canHaveSegmentIndexOpt(fallbackLayerName: Option[String]): Option[Boolean] = Some(fallbackLayerName.isEmpty)

  def canHaveSegmentIndex(fallbackLayerName: Option[String]): Boolean = fallbackLayerName.isEmpty
}

// Segment-to-Bucket index for volume tracings in FossilDB
// key: tracing id, segment id, mag – value: list of buckets
// used for calculating segment statistics
class VolumeSegmentIndexService @Inject()(val tracingDataStore: TracingDataStore)
    extends KeyValueStoreImplicits
    with ProtoGeometryImplicits
    with VolumeBucketCompression
    with SegmentIndexKeyHelper
    with LazyLogging {

  private val volumeSegmentIndexClient: FossilDBClient = tracingDataStore.volumeSegmentIndex

  // Add segment index to merged tracing if all source tracings have a segment index
  def shouldCreateSegmentIndexForMerged(tracings: Seq[VolumeTracing]): Boolean =
    tracings.forall(_.hasSegmentIndex.getOrElse(false))

  def updateFromBucket(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                       bucketPosition: BucketPosition,
                       bucketBytes: Array[Byte],
                       previousBucketBytesBox: Box[Array[Byte]],
                       elementClass: ElementClassProto)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      bucketBytesDecompressed <- tryo(
        decompressIfNeeded(bucketBytes, expectedUncompressedBucketSizeFor(elementClass), "")).toFox
      previousBucketBytesWithEmptyFallback <- bytesWithEmptyFallback(previousBucketBytesBox, elementClass) ?~> "volumeSegmentIndex.udpate.getPreviousBucket.failed"
      segmentIds: Set[Long] <- collectSegmentIds(bucketBytesDecompressed, elementClass)
      previousSegmentIds: Set[Long] <- collectSegmentIds(previousBucketBytesWithEmptyFallback, elementClass) ?~> "volumeSegmentIndex.udpate.collectSegmentIds.failed"
      additions = segmentIds.diff(previousSegmentIds)
      removals = previousSegmentIds.diff(segmentIds)
      _ <- Fox.serialCombined(removals.toList)(segmentId =>
        removeBucketFromSegmentIndex(segmentIndexBuffer, segmentId, bucketPosition)) ?~> "volumeSegmentIndex.udpate.removeBucket.failed"
      _ <- Fox.serialCombined(additions.toList)(segmentId =>
        addBucketToSegmentIndex(segmentIndexBuffer, segmentId, bucketPosition)) ?~> "volumeSegmentIndex.udpate.addBucket.failed"
    } yield ()

  private def bytesWithEmptyFallback(bytesBox: Box[Array[Byte]], elementClass: ElementClassProto)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    bytesBox match {
      case Empty       => Fox.successful(Array.fill[Byte](ElementClass.bytesPerElement(elementClass))(0))
      case Full(bytes) => Fox.successful(bytes)
      case f: Failure  => f.toFox
    }

  private def removeBucketFromSegmentIndex(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                           segmentId: Long,
                                           bucketPosition: BucketPosition)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      previousBucketList: ListOfVec3IntProto <- getSegmentToBucketIndexWithEmptyFallback(
        segmentIndexBuffer,
        segmentId,
        bucketPosition.mag,
        bucketPosition.additionalCoordinates)
      bucketPositionProto = bucketPosition.toVec3IntProto
      newBucketList = ListOfVec3IntProto(previousBucketList.values.filterNot(_ == bucketPositionProto))
      _ = segmentIndexBuffer.put(segmentId, bucketPosition.mag, bucketPosition.additionalCoordinates, newBucketList)
    } yield ()

  private def addBucketToSegmentIndex(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                      segmentId: Long,
                                      bucketPosition: BucketPosition)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      previousBucketList <- getSegmentToBucketIndexWithEmptyFallback(segmentIndexBuffer,
                                                                     segmentId,
                                                                     bucketPosition.mag,
                                                                     bucketPosition.additionalCoordinates)
      newBucketList = ListOfVec3IntProto((bucketPosition.toVec3IntProto +: previousBucketList.values).distinct)
      _ <- segmentIndexBuffer.put(segmentId, bucketPosition.mag, bucketPosition.additionalCoordinates, newBucketList)
    } yield ()

  private def collectSegmentIds(bytes: Array[Byte], elementClass: ElementClassProto)(
      implicit ec: ExecutionContext): Fox[Set[Long]] =
    for {
      set <- tryo(UnsignedIntegerArray.toSetFromByteArray(bytes, elementClass)).toFox
    } yield
      set.filter(!_.isZero).map { u: UnsignedInteger =>
        u.toPositiveLong
      }

  private def getSegmentToBucketIndexWithEmptyFallback(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                                       segmentId: Long,
                                                       mag: Vec3Int,
                                                       additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] =
    for {
      bucketListBox <- segmentIndexBuffer.getWithFallback(segmentId, mag, additionalCoordinates).futureBox
      bucketList <- addEmptyFallback(bucketListBox)
    } yield bucketList

  def getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(
      tracingId: String,
      segmentId: Long,
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      additionalAxes: Option[Seq[AdditionalAxis]],
      version: Option[Long] = None)(implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] =
    for {
      bucketListBox <- getSegmentToBucketIndex(tracingId,
                                               segmentId,
                                               mag,
                                               additionalCoordinates,
                                               additionalAxes,
                                               version).futureBox
      bucketList <- addEmptyFallback(bucketListBox)
    } yield bucketList

  private def addEmptyFallback(positionsBox: Box[ListOfVec3IntProto])(
      implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] =
    positionsBox match {
      case Full(list) => Fox.successful(list)
      case f: Failure => f.toFox
      case Empty      => Fox.successful(ListOfVec3IntProto(Seq.empty))
    }

  private def getSegmentToBucketIndex(tracingId: String,
                                      segmentId: Long,
                                      mag: Vec3Int,
                                      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                                      additionalAxes: Option[Seq[AdditionalAxis]],
                                      version: Option[Long]): Fox[ListOfVec3IntProto] = {
    val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
    volumeSegmentIndexClient.get(key, version, mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto]).map(_.value)
  }

}
