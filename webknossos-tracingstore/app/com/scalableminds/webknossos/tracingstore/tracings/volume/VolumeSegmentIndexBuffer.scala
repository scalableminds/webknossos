package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.geometry.{ListOfVec3IntProto, Vec3IntProto}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, ElementClass}
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  RemoteFallbackLayer,
  TemporaryTracingService
}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.collection.mutable
import scala.concurrent.ExecutionContext

trait SegmentIndexKeyHelper extends AdditionalCoordinateKey {
  protected def segmentIndexKey(tracingId: String,
                                segmentId: Long,
                                mag: Vec3Int,
                                additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                                axes: Option[Seq[AdditionalAxis]]) =
    s"$tracingId/$segmentId/${mag
      .toMagLiteral()}${additionalCoordinatesKeyPart(additionalCoordinates.getOrElse(Seq()), axes.getOrElse(Seq()), "/")}"
}

// To introduce buffering for updating the segment-to-bucket index for a volume tracing
// read provides fallback data from fossildb / segment index file
// while write is done only locally in-memory, until flush is called
// This saves a lot of db interactions (since adjacent bucket updates usually touch the same segments)
class VolumeSegmentIndexBuffer(
    tracingId: String,
    elementClass: ElementClass.Value,
    mappingName: Option[String], // should be the base mapping name in case of editable mapping, otherwise the selected mapping
    volumeSegmentIndexClient: FossilDBClient,
    version: Long,
    remoteDatastoreClient: TSRemoteDatastoreClient,
    fallbackLayer: Option[RemoteFallbackLayer],
    additionalAxes: Option[Seq[AdditionalAxis]],
    temporaryTracingService: TemporaryTracingService,
    tc: TokenContext,
    isReadOnly: Boolean = false,
    toTemporaryStore: Boolean = false)
    extends KeyValueStoreImplicits
    with SegmentIndexKeyHelper
    with ProtoGeometryImplicits
    with FoxImplicits
    with LazyLogging {

  private lazy val segmentIndexBuffer: mutable.Map[String, (Set[Vec3IntProto], Boolean)] =
    new mutable.HashMap[String, (Set[Vec3IntProto], Boolean)]()

  def put(segmentId: Long,
          mag: Vec3Int,
          additionalCoordinates: Option[Seq[AdditionalCoordinate]],
          bucketPositions: Set[Vec3IntProto],
          markAsChanged: Boolean): Unit =
    if (!isReadOnly) {
      segmentIndexBuffer(segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)) =
        (bucketPositions, markAsChanged)
    }

  private def putMultiple(segmentIdsWithBucketPositions: Seq[(Long, Set[Vec3IntProto])],
                          mag: Vec3Int,
                          additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                          markAsChanged: Boolean): Unit =
    if (!isReadOnly) {
      segmentIdsWithBucketPositions.foreach {
        case (segmentId, bucketPositions) =>
          put(segmentId, mag, additionalCoordinates, bucketPositions, markAsChanged)
      }
    }

  def getOne(
      segmentId: Long,
      mag: Vec3Int,
      editableMappingTracingId: Option[String],
      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(implicit ec: ExecutionContext): Fox[Set[Vec3IntProto]] =
    for {
      resultList <- getMultiple(List(segmentId), mag, editableMappingTracingId, additionalCoordinates)
      result <- resultList.headOption.map(_._2).toFox
    } yield result

  def getMultiple(segmentIds: List[Long],
                  mag: Vec3Int,
                  editableMappingTracingId: Option[String],
                  additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[List[(Long, Set[Vec3IntProto])]] =
    if (segmentIds.isEmpty) Fox.successful(List.empty)
    else {
      val (fromBufferHits, fromBufferMisses) = getMultipleFromBufferNoteMisses(segmentIds, mag, additionalCoordinates)
      for {
        (fromFossilOrTempHits, fromFossilOrTempMisses) <- if (toTemporaryStore)
          Fox.successful(getMultipleFromTemporaryStoreNoteMisses(fromBufferMisses, mag, additionalCoordinates))
        else getMultipleFromFossilNoteMisses(fromBufferMisses, mag, additionalCoordinates)
        fromDatastoreHits <- getMultipleFromDatastore(fromFossilOrTempMisses,
                                                      mag,
                                                      additionalCoordinates,
                                                      mappingName,
                                                      editableMappingTracingId)
        _ = putMultiple(fromFossilOrTempHits.toSeq, mag, additionalCoordinates, markAsChanged = false)
        _ = putMultiple(fromDatastoreHits, mag, additionalCoordinates, markAsChanged = false)
        allHits = fromBufferHits ++ fromFossilOrTempHits ++ fromDatastoreHits
        allHitsFilled = segmentIds.map { segmentId =>
          allHits.get(segmentId) match {
            case Some(positions) => (segmentId, positions)
            case None            => (segmentId, Set[Vec3IntProto]())
          }
        }
      } yield allHitsFilled
    }

  def flush()(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.fromBool(!isReadOnly) ?~> "this VolumeSegmentIndexBuffer was instantiated with isReadOnly=true and cannot be flushed."
      toFlush = segmentIndexBuffer.flatMap {
        case (key, (bucketPositions, true)) => Some((key, bucketPositions))
        case _                              => None
      }
      _ <- if (toTemporaryStore) {
        temporaryTracingService.saveVolumeSegmentIndexBuffer(tracingId, toFlush.toSeq)
      } else {
        val asProtoByteArrays = toFlush.map {
          case (key, bucketPositions) => (key, toProtoBytes(ListOfVec3IntProto(bucketPositions.toList)))
        }
        volumeSegmentIndexClient.putMultiple(asProtoByteArrays.toSeq, version)
      }
    } yield ()

  private def getMultipleFromBufferNoteMisses(
      segmentIds: List[Long],
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]]
  ): (Map[Long, Set[Vec3IntProto]], List[Long]) =
    if (isReadOnly) {
      // Nothing is buffered in isReadOnly case, no need to query it.
      (Map.empty, segmentIds)
    } else {
      var misses = List[Long]()
      val hits = mutable.Map[Long, Set[Vec3IntProto]]()
      segmentIds.foreach { segmentId =>
        val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
        segmentIndexBuffer.get(key) match {
          case Some((bucketPositions, _)) => hits.put(segmentId, bucketPositions)
          case None                       => misses = segmentId :: misses
        }
      }
      (hits.toMap, misses)
    }

  private def getMultipleFromFossilNoteMisses(
      segmentIds: List[Long],
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]]): Fox[(Map[Long, Set[Vec3IntProto]], List[Long])] = {
    var misses = List[Long]()
    val hits = mutable.Map[Long, Set[Vec3IntProto]]()
    val keys =
      segmentIds.map(segmentId => segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes))
    for {
      bucketPositionsBoxes <- volumeSegmentIndexClient.getMultipleKeysByList(keys, Some(version), batchSize = 50)(
        fromProtoBytes[ListOfVec3IntProto])
      _ = segmentIds.zip(bucketPositionsBoxes).foreach {
        case (segmentId, Full(bucketPositions)) => hits.put(segmentId, bucketPositions.value.values.toSet)
        case (segmentId, _)                     => misses = segmentId :: misses
      }
    } yield (hits.toMap, misses)
  }

  private def getMultipleFromTemporaryStoreNoteMisses(
      segmentIds: List[Long],
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]]): (Map[Long, Set[Vec3IntProto]], List[Long]) = {
    var misses = List[Long]()
    val hits = mutable.Map[Long, Set[Vec3IntProto]]()
    segmentIds.foreach { segmentId =>
      val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
      temporaryTracingService.getVolumeSegmentIndexBufferForKey(key) match {
        case Some(bucketPositions) => hits.put(segmentId, bucketPositions)
        case None                  => misses = segmentId :: misses
      }
    }
    (hits.toMap, misses)
  }

  private def getMultipleFromDatastore(
      segmentIds: List[Long],
      mag: Vec3Int,
      // currently unused, segment index files in datastore cannot handle ND anyway.
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      mappingName: Option[String],
      editableMappingTracingId: Option[String])(implicit ec: ExecutionContext): Fox[Seq[(Long, Set[Vec3IntProto])]] =
    fallbackLayer match {
      case Some(remoteFallbackLayer) if segmentIds.nonEmpty =>
        remoteDatastoreClient.querySegmentIndexForMultipleSegments(remoteFallbackLayer,
                                                                   segmentIds,
                                                                   mag,
                                                                   mappingName,
                                                                   editableMappingTracingId)(tc)
      case _ => Fox.successful(List.empty)
    }

  lazy val emptyBucketArrayForElementClass: Array[Byte] =
    Array.fill[Byte](ElementClass.bytesPerElement(elementClass))(0)

  def bytesWithEmptyFallback(bytesBox: Box[Array[Byte]]): Box[Array[Byte]] =
    bytesBox match {
      case Empty       => Full(emptyBucketArrayForElementClass)
      case Full(bytes) => Full(bytes)
      case f: Failure  => f
    }
}
