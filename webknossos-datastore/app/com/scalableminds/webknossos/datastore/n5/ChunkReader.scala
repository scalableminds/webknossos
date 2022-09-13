package com.scalableminds.webknossos.datastore.n5

import com.scalableminds.webknossos.datastore.jzarr.{MultiArrayUtils, ZarrDataType}

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, IOException}
import com.typesafe.scalalogging.LazyLogging

import javax.imageio.stream.MemoryCacheImageInputStream
import ucar.ma2.{Array => MultiArray, DataType => MADataType}

import scala.concurrent.Future
import scala.util.Using

object ChunkReader {
  def create(store: FileSystemStore, header: N5Header): ChunkReader =
    header.resolvedDataType match {
      case ZarrDataType.i1 | ZarrDataType.u1 => new ByteChunkReader(store, header)
      case ZarrDataType.i2 | ZarrDataType.u2 => new ShortChunkReader(store, header)
      case ZarrDataType.i4 | ZarrDataType.u4 => new IntChunkReader(store, header)
      case ZarrDataType.i8 | ZarrDataType.u8 => new LongChunkReader(store, header)
      case ZarrDataType.f4                   => new FloatChunkReader(store, header)
      case ZarrDataType.f8                   => new DoubleChunkReader(store, header)
    }
}

trait ChunkReader {
  val header: N5Header
  val store: FileSystemStore
  lazy val chunkSize: Int = header.blockSize.toList.product

  @throws[IOException]
  def read(path: String): Future[MultiArray]

  protected def readBlock(path: String): Option[(N5BlockHeader, Array[Byte])] = {
    Using.Manager { use => {
      val (blockHeader, data) = store.readHeaderFromFile(path)

      data.map { bytes =>
        val is = new ByteArrayInputStream(bytes)
        val os = new ByteArrayOutputStream()
        header.compressorImpl.bytesSize = blockHeader.numElements
        header.compressorImpl.uncompress(is, os)
        val result = (blockHeader, os.toByteArray)

        val numElements = result._1.numElements
        val blockSize = result._1.blockSize

        val completeArray = if (result._2.length == numElements && numElements == blockSize.product) result._2 else {
          val fillArray = new Array[Byte](blockSize.product)
          for ((x, i) <- fillArray.zipWithIndex) {
            fillArray.update(i, 0)
          }

          for ((x, i) <- result._2.zipWithIndex) {
            fillArray.update(i, x)
          }
          fillArray
        }
        (blockHeader, completeArray)
      }
    }
    }.get
  }

  def createFilled(dataType: MADataType): MultiArray =
    MultiArrayUtils.createFilledArray(dataType, header.chunkShapeOrdered, header.fillValueNumber)
}

class ByteChunkReader(val store: FileSystemStore, val header: N5Header) extends ChunkReader {
  val ma2DataType: MADataType = MADataType.BYTE

  override def read(path: String): Future[MultiArray] =
    Future.successful(readBlock(path).map { result =>
      MultiArray.factory(ma2DataType, result._1.blockSize, result._2)
    }.getOrElse(createFilled(ma2DataType)))
}

class DoubleChunkReader(val store: FileSystemStore, val header: N5Header) extends ChunkReader {

  val ma2DataType: MADataType = MADataType.DOUBLE

  override def read(path: String): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      readBlock(path).map { result =>
        val bytes = result._2
        val blockHeader = result._1
        val typedStorage = new Array[Double](blockHeader.numElements)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, blockHeader.blockSize, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get)
}

class ShortChunkReader(val store: FileSystemStore, val header: N5Header) extends ChunkReader with LazyLogging {

  val ma2DataType: MADataType = MADataType.SHORT

  override def read(path: String): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      readBlock(path).map { result =>
        val bytes = result._2
        val blockHeader = result._1
        val typedStorage = new Array[Short](blockHeader.numElements)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, blockHeader.blockSize, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get)
}

class IntChunkReader(val store: FileSystemStore, val header: N5Header) extends ChunkReader {

  val ma2DataType: MADataType = MADataType.INT

  override def read(path: String): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      readBlock(path).map { result =>
        val bytes = result._2
        val blockHeader = result._1
        val typedStorage = new Array[Int](blockHeader.numElements)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, blockHeader.blockSize, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get)
}

class LongChunkReader(val store: FileSystemStore, val header: N5Header) extends ChunkReader {

  val ma2DataType: MADataType = MADataType.LONG

  override def read(path: String): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      readBlock(path).map { result =>
        val bytes = result._2
        val blockHeader = result._1
        val typedStorage = new Array[Long](blockHeader.numElements)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, blockHeader.blockSize, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get)
}

class FloatChunkReader(val store: FileSystemStore, val header: N5Header) extends ChunkReader {

  val ma2DataType: MADataType = MADataType.FLOAT

  override def read(path: String): Future[MultiArray] =
    Future.successful(Using.Manager { use =>
      readBlock(path).map { result =>
        val bytes = result._2
        val blockHeader = result._1
        val typedStorage = new Array[Float](blockHeader.numElements)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        MultiArray.factory(ma2DataType, blockHeader.blockSize, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get)
}
