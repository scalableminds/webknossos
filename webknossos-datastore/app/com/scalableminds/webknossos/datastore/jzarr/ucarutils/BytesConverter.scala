package com.scalableminds.webknossos.datastore.jzarr.ucarutils

import java.nio.{ByteBuffer, ByteOrder}

import com.scalableminds.webknossos.datastore.jzarr.DataType

object BytesConverter {

  def bytesPerElementFor(dataType: DataType): Int =
    dataType match {
      case DataType.f8 => 8
      case DataType.f4 => 4
      case DataType.i8 => 8
      case DataType.i4 => 4
      case DataType.u4 => 4
      case DataType.i2 => 2
      case DataType.u2 => 2
      case DataType.i1 => 1
      case DataType.u1 => 1
    }

  def toByteArray(array: Object, dataType: DataType, byteOrder: ByteOrder): Array[Byte] = {
    val bytesPerElement = bytesPerElementFor(dataType)
    dataType match {
      case DataType.u1 | DataType.i1 =>
        array.asInstanceOf[Array[Byte]]
      case DataType.u2 | DataType.i2 =>
        val arrayTyped = array.asInstanceOf[Array[Short]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asShortBuffer().put(arrayTyped)
        byteBuffer.array()
      case DataType.u4 | DataType.i4 =>
        val arrayTyped = array.asInstanceOf[Array[Int]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asIntBuffer().put(arrayTyped)
        byteBuffer.array()
      case DataType.i8 => // TODO u8
        val arrayTyped = array.asInstanceOf[Array[Long]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asLongBuffer().put(arrayTyped).array()
        byteBuffer.array()
      case DataType.f4 =>
        val arrayTyped = array.asInstanceOf[Array[Float]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asFloatBuffer().put(arrayTyped).array()
        byteBuffer.array()
      case DataType.f8 =>
        val arrayTyped = array.asInstanceOf[Array[Double]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asDoubleBuffer().put(arrayTyped).array()
        byteBuffer.array()
    }
  }

  private def makeByteBuffer(lengthBytes: Int, byteOrder: ByteOrder) =
    ByteBuffer.allocate(lengthBytes).order(invertByteOrder(byteOrder))

  private def invertByteOrder(byteOrder: ByteOrder) =
    if (byteOrder == ByteOrder.BIG_ENDIAN) ByteOrder.LITTLE_ENDIAN else ByteOrder.BIG_ENDIAN
}
