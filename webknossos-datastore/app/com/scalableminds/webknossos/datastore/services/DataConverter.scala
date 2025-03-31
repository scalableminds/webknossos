package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.services.mesh.DataTypeFunctors
import spire.math.{ULong, _}

import java.nio._
import scala.reflect.ClassTag

trait DataConverter extends FoxImplicits {

  def putByte(buf: ByteBuffer, lon: Long): ByteBuffer = buf put lon.toByte
  def putShort(buf: ByteBuffer, lon: Long): ByteBuffer = buf putShort lon.toShort
  def putInt(buf: ByteBuffer, lon: Long): ByteBuffer = buf putInt lon.toInt
  def putLong(buf: ByteBuffer, lon: Long): ByteBuffer = buf putLong lon

  def uByteToLong(uByte: Byte): Long = uByte & 0xffL
  def uShortToLong(uShort: Short): Long = uShort & 0xffffL
  def uIntToLong(uInt: Int): Long = uInt & 0xffffffffL

  def convertData(data: Array[Byte],
                  elementClass: ElementClass.Value): Array[_ >: Byte with Short with Int with Long with Float] =
    elementClass match {
      case ElementClass.uint8 | ElementClass.int8 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
      case ElementClass.uint16 | ElementClass.int16 =>
        convertDataImpl[Short, ShortBuffer](data,
                                            DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))
      case ElementClass.uint24 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
      case ElementClass.uint32 | ElementClass.int32 =>
        convertDataImpl[Int, IntBuffer](data, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
      case ElementClass.uint64 | ElementClass.int64 =>
        convertDataImpl[Long, LongBuffer](data, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
      case ElementClass.float =>
        convertDataImpl[Float, FloatBuffer](
          data,
          DataTypeFunctors[Float, FloatBuffer](_.asFloatBuffer(), _.get(_), _.toFloat))
    }

  private def convertDataImpl[T: ClassTag, B <: Buffer](data: Array[Byte],
                                                        dataTypeFunctor: DataTypeFunctors[T, B]): Array[T] = {
    val srcBuffer = dataTypeFunctor.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
    srcBuffer.rewind()
    val dstArray = Array.ofDim[T](srcBuffer.remaining())
    dataTypeFunctor.copyDataFn(srcBuffer, dstArray)
    dstArray
  }

  def toUnsignedIfNeeded(
      data: Array[_ >: Byte with Short with Int with Long with Float],
      isSigned: Boolean
  ): Array[_ >: UByte with Byte with UShort with Short with UInt with Int with ULong with Long with Float] =
    data match {
      case d: Array[Byte]  => if (isSigned) d else d.map(UByte(_))
      case d: Array[Short] => if (isSigned) d else d.map(UShort(_))
      case d: Array[Int]   => if (isSigned) d else d.map(UInt(_))
      case d: Array[Long]  => if (isSigned) d else d.map(ULong(_))
      case d: Array[Float] => d // Float is always signed
    }

  def filterZeroes(data: Array[_ >: Byte with Short with Int with Long with Float],
                   skip: Boolean = false): Array[_ >: Byte with Short with Int with Long with Float] =
    if (skip) data
    else {
      val zeroByte = 0.toByte
      val zeroShort = 0.toShort
      val zeroInt = 0
      val zeroLong = 0L
      data match {
        case d: Array[Byte]  => d.filter(_ != zeroByte)
        case d: Array[Short] => d.filter(_ != zeroShort)
        case d: Array[Int]   => d.filter(_ != zeroInt)
        case d: Array[Long]  => d.filter(_ != zeroLong)
        case d: Array[Float] => d.filter(!_.isNaN).filter(_ != 0f)
      }
    }

  def toBytesSpire(typed: Array[_ >: UByte with UShort with UInt with ULong with Float],
                   elementClass: ElementClass.Value): Array[Byte] = {
    val numBytes = ElementClass.bytesPerElement(elementClass)
    val byteBuffer = ByteBuffer.allocate(numBytes * typed.length).order(ByteOrder.LITTLE_ENDIAN)
    typed match {
      case data: Array[UByte]  => data.foreach(el => byteBuffer.put(el.signed))
      case data: Array[UShort] => data.foreach(el => byteBuffer.putChar(el.signed))
      case data: Array[UInt]   => data.foreach(el => byteBuffer.putInt(el.signed))
      case data: Array[ULong]  => data.foreach(el => byteBuffer.putLong(el.signed))
      case data: Array[Float]  => data.foreach(el => byteBuffer.putFloat(el))
    }
    byteBuffer.array()
  }

  def toBytes(typed: Array[_ >: Byte with Short with Int with Long with Float],
              elementClass: ElementClass.Value): Array[Byte] = {
    val numBytes = ElementClass.bytesPerElement(elementClass)
    val byteBuffer = ByteBuffer.allocate(numBytes * typed.length).order(ByteOrder.LITTLE_ENDIAN)
    typed match {
      case data: Array[Byte]  => data.foreach(el => byteBuffer.put(el))
      case data: Array[Short] => data.foreach(el => byteBuffer.putShort(el))
      case data: Array[Int]   => data.foreach(el => byteBuffer.putInt(el))
      case data: Array[Long]  => data.foreach(el => byteBuffer.putLong(el))
      case data: Array[Float] => data.foreach(el => byteBuffer.putFloat(el))
    }
    byteBuffer.array()
  }
}
