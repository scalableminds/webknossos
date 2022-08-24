package com.scalableminds.webknossos.datastore.jzarr

import java.nio.{ByteBuffer, ByteOrder}

import com.scalableminds.webknossos.datastore.jzarr.ZarrDataType.ZarrDataType

object BytesConverter {

  def bytesPerElementFor(dataType: ZarrDataType): Int =
    dataType match {
      case ZarrDataType.f8 => 8
      case ZarrDataType.f4 => 4
      case ZarrDataType.i8 => 8
      case ZarrDataType.u8 => 8
      case ZarrDataType.i4 => 4
      case ZarrDataType.u4 => 4
      case ZarrDataType.i2 => 2
      case ZarrDataType.u2 => 2
      case ZarrDataType.i1 => 1
      case ZarrDataType.u1 => 1
    }

  def toByteArray(array: Object, dataType: ZarrDataType, byteOrder: ByteOrder): Array[Byte] = {
    val bytesPerElement = bytesPerElementFor(dataType)
    dataType match {
      case ZarrDataType.u1 | ZarrDataType.i1 =>
        array.asInstanceOf[Array[Byte]]
      case ZarrDataType.u2 | ZarrDataType.i2 =>
        val arrayTyped = array.asInstanceOf[Array[Short]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asShortBuffer().put(arrayTyped)
        byteBuffer.array()
      case ZarrDataType.u4 | ZarrDataType.i4 =>
        val arrayTyped = array.asInstanceOf[Array[Int]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asIntBuffer().put(arrayTyped)
        byteBuffer.array()
      case ZarrDataType.i8 | ZarrDataType.u8 =>
        val arrayTyped = array.asInstanceOf[Array[Long]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asLongBuffer().put(arrayTyped)
        byteBuffer.array()
      case ZarrDataType.f4 =>
        val arrayTyped = array.asInstanceOf[Array[Float]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        val asFloat = byteBuffer.asFloatBuffer()
        asFloat.put(arrayTyped)
        byteBuffer.array()
      case ZarrDataType.f8 =>
        val arrayTyped = array.asInstanceOf[Array[Double]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asDoubleBuffer().put(arrayTyped)
        byteBuffer.array()
    }
  }

  private def makeByteBuffer(lengthBytes: Int, byteOrder: ByteOrder) =
    ByteBuffer.allocate(lengthBytes).order(byteOrder)

}
