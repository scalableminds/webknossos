package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, UnsignedInteger}
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

  def calculateSegmentVolume(
      segmentId: Long,
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      getBucketPositions: (Long, Vec3Int) => Fox[ListOfVec3IntProto],
      getTypedDataForBucketPosition: (
          Vec3Int,
          Vec3Int,
          Option[Seq[AdditionalCoordinate]]) => Fox[Array[UnsignedInteger]])(implicit ec: ExecutionContext): Fox[Long] =
    for {
      bucketPositionsProtos: ListOfVec3IntProto <- getBucketPositions(segmentId, mag)
      bucketPositionsInMag = bucketPositionsProtos.values.map(vec3IntFromProto)
      volumeBoxes <- Fox.serialSequence(bucketPositionsInMag.toList)(bucketPosition =>
        for {
          dataTyped: Array[UnsignedInteger] <- getTypedDataForBucketPosition(bucketPosition, mag, additionalCoordinates)
          count = dataTyped.count(unsignedInteger => unsignedInteger.toPositiveLong == segmentId)
        } yield count.toLong)
      counts <- Fox.combined(volumeBoxes.map(_.toFox))
    } yield counts.sum

  // Returns the bounding box in voxels in the target mag
  def calculateSegmentBoundingBox(segmentId: Long,
                                  mag: Vec3Int,
                                  additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                                  getBucketPositions: (Long, Vec3Int) => Fox[ListOfVec3IntProto],
                                  getTypedDataForBucketPosition: (
                                      Vec3Int,
                                      Vec3Int,
                                      Option[Seq[AdditionalCoordinate]]) => Fox[Array[UnsignedInteger]])(
      implicit ec: ExecutionContext): Fox[BoundingBox] =
    for {
      allBucketPositions: ListOfVec3IntProto <- getBucketPositions(segmentId, mag)
      relevantBucketPositions = filterOutInnerBucketPositions(allBucketPositions)
      boundingBoxMutable = scala.collection.mutable.ListBuffer[Int](Int.MaxValue,
                                                                    Int.MaxValue,
                                                                    Int.MaxValue,
                                                                    Int.MinValue,
                                                                    Int.MinValue,
                                                                    Int.MinValue) //topleft, bottomright
      _ <- Fox.serialCombined(relevantBucketPositions.iterator)(
        bucketPosition =>
          extendBoundingBoxByData(mag,
                                  segmentId,
                                  boundingBoxMutable,
                                  bucketPosition,
                                  additionalCoordinates,
                                  getTypedDataForBucketPosition))
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
  private def filterOutInnerBucketPositions(bucketPositions: ListOfVec3IntProto): Seq[Vec3Int] =
    if (bucketPositions.values.isEmpty) List.empty
    else {
      val minX = bucketPositions.values.map(_.x).min
      val minY = bucketPositions.values.map(_.y).min
      val minZ = bucketPositions.values.map(_.z).min
      val maxX = bucketPositions.values.map(_.x).max
      val maxY = bucketPositions.values.map(_.y).max
      val maxZ = bucketPositions.values.map(_.z).max
      bucketPositions.values
        .filter(pos =>
          pos.x == minX || pos.x == maxX || pos.y == minY || pos.y == maxY || pos.z == minZ || pos.z == maxZ)
        .map(vec3IntFromProto)
    }

  private def extendBoundingBoxByData(
      mag: Vec3Int,
      segmentId: Long,
      mutableBoundingBox: scala.collection.mutable.ListBuffer[Int],
      bucketPosition: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      getTypedDataForBucketPosition: (Vec3Int,
                                      Vec3Int,
                                      Option[Seq[AdditionalCoordinate]]) => Fox[Array[UnsignedInteger]]): Fox[Unit] =
    for {
      dataTyped: Array[UnsignedInteger] <- getTypedDataForBucketPosition(bucketPosition, mag, additionalCoordinates)
      bucketTopLeftInTargetMagVoxels = bucketPosition * DataLayer.bucketLength
      _ = scanDataAndExtendBoundingBox(dataTyped, bucketTopLeftInTargetMagVoxels, segmentId, mutableBoundingBox)
    } yield ()

  private def scanDataAndExtendBoundingBox(dataTyped: Array[UnsignedInteger],
                                           bucketTopLeftInTargetMagVoxels: Vec3Int,
                                           segmentId: Long,
                                           mutableBoundingBox: scala.collection.mutable.ListBuffer[Int]): Unit =
    for {
      x <- 0 until DataLayer.bucketLength
      y <- 0 until DataLayer.bucketLength
      z <- 0 until DataLayer.bucketLength
      index = z * DataLayer.bucketLength * DataLayer.bucketLength + y * DataLayer.bucketLength + x
    } yield {
      if (dataTyped(index).toPositiveLong == segmentId) {
        val voxelPosition = bucketTopLeftInTargetMagVoxels + Vec3Int(x, y, z)
        extendBoundingBoxByPosition(mutableBoundingBox, voxelPosition)
      }
    }

  private def extendBoundingBoxByPosition(mutableBoundingBox: scala.collection.mutable.ListBuffer[Int],
                                          position: Vec3Int): Unit = {
    mutableBoundingBox(0) = Math.min(mutableBoundingBox(0), position.x)
    mutableBoundingBox(1) = Math.min(mutableBoundingBox(1), position.y)
    mutableBoundingBox(2) = Math.min(mutableBoundingBox(2), position.z)
    mutableBoundingBox(3) = Math.max(mutableBoundingBox(3), position.x)
    mutableBoundingBox(4) = Math.max(mutableBoundingBox(4), position.y)
    mutableBoundingBox(5) = Math.max(mutableBoundingBox(5), position.z)
  }
}
