package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.common.Box.tryo
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext

case class SegmentStatisticsParameters(mag: Vec3Int,
                                       segmentIds: List[Long],
                                       mappingName: Option[String],
                                       additionalCoordinates: Option[Seq[AdditionalCoordinate]])
object SegmentStatisticsParameters {
  implicit val jsonFormat: OFormat[SegmentStatisticsParameters] = Json.format[SegmentStatisticsParameters]
}

trait SegmentStatistics extends ProtoGeometryImplicits with FoxImplicits {

  protected def bucketScanner: NativeBucketScanner

  def calculateSegmentVolume(
      segmentId: Long,
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      getBucketPositions: (Long, Vec3Int) => Fox[Set[Vec3IntProto]],
      getDataForBucketPositions: (
          Seq[Vec3Int],
          Vec3Int,
          Option[Seq[AdditionalCoordinate]]) => Fox[(Seq[Box[Array[Byte]]], ElementClass.Value)])(
      implicit ec: ExecutionContext): Fox[Long] =
    for {
      bucketPositionsProtos: Set[Vec3IntProto] <- getBucketPositions(segmentId, mag)
      bucketPositionsInMag = bucketPositionsProtos.map(vec3IntFromProto)
      (bucketBoxes, elementClass) <- getDataForBucketPositions(bucketPositionsInMag.toSeq, mag, additionalCoordinates)
      counts <- Fox.serialCombined(bucketBoxes.toList) {
        case Full(bucketBytes) =>
          tryo(
            bucketScanner.countSegmentVoxels(bucketBytes,
                                             ElementClass.bytesPerElement(elementClass),
                                             ElementClass.isSigned(elementClass),
                                             segmentId)).toFox
        case Empty      => Full(0L).toFox
        case f: Failure => f.toFox
      }
    } yield counts.sum

  // Returns the bounding box in voxels in the target mag
  def calculateSegmentBoundingBox(
      segmentId: Long,
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      getBucketPositions: (Long, Vec3Int) => Fox[Set[Vec3IntProto]],
      getDataForBucketPositions: (
          Seq[Vec3Int],
          Vec3Int,
          Option[Seq[AdditionalCoordinate]]) => Fox[(Seq[Box[Array[Byte]]], ElementClass.Value)])(
      implicit ec: ExecutionContext): Fox[BoundingBox] =
    for {
      allBucketPositions: Set[Vec3IntProto] <- getBucketPositions(segmentId, mag)
      relevantBucketPositions = filterOutInnerBucketPositions(allBucketPositions)
      boundingBoxMutable = scala.collection.mutable.ListBuffer[Int](Int.MaxValue,
                                                                    Int.MaxValue,
                                                                    Int.MaxValue,
                                                                    Int.MinValue,
                                                                    Int.MinValue,
                                                                    Int.MinValue) //topleft, bottomright
      (bucketBoxes, elementClass) <- getDataForBucketPositions(relevantBucketPositions.toSeq,
                                                               mag,
                                                               additionalCoordinates)
      _ <- Fox.serialCombined(relevantBucketPositions.zip(bucketBoxes)) {
        case (bucketPosition, Full(bucketData)) =>
          Fox.successful(
            extendBoundingBoxByData(segmentId, boundingBoxMutable, bucketPosition, bucketData, elementClass))
        case (_, Empty)      => Fox.successful(())
        case (_, f: Failure) => f.toFox
      }
    } yield
      if (boundingBoxMutable.exists(item => item == Int.MaxValue || item == Int.MinValue)) {
        BoundingBox.empty
      } else
        BoundingBox(
          Vec3Int(boundingBoxMutable(0), boundingBoxMutable(1), boundingBoxMutable(2)),
          boundingBoxMutable(3) - boundingBoxMutable(0) + 1,
          boundingBoxMutable(4) - boundingBoxMutable(1) + 1,
          boundingBoxMutable(5) - boundingBoxMutable(2) + 1
        )

  // The buckets that form the outer walls of the bounding box are relevant (in each of those the real min/max voxel positions could occur)
  private def filterOutInnerBucketPositions(bucketPositions: Set[Vec3IntProto]): Set[Vec3Int] =
    if (bucketPositions.isEmpty) Set.empty
    else {
      val minX = bucketPositions.map(_.x).min
      val minY = bucketPositions.map(_.y).min
      val minZ = bucketPositions.map(_.z).min
      val maxX = bucketPositions.map(_.x).max
      val maxY = bucketPositions.map(_.y).max
      val maxZ = bucketPositions.map(_.z).max
      bucketPositions
        .filter(pos =>
          pos.x == minX || pos.x == maxX || pos.y == minY || pos.y == maxY || pos.z == minZ || pos.z == maxZ)
        .map(vec3IntFromProto)
    }

  private def extendBoundingBoxByData(segmentId: Long,
                                      boundingBoxMutable: scala.collection.mutable.ListBuffer[Int],
                                      bucketPosition: Vec3Int,
                                      bucketBytes: Array[Byte],
                                      elementClass: ElementClass.Value): Unit = {
    val bucketTopLeftInTargetMagVoxels = bucketPosition * DataLayer.bucketLength
    val extendedBBArray: Array[Int] =
      bucketScanner.extendSegmentBoundingBox(
        bucketBytes,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        DataLayer.bucketLength,
        segmentId,
        bucketTopLeftInTargetMagVoxels.x,
        bucketTopLeftInTargetMagVoxels.y,
        bucketTopLeftInTargetMagVoxels.z,
        boundingBoxMutable(0),
        boundingBoxMutable(1),
        boundingBoxMutable(2),
        boundingBoxMutable(3),
        boundingBoxMutable(4),
        boundingBoxMutable(5)
      )
    (0 until 6).foreach(i => boundingBoxMutable(i) = extendedBBArray(i))
  }

}
