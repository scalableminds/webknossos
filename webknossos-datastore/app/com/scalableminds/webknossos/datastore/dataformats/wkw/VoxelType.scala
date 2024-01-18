package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import net.liftweb.common.{Box, Failure, Full}

object VoxelType extends Enumeration(1) {
  val UInt8, UInt16, UInt32, UInt64, Float, Double, Int8, Int16, Int32, Int64 = Value

  def bytesPerVoxelPerChannel(voxelType: VoxelType.Value): Int = voxelType match {
    case UInt8  => 1
    case UInt16 => 2
    case UInt32 => 4
    case UInt64 => 8
    case Float  => 4
    case Double => 8
    case Int8   => 1
    case Int16  => 2
    case Int32  => 4
    case Int64  => 8
  }

  def toArrayDataType(voxelType: VoxelType.Value): ArrayDataType =
    voxelType match {
      case UInt8  => ArrayDataType.u1
      case UInt16 => ArrayDataType.u2
      case UInt32 => ArrayDataType.u4
      case UInt64 => ArrayDataType.u8
      case Float  => ArrayDataType.f4
      case Double => ArrayDataType.f8
      case Int8   => ArrayDataType.i1
      case Int16  => ArrayDataType.i2
      case Int32  => ArrayDataType.i4
      case Int64  => ArrayDataType.i8
    }

  def toElementClass(voxelType: VoxelType.Value, voxelSize: Int): Box[ElementClass.Value] =
    (voxelType, voxelSize) match {
      case (VoxelType.UInt8, 1)  => Full(ElementClass.uint8)
      case (VoxelType.UInt16, 2) => Full(ElementClass.uint16)
      case (VoxelType.UInt8, 3)  => Full(ElementClass.uint24)
      case (VoxelType.UInt32, 4) => Full(ElementClass.uint32)
      case (VoxelType.UInt64, 8) => Full(ElementClass.uint64)
      case (VoxelType.Float, 4)  => Full(ElementClass.float)
      case (VoxelType.Double, 8) => Full(ElementClass.double)
      case (VoxelType.Int8, 1)   => Full(ElementClass.int8)
      case (VoxelType.Int16, 2)  => Full(ElementClass.int16)
      case (VoxelType.Int32, 4)  => Full(ElementClass.int32)
      case (VoxelType.Int64, 8)  => Full(ElementClass.int64)
      case _                     => Failure("VoxelType is not supported.")
    }

  def fromElementClass(elementClass: ElementClass.Value): (VoxelType.Value, Int) =
    elementClass match {
      case ElementClass.uint8  => (VoxelType.UInt8, 1)
      case ElementClass.uint16 => (VoxelType.UInt16, 1)
      case ElementClass.uint24 => (VoxelType.UInt8, 3)
      case ElementClass.uint32 => (VoxelType.UInt32, 1)
      case ElementClass.uint64 => (VoxelType.UInt64, 1)
      case ElementClass.float  => (VoxelType.Float, 1)
      case ElementClass.double => (VoxelType.Double, 1)
      case ElementClass.int8   => (VoxelType.Int8, 1)
      case ElementClass.int16  => (VoxelType.Int16, 1)
      case ElementClass.int32  => (VoxelType.Int32, 1)
      case ElementClass.int64  => (VoxelType.Int64, 1)
    }

}
