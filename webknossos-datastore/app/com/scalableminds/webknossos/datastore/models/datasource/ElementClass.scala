package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.tools.{Box, Failure, Full}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType

object ElementClass extends ExtendedEnumeration {
  val uint8, uint16, uint24, uint32, uint64, float, double, int8, int16, int32, int64 = Value

  def segmentationElementClasses: Set[Value] = Set(uint8, uint16, uint32, uint64, int8, int16, int32, int64)

  def encodeAsByte(elementClass: ElementClass.Value): Byte = {
    val asInt = elementClass match {
      case ElementClass.uint8  => 0
      case ElementClass.uint16 => 1
      case ElementClass.uint24 => 2
      case ElementClass.uint32 => 3
      case ElementClass.uint64 => 4
      case ElementClass.float  => 5
      case ElementClass.double => 6
      case ElementClass.int8   => 7
      case ElementClass.int16  => 8
      case ElementClass.int32  => 9
      case ElementClass.int64  => 10
    }
    asInt.toByte
  }

  def isSigned(elementClass: ElementClass.Value): Boolean =
    elementClass match {
      case ElementClass.uint8  => false
      case ElementClass.uint16 => false
      case ElementClass.uint24 => false
      case ElementClass.uint32 => false
      case ElementClass.uint64 => false
      case ElementClass.float  => true
      case ElementClass.double => true
      case ElementClass.int8   => true
      case ElementClass.int16  => true
      case ElementClass.int32  => true
      case ElementClass.int64  => true
    }

  def defaultIntensityRange(elementClass: ElementClass.Value): (Double, Double) = elementClass match {
    case ElementClass.uint8  => (0.0, math.pow(2, 8) - 1)
    case ElementClass.uint16 => (0.0, math.pow(2, 16) - 1)
    case ElementClass.uint24 => (0.0, math.pow(2, 8) - 1) // Assume uint24 rgb color data
    case ElementClass.uint32 => (0.0, math.pow(2, 32) - 1)
    case ElementClass.float  => (-3.40282347e+38, 3.40282347e+38)
    case ElementClass.double => (-1.7976931348623157e+308, 1.7976931348623157e+308)
    case ElementClass.int8   => (-math.pow(2, 7), math.pow(2, 7) - 1)
    case ElementClass.int16  => (-math.pow(2, 15), math.pow(2, 15) - 1)
    case ElementClass.int32  => (-math.pow(2, 31), math.pow(2, 31) - 1)

    // Int64 types are only supported for segmentations (which don't need to call this
    // function as there will be no histogram / color data). Still, for the record:
    // The frontend only supports number in range of 2 ** 53 - 1 which is currently
    // the maximum supported "64-bit" segment id due to JS Number limitations (frontend).
    case ElementClass.uint64 | ElementClass.int64 => (0.0, math.pow(2, 8) - 1)
    case _                                        => (0.0, 255.0)
  }

  def bytesPerElement(elementClass: ElementClass.Value): Int = elementClass match {
    case ElementClass.uint8  => 1
    case ElementClass.uint16 => 2
    case ElementClass.uint24 => 3
    case ElementClass.uint32 => 4
    case ElementClass.uint64 => 8
    case ElementClass.float  => 4
    case ElementClass.double => 8
    case ElementClass.int8   => 1
    case ElementClass.int16  => 2
    case ElementClass.int32  => 4
    case ElementClass.int64  => 8
  }

  def fromProto(elementClassProto: ElementClassProto): ElementClass.Value =
    elementClassProto match {
      case ElementClassProto.uint8  => uint8
      case ElementClassProto.uint16 => uint16
      case ElementClassProto.uint24 => uint24
      case ElementClassProto.uint32 => uint32
      case ElementClassProto.uint64 => uint64
      case ElementClassProto.int8   => int8
      case ElementClassProto.int16  => int16
      case ElementClassProto.int32  => int32
      case ElementClassProto.int64  => int64
      case ElementClassProto.Unrecognized(_) =>
        throw new RuntimeException(s"Cannot convert ElementClassProto $elementClassProto to ElementClass")
    }

