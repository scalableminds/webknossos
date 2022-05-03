package com.scalableminds.webknossos.datastore.jzarr

import com.scalableminds.util.enumeration.ExtendedEnumeration

object DimensionSeparator extends ExtendedEnumeration {

  type DimensionSeparator = Value
  val SLASH: DimensionSeparator.Value = Value("/")
  val DOT: DimensionSeparator.Value = Value(".")

}
