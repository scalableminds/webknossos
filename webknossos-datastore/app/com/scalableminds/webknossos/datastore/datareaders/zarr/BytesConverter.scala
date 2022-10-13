package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.{ArrayDataType, bytesPerElementFor}

import java.nio.{ByteBuffer, ByteOrder}

object BytesConverter {
  def toByteArray(array: Object, dataType: ArrayDataType, byteOrder: ByteOrder): Array[Byte] = {
    val bytesPerElement = bytesPerElementFor(dataType)
    dataType match {
      case ArrayDataType.u1 | ArrayDataType.i1 =>
        array.asInstanceOf[Array[Byte]]
      case ArrayDataType.u2 | ArrayDataType.i2 =>
        val arrayTyped = array.asInstanceOf[Array[Short]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asShortBuffer().put(arrayTyped)
        byteBuffer.array()
      case ArrayDataType.u4 | ArrayDataType.i4 =>
        val arrayTyped = array.asInstanceOf[Array[Int]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asIntBuffer().put(arrayTyped)
        byteBuffer.array()
      case ArrayDataType.i8 | ArrayDataType.u8 =>
        val arrayTyped = array.asInstanceOf[Array[Long]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asLongBuffer().put(arrayTyped)
        byteBuffer.array()
      case ArrayDataType.f4 =>
        val arrayTyped = array.asInstanceOf[Array[Float]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asFloatBuffer().put(arrayTyped)
        byteBuffer.array()
      case ArrayDataType.f8 =>
        val arrayTyped = array.asInstanceOf[Array[Double]]
        val byteBuffer = makeByteBuffer(arrayTyped.length * bytesPerElement, byteOrder)
        byteBuffer.asDoubleBuffer().put(arrayTyped)
        byteBuffer.array()
    }
  }

  private def makeByteBuffer(lengthBytes: Int, byteOrder: ByteOrder) =
    ByteBuffer.allocate(lengthBytes).order(byteOrder)

}
