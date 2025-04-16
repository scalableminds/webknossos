package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.File
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{ByteUtils, Fox}
import com.scalableminds.webknossos.datastore.models.{BucketPosition, SegmentInteger, SegmentIntegerArray}
import com.scalableminds.webknossos.datastore.services.DataConverter
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits

import scala.collection.mutable
import scala.concurrent.ExecutionContext

case class MergedVolumeStats(
    largestSegmentId: Long,
    sortedMagsList: Option[List[Vec3IntProto]], // None means do not touch the mag list
    labelMaps: List[Map[Long, Long]],
    createdSegmentIndex: Boolean
)

object MergedVolumeStats {
  def empty(createdSegmentIndex: Boolean = false): MergedVolumeStats =
    MergedVolumeStats(0L, None, List.empty, createdSegmentIndex)
}

class MergedVolume(elementClass: ElementClassProto, initialLargestSegmentId: Long = 0)
    extends DataConverter
    with ByteUtils
    with VolumeDataZipHelper
    with ProtoGeometryImplicits {
  private val mergedVolume = mutable.HashMap.empty[BucketPosition, Array[SegmentInteger]]
  private val labelSets = mutable.ListBuffer[mutable.Set[SegmentInteger]]()
  private val labelMaps = mutable.ListBuffer[mutable.HashMap[SegmentInteger, SegmentInteger]]()
  var largestSegmentId: SegmentInteger = SegmentInteger.zeroFromElementClass(elementClass)

  def addLabelSetFromDataZip(zipFile: File)(implicit ec: ExecutionContext): Fox[Unit] = {
    val importLabelSet: mutable.Set[SegmentInteger] = scala.collection.mutable.Set()
    val unzipResult = withBucketsFromZip(zipFile) { (_, bytes) =>
      val dataTyped =
        SegmentIntegerArray.fromByteArray(bytes, elementClass)
      val nonZeroData = SegmentIntegerArray.filterNonZero(dataTyped)
      Fox.successful(importLabelSet ++= nonZeroData)
    }
    for {
      _ <- unzipResult
      _ = addLabelSet(importLabelSet)
    } yield ()
  }

  def addLabelSetFromBucketStream(bucketStream: Iterator[(BucketPosition, Array[Byte])],
                                  allowedMags: Set[Vec3Int]): Unit = {
    val labelSet: mutable.Set[SegmentInteger] = scala.collection.mutable.Set()
    bucketStream.foreach {
      case (bucketPosition, data) =>
        if (allowedMags.contains(bucketPosition.mag)) {
          val dataTyped = SegmentIntegerArray.fromByteArray(data, elementClass)
          val nonZeroData: Array[SegmentInteger] = SegmentIntegerArray.filterNonZero(dataTyped)
          labelSet ++= nonZeroData
        }
    }
    addLabelSet(labelSet)
  }

  private def addLabelSet(labelSet: mutable.Set[SegmentInteger]): Unit = labelSets += labelSet

  private def prepareLabelMaps(): Unit =
    if (labelSets.isEmpty || (labelSets.length == 1 && initialLargestSegmentId == 0) || labelMaps.nonEmpty) {
      ()
    } else {
      var segmentId: SegmentInteger = SegmentInteger.zeroFromElementClass(elementClass)
      if (initialLargestSegmentId > 0) {
        labelMaps += mutable.HashMap.empty[SegmentInteger, SegmentInteger]
        segmentId = SegmentInteger.fromLongWithElementClass(initialLargestSegmentId, elementClass)
      }
      labelSets.foreach { labelSet =>
        val labelMap = mutable.HashMap.empty[SegmentInteger, SegmentInteger]
        labelSet.foreach { label =>
          segmentId = segmentId.increment
          labelMap += ((label, segmentId))
        }
        labelMaps += labelMap
      }
      largestSegmentId = segmentId
    }

  def addFromBucketStream(sourceVolumeIndex: Int,
                          bucketStream: Iterator[(BucketPosition, Array[Byte])],
                          allowedMags: Option[Set[Vec3Int]] = None): Unit =
    bucketStream.foreach {
      case (bucketPosition, bytes) =>
        if (!isAllZero(bytes) && allowedMags.forall(_.contains(bucketPosition.mag))) {
          add(sourceVolumeIndex, bucketPosition, bytes)
        }
    }

  def addFromDataZip(sourceVolumeIndex: Int, zipFile: File)(implicit ec: ExecutionContext): Fox[Unit] =
    withBucketsFromZip(zipFile) { (bucketPosition, bytes) =>
      Fox.successful(add(sourceVolumeIndex, bucketPosition, bytes))
    }

  def add(sourceVolumeIndex: Int, bucketPosition: BucketPosition, data: Array[Byte]): Unit = {
    val dataTyped: Array[SegmentInteger] = SegmentIntegerArray.fromByteArray(data, elementClass)
    prepareLabelMaps()
    if (mergedVolume.contains(bucketPosition)) {
      val mutableBucketData = mergedVolume(bucketPosition)
      dataTyped.zipWithIndex.foreach {
        case (valueTyped, index) =>
          if (!valueTyped.isZero) {
            val byteValueMapped =
              if (labelMaps.isEmpty || (initialLargestSegmentId > 0 && sourceVolumeIndex == 0)) valueTyped
              else labelMaps(sourceVolumeIndex)(valueTyped)
            mutableBucketData(index) = byteValueMapped
          }
      }
      mergedVolume += ((bucketPosition, mutableBucketData))
    } else {
      if (labelMaps.isEmpty) {
        mergedVolume += ((bucketPosition, dataTyped))
      } else {
        val dataMapped = dataTyped.map { byteValue =>
          if (byteValue.isZero || initialLargestSegmentId > 0 && sourceVolumeIndex == 0)
            byteValue
          else
            labelMaps(sourceVolumeIndex)(byteValue)
        }
        mergedVolume += ((bucketPosition, dataMapped))
      }
    }
  }

  def withMergedBuckets(block: (BucketPosition, Array[Byte]) => Fox[Unit])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(mergedVolume.keysIterator) { bucketPosition =>
        block(bucketPosition, SegmentIntegerArray.toByteArray(mergedVolume(bucketPosition), elementClass))
      }
    } yield ()

  def presentMags: Set[Vec3Int] =
    mergedVolume.map {
      case (bucketPosition: BucketPosition, _) => bucketPosition.mag
    }.toSet

  def stats(createdSegmentIndex: Boolean): MergedVolumeStats =
    MergedVolumeStats(
      largestSegmentId.toLong,
      Some(presentMags.toList.sortBy(_.maxDim).map(vec3IntToProto)),
      labelMapsToLongMaps,
      createdSegmentIndex
    )

  private def labelMapsToLongMaps =
    labelMaps.toList.map { segmentIntegerMap =>
      val longMap = new mutable.HashMap[Long, Long]()
      segmentIntegerMap.foreach { keyValueTuple =>
        longMap += ((keyValueTuple._1.toLong, keyValueTuple._2.toLong))
      }
      longMap.toMap
    }

}
