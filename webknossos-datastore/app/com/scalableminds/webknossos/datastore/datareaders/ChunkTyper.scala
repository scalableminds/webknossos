package com.scalableminds.webknossos.datastore.datareaders

import net.liftweb.common.Box
import net.liftweb.common.Box.tryo

import java.io.ByteArrayInputStream
import javax.imageio.stream.MemoryCacheImageInputStream
import scala.util.Using
import ucar.ma2.{Array => MultiArray, DataType => MADataType}

object ChunkTyper {
  def createFromHeader(header: DatasetHeader): ChunkTyper = header.resolvedDataType match {
    case ArrayDataType.i1 | ArrayDataType.u1 => new ByteChunkTyper(header)
    case ArrayDataType.i2 | ArrayDataType.u2 => new ShortChunkTyper(header)
    case ArrayDataType.i4 | ArrayDataType.u4 => new IntChunkTyper(header)
    case ArrayDataType.i8 | ArrayDataType.u8 => new LongChunkTyper(header)
    case ArrayDataType.f4                    => new FloatChunkTyper(header)
    case ArrayDataType.f8                    => new DoubleChunkTyper(header)
  }
}

abstract class ChunkTyper {
  val header: DatasetHeader

  def ma2DataType: MADataType
  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): Box[MultiArray]

  def createFromFillValue(chunkShape: Array[Int]): Box[MultiArray] =
    MultiArrayUtils.createFilledArray(ma2DataType, chunkShapeOrdered(chunkShape), header.fillValueNumber)

  // Chunk shape in header is in C-Order (XYZ), but data may be in F-Order (ZYX), so the chunk shape
  // associated with the array needs to be adjusted.
  def chunkShapeOrdered(chunkShape: Array[Int]): Array[Int] =
    if (header.order == ArrayOrder.F) chunkShape.reverse else chunkShape
}

class ByteChunkTyper(val header: DatasetHeader) extends ChunkTyper {
  val ma2DataType: MADataType = MADataType.BYTE

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): Box[MultiArray] =
    tryo(MultiArray.factory(ma2DataType, chunkShapeOrdered(chunkShape), bytes))
}

class DoubleChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.DOUBLE

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): Box[MultiArray] =
    tryo(Using.Manager { use =>
      val typedStorage = new Array[Double](chunkShape.product)
      val byteArrayInputStream = use(new ByteArrayInputStream(bytes))
      val imageInputStream = use(new MemoryCacheImageInputStream(byteArrayInputStream))
      imageInputStream.setByteOrder(header.byteOrder)
      imageInputStream.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkShapeOrdered(chunkShape), typedStorage)
    }.get)
}

class ShortChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.SHORT

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): Box[MultiArray] =
    tryo(Using.Manager { use =>
      val typedStorage = new Array[Short](chunkShape.product)
      val byteArrayInputStream = use(new ByteArrayInputStream(bytes))
      val imageInputStream = use(new MemoryCacheImageInputStream(byteArrayInputStream))
      imageInputStream.setByteOrder(header.byteOrder)
      imageInputStream.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkShapeOrdered(chunkShape), typedStorage)
    }.get)
}

class IntChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.INT

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): Box[MultiArray] =
    tryo(Using.Manager { use =>
      val typedStorage = new Array[Int](chunkShape.product)
      val byteArrayInputStream = use(new ByteArrayInputStream(bytes))
      val imageInputStream = use(new MemoryCacheImageInputStream(byteArrayInputStream))
      imageInputStream.setByteOrder(header.byteOrder)
      imageInputStream.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkShapeOrdered(chunkShape), typedStorage)
    }.get)
}

class LongChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.LONG

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): Box[MultiArray] =
    tryo(Using.Manager { use =>
      val typedStorage = new Array[Long](chunkShape.product)
      val byteArrayInputStream = use(new ByteArrayInputStream(bytes))
      val imageInputStream = use(new MemoryCacheImageInputStream(byteArrayInputStream))
      imageInputStream.setByteOrder(header.byteOrder)
      imageInputStream.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkShapeOrdered(chunkShape), typedStorage)
    }.get)

}

class FloatChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.FLOAT

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): Box[MultiArray] =
    tryo(Using.Manager { use =>
      val typedStorage = new Array[Float](chunkShape.product)
      val byteArrayInputStream = use(new ByteArrayInputStream(bytes))
      val imageInputStream = use(new MemoryCacheImageInputStream(byteArrayInputStream))
      imageInputStream.setByteOrder(header.byteOrder)
      imageInputStream.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkShapeOrdered(chunkShape), typedStorage)
    }.get)
}

// In no-partial-copy shortcut, the MultiArray shape is never used, so it is just set to flat.
// type is always BYTE
class ShortcutChunkTyper(val header: DatasetHeader) extends ChunkTyper {
  val ma2DataType: MADataType = MADataType.BYTE

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): Box[MultiArray] = tryo {
    val flatShape = Array(bytes.length)
    MultiArray.factory(ma2DataType, flatShape, bytes)
  }

  override def createFromFillValue(chunkShape: Array[Int]): Box[MultiArray] = {
    val flatShape = Array(chunkShape.product * header.bytesPerElement)
    MultiArrayUtils.createFilledArray(ma2DataType, flatShape, header.fillValueNumber)
  }
}
