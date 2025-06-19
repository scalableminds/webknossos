package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeUserStateProto
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.geometry.Vec3DoubleProto

object VolumeTracingDefaults {

  val editRotation: Vec3DoubleProto = Vec3DoubleProto(0, 0, 0)

  val elementClass: ElementClass.Value = ElementClass.uint32

  // default for volume tracings *with no fallback segmentation*
  val largestSegmentId: Option[Long] = Some(0L)

  val zoomLevel = 1.0

  def emptyUserState(userId: ObjectId): VolumeUserStateProto = VolumeUserStateProto(
    userId = userId.toString,
    activeSegmentId = None,
    segmentGroupExpandedStates = Seq.empty,
    boundingBoxVisibilities = Seq.empty,
    segmentVisibilities = Seq.empty
  )
}
