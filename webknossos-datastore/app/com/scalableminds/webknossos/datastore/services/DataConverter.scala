package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import spire.math._

import java.nio._
import scala.reflect.ClassTag

trait DataConverter extends FoxImplicits {

  def convertData(data: Array[Byte],
                  elementClass: ElementClass.Value,
                  filterZeroes: Boolean = false): Array[_ >: UByte with UShort with UInt with ULong with Float] =
    elementClass match {
      case ElementClass.uint8 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
          .map(UByte(_))
          .filter(!filterZeroes || _ != UByte(0))
      case ElementClass.uint16 =>
        convertDataImpl[Short, ShortBuffer](data,
                                            DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))
          .map(UShort(_))
          .filter(!filterZeroes || _ != UShort(0))
      case ElementClass.uint24 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
          .map(UByte(_))
          .filter(!filterZeroes || _ != UByte(0))
      case ElementClass.uint32 =>
        convertDataImpl[Int, IntBuffer](data, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
          .map(UInt(_))
          .filter(!filterZeroes || _ != UInt(0))
      case ElementClass.uint64 =>
        convertDataImpl[Long, LongBuffer](data, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
          .map(ULong(_))
          .filter(!filterZeroes || _ != ULong(0))
      case ElementClass.float =>
        convertDataImpl[Float, FloatBuffer](data,
                                            DataTypeFunctors[Float, FloatBuffer](
                                              _.asFloatBuffer(),
                                              _.get(_),
                                              _.toFloat)).filter(!_.isNaN).filter(!filterZeroes || _ != 0f)
    }

  private def convertDataImpl[T: ClassTag, B <: Buffer](data: Array[Byte],
                                                        dataTypeFunctor: DataTypeFunctors[T, B]): Array[T] = {
    val srcBuffer = dataTypeFunctor.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
    srcBuffer.rewind()
    val dstArray = Array.ofDim[T](srcBuffer.remaining())
    dataTypeFunctor.copyDataFn(srcBuffer, dstArray)
    dstArray
  }
}
