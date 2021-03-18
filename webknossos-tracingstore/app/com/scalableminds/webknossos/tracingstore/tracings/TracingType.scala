package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.enumeration.ExtendedEnumeration

object TracingType extends ExtendedEnumeration {
  type TracingType = Value
  val skeleton, volume, hybrid = Value
}
