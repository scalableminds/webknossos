package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.File

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{ByteUtils, Fox}
import com.scalableminds.webknossos.datastore.models.{BucketPosition, UnsignedInteger, UnsignedIntegerArray}
import com.scalableminds.webknossos.datastore.services.DataConverter
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.tracingstore.tracings.ProtoGeometryImplicits
import net.liftweb.common.Box

import scala.collection.mutable
import scala.concurrent.ExecutionContext

class MergedVolume(elementClass: ElementClass, initialLargestSegmentId: Long = 0)
    extends DataConverter
    with ByteUtils
    with VolumeDataZipHelper
    with ProtoGeometryImplicits {
  private var mergedVolume = mutable.HashMap.empty[BucketPosition, Array[UnsignedInteger]]
  private var labelSets = mutable.ListBuffer[mutable.Set[UnsignedInteger]]()
  private var labelMaps = mutable.ListBuffer[mutable.HashMap[UnsignedInteger, UnsignedInteger]]()
  var largestSegmentId: UnsignedInteger = UnsignedInteger.zeroFromElementClass(elementClass)

  def addLabelSetFromDataZip(zipFile: File)(implicit ec: ExecutionContext): Box[Unit] = {
    val importLabelSet: mutable.Set[UnsignedInteger] = scala.collection.mutable.Set()
    val unzipResult = withBucketsFromZip(zipFile) { (_, bytes) =>
      val dataTyped =
        UnsignedIntegerArray.fromByteArray(bytes, elementClass)
      val nonZeroData = UnsignedIntegerArray.filterNonZero(dataTyped)
      importLabelSet ++= nonZeroData
    }
    for {
      _ <- unzipResult
      _ = addLabelSet(importLabelSet)
    } yield ()
  }

  def addLabelSetFromBucketStream(bucketStream: Iterator[(BucketPosition, Array[Byte])],
                                  allowedResolutions: Set[Point3D]): Unit = {
    val labelSet: mutable.Set[UnsignedInteger] = scala.collection.mutable.Set()
    bucketStream.foreach {
      case (bucketPosition, data) =>
        if (allowedResolutions.contains(bucketPosition.resolution)) {
          val dataTyped = UnsignedIntegerArray.fromByteArray(data, elementClass)
          val nonZeroData: Array[UnsignedInteger] = UnsignedIntegerArray.filterNonZero(dataTyped)
          labelSet ++= nonZeroData
        }
    }
    addLabelSet(labelSet)
  }

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

  def addFromBucketStream(sourceVolumeIndex: Int,
                          bucketStream: Iterator[(BucketPosition, Array[Byte])],
                          allowedResolutions: Option[Set[Point3D]] = None): Unit =
    bucketStream.foreach {
      case (bucketPosition, bytes) =>
        if (!isAllZero(bytes) && allowedResolutions.forall(_.contains(bucketPosition.resolution))) {
          add(sourceVolumeIndex, bucketPosition, bytes)
        }
    }

  def addFromDataZip(sourceVolumeIndex: Int, zipFile: File)(implicit ec: ExecutionContext): Box[Unit] =
    withBucketsFromZip(zipFile) { (bucketPosition, bytes) =>
      add(sourceVolumeIndex, bucketPosition, bytes)
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

  def withMergedBuckets(block: (BucketPosition, Array[Byte]) => Fox[Unit])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.combined(mergedVolume.map {
        case (bucketPosition, bucketData) =>
          block(bucketPosition, UnsignedIntegerArray.toByteArray(bucketData, elementClass))
      }.toList)
    } yield ()

  def presentResolutions: Set[Point3D] =
    mergedVolume.map {
      case (bucketPosition: BucketPosition, _) => bucketPosition.resolution
    }.toSet

}
