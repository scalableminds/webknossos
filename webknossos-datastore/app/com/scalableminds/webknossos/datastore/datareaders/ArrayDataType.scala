package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.enumeration.ExtendedEnumeration

object ArrayDataType extends ExtendedEnumeration {
  type ArrayDataType = Value
  val f8, f4, i8, u8, i4, u4, i2, u2, i1, u1 = Value

  def bytesPerElementFor(dataType: ArrayDataType): Int =
    dataType match {
      case ArrayDataType.f8 => 8
      case ArrayDataType.f4 => 4
      case ArrayDataType.i8 => 8
      case ArrayDataType.u8 => 8
      case ArrayDataType.i4 => 4
      case ArrayDataType.u4 => 4
      case ArrayDataType.i2 => 2
      case ArrayDataType.u2 => 2
      case ArrayDataType.i1 => 1
      case ArrayDataType.u1 => 1
    }
}
