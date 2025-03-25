package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, TemporaryTracingService}
import net.liftweb.common.{Box, Empty, Failure, Full}

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
      _ <- Fox.serialSequenceBox(bucketPositions)(pos => getFromFossilOrFallbackLayer(pos))
      _ = Instant.logSince(before, s"bucketBuffer prefill for ${bucketPositions.length} bucket positions.")
    } yield ()

  def getWithFallback(bucketPosition: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    bucketDataBuffer.get(bucketPosition) match {
      case Some((bucketDataBox, _d)) => bucketDataBox
      case None                      => logger.info(s"buffer miss for $bucketPosition"); getFromFossilOrFallbackLayer(bucketPosition)
    }

  private def getFromFossilOrFallbackLayer(bucketPosition: BucketPosition): Fox[Array[Byte]] =
    for {
      bucketDataBox: Box[Array[Byte]] <- loadBucket(volumeTracingLayer, bucketPosition, Some(version)).futureBox
      _ = bucketDataBox match {
        case Full(_)    => bucketDataBuffer.put(bucketPosition, (bucketDataBox, false))
        case Empty      => bucketDataBuffer.put(bucketPosition, (bucketDataBox, false))
        case _: Failure => logger.info("failure in loadBucket")
      }
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
