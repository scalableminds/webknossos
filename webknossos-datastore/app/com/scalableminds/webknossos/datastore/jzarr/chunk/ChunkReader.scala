package com.scalableminds.webknossos.datastore.jzarr.chunk

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, IOException}

import com.scalableminds.webknossos.datastore.jzarr.storage.Store
import com.scalableminds.webknossos.datastore.jzarr.ucarutils.NetCDF_Util
import com.scalableminds.webknossos.datastore.jzarr.{ZarrDataType, ZarrHeader}
import javax.imageio.stream.MemoryCacheImageInputStream
import ucar.ma2.{Array => Ma2Array, DataType => Ma2DataType}

import scala.util.Using

object ChunkReader {
  def create(store: Store, header: ZarrHeader): ChunkReader =
    header.dataType match {
      case ZarrDataType.i1 | ZarrDataType.u1 => new ByteChunkReader(store, header)
      case ZarrDataType.i2 | ZarrDataType.u2 => new ShortChunkReader(store, header)
      case ZarrDataType.i4 | ZarrDataType.u4 => new IntChunkReader(store, header)
      case ZarrDataType.i8                   => new LongChunkReader(store, header)
      case ZarrDataType.f4                   => new FloatChunkReader(store, header)
      case ZarrDataType.f8                   => new DoubleChunkReader(store, header)
    }
}

trait ChunkReader {
  val header: ZarrHeader
  val store: Store
  lazy val chunkSize: Int = header.chunks.toList.product

  @throws[IOException]
  def read(path: String): Ma2Array

  protected def readBytes(path: String): Option[Array[Byte]] =
    Using.Manager { use =>
      val is = use(store.getInputStream(path))
      if (is == null) return None
      val os = use(new ByteArrayOutputStream())
      header.compressorImpl.uncompress(is, os)
      Some(os.toByteArray)
    }.get

  def createFilled(dataType: Ma2DataType): Ma2Array =
    NetCDF_Util.createFilledArray(dataType, header.chunks, header.fillValueNumber)
}

class ByteChunkReader(val store: Store, val header: ZarrHeader) extends ChunkReader {
  val ma2DataType: Ma2DataType = Ma2DataType.BYTE

  override def read(path: String): Ma2Array =
    readBytes(path).map { bytes =>
      Ma2Array.factory(ma2DataType, header.chunks, bytes)
    }.getOrElse(createFilled(ma2DataType))
}

class DoubleChunkReader(val store: Store, val header: ZarrHeader) extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.DOUBLE

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Double](chunkSize)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, header.chunks, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}

class ShortChunkReader(val store: Store, val header: ZarrHeader) extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.SHORT

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Short](chunkSize)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, header.chunks, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}

class IntChunkReader(val store: Store, val header: ZarrHeader) extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.INT

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Int](chunkSize)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, header.chunks, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}

class LongChunkReader(val store: Store, val header: ZarrHeader) extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.LONG

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Long](chunkSize)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, header.chunks, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}

class FloatChunkReader(val store: Store, val header: ZarrHeader) extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.FLOAT

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Float](chunkSize)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(header.byteOrder)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, header.chunks, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}
