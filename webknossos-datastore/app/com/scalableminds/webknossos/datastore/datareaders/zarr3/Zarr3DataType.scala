package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.datareaders.{ArrayDataType, zarr3}
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType

object Zarr3DataType extends ExtendedEnumeration {
  type Zarr3DataType = Value
  val bool, int8, int16, int32, int64, uint8, uint16, uint32, uint64, float16, float32, float64, complex64, complex128,
      raw, extension = Value

  // https://zarr-specs.readthedocs.io/en/latest/v3/core/v3.0.html#core-data-types

  override def fromString(s: String): Option[zarr3.Zarr3DataType.Value] = {

    val rawPattern = "(r\\d+)".r
    super
      .fromString(s)
      .orElse(s match {
        case rawPattern(_) => Some(Zarr3DataType.raw)
        case _             => None
      })
  }

  def toArrayDataType(dataType: Zarr3DataType): ArrayDataType =
    dataType match {
      case Zarr3DataType.bool       => ???
      case Zarr3DataType.int8       => ArrayDataType.i1
      case Zarr3DataType.int16      => ArrayDataType.i2
      case Zarr3DataType.int32      => ArrayDataType.i4
      case Zarr3DataType.int64      => ArrayDataType.i8
      case Zarr3DataType.uint8      => ArrayDataType.u1
      case Zarr3DataType.uint16     => ArrayDataType.u2
      case Zarr3DataType.uint32     => ArrayDataType.u4
      case Zarr3DataType.uint64     => ArrayDataType.u8
      case Zarr3DataType.float16    => ???
      case Zarr3DataType.float32    => ArrayDataType.f4
      case Zarr3DataType.float64    => ArrayDataType.f8
      case Zarr3DataType.complex64  => ???
      case Zarr3DataType.complex128 => ???
      case Zarr3DataType.raw        => ???
      case Zarr3DataType.extension  => ???
    }
}
