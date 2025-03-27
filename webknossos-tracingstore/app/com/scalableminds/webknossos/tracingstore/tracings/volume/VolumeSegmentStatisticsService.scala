package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryImplicits, SegmentStatistics}
import com.scalableminds.webknossos.datastore.models.{SegmentInteger, SegmentIntegerArray, WebknossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class VolumeSegmentStatisticsService @Inject()(volumeTracingService: VolumeTracingService,
                                               annotationService: TSAnnotationService,
                                               volumeSegmentIndexService: VolumeSegmentIndexService,
                                               editableMappingService: EditableMappingService)
    extends ProtoGeometryImplicits
    with SegmentStatistics {

  // Returns the segment volume (=number of voxels) in the target mag
  def getSegmentVolume(annotationId: String,
                       tracingId: String,
                       segmentId: Long,
                       mag: Vec3Int,
                       mappingName: Option[String],
                       additionalCoordinates: Option[Seq[AdditionalCoordinate]])(implicit ec: ExecutionContext,
                                                                                 tc: TokenContext): Fox[Long] =
    calculateSegmentVolume(
      segmentId,
      mag,
      additionalCoordinates,
      getBucketPositions(annotationId, tracingId, mappingName, additionalCoordinates),
      getTypedDataForBucketPosition(annotationId, tracingId)
    )

  def getSegmentBoundingBox(annotationId: String,
                            tracingId: String,
                            segmentId: Long,
                            mag: Vec3Int,
                            mappingName: Option[String],
                            additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[BoundingBox] =
    calculateSegmentBoundingBox(
      segmentId,
      mag,
      additionalCoordinates,
      getBucketPositions(annotationId, tracingId, mappingName, additionalCoordinates),
      getTypedDataForBucketPosition(annotationId, tracingId)
    )

  private def getTypedDataForBucketPosition(annotationId: String, tracingId: String)(
      bucketPosition: Vec3Int,
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(implicit tc: TokenContext, ec: ExecutionContext) =
    for {
      tracing <- annotationService.findVolume(annotationId, tracingId) ?~> "tracing.notFound"
      bucketData <- getVolumeDataForPositions(annotationId,
                                              tracingId,
                                              tracing,
                                              mag,
                                              Seq(bucketPosition),
                                              additionalCoordinates)
      dataTyped: Array[SegmentInteger] = SegmentIntegerArray.fromByteArray(bucketData,
                                                                           elementClassFromProto(tracing.elementClass))
    } yield dataTyped

  private def getBucketPositions(annotationId: String,
                                 tracingId: String,
                                 mappingName: Option[String],
                                 additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      segmentId: Long,
      mag: Vec3Int)(implicit ec: ExecutionContext, tc: TokenContext) =
    for {
      tracing <- annotationService.findVolume(annotationId, tracingId) ?~> "tracing.notFound"
      fallbackLayer <- volumeTracingService.getFallbackLayer(annotationId, tracing)
      allBucketPositions: Set[Vec3IntProto] <- volumeSegmentIndexService.getSegmentToBucketIndex(
        tracing,
        fallbackLayer,
        tracingId,
        segmentId,
        mag,
        mappingName,
        editableMappingTracingId = volumeTracingService.editableMappingTracingId(tracing, tracingId),
        additionalCoordinates
      )
    } yield allBucketPositions

  private def getVolumeDataForPositions(
      annotationId: String,
      tracingId: String,
      tracing: VolumeTracing,
      mag: Vec3Int,
      bucketPositions: Seq[Vec3Int],
      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(implicit tc: TokenContext): Fox[Array[Byte]] = {

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
      (data, _) <- if (tracing.getHasEditableMapping) {
        val mappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
        editableMappingService.volumeData(mappingLayer, dataRequests)
      } else
        volumeTracingService.data(annotationId, tracingId, tracing, dataRequests, includeFallbackDataIfAvailable = true)
    } yield data
  }

}
