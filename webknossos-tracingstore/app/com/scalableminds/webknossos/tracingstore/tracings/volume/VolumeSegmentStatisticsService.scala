package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{UnsignedInteger, UnsignedIntegerArray, WebKnossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class VolumeSegmentStatisticsService @Inject()(volumeTracingService: VolumeTracingService,
                                               volumeSegmentIndexService: VolumeSegmentIndexService,
                                               editableMappingService: EditableMappingService)
    extends ProtoGeometryImplicits
    with LazyLogging {

  def getSegmentVolume(tracingId: String, segmentId: Long, mag: Vec3Int, userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[Long] =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      bucketPositions: ListOfVec3IntProto <- volumeSegmentIndexService
        .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(tracingId, segmentId, mag)
      volumeData <- data(tracing, tracingId, mag, bucketPositions, userToken)
      dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(volumeData, tracing.elementClass)
      volumeInVx = dataTyped.count(unsignedInteger => unsignedInteger.toPositiveLong == segmentId)
    } yield volumeInVx

  private def data(tracing: VolumeTracing,
                   tracingId: String,
                   mag: Vec3Int,
                   bucketPositions: ListOfVec3IntProto,
                   userToken: Option[String]): Fox[Array[Byte]] = {
    val dataRequests = bucketPositions.values.map { position =>
      WebKnossosDataRequest(
        position = vec3IntFromProto(position) * mag * DataLayer.bucketLength,
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
