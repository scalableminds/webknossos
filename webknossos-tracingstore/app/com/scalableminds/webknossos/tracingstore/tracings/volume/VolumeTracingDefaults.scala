package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.geometry.Vector3D

object VolumeTracingDefaults {

  val editRotation: Vector3D = Vector3D(0, 0, 0)

  val elementClass: ElementClass.Value = ElementClass.uint32

  val largestSegmentId = 0L

  val zoomLevel = 1.0

}
