package com.scalableminds.webknossos.datastore.n5

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.jzarr.ZarrDataType
import com.scalableminds.webknossos.datastore.jzarr.ZarrDataType.ZarrDataType

object N5DataType extends ExtendedEnumeration {
  type N5DataType = Value
  val float64, float32, int64, uint64, int32, uint32, int16, uint16, int8, uint8 = Value

  def toZarrDataType(dataType: N5DataType): ZarrDataType =
    dataType match {
      case `float64` => ZarrDataType.f8
      case `float32` => ZarrDataType.f4
      case `int64` => ZarrDataType.i8
      case `uint64` => ZarrDataType.u8
      case `int32` => ZarrDataType.i4
      case `uint32` => ZarrDataType.u4
      case `int16` => ZarrDataType.i2
      case `uint16` => ZarrDataType.u2
      case `int8` => ZarrDataType.i1
      case `uint8` => ZarrDataType.u1
    }
}
