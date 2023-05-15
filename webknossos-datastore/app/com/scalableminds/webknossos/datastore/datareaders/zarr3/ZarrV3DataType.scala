package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.datareaders.{ArrayDataType, zarr3}
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.{ArrayDataType, i1}

object ZarrV3DataType extends ExtendedEnumeration {
  type ZarrV3DataType = Value
  val bool, int8, int16, int32, int64, uint8, uint16, uint32, uint64, float16, float32, float64, complex64, complex128,
  raw, extension = Value

  // https://zarr-specs.readthedocs.io/en/latest/v3/core/v3.0.html#core-data-types

  override def fromString(s: String): Option[zarr3.ZarrV3DataType.Value] = {

    val rawPattern = "(r\\d+)".r
    super
      .fromString(s)
      .orElse(s match {
        case rawPattern(_) => Some(ZarrV3DataType.raw)
        case _             => ???
      })
  }

  def toArrayDataType(dataType: ZarrV3DataType): ArrayDataType =
    dataType match {
      case ZarrV3DataType.bool       => ???
      case ZarrV3DataType.int8       => ArrayDataType.i1
      case ZarrV3DataType.int16      => ArrayDataType.i2
      case ZarrV3DataType.int32      => ArrayDataType.i4
      case ZarrV3DataType.int64      => ArrayDataType.i8
      case ZarrV3DataType.uint8      => ArrayDataType.u1
      case ZarrV3DataType.uint16     => ArrayDataType.u2
      case ZarrV3DataType.uint32     => ArrayDataType.u4
      case ZarrV3DataType.uint64     => ArrayDataType.u8
      case ZarrV3DataType.float16    => ???
      case ZarrV3DataType.float32    => ArrayDataType.f4
      case ZarrV3DataType.float64    => ArrayDataType.f8
      case ZarrV3DataType.complex64  => ???
      case ZarrV3DataType.complex128 => ???
      case ZarrV3DataType.raw        => ???
      case ZarrV3DataType.extension  => ???
    }
}
