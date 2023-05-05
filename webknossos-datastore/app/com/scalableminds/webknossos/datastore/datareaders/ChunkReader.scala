package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import ucar.ma2.{Array => MultiArray, DataType => MADataType}

import java.io.ByteArrayInputStream
import javax.imageio.stream.MemoryCacheImageInputStream
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext
import scala.util.Using

object ChunkReader {
  def create(vaultPath: VaultPath, header: DatasetHeader): ChunkReader =
    new ChunkReader(header, vaultPath, createChunkTyper(header))

  def createChunkTyper(header: DatasetHeader): ChunkTyper =
    header.resolvedDataType match {
      case ArrayDataType.i1 | ArrayDataType.u1 => new ByteChunkTyper(header)
      case ArrayDataType.i2 | ArrayDataType.u2 => new ShortChunkTyper(header)
      case ArrayDataType.i4 | ArrayDataType.u4 => new IntChunkTyper(header)
      case ArrayDataType.i8 | ArrayDataType.u8 => new LongChunkTyper(header)
      case ArrayDataType.f4                    => new FloatChunkTyper(header)
      case ArrayDataType.f8                    => new DoubleChunkTyper(header)
    }
}

class ChunkReader(val header: DatasetHeader, val vaultPath: VaultPath, val chunkTyper: ChunkTyper) {
  lazy val chunkSize: Int = header.chunkSize.toList.product

  def read(path: String, chunkShapeFromMetadata: Array[Int], range: Option[NumericRange[Long]])(
      implicit ec: ExecutionContext): Fox[MultiArray] =
    for {
      chunkBytesAndShapeBox: Box[(Array[Byte], Option[Array[Int]])] <- readChunkBytesAndShape(path, range).futureBox
      chunkShape: Array[Int] = chunkBytesAndShapeBox.toOption.flatMap(_._2).getOrElse(chunkShapeFromMetadata)
      typed <- chunkBytesAndShapeBox.map(_._1) match {
        case Full(chunkBytes) =>
          Fox.successful(chunkTyper.wrapAndType(chunkBytes, chunkShape))
        case Empty =>
          Fox.successful(chunkTyper.createFromFillValue(chunkShape))
        case f: Failure =>
          f.toFox ?~> s"Reading chunk at $path failed"
      }
    } yield typed

  // Returns bytes (optional, Fox.empty may later be replaced with fill value)
  // and chunk shape (optional, only for data formats where each chunk reports its own shape, e.g. N5)
  protected def readChunkBytesAndShape(path: String, range: Option[NumericRange[Long]])(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- (vaultPath / path).readBytes(range) match {
        case Some(bytes) => Fox.successful(bytes)
        case None        => Fox.empty
      }
      decompressed <- tryo(header.compressorImpl.decompress(bytes)).toFox ?~> "chunk.decompress.failed"
    } yield (decompressed, None)
}

abstract class ChunkTyper {
  val header: DatasetHeader

  def ma2DataType: MADataType
  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): MultiArray

  def createFromFillValue(chunkShape: Array[Int]): MultiArray =
    MultiArrayUtils.createFilledArray(ma2DataType, chunkShape, header.fillValueNumber)

  // Chunk shape in header is in C-Order (XYZ), but data may be in F-Order (ZYX), so the chunk shape
  // associated with the array needs to be adjusted for non-isotropic chunk sizes.
  def chunkSizeOrdered(chunkSize: Array[Int]): Array[Int] =
    if (header.order == ArrayOrder.F) chunkSize.reverse else chunkSize
}

class ByteChunkTyper(val header: DatasetHeader) extends ChunkTyper {
  val ma2DataType: MADataType = MADataType.BYTE

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): MultiArray =
    MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), bytes)
}

class DoubleChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.DOUBLE

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): MultiArray =
    Using.Manager { use =>
      val typedStorage = new Array[Double](chunkShape.product)
      val bais = use(new ByteArrayInputStream(bytes))
      val iis = use(new MemoryCacheImageInputStream(bais))
      iis.setByteOrder(header.byteOrder)
      iis.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
    }.get
}

class ShortChunkTyper(val header: DatasetHeader) extends ChunkTyper with LazyLogging {

  val ma2DataType: MADataType = MADataType.SHORT

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): MultiArray =
    Using.Manager { use =>
      val typedStorage = new Array[Short](chunkShape.product)
      val bais = use(new ByteArrayInputStream(bytes))
      val iis = use(new MemoryCacheImageInputStream(bais))
      iis.setByteOrder(header.byteOrder)
      iis.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
    }.get
}

class IntChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.INT

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): MultiArray =
    Using.Manager { use =>
      val typedStorage = new Array[Int](chunkShape.product)
      val bais = use(new ByteArrayInputStream(bytes))
      val iis = use(new MemoryCacheImageInputStream(bais))
      iis.setByteOrder(header.byteOrder)
      iis.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
    }.get
}

class LongChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.LONG

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): MultiArray =
    Using.Manager { use =>
      val typedStorage = new Array[Long](chunkShape.product)
      val bais = use(new ByteArrayInputStream(bytes))
      val iis = use(new MemoryCacheImageInputStream(bais))
      iis.setByteOrder(header.byteOrder)
      iis.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
    }.get

}

class FloatChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.FLOAT

  def wrapAndType(bytes: Array[Byte], chunkShape: Array[Int]): MultiArray =
    Using.Manager { use =>
      val typedStorage = new Array[Float](chunkShape.product)
      val bais = use(new ByteArrayInputStream(bytes))
      val iis = use(new MemoryCacheImageInputStream(bais))
      iis.setByteOrder(header.byteOrder)
      iis.readFully(typedStorage, 0, typedStorage.length)
      MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
    }.get
}
