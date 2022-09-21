package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType
import ArrayDataType.ArrayDataType

object N5DataType extends ExtendedEnumeration {
  type N5DataType = Value
  val float64, float32, int64, uint64, int32, uint32, int16, uint16, int8, uint8 = Value

  def toArrayDataType(dataType: N5DataType): ArrayDataType =
    dataType match {
      case `float64` => ArrayDataType.f8
      case `float32` => ArrayDataType.f4
      case `int64`   => ArrayDataType.i8
      case `uint64`  => ArrayDataType.u8
      case `int32`   => ArrayDataType.i4
      case `uint32`  => ArrayDataType.u4
      case `int16`   => ArrayDataType.i2
      case `uint16`  => ArrayDataType.u2
      case `int8`    => ArrayDataType.i1
      case `uint8`   => ArrayDataType.u1
    }
}
