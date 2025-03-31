package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NativeBucketScanner, ProtoGeometryImplicits, SegmentStatistics}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, WebknossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class VolumeSegmentStatisticsService @Inject()(volumeTracingService: VolumeTracingService,
                                               annotationService: TSAnnotationService,
                                               volumeSegmentIndexService: VolumeSegmentIndexService,
                                               editableMappingService: EditableMappingService)
    extends ProtoGeometryImplicits
    with LazyLogging
    with SegmentStatistics {

  protected lazy val bucketScanner = new NativeBucketScanner()

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
      getDataForBucketPositionsCallable(annotationId, tracingId)
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
      getDataForBucketPositionsCallable(annotationId, tracingId)
    )

  private def getDataForBucketPositionsCallable(annotationId: String, tracingId: String)(
      bucketPositions: Seq[Vec3Int],
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(
      implicit tc: TokenContext,
      ec: ExecutionContext): Fox[(Seq[Box[Array[Byte]]], ElementClass.Value)] =
    for {
      tracing <- annotationService.findVolume(annotationId, tracingId) ?~> "tracing.notFound"
      dataRequests = bucketPositions.map { position =>
        WebknossosDataRequest(
          position = position * mag * DataLayer.bucketLength,
          mag = mag,
          cubeSize = DataLayer.bucketLength,
          fourBit = Some(false),
          applyAgglomerate = None,
          version = Some(tracing.version),
          additionalCoordinates = additionalCoordinates
        )
      }.toList
      bucketDataBoxes <- if (tracing.getHasEditableMapping) {
        val mappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
        editableMappingService.volumeDataBucketBoxes(mappingLayer, dataRequests)
      } else
        volumeTracingService.dataBucketBoxes(annotationId,
                                             tracingId,
                                             tracing,
                                             dataRequests,
                                             includeFallbackDataIfAvailable = true)
    } yield (bucketDataBoxes, elementClassFromProto(tracing.elementClass))

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

}
