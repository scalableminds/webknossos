package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, TemporaryTracingService}
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}

import scala.collection.mutable
import scala.concurrent.ExecutionContext

class VolumeBucketBuffer(version: Long,
                         volumeLayer: VolumeTracingLayer,
                         val volumeDataStore: FossilDBClient,
                         val temporaryTracingService: TemporaryTracingService,
                         toTemporaryStore: Boolean,
                         implicit val tc: TokenContext,
                         implicit val ec: ExecutionContext)
    extends VolumeTracingBucketHelper
    with ProtoGeometryImplicits {

  // bucketPos → (bucketData, isChanged)
  private lazy val bucketDataBuffer: mutable.Map[BucketPosition, (Box[Array[Byte]], Boolean)] =
    new mutable.HashMap[BucketPosition, (Box[Array[Byte]], Boolean)]()

  def prefill(bucketPositions: List[BucketPosition]): Fox[Unit] =
    for {
      _ <- getMultipleFromFossilOrFallbackLayer(bucketPositions)
    } yield ()

  def getWithFallback(bucketPosition: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    bucketDataBuffer.get(bucketPosition) match {
      case Some((bucketDataBox, _)) => bucketDataBox.toFox
      case None                     => getFromFossilOrFallbackLayer(bucketPosition)
    }

  private def getFromFossilOrFallbackLayer(bucketPosition: BucketPosition): Fox[Array[Byte]] =
    for {
      multiResult <- getMultipleFromFossilOrFallbackLayer(Seq(bucketPosition))
      firstBox <- multiResult.headOption.toFox
      firstValue <- firstBox.toFox
    } yield firstValue

  private def getMultipleFromFossilOrFallbackLayer(bucketPositions: Seq[BucketPosition]): Fox[Seq[Box[Array[Byte]]]] =
    for {
      bucketDataBoxes <- loadBuckets(volumeLayer, bucketPositions, Some(version))
      _ <- Fox.fromBool(bucketDataBoxes.length == bucketPositions.length)
      _ <- Fox.assertNoFailure(bucketDataBoxes)
      _ = bucketDataBoxes.zip(bucketPositions).foreach {
        case (bucketDataBox, bucketPosition) =>
          bucketDataBox match {
            case Full(_)    => bucketDataBuffer.put(bucketPosition, (bucketDataBox, false))
            case Empty      => bucketDataBuffer.put(bucketPosition, (Empty, false))
            case _: Failure => () // we asserted no failures above
          }
      }
    } yield bucketDataBoxes

  def put(bucketPosition: BucketPosition, bucketBytes: Array[Byte]): Unit =
    bucketDataBuffer.put(bucketPosition, (Full(bucketBytes), true))

  def flush(): Fox[Unit] = {
    val fullDirtyBuckets = bucketDataBuffer.keys.flatMap { bucketPosition =>
      bucketDataBuffer(bucketPosition) match {
        case (Full(bucketData), true) =>
          Some((bucketPosition, bucketData))
        case _ => None
      }
    }.toSeq
    saveBuckets(volumeLayer, fullDirtyBuckets.map(_._1), fullDirtyBuckets.map(_._2), version, toTemporaryStore)
  }
}
