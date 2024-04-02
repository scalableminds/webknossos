package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.enumeration.ExtendedEnumeration

object DimensionSeparator extends ExtendedEnumeration {

  type DimensionSeparator = Value
  val SLASH: DimensionSeparator.Value = Value("/")
  val DOT: DimensionSeparator.Value = Value(".")
  val UNDERSCORE: DimensionSeparator.Value = Value("_")

}
