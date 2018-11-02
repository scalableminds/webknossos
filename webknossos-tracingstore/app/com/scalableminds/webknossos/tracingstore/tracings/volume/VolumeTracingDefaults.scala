package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.tracingstore.geometry.Vector3D

object VolumeTracingDefaults {

  val editRotation = Vector3D(0, 0, 0)

  val elementClass = ElementClass.uint32

  val largestSegmentId = 0L

  val zoomLevel = 0.1

}
