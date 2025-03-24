package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.geometry.{ListOfVec3IntProto, Vec3IntProto}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  RemoteFallbackLayer,
  TemporaryTracingService
}
import com.typesafe.scalalogging.LazyLogging

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

  private lazy val segmentIndexBuffer: mutable.Map[String, ListOfVec3IntProto] =
    new mutable.HashMap[String, ListOfVec3IntProto]()

  // Used during initial saving of annotation: For each bucket, multiple segment ids are requested, which may overlap.
  private lazy val fileSegmentIndexCache: mutable.Map[String, ListOfVec3IntProto] =
    new mutable.HashMap[String, ListOfVec3IntProto]()

  def put(segmentId: Long,
          mag: Vec3Int,
          additionalCoordinates: Option[Seq[AdditionalCoordinate]],
          segmentPositions: ListOfVec3IntProto): Unit =
    segmentIndexBuffer(segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)) =
      segmentPositions

  def getWithFallback(segmentId: Long,
                      mag: Vec3Int,
                      mappingName: Option[String],
                      editableMappingTracingId: Option[String],
                      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] = {
    val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
    segmentIndexBuffer.get(key) match {
      case Some(positions) => Fox.successful(positions)
      case None            => getFallback(segmentId, mag, mappingName, editableMappingTracingId, additionalCoordinates)
    }
  }

  def flush()(implicit ec: ExecutionContext): Fox[Unit] =
    if (toTemporaryStore) {
      temporaryTracingService.saveVolumeSegmentIndexBuffer(tracingId, segmentIndexBuffer.toMap)
    } else {
      // TODO batching
      val keyValueTuples: Seq[(String, Array[Byte])] =
        segmentIndexBuffer.toSeq.map(tuple => (tuple._1, toProtoBytes(tuple._2)))
      volumeSegmentIndexClient.putMultiple(keyValueTuples, version)
    }

  private def getFallback(segmentId: Long,
                          mag: Vec3Int,
                          mappingName: Option[String],
                          editableMappingTracingId: Option[String],
                          additionalCoordinates: Option[Seq[AdditionalCoordinate]])(implicit ec: ExecutionContext) = {
    val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
    logger.info(f"getFallback for $key")
    for {
      fossilDbData <- volumeSegmentIndexClient
        .get(key, Some(version), mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto])
        .map(_.value)
        .fillEmpty(ListOfVec3IntProto.of(Seq()))
      data <- fallbackLayer match {
        case Some(layer) if fossilDbData.length == 0 =>
          remoteDatastoreClient.querySegmentIndex(layer, segmentId, mag, mappingName, editableMappingTracingId)(tc)
        case _ => Fox.successful(fossilDbData.values.map(vec3IntFromProto))
      }
    } yield ListOfVec3IntProto(data.map(vec3IntToProto))
  }

  private def getSegmentsFromFossilDBNoteMisses(
      tracingId: String,
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      additionalAxes: Option[Seq[AdditionalAxis]],
      segmentIds: List[Long])(implicit ec: ExecutionContext): Fox[(List[(Long, Seq[Vec3IntProto])], List[Long])] = {
    logger.info(s"get segments from fossildb for $segmentIds")
    var misses = List[Long]()
    var hits = List[(Long, Seq[Vec3IntProto])]()
    for {
      _ <- Fox.serialCombined(segmentIds)(segmentId =>
        for {
          _ <- Fox.successful(())
          key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
          bucketPositions <- volumeSegmentIndexClient
            .get(key, Some(version), mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto])
            .map(_.value)
            .fillEmpty(ListOfVec3IntProto.of(Seq()))
          wasMiss = bucketPositions.length == 0
          _ = if (wasMiss) misses = segmentId :: misses
          else hits = (segmentId, bucketPositions.values) :: hits
        } yield ())
      _ = misses.map(
        segmentId =>
          fileSegmentIndexCache
            .get(segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)) match {
            case Some(positions) => {
              hits = (segmentId, positions.values) :: hits
              misses = misses.filterNot(_ == segmentId)
            }
            case None => ()
        })
    } yield (hits, misses)
  }

  private def getSegmentsFromBufferNoteMisses(
      segmentIds: List[Long],
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]]
  ): (List[(Long, Seq[Vec3IntProto])], List[Long]) = {
    val hits = segmentIds.flatMap(id => {
      val key = segmentIndexKey(tracingId, id, mag, additionalCoordinates, additionalAxes)
      val values = segmentIndexBuffer.get(key).map(_.values)
      values match {
        case Some(positions) => Some(id, positions)
        case None            => None
      }
    })
    val misses = segmentIds.filterNot(id => hits.exists(_._1 == id))
    (hits, misses)
  }

  private def getSegmentToBucketIndexMapFromPermanentStorage(segmentIds: List[Long],
                                                             mag: Vec3Int,
                                                             mappingName: Option[String],
                                                             editableMappingTracingId: Option[String],
                                                             additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[List[(Long, Seq[Vec3IntProto])]] =
    if (segmentIds.isEmpty) Fox.successful(List.empty)
    else {
      for {
        (mutableIndexHits, mutableIndexMisses) <- getSegmentsFromFossilDBNoteMisses(tracingId,
                                                                                    mag,
                                                                                    additionalCoordinates,
                                                                                    additionalAxes,
                                                                                    segmentIds)
        fileBucketPositions <- fallbackLayer match {
          case Some(layer) =>
            for {
              fileBucketPositionsOpt <- Fox.runIf(mutableIndexMisses.nonEmpty)(
                remoteDatastoreClient.querySegmentIndexForMultipleSegments(layer,
                                                                           mutableIndexMisses,
                                                                           mag,
                                                                           mappingName,
                                                                           editableMappingTracingId)(tc))
              fileBucketPositions = fileBucketPositionsOpt.getOrElse(Seq())
              fileBucketPositionsProto = fileBucketPositions.map {
                case (segmentId, positions) => (segmentId, positions.map(vec3IntToProto))
              }
              _ = fileBucketPositionsProto.map {
                case (segmentId, positions) =>
                  fileSegmentIndexCache(
                    segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)) =
                    ListOfVec3IntProto(positions)
              }
            } yield fileBucketPositionsProto
          case _ => Fox.successful(List[(Long, Seq[Vec3IntProto])]())
        }
      } yield mutableIndexHits ++ fileBucketPositions
    }

  private def getSegmentToBucketIndexMapFromTemporaryStorage(segmentIds: List[Long],
                                                             mag: Vec3Int,
                                                             additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[List[(Long, Seq[Vec3IntProto])]] =
    Fox.successful(
      segmentIds
        .map(segmentId => {
          val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
          temporaryTracingService.getVolumeSegmentIndexBufferForKey(key) match {
            case Some(positions) => Some(segmentId, positions.values)
            case None            => None
          }
        })
        .collect { case Some(x) => x })

  // Get a map from segment to bucket position (e.g. an index) from all sources (buffer, temporary storage, fossilDB, file)
  def getSegmentToBucketIndexMap(segmentIds: List[Long],
                                 mag: Vec3Int,
                                 mappingName: Option[String],
                                 editableMappingTracingId: Option[String],
                                 additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[List[(Long, Seq[Vec3IntProto])]] =
    for {
      _ <- Fox.successful(())
      (bufferHits, bufferMisses) = getSegmentsFromBufferNoteMisses(segmentIds, mag, additionalCoordinates)
      remainingHits <- if (toTemporaryStore) {
        getSegmentToBucketIndexMapFromTemporaryStorage(bufferMisses, mag, additionalCoordinates)
      } else {
        getSegmentToBucketIndexMapFromPermanentStorage(bufferMisses,
                                                       mag,
                                                       mappingName,
                                                       editableMappingTracingId,
                                                       additionalCoordinates)
      }
      allHits = remainingHits ++ bufferHits
      allHitsFilled = segmentIds.map { segmentId =>
        allHits.find(_._1 == segmentId) match {
          case Some((_, positions)) => (segmentId, positions)
          case None                 => (segmentId, Seq())
        }
      }
    } yield allHitsFilled

}
