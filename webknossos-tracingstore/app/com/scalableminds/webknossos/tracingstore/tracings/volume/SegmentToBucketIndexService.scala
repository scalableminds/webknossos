package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.geometry.{ListOfVec3IntProto, Vec3IntProto}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, TracingDataStore}

class SegmentToBucketIndexService @Inject()(val tracingDataStore: TracingDataStore) {
  val volumeSegmentIndexClient: FossilDBClient = tracingDataStore.volumeSegmentIndex

  def updateSegmentToBucketIndex(segmentId: Long, bucketPositions: Seq[BucketPosition]) = {
    val groupedByMag: Map[Vec3Int, Seq[BucketPosition]] = bucketPositions.groupBy(_.mag)
    val proto: Map[Vec3Int, ListOfVec3IntProto] = groupedByMag.mapValues((buckets: Seq[BucketPosition]) =>
      ListOfVec3IntProto(buckets.map(bucket => Vec3IntProto(bucket.bucketX, bucket.bucketY, bucket.bucketZ))))

  }
}
