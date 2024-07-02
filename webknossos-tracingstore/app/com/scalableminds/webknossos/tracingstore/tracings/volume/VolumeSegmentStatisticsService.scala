package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryImplicits, SegmentStatistics}
import com.scalableminds.webknossos.datastore.models.{UnsignedInteger, UnsignedIntegerArray, WebknossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class VolumeSegmentStatisticsService @Inject()(volumeTracingService: VolumeTracingService,
                                               volumeSegmentIndexService: VolumeSegmentIndexService,
                                               editableMappingService: EditableMappingService)
    extends ProtoGeometryImplicits
    with SegmentStatistics {

  // Returns the segment volume (=number of voxels) in the target mag
  def getSegmentVolume(tracingId: String,
                       segmentId: Long,
                       mag: Vec3Int,
                       mappingName: Option[String],
                       additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                       userToken: Option[String])(implicit ec: ExecutionContext): Fox[Long] =
    calculateSegmentVolume(
      segmentId,
      mag,
      additionalCoordinates,
      getBucketPositions(tracingId, mappingName, additionalCoordinates, userToken),
      getTypedDataForBucketPosition(tracingId, userToken)
    )

  def getSegmentBoundingBox(tracingId: String,
                            segmentId: Long,
                            mag: Vec3Int,
                            mappingName: Option[String],
                            additionalCoordinates: Option[Seq[AdditionalCoordinate]],
                            userToken: Option[String])(implicit ec: ExecutionContext): Fox[BoundingBox] =
    calculateSegmentBoundingBox(
      segmentId,
      mag,
      additionalCoordinates,
      getBucketPositions(tracingId, mappingName, additionalCoordinates, userToken),
      getTypedDataForBucketPosition(tracingId, userToken)
    )

  private def getTypedDataForBucketPosition(tracingId: String, userToken: Option[String])(
      bucketPosition: Vec3Int,
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]]) =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      bucketData <- getVolumeDataForPositions(tracing,
                                              tracingId,
                                              mag,
                                              Seq(bucketPosition),
                                              additionalCoordinates,
                                              userToken)
      dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(
        bucketData,
        elementClassFromProto(tracing.elementClass))
    } yield dataTyped

  private def getBucketPositions(
      tracingId: String,
      mappingName: Option[String],
      additionalCoordinates: Option[Seq[AdditionalCoordinate]],
      userToken: Option[String])(segmentId: Long, mag: Vec3Int)(implicit ec: ExecutionContext) =
    for {
      fallbackLayer <- volumeTracingService.getFallbackLayer(tracingId)
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      additionalAxes = AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes)
      allBucketPositions: ListOfVec3IntProto <- volumeSegmentIndexService
        .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(
          fallbackLayer,
          tracingId,
          segmentId,
          mag,
          None,
          mappingName,
          editableMappingTracingId = volumeTracingService.editableMappingTracingId(tracing, tracingId),
          additionalCoordinates,
          additionalAxes,
          userToken
        )
    } yield allBucketPositions

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
      (data, _) <- if (tracing.getHasEditableMapping)
        editableMappingService.volumeData(tracing, tracingId, dataRequests, userToken)
      else volumeTracingService.data(tracingId, tracing, dataRequests, includeFallbackDataIfAvailable = true, userToken)
    } yield data
  }

}
