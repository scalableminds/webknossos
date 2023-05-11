package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.geometry.{ListOfVec3IntProto, Vec3IntProto}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, KeyValueStoreImplicits, TracingDataStore}

import scala.concurrent.ExecutionContext

class SegmentToBucketIndexService @Inject()(val tracingDataStore: TracingDataStore) extends KeyValueStoreImplicits {
  private val volumeSegmentIndexClient: FossilDBClient = tracingDataStore.volumeSegmentIndex

  private def segmentIndexKey(segmentId: Long, mag: Vec3Int) = s"$segmentId/${mag.toMagLiteral()}"

  def updateSegmentToBucketIndex(segmentId: Long, bucketPositions: Seq[BucketPosition], version: Long)(
      implicit ec: ExecutionContext): Fox[Unit] = {
    val groupedByMag: Map[Vec3Int, Seq[BucketPosition]] = bucketPositions.groupBy(_.mag)
    val protoByMag: Map[Vec3Int, ListOfVec3IntProto] = groupedByMag.mapValues((buckets: Seq[BucketPosition]) =>
      ListOfVec3IntProto(buckets.map(bucket => Vec3IntProto(bucket.bucketX, bucket.bucketY, bucket.bucketZ))))
    for {
      _ <- Fox.serialCombined(protoByMag.keys.toList) { mag =>
        val positions = protoByMag(mag)
        val key = segmentIndexKey(segmentId, mag)
        volumeSegmentIndexClient.put(key, version, positions)
      }
    } yield ()
  }

  def getSegmentToBucketIndex(segmentId: Long, mag: Vec3Int, version: Option[Long])(
      implicit ec: ExecutionContext): Fox[ListOfVec3IntProto] = {
    val key = segmentIndexKey(segmentId, mag)
    volumeSegmentIndexClient.get(key, version, mayBeEmpty = Some(true))(fromProtoBytes[ListOfVec3IntProto]).map(_.value)
  }
}
