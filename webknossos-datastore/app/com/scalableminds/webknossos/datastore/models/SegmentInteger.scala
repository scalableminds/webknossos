package com.scalableminds.webknossos.datastore.models

import java.nio._
import com.scalableminds.webknossos.datastore.models.SegmentInteger.wrongElementClass
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

import java.util
import scala.reflect.ClassTag

/* Wrapper for unsigned integral data types. Currently not a lot of algebra implemented, add functionality as needed */

trait SegmentInteger {
  def increment: SegmentInteger
  def isZero: Boolean
  def toLong: Long
}

object UInt8 { @inline final def apply(n: Byte): UInt8 = new UInt8(n) }
object Int8 { @inline final def apply(n: Byte): Int8 = new Int8(n) }
object UInt16 { @inline final def apply(n: Short): UInt16 = new UInt16(n) }
object Int16 { @inline final def apply(n: Short): Int16 = new Int16(n) }
object UInt32 { @inline final def apply(n: Int): UInt32 = new UInt32(n) }
object Int32 { @inline final def apply(n: Int): Int32 = new Int32(n) }
object UInt64 { @inline final def apply(n: Long): UInt64 = new UInt64(n) }
object Int64 { @inline final def apply(n: Long): Int64 = new Int64(n) }

object SegmentInteger {
  def wrongElementClass(elementClass: ElementClass.Value): SegmentInteger =
    throw new IllegalArgumentException(s"Cannot use Segment Integer with element class ${elementClass.toString}")

  def zeroFromElementClass(elementClass: ElementClass.Value): SegmentInteger =
    elementClass match {
      case ElementClass.uint8  => UInt8(0)
      case ElementClass.int8   => Int8(0)
      case ElementClass.uint16 => UInt16(0)
      case ElementClass.int16  => Int16(0)
      case ElementClass.uint32 => UInt32(0)
      case ElementClass.int32  => Int32(0)
      case ElementClass.uint64 => UInt64(0)
      case ElementClass.int64  => Int64(0)
      case _                   => wrongElementClass(elementClass)
    }

  def fromLongWithElementClass(long: Long, elementClass: ElementClass.Value): SegmentInteger =
    elementClass match {
      case ElementClass.uint8  => UInt8(long.toByte)
      case ElementClass.int8   => Int8(long.toByte)
      case ElementClass.uint16 => UInt16(long.toShort)
      case ElementClass.int16  => Int16(long.toShort)
      case ElementClass.uint32 => UInt32(long.toInt)
      case ElementClass.int32  => Int32(long.toInt)
      case ElementClass.uint64 => UInt64(long)
      case ElementClass.int64  => Int64(long)
      case _                   => wrongElementClass(elementClass)
    }
}

class UInt8(val signed: Byte) extends SegmentInteger {
  def increment: UInt8 = UInt8((signed + 1).toByte)
  def isZero: Boolean = signed == 0
  override def toLong: Long =
    if (signed >= 0) signed.toLong else signed.toLong + Byte.MaxValue.toLong + Byte.MaxValue.toLong + 2L
  override def toString = s"UInt8($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: UInt8 => that.signed == signed
    case _           => false
  }
}

class Int8(val signed: Byte) extends SegmentInteger {
  def increment: Int8 = Int8((signed + 1).toByte)
  def isZero: Boolean = signed == 0
  override def toLong: Long = signed.toLong
  override def toString = s"Int8($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: Int8 => that.signed == signed
    case _          => false
  }
}

class UInt16(val signed: Short) extends SegmentInteger {
  def increment: UInt16 = UInt16((signed + 1).toShort)
  def isZero: Boolean = signed == 0
  override def toLong: Long =
    if (signed >= 0) signed.toLong else signed.toLong + Short.MaxValue.toLong + Short.MaxValue.toLong + 2L
  override def toString = s"UInt16($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: UInt16 => that.signed == signed
    case _            => false
  }
}

class Int16(val signed: Short) extends SegmentInteger {
  override def increment: Int16 = Int16((signed + 1).toShort)
  def isZero: Boolean = signed == 0
  override def toLong: Long = signed.toLong
  override def toString = s"Int16($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: Int16 => that.signed == signed
    case _           => false
  }
}

class UInt32(val signed: Int) extends SegmentInteger {
  def increment: UInt32 = UInt32(signed + 1)
  def isZero: Boolean = signed == 0
  override def toLong: Long =
    if (signed >= 0) signed.toLong else signed.toLong + Int.MaxValue.toLong + Int.MaxValue.toLong + 2L
  override def toString = s"UInt32($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: UInt32 => that.signed == signed
    case _            => false
  }
}

class Int32(val signed: Int) extends SegmentInteger {
  def increment: Int32 = Int32(signed + 1)
  def isZero: Boolean = signed == 0
  override def toLong: Long = signed.toLong
  override def toString = s"Int32($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: Int32 => that.signed == signed
    case _            => false
  }
}

class UInt64(val signed: Long) extends SegmentInteger {
  def increment: UInt64 = UInt64(signed + 1)
  def isZero: Boolean = signed == 0L
  override def toLong: Long =
    if (signed >= 0) signed else throw new Exception("Cannot convert UInt64 with value >= 2^63 to Long")
  override def toString = s"UInt64($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: UInt64 => that.signed == signed
    case _            => false
  }
}

