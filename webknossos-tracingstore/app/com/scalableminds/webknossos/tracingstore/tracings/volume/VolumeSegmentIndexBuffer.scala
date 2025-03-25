package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
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
class VolumeSegmentIndexBuffer(tracingId: String,
                               elementClass: ElementClass.Value,
                               volumeSegmentIndexClient: FossilDBClient,
                               version: Long,
                               remoteDatastoreClient: TSRemoteDatastoreClient,
                               fallbackLayer: Option[RemoteFallbackLayer],
                               additionalAxes: Option[Seq[AdditionalAxis]],
                               temporaryTracingService: TemporaryTracingService,
                               tc: TokenContext,
                               toTemporaryStore: Boolean = false)
    extends KeyValueStoreImplicits
    with SegmentIndexKeyHelper
    with ProtoGeometryImplicits
    with LazyLogging {

  private lazy val segmentIndexBuffer: mutable.Map[String, (Set[Vec3IntProto], Boolean)] =
    new mutable.HashMap[String, (Set[Vec3IntProto], Boolean)]()

  def put(segmentId: Long,
          mag: Vec3Int,
          additionalCoordinates: Option[Seq[AdditionalCoordinate]],
          bucketPositions: Set[Vec3IntProto],
          markAsChanged: Boolean): Unit =
    segmentIndexBuffer(segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)) =
      (bucketPositions, markAsChanged)

  private def putMultiple(segmentIdsWithBucketPositions: Seq[(Long, Set[Vec3IntProto])],
                          mag: Vec3Int,
                          additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                          markAsChanged: Boolean): Unit =
    segmentIdsWithBucketPositions.foreach {
      case (segmentId, bucketPositions) =>
        put(segmentId, mag, additionalCoordinates, bucketPositions, markAsChanged)
    }

  def getOne(segmentId: Long,
             mag: Vec3Int,
             mappingName: Option[String],
             editableMappingTracingId: Option[String],
             additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[Set[Vec3IntProto]] = {
    val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
    segmentIndexBuffer.get(key) match {
      case Some((positions, _)) => Fox.successful(positions)
      case None =>
        getOneFromFossilOrDatastore(segmentId, mag, mappingName, editableMappingTracingId, additionalCoordinates)
    }
  }

  def getMultiple(segmentIds: List[Long],
                  mag: Vec3Int,
                  mappingName: Option[String], // TODO move mappingName to buffer properties?
                  editableMappingTracingId: Option[String],
                  additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[List[(Long, Set[Vec3IntProto])]] =
    if (segmentIds.isEmpty) Fox.successful(List.empty)
    else {
      for {
        (fromBufferHits, fromBufferMisses) <- Fox.successful(
          getMultipleFromBufferNoteMisses(segmentIds, mag, additionalCoordinates))
        (fromFossilOrTempHits, fromFossilOrTempMisses) <- if (toTemporaryStore)
          Fox.successful(getMultipleFromTemporaryStoreNoteMisses(fromBufferMisses, mag, additionalCoordinates))
        else getMultipleFromFossilNoteMisses(fromBufferMisses, mag, additionalCoordinates)
        fromDatastoreHits <- getMultipleFromDatastore(fromFossilOrTempMisses,
                                                      mag,
                                                      additionalCoordinates,
                                                      mappingName,
                                                      editableMappingTracingId)
        _ = putMultiple(fromFossilOrTempHits, mag, additionalCoordinates, markAsChanged = false)
        _ = putMultiple(fromDatastoreHits, mag, additionalCoordinates, markAsChanged = false)
        allHits = fromBufferHits ++ fromFossilOrTempHits ++ fromDatastoreHits
        allHitsFilled = segmentIds.map { segmentId =>
          allHits.find(_._1 == segmentId) match {
            case Some((_, positions)) => (segmentId, positions)
            case None                 => (segmentId, Set[Vec3IntProto]())
          }
        }
      } yield allHitsFilled
    }

  def flush(): Fox[Unit] = {
    val toFlush = segmentIndexBuffer.toMap.flatMap {
      case (key, (bucketPositions, true)) => Some((key, bucketPositions))
      case _                              => None
    }
    if (toTemporaryStore) {
      temporaryTracingService.saveVolumeSegmentIndexBuffer(tracingId, toFlush)
    } else {
      // TODO batching
      val asByteArrays: Seq[(String, Array[Byte])] =
        toFlush.toSeq.map(tuple => (tuple._1, toProtoBytes(tuple._2)))
      volumeSegmentIndexClient.putMultiple(asByteArrays, version)
    }
  }

  private def getOneFromFossilOrDatastore(segmentId: Long,
                                          mag: Vec3Int,
                                          mappingName: Option[String],
                                          editableMappingTracingId: Option[String],
                                          additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[Set[Vec3IntProto]] = {
    val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
    for {
      fossilDbData <- volumeSegmentIndexClient
        .get(key, Some(version), mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto])
        .map(_.value.values.toSet)
        .fillEmpty(Set[Vec3IntProto]())
      data <- fallbackLayer match {
        case Some(layer) if fossilDbData.isEmpty =>
          remoteDatastoreClient
            .querySegmentIndex(layer, segmentId, mag, mappingName, editableMappingTracingId)(tc)
            .map(_.toSet.map(vec3IntToProto))
        case _ => Fox.successful(fossilDbData)
      }
    } yield data
  }

  private def getMultipleFromBufferNoteMisses(
      segmentIds: List[Long],
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]]
  ): (List[(Long, Set[Vec3IntProto])], List[Long]) = {
    var misses = List[Long]()
    var hits = List[(Long, Set[Vec3IntProto])]()
    segmentIds.foreach { segmentId =>
      val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
      segmentIndexBuffer.get(key) match {
        case Some((bucketPositions, _)) => hits = (segmentId, bucketPositions) :: hits
        case None                       => misses = segmentId :: misses
      }
    }
    (hits, misses)
  }

  private def getMultipleFromFossilNoteMisses(segmentIds: List[Long],
                                              mag: Vec3Int,
                                              additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[(List[(Long, Set[Vec3IntProto])], List[Long])] = {
    var misses = List[Long]()
    var hits = List[(Long, Set[Vec3IntProto])]()
    for {
      _ <- Fox.serialCombined(segmentIds)(segmentId =>
        for {
          _ <- Fox.successful(())
          key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
          bucketPositionsBox <- volumeSegmentIndexClient
            .get(key, Some(version), mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto])
            .map(_.value.values.toSet)
            .futureBox
          _ = bucketPositionsBox match {
            case Full(bucketPositions) => hits = (segmentId, bucketPositions) :: hits
            case _                     => misses = segmentId :: misses
          }
        } yield ())
    } yield (hits, misses)
  }

  private def getMultipleFromTemporaryStoreNoteMisses(
      segmentIds: List[Long],
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]]): (List[(Long, Set[Vec3IntProto])], List[Long]) = {
    var misses = List[Long]()
    var hits = List[(Long, Set[Vec3IntProto])]()
    segmentIds.foreach { segmentId =>
      val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
      temporaryTracingService.getVolumeSegmentIndexBufferForKey(key) match {
        case Some(bucketPositions) => hits = (segmentId, bucketPositions) :: hits
        case None                  => misses = segmentId :: misses
      }
    }
    (hits, misses)
  }

  private def getMultipleFromDatastore(
      segmentIds: List[Long],
      mag: Vec3Int,
      // currently unused, segment index files in datastore cannot handle ND anyway.
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      mappingName: Option[String],
      editableMappingTracingId: Option[String])(implicit ec: ExecutionContext): Fox[Seq[(Long, Set[Vec3IntProto])]] =
    fallbackLayer match {
      case Some(remoteFallbackLayer) if segmentIds.nonEmpty => {
        remoteDatastoreClient.querySegmentIndexForMultipleSegments(remoteFallbackLayer,
                                                                   segmentIds,
                                                                   mag,
                                                                   mappingName,
                                                                   editableMappingTracingId)(tc)
      }
      case None => Fox.successful(List.empty)
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
