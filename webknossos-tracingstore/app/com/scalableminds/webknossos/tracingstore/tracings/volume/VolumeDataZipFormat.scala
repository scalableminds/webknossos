package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.enumeration.ExtendedEnumeration

object VolumeDataZipFormat extends ExtendedEnumeration {
  type VolumeDataZipFormat = Value
  val wkw, zarr3 = Value
}
