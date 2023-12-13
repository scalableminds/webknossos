package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, KeyValueStoreImplicits}
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
// read provides fallback data from fossildb
// while write is done only locally in-memory, until flush is called
// This saves a lot of db interactions (since adjacent bucket updates usually touch the same segments)
class VolumeSegmentIndexBuffer(tracingId: String,
                               volumeSegmentIndexClient: FossilDBClient,
                               version: Long,
                               additionalAxes: Option[Seq[AdditionalAxis]])
    extends KeyValueStoreImplicits
    with SegmentIndexKeyHelper
    with LazyLogging {

  private lazy val segmentIndexBuffer: mutable.Map[String, ListOfVec3IntProto] =
    new mutable.HashMap[String, ListOfVec3IntProto]()

  def put(segmentId: Long,
          mag: Vec3Int,
          additionalCoordinates: Option[Seq[AdditionalCoordinate]],
          segmentPositions: ListOfVec3IntProto): Unit =
    segmentIndexBuffer(segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)) =
      segmentPositions

  def getWithFallback(segmentId: Long, mag: Vec3Int, additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] = {
    val key = segmentIndexKey(tracingId, segmentId, mag, additionalCoordinates, additionalAxes)
    segmentIndexBuffer.get(key) match {
      case Some(positions) => Fox.successful(positions)
      case None =>
        volumeSegmentIndexClient
          .get(key, Some(version), mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto])
          .map(_.value)
    }
  }

  def flush()(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(segmentIndexBuffer.keys.toList) { key =>
        volumeSegmentIndexClient.put(key, version, segmentIndexBuffer(key))
      }
    } yield ()

}
