package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.helpers.{NativeBucketScanner, ProtoGeometryConversions}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, TemporaryTracingService}

import scala.collection.mutable
import scala.concurrent.ExecutionContext

class VolumeBucketBuffer(
    version: Long,
    volumeLayer: VolumeTracingLayer,
    val volumeDataStore: FossilDBClient,
    val temporaryTracingService: TemporaryTracingService,
    toTemporaryStore: Boolean
)(using ec: ExecutionContext)
    extends VolumeTracingBucketHelper
    with ProtoGeometryConversions {

  // bucketPos → (bucketData, isChanged)
  private lazy val bucketDataBuffer: mutable.Map[BucketPosition, (Box[Array[Byte]], Boolean)] =
    new mutable.HashMap[BucketPosition, (Box[Array[Byte]], Boolean)]()

  private lazy val segmentAdditionsBuffer: mutable.Map[BucketPosition, Set[Long]] =
    new mutable.HashMap[BucketPosition, Set[Long]]()

  private lazy val segmentRemovalsBuffer: mutable.Map[BucketPosition, Set[Long]] =
    new mutable.HashMap[BucketPosition, Set[Long]]()

  def segmentAdditions: Map[BucketPosition, Set[Long]] = segmentAdditionsBuffer.toMap
  def segmentRemovals: Map[BucketPosition, Set[Long]] = segmentRemovalsBuffer.toMap

  private lazy val bucketScanner = new NativeBucketScanner()

  // TODO make use of prefill
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
      _ = bucketDataBoxes.zip(bucketPositions).foreach { case (bucketDataBox, bucketPosition) =>
        bucketDataBox match {
          case Full(_)    => bucketDataBuffer.put(bucketPosition, (bucketDataBox, false))
          case Empty      => bucketDataBuffer.put(bucketPosition, (Empty, false))
          case _: Failure => () // we asserted no failures above
        }
      }
    } yield bucketDataBoxes

  def put(bucketPosition: BucketPosition, bucketBytes: Array[Byte]): Unit =
    bucketDataBuffer.put(bucketPosition, (Full(bucketBytes), true))

  private def applyBucketMutation(
      bucketPosition: BucketPosition
  )(transform: Array[Byte] => Box[Array[Byte]]): Fox[Unit] =
    for {
      previousBucketBytesBox <- getWithFallback(bucketPosition).shiftBox
      previousBucketBytesOrEmpty <- bytesWithEmptyFallback(previousBucketBytesBox).toFox
      updatedBucketBytes <- transform(previousBucketBytesOrEmpty).toFox
      _ = put(bucketPosition, updatedBucketBytes)
      (additions, removals) <- scanSegmentAdditionsAndRemovals(previousBucketBytesOrEmpty, updatedBucketBytes).toFox
      _ = incorporateAdditionsAndRemovals(bucketPosition, additions, removals)
    } yield ()

  def applyUpdateBucketPartialAction(action: UpdateBucketPartialVolumeAction): Fox[Unit] =
    applyBucketMutation(action.bucketPosition)(previous => applyVoxelRuns(previous, action.voxelRunsBinary))

  def applyDeleteSegmentDataAction(bucketPositions: List[BucketPosition], segmentId: Long): Fox[Unit] =
    Fox
      .serialCombined(bucketPositions)(bucketPosition =>
        applyBucketMutation(bucketPosition)(previous => deleteSegmentFromBucket(previous, segmentId))
      )
      .map(_ => ())

  private def incorporateAdditionsAndRemovals(
      bucketPosition: BucketPosition,
      additions: Set[Long],
      removals: Set[Long]
  ): Unit = {
    val previousAdditions = segmentAdditionsBuffer.getOrElse(bucketPosition, Set.empty[Long])
    val previousRemovals = segmentRemovalsBuffer.getOrElse(bucketPosition, Set.empty[Long])

    // A segment id that is first removed and then added, or first added and then removed is cancelled out.
    val cancelledFromRemovals = additions.intersect(previousRemovals)
    val cancelledFromAdditions = removals.intersect(previousAdditions)

    val combinedAdditions = (previousAdditions ++ (additions -- previousRemovals)) -- cancelledFromAdditions
    val combinedRemovals = (previousRemovals ++ (removals -- previousAdditions)) -- cancelledFromRemovals

    segmentAdditionsBuffer.put(bucketPosition, combinedAdditions)
    segmentRemovalsBuffer.put(bucketPosition, combinedRemovals)
  }

  private def applyVoxelRuns(
      previousBucketBytes: Array[Byte],
      voxelRunsBinary: Array[Byte]
  ): Box[Array[Byte]] =
    tryo(
      bucketScanner.applyVoxelRuns(
        previousBucketBytes,
        ElementClass.bytesPerElement(volumeLayer.elementClass),
        ElementClass.isSigned(volumeLayer.elementClass),
        voxelRunsBinary
      )
    )

  private def deleteSegmentFromBucket(bucketBytes: Array[Byte], segmentId: Long): Box[Array[Byte]] =
    tryo(
      bucketScanner.deleteSegmentFromBucket(
        bucketBytes,
        ElementClass.bytesPerElement(volumeLayer.elementClass),
        ElementClass.isSigned(volumeLayer.elementClass),
        segmentId
      )
    )

  private def scanSegmentAdditionsAndRemovals(
      oldBucketBytes: Array[Byte],
      newBucketBytes: Array[Byte]
  ): Box[(Set[Long], Set[Long])] =
    for {

      previousSegmentIds <- collectSegmentIds(oldBucketBytes)
      segmentIds <- collectSegmentIds(newBucketBytes)
      additions = segmentIds.diff(previousSegmentIds)
      removals = previousSegmentIds.diff(segmentIds)
    } yield (additions, removals)

  private def collectSegmentIds(bytes: Array[Byte]): Box[Set[Long]] =
    tryo(
      bucketScanner
        .collectSegmentIds(
          bytes,
          ElementClass.bytesPerElement(volumeLayer.elementClass),
          ElementClass.isSigned(volumeLayer.elementClass),
          skipZeroes = true
        )
        .toSet
    )

  // TODO deduplicate from segment index buffer
  def bytesWithEmptyFallback(bytesBox: Box[Array[Byte]]): Box[Array[Byte]] =
    bytesBox match {
      case Empty       => Full(emptyBucketArrayForElementClass)
      case Full(bytes) => Full(bytes)
      case f: Failure  => f
    }

  // TODO deduplicate from segment index buffer
  lazy val emptyBucketArrayForElementClass: Array[Byte] =
    Array.fill[Byte](ElementClass.bytesPerElement(volumeLayer.elementClass))(0)

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

  // Caution, this returns a new VolumeBucketBuffer but also mutates the collections! Do not use the old copy afterwards
  def resetForNextUpdateGroup(newTargetVersion: Long): VolumeBucketBuffer =
    new VolumeBucketBuffer(
      version = newTargetVersion,
      volumeLayer,
      volumeDataStore,
      temporaryTracingService,
      toTemporaryStore
    )
}
