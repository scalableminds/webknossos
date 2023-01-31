package com.scalableminds.webknossos.datastore.datareaders

import com.typesafe.scalalogging.LazyLogging
import ucar.ma2.{Array => MultiArray, DataType => MADataType}

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, IOException}
import javax.imageio.stream.MemoryCacheImageInputStream
import scala.concurrent.Future
import scala.util.Using

object ChunkReader {
  def create(store: FileSystemStore, header: DatasetHeader): ChunkReader =
    new ChunkReader(header, store, createTypedChunkReader(header))

  def createTypedChunkReader(header: DatasetHeader): TypedChunkReader =
    header.resolvedDataType match {
      case ArrayDataType.i1 | ArrayDataType.u1 => new ByteChunkReader(header)
      case ArrayDataType.i2 | ArrayDataType.u2 => new ShortChunkReader(header)
      case ArrayDataType.i4 | ArrayDataType.u4 => new IntChunkReader(header)
      case ArrayDataType.i8 | ArrayDataType.u8 => new LongChunkReader(header)
      case ArrayDataType.f4                    => new FloatChunkReader(header)
      case ArrayDataType.f8                    => new DoubleChunkReader(header)
    }
}

class ChunkReader(val header: DatasetHeader, val store: FileSystemStore, val typedChunkReader: TypedChunkReader) {
  lazy val chunkSize: Int = header.chunkSize.toList.product

  @throws[IOException]
  def read(path: String, chunkShape: Array[Int]): Future[MultiArray] =
    typedChunkReader.read(readBytes(path), chunkShape)

  protected def readBytes(path: String): Option[Array[Byte]] =
    Using.Manager { use =>
      store.readBytes(path).map { bytes =>
        val is = use(new ByteArrayInputStream(bytes))
        val os = use(new ByteArrayOutputStream())
        header.compressorImpl.uncompress(is, os)
        os.toByteArray
      }
    }.get
}

abstract class TypedChunkReader {
  val header: DatasetHeader

  def ma2DataType: MADataType
  def read(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray]

  def createFilled(dataType: MADataType, chunkShape: Array[Int]): MultiArray =
    MultiArrayUtils.createFilledArray(dataType, chunkShape, header.fillValueNumber)

  // Chunk shape in header is in C-Order (XYZ), but data may be in F-Order (ZYX), so the chunk shape
  // associated with the array needs to be adjusted for non-isotropic chunk sizes.
  def chunkDataShape(chunkShape: Array[Int]) = if (header.order == ArrayOrder.F) chunkShape.reverse else chunkShape
}

class ByteChunkReader(val header: DatasetHeader) extends TypedChunkReader {
  val ma2DataType: MADataType = MADataType.BYTE

  def read(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(bytes.map { result =>
      MultiArray.factory(ma2DataType, chunkDataShape(chunkShape), result)
    }.getOrElse(createFilled(ma2DataType, chunkDataShape(chunkShape))))
}

class DoubleChunkReader(val header: DatasetHeader) extends TypedChunkReader {

  val ma2DataType: MADataType = MADataType.DOUBLE

  def read(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Double](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkDataShape(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkDataShape(chunkShape)))
    }.get)
}

class ShortChunkReader(val header: DatasetHeader) extends TypedChunkReader with LazyLogging {

  val ma2DataType: MADataType = MADataType.SHORT

  def read(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Short](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkDataShape(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkDataShape(chunkShape)))
    }.get)
}

class IntChunkReader(val header: DatasetHeader) extends TypedChunkReader {

  val ma2DataType: MADataType = MADataType.INT

  def read(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Int](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkDataShape(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkDataShape(chunkShape)))
    }.get)
}

class LongChunkReader(val header: DatasetHeader) extends TypedChunkReader {

  val ma2DataType: MADataType = MADataType.LONG

  def read(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Long](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkDataShape(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkDataShape(chunkShape)))
    }.get)
}

class FloatChunkReader(val header: DatasetHeader) extends TypedChunkReader {

  val ma2DataType: MADataType = MADataType.FLOAT

  def read(bytes: Option[Array[Byte]], chunkShape: Array[Int]): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      bytes.map { result =>
        val typedStorage = new Array[Float](chunkShape.product)
        val bais = use(new ByteArrayInputStream(result))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, chunkDataShape(chunkShape), typedStorage)
      }.getOrElse(createFilled(ma2DataType, chunkDataShape(chunkShape)))
    }.get)
}
