package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, TemporaryTracingService}
import net.liftweb.common.{Box, Full}

import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}

class VolumeBucketBuffer(version: Long,
                         volumeTracingLayer: VolumeTracingLayer,
                         val volumeDataStore: FossilDBClient,
                         val temporaryTracingService: TemporaryTracingService,
                         implicit val tc: TokenContext,
                         implicit val ec: ExecutionContext)
    extends VolumeTracingBucketHelper
    with ProtoGeometryImplicits {

  // bucketPos → (bucketData, isChanged)
  private lazy val bucketDataBuffer: mutable.Map[BucketPosition, (Box[Array[Byte]], Boolean)] =
    new mutable.HashMap[BucketPosition, (Box[Array[Byte]], Boolean)]()

  def prefill(bucketPositions: List[BucketPosition]): Fox[Unit] =
    for {
      before <- Instant.nowFox
      // TODO use multi-get
      _ <- Future.sequence(bucketPositions.map(pos => getFromFossil(pos).futureBox))
      _ = Instant.logSince(before, "bucketBuffer prefill")
    } yield ()

  def getWithFallback(bucketPosition: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    bucketDataBuffer.get(bucketPosition) match {
      case Some((bucketDataBox, _d)) => bucketDataBox
      case None                      => logger.info("buffer miss"); getFromFossil(bucketPosition)
    }

  private def getFromFossil(bucketPosition: BucketPosition): Fox[Array[Byte]] =
    for {
      bucketDataBox: Box[Array[Byte]] <- loadBucket(volumeTracingLayer, bucketPosition, Some(version)).futureBox
      _ = bucketDataBuffer.put(bucketPosition, (bucketDataBox, false))
    } yield bucketDataBox

  def put(bucketPosition: BucketPosition, bucketBytes: Array[Byte]): Unit =
    bucketDataBuffer.put(bucketPosition, (Full(bucketBytes), true))

  def flush(): Fox[Unit] = {
    val fullDirtyBuckets = bucketDataBuffer.keys.flatMap { bucketPosition =>
      bucketDataBuffer(bucketPosition) match {
        case (Full(bucketData), true) =>
          Some(
            (buildBucketKey(volumeTracingLayer.tracingId, bucketPosition, volumeTracingLayer.additionalAxes),
             bucketData))
        case _ => None
      }
    }
    // TODO go via VolumeTracingBucketHelper (compress if needed, etc)
    volumeDataStore.putMultiple(fullDirtyBuckets.toList, version)
  }
}
