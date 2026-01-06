package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.File
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{ByteUtils, Fox}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NativeBucketScanner, ProtoGeometryImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

import scala.collection.mutable
import scala.concurrent.ExecutionContext

case class MergedVolumeStats(
    largestSegmentId: Long,
    sortedMagsList: Option[List[Vec3IntProto]], // None means do not touch the mag list
    idMaps: Seq[Map[Long, Long]],
    createdSegmentIndex: Boolean
)

object MergedVolumeStats {
  def empty(createdSegmentIndex: Boolean = false): MergedVolumeStats =
    MergedVolumeStats(0L, None, List.empty, createdSegmentIndex)
}

class MergedVolume(elementClass: ElementClassProto, initialLargestSegmentId: Long = 0)
    extends ByteUtils
    with VolumeDataZipHelper
    with ProtoGeometryImplicits {
  private val mergedVolume = mutable.HashMap.empty[BucketPosition, Array[Byte]]
  private val idSets = mutable.ListBuffer[mutable.Set[Long]]()
  private var idMaps = Seq[(Array[Long], Array[Long])]()
  var largestSegmentId: Long = 0
  private val bytesPerElement = ElementClass.bytesPerElement(ElementClass.fromProto(elementClass))
  private val elementsAreSigned = ElementClass.isSigned(ElementClass.fromProto(elementClass))
  private lazy val bucketScanner = new NativeBucketScanner()

  def addIdSetFromDataZip(zipFile: File)(implicit ec: ExecutionContext): Fox[Unit] = {
    val importIdSet: mutable.Set[Long] = scala.collection.mutable.Set()
    val unzipResult = withBucketsFromZip(zipFile) { (_, bucketBytes) =>
      val bucketSegmentIds =
        bucketScanner.collectSegmentIds(bucketBytes, bytesPerElement, elementsAreSigned, skipZeroes = true)
      Fox.successful(importIdSet ++= bucketSegmentIds)
    }
    for {
      _ <- unzipResult
      _ = addIdSet(importIdSet)
    } yield ()
  }

  def addIdSetFromBucketStream(bucketStream: Iterator[(BucketPosition, Array[Byte])],
                               allowedMags: Set[Vec3Int]): Unit = {
    val idSet: mutable.Set[Long] = scala.collection.mutable.Set()
    bucketStream.foreach {
      case (bucketPosition, data) =>
        if (allowedMags.contains(bucketPosition.mag)) {
          val bucketSegmentIds =
            bucketScanner.collectSegmentIds(data, bytesPerElement, elementsAreSigned, skipZeroes = true)
          idSet ++= bucketSegmentIds
        }
    }
    addIdSet(idSet)
  }

  private def addIdSet(idSet: mutable.Set[Long]): Unit = idSets += idSet

  private def prepareIdMaps(): Unit =
    if (idSets.isEmpty || (idSets.length == 1 && initialLargestSegmentId == 0) || idMaps.nonEmpty) {
      ()
    } else {
      val idMapsBuffer = mutable.ListBuffer[mutable.HashMap[Long, Long]]()
      var currentSegmentId: Long = 0
      if (initialLargestSegmentId > 0) {
        idMapsBuffer += mutable.HashMap.empty[Long, Long]
        currentSegmentId = initialLargestSegmentId
      }
      idSets.foreach { idSet =>
        val idMap = mutable.HashMap.empty[Long, Long]
        idSet.foreach { segmentId =>
          currentSegmentId = currentSegmentId + 1
          idMap += ((segmentId, currentSegmentId))
        }
        idMapsBuffer += idMap
      }
      largestSegmentId = currentSegmentId
      idMaps = idMapsBuffer.toSeq.map(_.toArray.unzip)
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
    prepareIdMaps()
    if (mergedVolume.contains(bucketPosition)) {
      val previousBucketData = mergedVolume(bucketPosition)
      val skipMapping = idMaps.isEmpty || (initialLargestSegmentId > 0 && sourceVolumeIndex == 0)
      val idMap = idMaps(sourceVolumeIndex)
      bucketScanner.mergeVolumeBucketInPlace(previousBucketData,
                                             data,
                                             skipMapping,
                                             idMap._1,
                                             idMap._2,
                                             bytesPerElement,
                                             elementsAreSigned)
    } else {
      if (idMaps.isEmpty) {
        mergedVolume += ((bucketPosition, data))
      } else {
        val idMap = idMaps(sourceVolumeIndex)
        val dataMappedMutable = new Array[Byte](data.length)
        bucketScanner.mergeVolumeBucketInPlace(dataMappedMutable,
                                               data,
                                               skipMapping = false,
                                               idMap._1,
                                               idMap._2,
                                               bytesPerElement,
                                               elementsAreSigned)
        mergedVolume += ((bucketPosition, dataMappedMutable))
      }
    }
  }

  def withMergedBuckets(block: (BucketPosition, Array[Byte]) => Fox[Unit])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(mergedVolume.keysIterator) { bucketPosition =>
        block(bucketPosition, mergedVolume(bucketPosition))
      }
    } yield ()

  def presentMags: Set[Vec3Int] =
    mergedVolume.map {
      case (bucketPosition: BucketPosition, _) => bucketPosition.mag
    }.toSet

  def stats(createdSegmentIndex: Boolean): MergedVolumeStats =
    MergedVolumeStats(
      largestSegmentId,
      Some(presentMags.toList.sortBy(_.maxDim).map(vec3IntToProto)),
      Seq.empty, // TODO re-insert id maps,
      createdSegmentIndex
    )

}
