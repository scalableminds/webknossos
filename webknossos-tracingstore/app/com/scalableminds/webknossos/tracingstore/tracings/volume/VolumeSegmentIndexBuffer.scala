package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.RemoteFallbackLayer
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, KeyValueStoreImplicits}
import com.typesafe.scalalogging.LazyLogging

import scala.collection.mutable
import scala.concurrent.ExecutionContext

trait SegmentIndexKeyHelper {
  protected def segmentIndexKey(tracingId: String, segmentId: Long, mag: Vec3Int) =
    s"$tracingId/$segmentId/${mag.toMagLiteral()}"
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
                               userToken: Option[String])
    extends KeyValueStoreImplicits
    with SegmentIndexKeyHelper
    with ProtoGeometryImplicits
    with LazyLogging {

  private lazy val segmentIndexBuffer: mutable.Map[String, ListOfVec3IntProto] =
    new mutable.HashMap[String, ListOfVec3IntProto]()

  def put(segmentId: Long, mag: Vec3Int, segmentPositions: ListOfVec3IntProto): Unit =
    segmentIndexBuffer(segmentIndexKey(tracingId, segmentId, mag)) = segmentPositions

  def getWithFallback(segmentId: Long, mag: Vec3Int, mappingName: Option[String])(
      implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] = {
    val key = segmentIndexKey(tracingId, segmentId, mag)
    segmentIndexBuffer.get(key) match {
      case Some(positions) => Fox.successful(positions)
      case None            => getFallback(segmentId, mag, mappingName)
    }
  }

  def flush()(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(segmentIndexBuffer.keys.toList) { key =>
        volumeSegmentIndexClient.put(key, version, segmentIndexBuffer(key))
      }
    } yield ()

  private def getFallback(segmentId: Long, mag: Vec3Int, mappingName: Option[String])(implicit ec: ExecutionContext) = {
    val key = segmentIndexKey(tracingId, segmentId, mag)
    for {
      fossilDbData <- volumeSegmentIndexClient
        .get(key, Some(version), mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto])
        .map(_.value)
        .fillEmpty(ListOfVec3IntProto.of(Seq()))
      data <- fallbackLayer match {
        case Some(layer) if fossilDbData.length == 0 =>
          remoteDatastoreClient.querySegmentIndex(layer, segmentId, mag, mappingName, userToken)
        case _ => Fox.successful(fossilDbData.values.map(vec3IntFromProto))
      }
    } yield ListOfVec3IntProto(data.map(vec3IntToProto))
  }

}