class Int64(val signed: Long) extends SegmentInteger {
  def increment: Int64 = Int64(signed + 1)
  def isZero: Boolean = signed == 0L
  override def toLong: Long = signed
  override def toString = s"Int64($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: Int64 => that.signed == signed
    case _            => false
  }
}

case class DataTypeFunctors[T, B](
    getTypedBufferFn: ByteBuffer => B,
    copyDataFn: (B, Array[T]) => Unit,
)

object SegmentIntegerArray {

  def fromByteArray(byteArray: Array[Byte], elementClass: ElementClass.Value): Array[SegmentInteger] = {
    lazy val byteBuffer = ByteBuffer.wrap(byteArray).order(ByteOrder.LITTLE_ENDIAN)
    elementClass match {
      case ElementClass.uint8 => byteArray.map(UInt8(_))
      case ElementClass.int8  => byteArray.map(Int8(_))
      case ElementClass.uint16 =>
        fromByteArrayImpl(byteBuffer, DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_))).map(UInt16(_))
      case ElementClass.int16 =>
        fromByteArrayImpl(byteBuffer, DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_))).map(Int16(_))
      case ElementClass.uint32 =>
        fromByteArrayImpl(byteBuffer, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_))).map(UInt32(_))
      case ElementClass.int32 =>
        fromByteArrayImpl(byteBuffer, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_))).map(Int32(_))
      case ElementClass.uint64 =>
        fromByteArrayImpl(byteBuffer, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_))).map(UInt64(_))
      case ElementClass.int64 =>
        fromByteArrayImpl(byteBuffer, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_))).map(Int64(_))
      case _ =>
        wrongElementClass(elementClass)
        Array()
    }
  }

  private def fromByteArrayImpl[B <: Buffer, T: ClassTag](byteBuffer: ByteBuffer,
                                                          dataTypeFunctor: DataTypeFunctors[T, B]) = {
    val srcBuffer = dataTypeFunctor.getTypedBufferFn(byteBuffer)
    srcBuffer.rewind()
    val dstArray = Array.ofDim[T](srcBuffer.remaining())
    dataTypeFunctor.copyDataFn(srcBuffer, dstArray)
    dstArray
  }

  def toByteArray(dataTyped: Array[SegmentInteger], elementClass: ElementClass.Value): Array[Byte] = {
    val byteBuffer =
      ByteBuffer.allocate(dataTyped.length * ElementClass.bytesPerElement(elementClass)).order(ByteOrder.LITTLE_ENDIAN)
    val shortBuffer = byteBuffer.asShortBuffer()
    val intBuffer = byteBuffer.asIntBuffer()
    val longBuffer = byteBuffer.asLongBuffer()
    dataTyped.foreach { elem: SegmentInteger =>
      elem match {
        case e: UInt8  => byteBuffer.put(e.signed)
        case e: Int8   => byteBuffer.put(e.signed)
        case e: UInt16 => shortBuffer.put(e.signed)
        case e: Int16  => shortBuffer.put(e.signed)
        case e: UInt32 => intBuffer.put(e.signed)
        case e: Int32  => intBuffer.put(e.signed)
        case e: UInt64 => longBuffer.put(e.signed)
        case e: Int64  => longBuffer.put(e.signed)
        case _         => wrongElementClass(elementClass)
      }
    }
    byteBuffer.array()
  }

  def filterNonZero(typedArray: Array[SegmentInteger]): Array[SegmentInteger] =
    typedArray.filter(!_.isZero)

  // SegmentInteger objects are only allocated on the (fewer) elements of the set
  // for Int and Long, primitive Streams are provided by java.util.stream, which are faster than toSet
  // Most volume annotations are Int or Long anyway
  def toSetFromByteArray(byteArray: Array[Byte], elementClass: ElementClass.Value): Set[SegmentInteger] = {
    lazy val byteBuffer = ByteBuffer.wrap(byteArray).order(ByteOrder.LITTLE_ENDIAN)
    elementClass match {
      case ElementClass.uint8 => byteArray.toSet.map(UInt8(_))
      case ElementClass.int8  => byteArray.toSet.map(Int8(_))
      case ElementClass.uint16 | ElementClass.int16 =>
        val asSet = fromByteArrayImpl(byteBuffer, DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_))).toSet
        if (elementClass == ElementClass.uint16) asSet.map(UInt16(_)) else asSet.map(Int16(_))
      case ElementClass.uint32 | ElementClass.int32 =>
        val signedArray = fromByteArrayImpl(byteBuffer, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_)))
        val asSet = util.Arrays.stream(signedArray).distinct().toArray.toSet
        if (elementClass == ElementClass.uint32) asSet.map(UInt32(_)) else asSet.map(Int32(_))
      case ElementClass.uint64 =>
        val signedArray = fromByteArrayImpl(byteBuffer, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_)))
        val asSet = util.Arrays.stream(signedArray).distinct().toArray.toSet
        if (elementClass == ElementClass.uint64) asSet.map(UInt64(_)) else asSet.map(Int64(_))
      case _ =>
        wrongElementClass(elementClass)
        Set()
    }
  }

}
