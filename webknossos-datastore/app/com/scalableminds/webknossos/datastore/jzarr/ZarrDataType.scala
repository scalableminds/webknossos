package com.scalableminds.webknossos.datastore.jzarr

import com.scalableminds.util.enumeration.ExtendedEnumeration

object ZarrDataType extends ExtendedEnumeration {
  type ZarrDataType = Value
  val f8, f4, i8, u8, i4, u4, i2, u2, i1, u1 = Value
}
