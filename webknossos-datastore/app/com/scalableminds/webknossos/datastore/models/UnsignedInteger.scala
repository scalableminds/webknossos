package com.scalableminds.webknossos.datastore.models

import java.nio.{Buffer, ByteBuffer, ByteOrder, IntBuffer, LongBuffer, ShortBuffer}

import com.scalableminds.webknossos.datastore.models.UnsignedInteger.wrongElementClass
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

import scala.reflect.ClassTag

/* Wrapper for unsigned integral data types. Currently not a lot of algebra implemented, add functionality as needed */

trait UnsignedInteger {
  def increment: UnsignedInteger
  def isZero: Boolean
}

object UInt8 { @inline final def apply(n: Byte): UInt8 = new UInt8(n) }
object UInt16 { @inline final def apply(n: Short): UInt16 = new UInt16(n) }
object UInt32 { @inline final def apply(n: Int): UInt32 = new UInt32(n) }
object UInt64 { @inline final def apply(n: Long): UInt64 = new UInt64(n) }

object UnsignedInteger {
  def wrongElementClass(elementClass: ElementClass.Value): UnsignedInteger =
    throw new IllegalArgumentException(s"Cannot use Unsigned Integer with element class ${elementClass.toString}")

  def zeroFromElementClass(elementClass: ElementClass.Value): UnsignedInteger =
    elementClass match {
      case ElementClass.uint8  => UInt8(0)
      case ElementClass.uint16 => UInt16(0)
      case ElementClass.uint32 => UInt32(0)
      case ElementClass.uint64 => UInt64(0)
      case _                   => wrongElementClass(elementClass)
    }
}

class UInt8(val signed: Byte) extends UnsignedInteger {
  def increment: UInt8 = UInt8((signed + 1).toByte)
  def isZero: Boolean = signed == 0
  override def toString = s"UInt8($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: UInt8 => that.signed == signed
    case _           => false
  }
}
class UInt16(val signed: Short) extends UnsignedInteger {
  def increment: UInt16 = UInt16((signed + 1).toShort)
  def isZero: Boolean = signed == 0
  override def toString = s"UInt16($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: UInt16 => that.signed == signed
    case _            => false
  }
}
class UInt32(val signed: Int) extends UnsignedInteger {
  def increment: UInt32 = UInt32(signed + 1)
  def isZero: Boolean = signed == 0
  override def toString = s"UInt32($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: UInt32 => that.signed == signed
    case _            => false
  }
}
class UInt64(val signed: Long) extends UnsignedInteger {
  def increment: UInt64 = UInt64(signed + 1)
  def isZero: Boolean = signed == 0L
  override def toString = s"UInt64($signed)"
  override def hashCode: Int = signed.hashCode
  override def equals(that: Any): Boolean = that match {
    case that: UInt64 => that.signed == signed
    case _            => false
  }
}

case class DataTypeFunctors[T, B](
    getTypedBufferFn: ByteBuffer => B,
    copyDataFn: (B, Array[T]) => Unit,
)

object UnsignedIntegerArray {

  def fromByteArray(byteArray: Array[Byte], elementClass: ElementClass.Value): Array[UnsignedInteger] = {
    lazy val byteBuffer = ByteBuffer.wrap(byteArray).order(ByteOrder.LITTLE_ENDIAN)
    elementClass match {
      case ElementClass.uint8 => byteArray.map(UInt8(_))
      case ElementClass.uint16 =>
        fromByteArrayImpl(byteBuffer, DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_))).map(UInt16(_))
      case ElementClass.uint32 =>
        fromByteArrayImpl(byteBuffer, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_))).map(UInt32(_))
      case ElementClass.uint64 =>
        fromByteArrayImpl(byteBuffer, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_))).map(UInt64(_))
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

  def toByteArray(dataTyped: Array[UnsignedInteger], elementClass: ElementClass.Value): Array[Byte] = {
    val byteBuffer =
      ByteBuffer.allocate(dataTyped.length * ElementClass.bytesPerElement(elementClass)).order(ByteOrder.LITTLE_ENDIAN)
    val shortBuffer = byteBuffer.asShortBuffer()
    val intBuffer = byteBuffer.asIntBuffer()
    val longBuffer = byteBuffer.asLongBuffer()
    dataTyped.foreach { elem: UnsignedInteger =>
      elem match {
        case e: UInt8  => byteBuffer.put(e.signed)
        case e: UInt16 => shortBuffer.put(e.signed)
        case e: UInt32 => intBuffer.put(e.signed)
        case e: UInt64 => longBuffer.put(e.signed)
        case _         => wrongElementClass(elementClass)
      }
    }
    byteBuffer.array()
  }

  def filterNonZero(typedArray: Array[UnsignedInteger]): Array[UnsignedInteger] =
    typedArray.filter(!_.isZero)
}
