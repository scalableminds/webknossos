package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.{BucketPosition, UnsignedInteger, UnsignedIntegerArray}
import com.scalableminds.webknossos.datastore.services.DataConverter
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.tracingstore.tracings.ProtoGeometryImplicits

import scala.collection.mutable
import scala.concurrent.ExecutionContext

class MergedVolume(elementClass: ElementClass, initialLargestSegmentId: Long = 0)
    extends DataConverter
    with ProtoGeometryImplicits {
  private var mergedVolume = mutable.HashMap.empty[BucketPosition, Array[UnsignedInteger]]
  private var labelSets = mutable.ListBuffer[mutable.Set[UnsignedInteger]]()
  private var labelMaps = mutable.ListBuffer[mutable.HashMap[UnsignedInteger, UnsignedInteger]]()
  var largestSegmentId: UnsignedInteger = UnsignedInteger.zeroFromElementClass(elementClass)
  def addLabelSet(labelSet: mutable.Set[UnsignedInteger]): Unit = labelSets += labelSet

  private def prepareLabelMaps(): Unit =
    if (labelSets.isEmpty || (labelSets.length == 1 && initialLargestSegmentId == 0) || labelMaps.nonEmpty) {
      ()
    } else {
      var i: UnsignedInteger = UnsignedInteger.zeroFromElementClass(elementClass)
      if (initialLargestSegmentId > 0) {
        labelMaps += mutable.HashMap.empty[UnsignedInteger, UnsignedInteger]
        i = UnsignedInteger.fromLongWithElementClass(initialLargestSegmentId, elementClass)
      }
      labelSets.toList.foreach { labelSet =>
        var labelMap = mutable.HashMap.empty[UnsignedInteger, UnsignedInteger]
        labelSet.foreach { label =>
          i = i.increment
          labelMap += ((label, i))
        }
        labelMaps += labelMap
      }
      largestSegmentId = i
    }

  def add(sourceVolumeIndex: Int, bucketPosition: BucketPosition, data: Array[Byte]): Unit =
    if (data.length > 1) { // skip reverted buckets
      val dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(data, elementClass)
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

  def withAllBuckets(bucketFn: (BucketPosition, Array[Byte]) => Fox[Unit])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.combined(mergedVolume.map {
        case (bucketPosition, bucketData) =>
          bucketFn(bucketPosition, UnsignedIntegerArray.toByteArray(bucketData, elementClass))
      }.toList)
    } yield ()

  def presentResolutions: Set[Point3D] =
    mergedVolume.map {
      case (bucketPosition: BucketPosition, _) => bucketPosition.resolution
    }.toSet

}
