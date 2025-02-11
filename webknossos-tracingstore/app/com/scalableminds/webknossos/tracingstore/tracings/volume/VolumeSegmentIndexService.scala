package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, ElementClass}
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{BucketPosition, UnsignedInteger, UnsignedIntegerArray}
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  RemoteFallbackLayer,
  TracingDataStore
}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Box.tryo

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
                                          remoteDatastoreClient: TSRemoteDatastoreClient)
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

  def updateFromBucket(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                       bucketPosition: BucketPosition,
                       bucketBytes: Array[Byte],
                       previousBucketBytesBox: Box[Array[Byte]],
                       elementClass: ElementClassProto,
                       mappingName: Option[String],
                       editableMappingTracingId: Option[String])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      bucketBytesDecompressed <- if (isRevertedElement(bucketBytes)) {
        Fox.successful(emptyArrayForElementClass(elementClass))
      } else {
        tryo(
          decompressIfNeeded(bucketBytes,
                             expectedUncompressedBucketSizeFor(elementClass),
                             "updating segment index, new bucket data")).toFox
      }
      // previous bytes: include fallback layer bytes if available, otherwise use empty bytes
      previousBucketBytesWithEmptyFallback <- bytesWithEmptyFallback(previousBucketBytesBox, elementClass) ?~> "volumeSegmentIndex.update.getPreviousBucket.failed"
      segmentIds: Set[Long] <- collectSegmentIds(bucketBytesDecompressed, elementClass)
      previousSegmentIds: Set[Long] <- collectSegmentIds(previousBucketBytesWithEmptyFallback, elementClass) ?~> "volumeSegmentIndex.update.collectSegmentIds.failed"
      additions = segmentIds.diff(previousSegmentIds)
      removals = previousSegmentIds.diff(segmentIds)
      _ <- Fox.serialCombined(removals.toList)(
        segmentId =>
          // When fallback layer is used we also need to include relevant segments here into the fossildb since otherwise the fallback layer would be used with invalid data
          removeBucketFromSegmentIndex(segmentIndexBuffer,
                                       segmentId,
                                       bucketPosition,
                                       mappingName,
                                       editableMappingTracingId)) ?~> "volumeSegmentIndex.update.removeBucket.failed"
      // When fallback layer is used, copy the entire bucketlist for this segment instead of one bucket
      _ <- Fox.runIf(additions.nonEmpty)(
        addBucketToSegmentIndex(segmentIndexBuffer,
                                additions.toList,
                                bucketPosition,
                                mappingName,
                                editableMappingTracingId)) ?~> "volumeSegmentIndex.update.addBucket.failed"
    } yield ()

  private def bytesWithEmptyFallback(bytesBox: Box[Array[Byte]], elementClass: ElementClassProto)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    bytesBox match {
      case Empty       => Fox.successful(emptyArrayForElementClass(elementClass))
      case Full(bytes) => Fox.successful(bytes)
      case f: Failure  => f.toFox
    }

  private def emptyArrayForElementClass(elementClass: ElementClassProto): Array[Byte] =
    Array.fill[Byte](ElementClass.bytesPerElement(elementClass))(0)

  private def removeBucketFromSegmentIndex(
      segmentIndexBuffer: VolumeSegmentIndexBuffer,
      segmentId: Long,
      bucketPosition: BucketPosition,
      mappingName: Option[String],
      editableMappingTracingId: Option[String])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      previousBucketList: ListOfVec3IntProto <- getSegmentToBucketIndexWithEmptyFallback(
        segmentIndexBuffer,
        segmentId,
        bucketPosition.mag,
        mappingName,
        editableMappingTracingId,
        bucketPosition.additionalCoordinates)
      bucketPositionProto = bucketPosition.toVec3IntProto
      newBucketList = ListOfVec3IntProto(previousBucketList.values.filterNot(_ == bucketPositionProto))
      _ = segmentIndexBuffer.put(segmentId, bucketPosition.mag, bucketPosition.additionalCoordinates, newBucketList)
    } yield ()

  private def addBucketToSegmentIndex(
      segmentIndexBuffer: VolumeSegmentIndexBuffer,
      segmentIds: List[Long],
      bucketPosition: BucketPosition,
      mappingName: Option[String],
      editableMappingTracingId: Option[String])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      previousBuckets <- segmentIndexBuffer.getSegmentToBucketIndexMap(segmentIds,
                                                                       bucketPosition.mag,
                                                                       mappingName,
                                                                       editableMappingTracingId,
                                                                       bucketPosition.additionalCoordinates)
      _ <- Fox.serialCombined(previousBuckets) {
        case (segmentId, previousBucketList) =>
          val newBucketList = ListOfVec3IntProto(
            (bucketPosition.toVec3IntProto +: ListOfVec3IntProto
              .of(previousBucketList.map(vec3IntToProto))
              .values).distinct)
          segmentIndexBuffer.put(segmentId, bucketPosition.mag, bucketPosition.additionalCoordinates, newBucketList)
          Fox.successful(())
        case _ => Fox.successful(())
      }
    } yield ()

  private def collectSegmentIds(bytes: Array[Byte], elementClass: ElementClassProto)(
      implicit ec: ExecutionContext): Fox[Set[Long]] =
    for {
      set <- tryo(UnsignedIntegerArray.toSetFromByteArray(bytes, elementClass)).toFox
    } yield
      set.filter(!_.isZero).map { (u: UnsignedInteger) =>
        u.toPositiveLong
      }

  private def getSegmentToBucketIndexWithEmptyFallback(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                                       segmentId: Long,
                                                       mag: Vec3Int,
                                                       mappingName: Option[String],
                                                       editableMappingTracingId: Option[String],
                                                       additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] =
    for {
      bucketListBox <- segmentIndexBuffer
        .getWithFallback(segmentId, mag, mappingName, editableMappingTracingId, additionalCoordinates)
        .futureBox
      bucketList <- addEmptyFallback(bucketListBox)
    } yield bucketList

  def getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(fallbackLayer: Option[RemoteFallbackLayer],
                                                            tracingId: String,
                                                            segmentId: Long,
                                                            mag: Vec3Int,
                                                            version: Option[Long] = None,
                                                            mappingName: Option[String],
                                                            editableMappingTracingId: Option[String],
                                                            additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                                                            additionalAxes: Option[Seq[AdditionalAxis]])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[ListOfVec3IntProto] =
    for {
      bucketListBox <- getSegmentToBucketIndex(fallbackLayer,
                                               tracingId,
                                               segmentId,
                                               mag,
                                               version,
                                               mappingName,
                                               editableMappingTracingId,
                                               additionalCoordinates,
                                               additionalAxes).futureBox
      bucketList <- addEmptyFallback(bucketListBox)
    } yield bucketList

  private def addEmptyFallback(positionsBox: Box[ListOfVec3IntProto])(
      implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] =
    positionsBox match {
      case Full(list) => Fox.successful(list)
      case f: Failure => f.toFox
      case Empty      => Fox.successful(ListOfVec3IntProto(Seq.empty))
    }

  private def getSegmentToBucketIndex(fallbackLayerOpt: Option[RemoteFallbackLayer],
                                      tracingId: String,
                                      segmentId: Long,
                                      mag: Vec3Int,
                                      version: Option[Long],
                                      mappingName: Option[String],
                                      editableMappingTracingId: Option[String],
                                      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                                      additionalAxes: Option[Seq[AdditionalAxis]])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[ListOfVec3IntProto] =
    for {
      fromMutableIndex <- getSegmentToBucketIndexFromFossilDB(tracingId,
                                                              segmentId,
                                                              mag,
                                                              version,
                                                              additionalCoordinates,
                                                              additionalAxes).fillEmpty(ListOfVec3IntProto.of(Seq()))
      fromFileIndex <- fallbackLayerOpt match { // isEmpty is not the same as length == 0 here :(
        case Some(fallbackLayer) if fromMutableIndex.length == 0 =>
          getSegmentToBucketIndexFromFile(fallbackLayer, segmentId, mag, mappingName, editableMappingTracingId) // additional coordinates not supported, see #7556
        case _ => Fox.successful(Seq.empty)
      }
      combined = fromMutableIndex.values.map(vec3IntFromProto) ++ fromFileIndex
    } yield ListOfVec3IntProto(combined.map(vec3IntToProto))

  private def getSegmentToBucketIndexFromFossilDB(
      tracingId: String,
      segmentId: Long,
      mag: Vec3Int,
      version: Option[Long],
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      additionalAxes: Option[Seq[AdditionalAxis]]): Fox[ListOfVec3IntProto] = {
    val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
    volumeSegmentIndexClient.get(key, version, mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto]).map(_.value)
  }

  private def getSegmentToBucketIndexFromFile(layer: RemoteFallbackLayer,
                                              segmentId: Long,
                                              mag: Vec3Int,
                                              mappingName: Option[String],
                                              editableMappingTracingId: Option[String])(implicit tc: TokenContext) =
    remoteDatastoreClient.querySegmentIndex(layer, segmentId, mag, mappingName, editableMappingTracingId)

}
