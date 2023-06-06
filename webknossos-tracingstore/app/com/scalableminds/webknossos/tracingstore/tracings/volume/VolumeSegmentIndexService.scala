package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.{ElementClass => ElementClassProto}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.geometry.{ListOfVec3IntProto, Vec3IntProto}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{BucketPosition, UnsignedInteger, UnsignedIntegerArray}
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, KeyValueStoreImplicits, TracingDataStore}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo

import scala.concurrent.ExecutionContext

class VolumeSegmentIndexService @Inject()(val tracingDataStore: TracingDataStore)
    extends KeyValueStoreImplicits
    with ProtoGeometryImplicits
    with VolumeBucketCompression
    with SegmentIndexKeyHelper
    with LazyLogging {

  private val volumeSegmentIndexClient: FossilDBClient = tracingDataStore.volumeSegmentIndex

  def updateFromBucket(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                       bucketPosition: BucketPosition,
                       bucketBytes: Array[Byte],
                       previousBucketBytesBox: Box[Array[Byte]],
                       updateGroupVersion: Long,
                       elementClass: ElementClassProto)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      before <- Fox.successful(Instant.now)
      bucketBytesDecompressed <- tryo(
        decompressIfNeeded(bucketBytes, expectedUncompressedBucketSizeFor(elementClass), "")).toFox
      previousBucketBytesWithEmptyFallback <- bytesWithEmptyFallback(previousBucketBytesBox, elementClass) ?~> "volumeSegmentIndex.udpate.getPreviousBucket.failed"
      beforeCollect = Instant.now
      segmentIds: Set[Long] <- collectSegmentIds(bucketBytesDecompressed, elementClass)
      previousSegmentIds: Set[Long] <- collectSegmentIds(previousBucketBytesWithEmptyFallback, elementClass) ?~> "volumeSegmentIndex.udpate.collectSegmentIds.failed"
      _ = logger.info(s"collect segment ids: ${Instant.since(beforeCollect)}")
      additions = segmentIds.diff(previousSegmentIds)
      removals = previousSegmentIds.diff(segmentIds)
      /*_ = if (additions.nonEmpty || removals.nonEmpty) {
        logger.info(s"Mag${bucketPosition.mag.toMagLiteral(true)} bucket additions: $additions and removals $removals")
      }*/
      beforeRemove = Instant.now
      _ <- Fox.serialCombined(removals.toList)(segmentId =>
        removeBucketFromSegmentIndex(segmentIndexBuffer, segmentId, bucketPosition, updateGroupVersion)) ?~> "volumeSegmentIndex.udpate.removeBucket.failed"
      _ <- Fox.serialCombined(additions.toList)(segmentId =>
        addBucketToSegmentIndex(segmentIndexBuffer, segmentId, bucketPosition, updateGroupVersion)) ?~> "volumeSegmentIndex.udpate.addBucket.failed"
      _ = logger.info(s"remove + add index entries: ${Instant.since(beforeRemove)}")
      _ = logger.info(s"# updateFromBucket total: ${Instant.since(before)}")
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
                                           bucketPosition: BucketPosition,
                                           updateGroupVersion: Long)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      previousBucketList: ListOfVec3IntProto <- getSegmentToBucketIndexWithEmptyFallback(segmentIndexBuffer,
                                                                                         segmentId,
                                                                                         bucketPosition.mag)
      bucketPositionProto = bucketPositionVec3IntProto(bucketPosition)
      newBucketList = ListOfVec3IntProto(previousBucketList.values.filterNot(_ == bucketPositionProto))
      /* _ = logger.info(
        s"Removing bucket ${vec3IntFromProto(bucketPositionVec3IntProto(bucketPosition))} from segment $segmentId, new mag-${bucketPosition.mag
          .toMagLiteral(true)} list: ${newBucketList.values.map(vec3IntFromProto)}") */
      _ = segmentIndexBuffer.put(segmentId, bucketPosition.mag, newBucketList)
    } yield ()

  private def addBucketToSegmentIndex(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                      segmentId: Long,
                                      bucketPosition: BucketPosition,
                                      updateGroupVersion: Long)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      previousBucketList <- getSegmentToBucketIndexWithEmptyFallback(segmentIndexBuffer, segmentId, bucketPosition.mag)
      newBucketList = ListOfVec3IntProto(
        (bucketPositionVec3IntProto(bucketPosition) +: previousBucketList.values).distinct)
      /* _ = logger.info(
        s"Adding bucket ${vec3IntFromProto(bucketPositionVec3IntProto(bucketPosition))} to segment $segmentId, new mag-${bucketPosition.mag
          .toMagLiteral(true)} list: ${newBucketList.values.map(vec3IntFromProto)}") */
      _ <- segmentIndexBuffer.put(segmentId, bucketPosition.mag, newBucketList)
    } yield ()

  private def collectSegmentIds(bytes: Array[Byte], elementClass: ElementClassProto)(
      implicit ec: ExecutionContext): Fox[Set[Long]] =
    for {
      set <- tryo(UnsignedIntegerArray.toSetFromByteArray(bytes, elementClass)).toFox
    } yield
      set.filter(!_.isZero).map { u: UnsignedInteger =>
        u.toPositiveLong
      }

  private def bucketPositionVec3IntProto(bucketPosition: BucketPosition) =
    Vec3IntProto(bucketPosition.bucketX, bucketPosition.bucketY, bucketPosition.bucketZ)

  private def getSegmentToBucketIndexWithEmptyFallback(
      segmentIndexBuffer: VolumeSegmentIndexBuffer,
      segmentId: Long,
      mag: Vec3Int)(implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] =
    for {
      bucketListBox <- segmentIndexBuffer.getWithFallback(segmentId, mag).futureBox
      bucketList <- addEmptyFallback(bucketListBox)
    } yield bucketList

  def getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(
      tracingId: String,
      segmentId: Long,
      mag: Vec3Int,
      version: Option[Long] = None)(implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] =
    for {
      bucketListBox <- getSegmentToBucketIndex(tracingId, segmentId, mag, version).futureBox
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
                                      version: Option[Long]): Fox[ListOfVec3IntProto] = {
    val key = segmentIndexKey(tracingId, segmentId, mag)
    volumeSegmentIndexClient.get(key, version, mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto]).map(_.value)
  }

}
