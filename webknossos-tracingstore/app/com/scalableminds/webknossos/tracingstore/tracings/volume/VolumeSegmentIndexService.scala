package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.datastore.geometry.{ListOfVec3IntProto, Vec3IntProto}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{BucketPosition, UnsignedInteger, UnsignedIntegerArray}
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, KeyValueStoreImplicits, TracingDataStore}
import net.liftweb.util.Helpers.tryo

import scala.concurrent.ExecutionContext

class VolumeSegmentIndexService @Inject()(val tracingDataStore: TracingDataStore)
    extends KeyValueStoreImplicits
    with ProtoGeometryImplicits {
  private val volumeSegmentIndexClient: FossilDBClient = tracingDataStore.volumeSegmentIndex

  def updateFromBucket(tracingId: String,
                       bucketPosition: BucketPosition,
                       bucketBytes: Array[Byte],
                       updateGroupVersion: Long,
                       elementClass: ElementClass)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      segmentIds <- collectSegmentIds(bucketBytes, elementClass)
    } yield ()

  private def collectSegmentIds(bytes: Array[Byte], elementClass: ElementClass)(
      implicit ec: ExecutionContext): Fox[Set[Long]] =
    for {
      unsignedIntArray <- tryo(UnsignedIntegerArray.fromByteArray(bytes, elementClass)).toFox
    } yield
      unsignedIntArray.toSet.map { u: UnsignedInteger =>
        u.toPositiveLong
      }

  private def segmentIndexKey(tracingId: String, segmentId: Long, mag: Vec3Int) =
    s"$tracingId/$segmentId/${mag.toMagLiteral()}"

  def updateSegmentToBucketIndex(tracingId: String,
                                 segmentId: Long,
                                 bucketPositions: Seq[BucketPosition],
                                 version: Long)(implicit ec: ExecutionContext): Fox[Unit] = {
    val groupedByMag: Map[Vec3Int, Seq[BucketPosition]] = bucketPositions.groupBy(_.mag)
    val protoByMag: Map[Vec3Int, ListOfVec3IntProto] = groupedByMag.mapValues((buckets: Seq[BucketPosition]) =>
      ListOfVec3IntProto(buckets.map(bucket => Vec3IntProto(bucket.bucketX, bucket.bucketY, bucket.bucketZ))))
    for {
      _ <- Fox.serialCombined(protoByMag.keys.toList) { mag =>
        val positions = protoByMag(mag)
        val key = segmentIndexKey(tracingId, segmentId, mag)
        volumeSegmentIndexClient.put(key, version, positions)
      }
    } yield ()
  }

  def getSegmentToBucketIndex(tracingId: String,
                              segmentId: Long,
                              mag: Vec3Int,
                              version: Option[Long]): Fox[ListOfVec3IntProto] = {
    val key = segmentIndexKey(tracingId, segmentId, mag)
    volumeSegmentIndexClient.get(key, version, mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto]).map(_.value)
  }
}
