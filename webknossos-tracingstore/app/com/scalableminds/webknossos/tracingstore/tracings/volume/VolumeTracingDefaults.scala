package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.geometry.Vec3DoubleProto

object VolumeTracingDefaults {

  val editRotation: Vec3DoubleProto = Vec3DoubleProto(0, 0, 0)

  val elementClass: ElementClass.Value = ElementClass.uint32

  val largestSegmentId = 0L

  val zoomLevel = 1.0

}
