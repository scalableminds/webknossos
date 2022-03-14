package com.scalableminds.webknossos.datastore.jzarr.chunk

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, IOException}
import java.nio.ByteOrder

import com.scalableminds.webknossos.datastore.jzarr.ZarrUtils.computeSizeInteger
import com.scalableminds.webknossos.datastore.jzarr.storage.Store
import com.scalableminds.webknossos.datastore.jzarr.ucarutils.NetCDF_Util
import com.scalableminds.webknossos.datastore.jzarr.{Compressor, DataType}
import javax.imageio.stream.MemoryCacheImageInputStream
import ucar.ma2.{Array => Ma2Array, DataType => Ma2DataType}

import scala.util.Using

object ChunkReader {
  def create(compressor: Compressor,
             dataType: DataType,
             order: ByteOrder,
             chunkShape: Array[Int],
             fill: Number,
             store: Store): ChunkReader =
    if (dataType eq DataType.f8) new DoubleChunkReader(order, compressor, chunkShape, fill, store)
    else if (dataType eq DataType.f4) new FloatChunkReader(order, compressor, chunkShape, fill, store)
    else if (dataType eq DataType.i8) new LongChunkReader(order, compressor, chunkShape, fill, store)
    else if ((dataType eq DataType.i4) || (dataType eq DataType.u4))
      new IntChunkReader(order, compressor, chunkShape, fill, store)
    else if ((dataType eq DataType.i2) || (dataType eq DataType.u2))
      new ShortChunkReader(order, compressor, chunkShape, fill, store)
    else if ((dataType eq DataType.i1) || (dataType eq DataType.u1))
      new ByteChunkReader(compressor, chunkShape, fill, store)
    else throw new IllegalStateException
}

trait ChunkReader {
  val compressor: Compressor
  val chunkShape: Array[Int]
  val fill: Number
  val store: Store
  lazy val size: Int = computeSizeInteger(chunkShape)

  @throws[IOException]
  def read(path: String): Ma2Array

  protected def readBytes(path: String): Option[Array[Byte]] =
    Using.Manager { use =>
      val is = use(store.getInputStream(path))
      if (is == null) return None
      val os = use(new ByteArrayOutputStream())
      compressor.uncompress(is, os)
      Some(os.toByteArray)
    }.get

  def createFilled(dataType: Ma2DataType): Ma2Array =
    NetCDF_Util.createFilledArray(dataType, chunkShape, fill)
}

class ByteChunkReader(val compressor: Compressor, val chunkShape: Array[Int], val fill: Number, val store: Store)
    extends ChunkReader {
  val ma2DataType: Ma2DataType = Ma2DataType.BYTE

  override def read(path: String): Ma2Array =
    readBytes(path).map { bytes =>
      Ma2Array.factory(ma2DataType, chunkShape, bytes)
    }.getOrElse(createFilled(ma2DataType))
}

class DoubleChunkReader(val order: ByteOrder,
                        val compressor: Compressor,
                        val chunkShape: Array[Int],
                        val fill: Number,
                        val store: Store)
    extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.DOUBLE

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Double](size)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(order)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, chunkShape, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}

class ShortChunkReader(val order: ByteOrder,
                       val compressor: Compressor,
                       val chunkShape: Array[Int],
                       val fill: Number,
                       val store: Store)
    extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.SHORT

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Short](size)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(order)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, chunkShape, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}

class IntChunkReader(val order: ByteOrder,
                     val compressor: Compressor,
                     val chunkShape: Array[Int],
                     val fill: Number,
                     val store: Store)
    extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.INT

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Int](size)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(order)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, chunkShape, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}

class LongChunkReader(val order: ByteOrder,
                      val compressor: Compressor,
                      val chunkShape: Array[Int],
                      val fill: Number,
                      val store: Store)
    extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.LONG

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Long](size)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(order)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, chunkShape, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}

class FloatChunkReader(val order: ByteOrder,
                       val compressor: Compressor,
                       val chunkShape: Array[Int],
                       val fill: Number,
                       val store: Store)
    extends ChunkReader {

  val ma2DataType: Ma2DataType = Ma2DataType.FLOAT

  override def read(path: String): Ma2Array =
    Using.Manager { use =>
      readBytes(path).map { bytes =>
        val typedStorage = new Array[Float](size)
        val bais = use(new ByteArrayInputStream(bytes))
        val iis = use(new MemoryCacheImageInputStream(bais))
        iis.setByteOrder(order)
        iis.readFully(typedStorage, 0, typedStorage.length)
        Ma2Array.factory(ma2DataType, chunkShape, typedStorage)
      }.getOrElse(createFilled(ma2DataType))
    }.get
}
