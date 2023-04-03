package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import ucar.ma2.{Array => MultiArray, DataType => MADataType}

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, IOException}
import javax.imageio.stream.MemoryCacheImageInputStream
import scala.collection.immutable.NumericRange
import scala.concurrent.Future
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

  @throws[IOException]
  def read(path: String, chunkShape: Array[Int], range: Option[NumericRange[Long]]): Future[MultiArray] = {
    val chunkBytesAndShape = readChunkBytesAndShape(path, range)
    chunkTyper.wrapAndType(chunkBytesAndShape.map(_._1), chunkBytesAndShape.flatMap(_._2).getOrElse(chunkShape))
  }

  // Returns bytes (optional, None may later be replaced with fill value)
  // and chunk shape (optional, only for data formats where each chunk reports its own shape, e.g. N5)
  protected def readChunkBytesAndShape(path: String,
                                       range: Option[NumericRange[Long]]): Option[(Array[Byte], Option[Array[Int]])] =
    Using.Manager { use =>
      (vaultPath / path).readBytes(range).map { bytes =>
        val is = use(new ByteArrayInputStream(bytes))
        val os = use(new ByteArrayOutputStream())
        header.compressorImpl.uncompress(is, os)
        (os.toByteArray, None)
      }
    }.get
}

abstract class ChunkTyper {
  val header: DatasetHeader

  def ma2DataType: MADataType
  def wrapAndType(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray]

  def createFilled(dataType: MADataType, chunkShape: Array[Int]): MultiArray =
    MultiArrayUtils.createFilledArray(dataType, chunkShape, header.fillValueNumber)

  // Chunk shape in header is in C-Order (XYZ), but data may be in F-Order (ZYX), so the chunk shape
  // associated with the array needs to be adjusted for non-isotropic chunk sizes.
  def chunkSizeOrdered(chunkSize: Array[Int]): Array[Int] =
    if (header.order == ArrayOrder.F) chunkSize.reverse else chunkSize
}

class ByteChunkTyper(val header: DatasetHeader) extends ChunkTyper {
  val ma2DataType: MADataType = MADataType.BYTE

  def wrapAndType(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(bytes.map { result =>
      MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), result)
    }.getOrElse(createFilled(ma2DataType, chunkSizeOrdered(chunkShape))))
}

class DoubleChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.DOUBLE

  def wrapAndType(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Double](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkSizeOrdered(chunkShape)))
    }.get)
}

class ShortChunkTyper(val header: DatasetHeader) extends ChunkTyper with LazyLogging {

  val ma2DataType: MADataType = MADataType.SHORT

  def wrapAndType(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Short](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkSizeOrdered(chunkShape)))
    }.get)
}

class IntChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.INT

  def wrapAndType(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Int](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkSizeOrdered(chunkShape)))
    }.get)
}

class LongChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.LONG

  def wrapAndType(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Long](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkSizeOrdered(chunkShape)))
    }.get)
}

class FloatChunkTyper(val header: DatasetHeader) extends ChunkTyper {

  val ma2DataType: MADataType = MADataType.FLOAT

  def wrapAndType(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Float](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkSizeOrdered(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkSizeOrdered(chunkShape)))
    }.get)
}
