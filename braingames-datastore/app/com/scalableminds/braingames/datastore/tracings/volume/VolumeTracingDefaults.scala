/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.models.datasource.ElementClass
import com.scalableminds.braingames.datastore.geometry.Vector3D

object VolumeTracingDefaults {

  val editRotation = Vector3D(0, 0, 0)

  val elementClass = ElementClass.uint32

  val largestSegmentId = 0

  val zoomLevel = 0.1
}
