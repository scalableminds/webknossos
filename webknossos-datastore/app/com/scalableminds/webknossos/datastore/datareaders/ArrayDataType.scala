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

  def maxValue(dataType: ArrayDataType): Number =
    dataType match {
      case ArrayDataType.f8 => Double.MaxValue
      case ArrayDataType.f4 => Float.MaxValue
      case ArrayDataType.i8 => Long.MaxValue
      case ArrayDataType.u8 => Long.MaxValue // Max value for primitive datatypes
      case ArrayDataType.i4 => Int.MaxValue
      case ArrayDataType.u4 => Math.pow(2, 4 * 8).toLong - 1
      case ArrayDataType.i2 => Char.MaxValue
      case ArrayDataType.u2 => Math.pow(2, 2 * 8).toLong - 1
      case ArrayDataType.i1 => Byte.MaxValue
      case ArrayDataType.u1 => Math.pow(2, 1 * 8).toLong - 1
    }

  def minValue(dataType: ArrayDataType): Number =
    dataType match {
      case ArrayDataType.f8 => Double.MinValue
      case ArrayDataType.f4 => Float.MinValue
      case ArrayDataType.i8 => Long.MinValue
      case ArrayDataType.u8 => 0
      case ArrayDataType.i4 => Int.MinValue
      case ArrayDataType.u4 => 0
      case ArrayDataType.i2 => Char.MinValue
      case ArrayDataType.u2 => 0
      case ArrayDataType.i1 => Byte.MinValue
      case ArrayDataType.u1 => 0
    }
}