  def toProto(elementClass: ElementClass.Value): Box[ElementClassProto] =
    elementClass match {
      case ElementClass.uint8  => Full(ElementClassProto.uint8)
      case ElementClass.uint16 => Full(ElementClassProto.uint16)
      case ElementClass.uint32 => Full(ElementClassProto.uint32)
      case ElementClass.uint64 => Full(ElementClassProto.uint64)
      case ElementClass.int8   => Full(ElementClassProto.int8)
      case ElementClass.int16  => Full(ElementClassProto.int16)
      case ElementClass.int32  => Full(ElementClassProto.int32)
      case ElementClass.int64  => Full(ElementClassProto.int64)
      case _                   => Failure(s"Unsupported element class $elementClass for ElementClassProto")
    }

  /* only used for segmentation layers, so only unsigned integers 8 16 32 64 */
  private def maxSegmentIdValue(elementClass: ElementClass.Value): Long = elementClass match {
    case ElementClass.uint8  => 1L << 8L
    case ElementClass.int8   => Byte.MaxValue
    case ElementClass.uint16 => 1L << 16L
    case ElementClass.int16  => Short.MaxValue
    case ElementClass.uint32 => 1L << 32L
    case ElementClass.int32  => Int.MaxValue
    case ElementClass.uint64 | ElementClass.int64 =>
      (1L << 53L) - 1 // Front-end can only handle segment-ids up to (2^53)-1
  }

  def largestSegmentIdIsInRange(largestSegmentId: Long, elementClass: ElementClass.Value): Boolean =
    largestSegmentIdIsInRange(Some(largestSegmentId), elementClass)

  def largestSegmentIdIsInRange(largestSegmentIdOpt: Option[Long], elementClass: ElementClass.Value): Boolean =
    segmentationElementClasses.contains(elementClass) && largestSegmentIdOpt.forall(largestSegmentId =>
      largestSegmentId >= 0L && largestSegmentId <= maxSegmentIdValue(elementClass))

  def toChannelAndZarrString(elementClass: ElementClass.Value): (Int, String) = elementClass match {
    case ElementClass.uint8  => (1, "|u1")
    case ElementClass.uint16 => (1, "<u2")
    case ElementClass.uint24 => (3, "|u1")
    case ElementClass.uint32 => (1, "<u4")
    case ElementClass.uint64 => (1, "<u8")
    case ElementClass.float  => (1, "<f4")
    case ElementClass.double => (1, "<f8")
    case ElementClass.int8   => (1, "|i1")
    case ElementClass.int16  => (1, "<i2")
    case ElementClass.int32  => (1, "<i4")
    case ElementClass.int64  => (1, "<i8")
  }

  def fromArrayDataType(arrayDataType: ArrayDataType): Option[ElementClass.Value] = arrayDataType match {
    case ArrayDataType.u1 => Some(ElementClass.uint8)
    case ArrayDataType.u2 => Some(ElementClass.uint16)
    case ArrayDataType.u4 => Some(ElementClass.uint32)
    case ArrayDataType.u8 => Some(ElementClass.uint64)
    case ArrayDataType.f4 => Some(ElementClass.float)
    case ArrayDataType.f8 => Some(ElementClass.double)
    case ArrayDataType.i1 => Some(ElementClass.int8)
    case ArrayDataType.i2 => Some(ElementClass.int16)
    case ArrayDataType.i4 => Some(ElementClass.int32)
    case ArrayDataType.i8 => Some(ElementClass.int64)
    case _                => None
  }

  def toArrayDataTypeAndChannel(elementClass: ElementClass.Value): (ArrayDataType, Int) = elementClass match {
    case ElementClass.uint8  => (ArrayDataType.u1, 1)
    case ElementClass.uint16 => (ArrayDataType.u2, 1)
    case ElementClass.uint24 => (ArrayDataType.u1, 3)
    case ElementClass.uint32 => (ArrayDataType.u4, 1)
    case ElementClass.uint64 => (ArrayDataType.u8, 1)
    case ElementClass.float  => (ArrayDataType.f4, 1)
    case ElementClass.double => (ArrayDataType.f8, 1)
    case ElementClass.int8   => (ArrayDataType.i1, 1)
    case ElementClass.int16  => (ArrayDataType.i2, 1)
    case ElementClass.int32  => (ArrayDataType.i4, 1)
    case ElementClass.int64  => (ArrayDataType.i8, 1)
  }
}
