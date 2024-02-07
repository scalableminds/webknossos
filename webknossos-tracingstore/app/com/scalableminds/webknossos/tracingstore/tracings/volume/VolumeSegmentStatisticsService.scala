package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryImplicits, SegmentStatistics}
import com.scalableminds.webknossos.datastore.models.{UnsignedInteger, UnsignedIntegerArray, WebKnossosDataRequest}
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
    for {
      typedData <- getTypedDataForSegmentIndex(tracingId, mappingName, userToken, segmentId, mag, additionalCoordinates)
    } yield calculateSegmentVolume(segmentId, mag, typedData)

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

  private def getTypedDataForSegmentIndex(
      tracingId: String,
      mappingName: Option[String],
      userToken: Option[String],
      segmentId: Long,
      mag: Vec3Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(implicit ec: ExecutionContext) =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      fallbackLayer <- volumeTracingService.getFallbackLayer(tracingId)
      bucketPositions: ListOfVec3IntProto <- volumeSegmentIndexService
        .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(fallbackLayer,
                                                               tracingId,
                                                               segmentId,
                                                               mag,
                                                               None,
                                                               mappingName,
                                                               additionalCoordinates,
                                                               AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
                                                               userToken)
      volumeData <- getVolumeDataForPositions(tracing,
                                              tracingId,
                                              mag,
                                              bucketPositions,
                                              additionalCoordinates,
                                              userToken)
      dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(volumeData, tracing.elementClass)
    } yield dataTyped

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
        .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(fallbackLayer,
                                                               tracingId,
                                                               segmentId,
                                                               mag,
                                                               None,
                                                               mappingName,
                                                               additionalCoordinates,
                                                               additionalAxes,
                                                               userToken)
    } yield allBucketPositions

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
      WebKnossosDataRequest(
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
      else volumeTracingService.data(tracingId, tracing, dataRequests, includeFallbackDataIfAvailable = true, userToken)
    } yield data
  }

}
