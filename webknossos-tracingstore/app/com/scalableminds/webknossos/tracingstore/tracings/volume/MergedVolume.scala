package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.File

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{ByteUtils, Fox}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.datastore.arrays.NumericArray
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{BucketPosition, UnsignedInteger}
import net.liftweb.common.Box

import scala.collection.mutable
import scala.concurrent.ExecutionContext

class MergedVolume(elementClass: ElementClass, initialLargestSegmentId: Long = 0)
    extends ByteUtils
    with VolumeDataZipHelper
    with ProtoGeometryImplicits {
  private val mergedVolume = mutable.HashMap.empty[BucketPosition, NumericArray]
  private val labelSets = mutable.ListBuffer[mutable.Set[UnsignedInteger]]()
  private val labelMaps = mutable.ListBuffer[mutable.HashMap[UnsignedInteger, UnsignedInteger]]()
  var largestSegmentId: UnsignedInteger = UnsignedInteger.zeroFromElementClass(elementClass)

  def addLabelSetFromDataZip(zipFile: File): Box[Unit] = {
    val importLabelSet: mutable.Set[UnsignedInteger] = scala.collection.mutable.Set()
    val unzipResult = withBucketsFromZip(zipFile) { (_, bytes) =>
      val dataTyped = NumericArray.fromBytes(bytes, elementClass)
      val nonZeroData = dataTyped.filterNonZero
      importLabelSet ++= nonZeroData
    }
    for {
      _ <- unzipResult
      _ = addLabelSet(importLabelSet)
    } yield ()
  }

  def addLabelSetFromBucketStream(bucketStream: Iterator[(BucketPosition, Array[Byte])],
                                  allowedResolutions: Set[Vec3Int]): Unit = {
    val labelSet: mutable.Set[UnsignedInteger] = scala.collection.mutable.Set()
    bucketStream.foreach {
      case (bucketPosition, data) =>
        if (allowedResolutions.contains(bucketPosition.mag)) {
          val dataTyped = NumericArray.fromBytes(data, elementClass)
          val nonZeroData = dataTyped.filterNonZero
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
      var segmentId: UnsignedInteger = UnsignedInteger.zeroFromElementClass(elementClass)
      if (initialLargestSegmentId > 0) {
        labelMaps += mutable.HashMap.empty[UnsignedInteger, UnsignedInteger]
        segmentId = UnsignedInteger.fromLongWithElementClass(initialLargestSegmentId, elementClass)
      }
      labelSets.foreach { labelSet =>
        val labelMap = mutable.HashMap.empty[UnsignedInteger, UnsignedInteger]
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
                          allowedResolutions: Option[Set[Vec3Int]] = None): Unit =
    bucketStream.foreach {
      case (bucketPosition, bytes) =>
        if (!isAllZero(bytes) && allowedResolutions.forall(_.contains(bucketPosition.mag))) {
          add(sourceVolumeIndex, bucketPosition, bytes)
        }
    }

  def addFromDataZip(sourceVolumeIndex: Int, zipFile: File): Box[Unit] =
    withBucketsFromZip(zipFile) { (bucketPosition, bytes) =>
      add(sourceVolumeIndex, bucketPosition, bytes)
    }

  def add(sourceVolumeIndex: Int, bucketPosition: BucketPosition, data: Array[Byte]): Unit = {
    val dataTyped: NumericArray = NumericArray.fromBytes(data, elementClass)
    val anArray: Array[Int] = List(1, 2, 3).toArray
    anArray(1) = 8
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
        val dataMapped: NumericArray =
          if (initialLargestSegmentId > 0 && sourceVolumeIndex == 0) dataTyped
          else {
            NumericArray.fromUnsignedIntegers(dataTyped.map { byteValue =>
              if (byteValue.isZero)
                byteValue
              else
                labelMaps(sourceVolumeIndex)(byteValue)
            }, dataTyped.elementClass)
          }
        mergedVolume += ((bucketPosition, dataMapped))
      }
    }
  }

  def withMergedBuckets(block: (BucketPosition, Array[Byte]) => Fox[Unit])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.combined(mergedVolume.map {
        case (bucketPosition, bucketData) =>
          block(bucketPosition, bucketData.toBytes)
      }.toList)
    } yield ()

  def presentResolutions: Set[Vec3Int] =
    mergedVolume.map {
      case (bucketPosition: BucketPosition, _) => bucketPosition.mag
    }.toSet

}
