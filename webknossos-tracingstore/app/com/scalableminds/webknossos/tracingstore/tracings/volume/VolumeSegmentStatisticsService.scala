package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{
  AdditionalCoordinate,
  UnsignedInteger,
  UnsignedIntegerArray,
  WebknossosDataRequest
}
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataLayer}
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import play.api.libs.json.{Json, OFormat}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class SegmentStatisticsParameters(mag: Vec3Int,
                                       segmentIds: List[Long],
                                       additionalCoordinates: Option[Seq[AdditionalCoordinate]])
object SegmentStatisticsParameters {
  implicit val jsonFormat: OFormat[SegmentStatisticsParameters] = Json.format[SegmentStatisticsParameters]
}

class VolumeSegmentStatisticsService @Inject()(volumeTracingService: VolumeTracingService,
                                               volumeSegmentIndexService: VolumeSegmentIndexService,
                                               editableMappingService: EditableMappingService)
    extends ProtoGeometryImplicits {

  // Returns the segment volume (=number of voxels) in the target mag
  def getSegmentVolume(tracingId: String,
                       segmentId: Long,
                       mag: Vec3Int,
                       additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                       userToken: Option[String])(implicit ec: ExecutionContext): Fox[Long] =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      bucketPositions: ListOfVec3IntProto <- volumeSegmentIndexService
        .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(tracingId,
                                                               segmentId,
                                                               mag,
                                                               additionalCoordinates,
                                                               AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes))
      volumeData <- getVolumeDataForPositions(tracing,
                                              tracingId,
                                              mag,
                                              bucketPositions,
                                              additionalCoordinates,
                                              userToken)
      dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(volumeData, tracing.elementClass)
      volumeInVx = dataTyped.count(unsignedInteger => unsignedInteger.toPositiveLong == segmentId)
    } yield volumeInVx

  // Returns the bounding box in voxels in the target mag
  def getSegmentBoundingBox(tracingId: String,
                            segmentId: Long,
                            mag: Vec3Int,
                            additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                            userToken: Option[String])(implicit ec: ExecutionContext): Fox[BoundingBox] =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      allBucketPositions: ListOfVec3IntProto <- volumeSegmentIndexService
        .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(tracingId,
                                                               segmentId,
                                                               mag,
                                                               additionalCoordinates,
                                                               AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes))
      relevantBucketPositions = filterOutInnerBucketPositions(allBucketPositions)
      boundingBoxMutable = scala.collection.mutable.ListBuffer[Int](Int.MaxValue,
                                                                    Int.MaxValue,
                                                                    Int.MaxValue,
                                                                    Int.MinValue,
                                                                    Int.MinValue,
                                                                    Int.MinValue) //topleft, bottomright
      _ <- Fox.serialCombined(relevantBucketPositions.iterator)(
        bucketPosition =>
          extendBoundingBoxByData(tracing,
                                  tracingId,
                                  mag,
                                  segmentId,
                                  boundingBoxMutable,
                                  bucketPosition,
                                  additionalCoordinates,
                                  userToken))
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

  private def extendBoundingBoxByData(tracing: VolumeTracing,
                                      tracingId: String,
                                      mag: Vec3Int,
                                      segmentId: Long,
                                      mutableBoundingBox: scala.collection.mutable.ListBuffer[Int],
                                      bucketPosition: Vec3Int,
                                      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                                      userToken: Option[String]): Fox[Unit] =
    for {
      bucketData <- getVolumeDataForPositions(tracing,
                                              tracingId,
                                              mag,
                                              Seq(bucketPosition),
                                              additionalCoordinates,
                                              userToken)
      dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(
        bucketData,
        elementClassFromProto(tracing.elementClass))
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

  private def getVolumeDataForPositions(tracing: VolumeTracing,
                                        tracingId: String,
                                        mag: Vec3Int,
                                        bucketPositions: ListOfVec3IntProto,
                                        additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                                        userToken: Option[String]): Fox[Array[Byte]] =
    getVolumeDataForPositions(tracing,
                              tracingId,
                              mag,
                              bucketPositions.values.map(vec3IntFromProto),
                              additionalCoordinates,
                              userToken)

  private def getVolumeDataForPositions(tracing: VolumeTracing,
                                        tracingId: String,
                                        mag: Vec3Int,
                                        bucketPositions: Seq[Vec3Int],
                                        additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                                        userToken: Option[String]): Fox[Array[Byte]] = {
    val dataRequests = bucketPositions.map { position =>
      WebknossosDataRequest(
        position = position * mag * DataLayer.bucketLength,
        mag = mag,
        cubeSize = DataLayer.bucketLength,
        fourBit = Some(false),
        applyAgglomerate = None,
        version = None,
        additionalCoordinates = additionalCoordinates
      )
    }.toList
    for {
      (data, _) <- if (tracing.mappingIsEditable.getOrElse(false))
        editableMappingService.volumeData(tracing, tracingId, dataRequests, userToken)
      else volumeTracingService.data(tracingId, tracing, dataRequests)
    } yield data
  }

}
