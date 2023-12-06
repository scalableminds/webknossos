package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryImplicits, SegmentStatistics}
import com.scalableminds.webknossos.datastore.models.{UnsignedInteger, UnsignedIntegerArray, WebKnossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class VolumeSegmentStatisticsService @Inject()(volumeTracingService: VolumeTracingService,
                                               volumeSegmentIndexService: VolumeSegmentIndexService,
                                               editableMappingService: EditableMappingService)
    extends ProtoGeometryImplicits
    with SegmentStatistics {

  def getSegmentVolume(tracingId: String, segmentId: Long, mag: Vec3Int, userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[Long] =
    calculateSegmentVolume(segmentId, mag, getTypedDataForSegmentIndex(tracingId, userToken))

  def getSegmentBoundingBox(tracingId: String, segmentId: Long, mag: Vec3Int, userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[BoundingBox] =
    calculateSegmentBoundingBox(segmentId,
                                mag,
                                getBucketPositions(tracingId),
                                getTypedDataForBucketPosition(tracingId, userToken))

  private def getTypedDataForSegmentIndex(tracingId: String, userToken: Option[String])(segmentId: Long, mag: Vec3Int)(
      implicit ec: ExecutionContext) =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      bucketPositions: ListOfVec3IntProto <- volumeSegmentIndexService
        .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(tracingId, segmentId, mag)
      volumeData <- getVolumeDataForPositions(tracing, tracingId, mag, bucketPositions, userToken)
      dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(volumeData, tracing.elementClass)
    } yield dataTyped

  private def getTypedDataForBucketPosition(tracingId: String, userToken: Option[String])(bucketPosition: Vec3Int,
                                                                                          mag: Vec3Int) =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      bucketData <- getVolumeDataForPositions(tracing, tracingId, mag, Seq(bucketPosition), userToken)
      dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(
        bucketData,
        elementClassFromProto(tracing.elementClass))
    } yield dataTyped

  private def getBucketPositions(tracingId: String)(segmentId: Long, mag: Vec3Int)(implicit ec: ExecutionContext) =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      allBucketPositions: ListOfVec3IntProto <- volumeSegmentIndexService
        .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(tracingId, segmentId, mag)
    } yield allBucketPositions

  private def getVolumeDataForPositions(tracing: VolumeTracing,
                                        tracingId: String,
                                        mag: Vec3Int,
                                        bucketPositions: ListOfVec3IntProto,
                                        userToken: Option[String]): Fox[Array[Byte]] =
    getVolumeDataForPositions(tracing, tracingId, mag, bucketPositions.values.map(vec3IntFromProto), userToken)

  private def getVolumeDataForPositions(tracing: VolumeTracing,
                                        tracingId: String,
                                        mag: Vec3Int,
                                        bucketPositions: Seq[Vec3Int],
                                        userToken: Option[String]): Fox[Array[Byte]] = {
    val dataRequests = bucketPositions.map { position =>
      WebKnossosDataRequest(
        position = position * mag * DataLayer.bucketLength,
        mag = mag,
        cubeSize = DataLayer.bucketLength,
        fourBit = Some(false),
        applyAgglomerate = None,
        version = None,
        additionalCoordinates = None
      )
    }.toList
    for {
      (data, _) <- if (tracing.mappingIsEditable.getOrElse(false))
        editableMappingService.volumeData(tracing, tracingId, dataRequests, userToken)
      else volumeTracingService.data(tracingId, tracing, dataRequests)
    } yield data
  }

}
