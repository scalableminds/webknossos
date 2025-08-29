package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.bloscjava.Blosc
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.ZipIO.GZIPOutputStream
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.precomputed.compressedsegmentation.{
  CompressedSegmentation32,
  CompressedSegmentation64
}
import org.apache.commons.compress.compressors.lz4.{BlockLZ4CompressorInputStream, BlockLZ4CompressorOutputStream}
import org.apache.commons.compress.compressors.zstandard.{ZstdCompressorInputStream, ZstdCompressorOutputStream}
import play.api.libs.json.{Format, JsResult, JsValue, Json}

import java.awt.image.{BufferedImage, DataBufferByte}
import java.io._
import java.util.zip._
import javax.imageio.ImageIO
import javax.imageio.ImageIO.createImageInputStream
import javax.imageio.stream.ImageInputStream

sealed trait CompressionSetting
final case class StringCompressionSetting(x: String) extends CompressionSetting
final case class IntCompressionSetting(x: Int) extends CompressionSetting
final case class BoolCompressionSetting(x: Boolean) extends CompressionSetting

object CompressionSetting {
  implicit object CompressionSettingFormat extends Format[CompressionSetting] {

    override def reads(json: JsValue): JsResult[CompressionSetting] =
      json
        .validate[String]
        .map(StringCompressionSetting)
        .orElse(json.validate[Int].map(IntCompressionSetting))
        .orElse(json.validate[Boolean].map(BoolCompressionSetting))

    override def writes(compressionSetting: CompressionSetting): JsValue =
      compressionSetting match {
        case StringCompressionSetting(x) => Json.toJson(x)
        case IntCompressionSetting(x)    => Json.toJson(x)
        case BoolCompressionSetting(x)   => Json.toJson(x)
      }
  }
}

abstract class Compressor {

  def getId: String

  override def toString: String = getId

  @throws[IOException]
  def compress(input: Array[Byte]): Array[Byte]

  @throws[IOException]
  def decompress(input: Array[Byte]): Array[Byte]

  @throws[IOException]
  protected def passThrough(is: InputStream, os: OutputStream): Unit = {
    val bytes = new Array[Byte](4096)
    var read = is.read(bytes)
    while ({
      read >= 0
    }) {
      if (read > 0)
        os.write(bytes, 0, read)
      read = is.read(bytes)
    }
  }

}

class NullCompressor extends Compressor {
  override def getId: String = "NullCompressor"

  @throws[IOException]
  override def compress(input: Array[Byte]): Array[Byte] = input

  @throws[IOException]
  override def decompress(input: Array[Byte]): Array[Byte] = input
}

class Lz4Compressor extends Compressor {
  override def getId: String = "LZ4Compressor"

  override def compress(input: Array[Byte]): Array[Byte] = {
    val is = new BufferedInputStream(new ByteArrayInputStream(input));
    val os = new ByteArrayOutputStream()
    val cos = new BlockLZ4CompressorOutputStream(os)
    try passThrough(is, cos)
    finally if (cos != null) cos.close()
    os.toByteArray
  }

  override def decompress(input: Array[Byte]): Array[Byte] = {
    val is = new BufferedInputStream(new ByteArrayInputStream(input));
    val os = new ByteArrayOutputStream()
    val cis = new BlockLZ4CompressorInputStream(is)
    try passThrough(cis, os)
    finally if (cis != null) cis.close()
    os.toByteArray
  }

}

class ZlibCompressor(val properties: Map[String, CompressionSetting]) extends Compressor {
  val level: Int = properties.get("level") match {
    case None                                        => 1 //default value
    case Some(IntCompressionSetting(levelInt))       => validateLevel(levelInt)
    case Some(StringCompressionSetting(levelString)) => validateLevel(levelString.toInt)
    case _                                           => throw new IllegalArgumentException("Invalid compression level: " + level)
  }

  override def toString: String = "compressor=" + getId + "/level=" + level

  private def validateLevel(level: Int): Int = { // see new Deflater().setLevel(level);
    if (level < 0 || level > 9)
      throw new IllegalArgumentException("Invalid compression level: " + level)
    level
  }

  override def getId = "zlib"

  @throws[IOException]
  override def compress(input: Array[Byte]): Array[Byte] = {
    val is = new ByteArrayInputStream(input)
    val os = new ByteArrayOutputStream()
    val dos = new DeflaterOutputStream(os, new Deflater(level))
    try passThrough(is, dos)
    finally if (dos != null) dos.close()
    os.toByteArray
  }

  @throws[IOException]
  override def decompress(input: Array[Byte]): Array[Byte] = {
    val is = new ByteArrayInputStream(input)
    val os = new ByteArrayOutputStream()
    val iis = new InflaterInputStream(is, new Inflater)
    try passThrough(iis, os)
    finally if (iis != null) iis.close()
    os.toByteArray
  }
}

class GzipCompressor(val properties: Map[String, CompressionSetting]) extends Compressor {
  val level: Int = properties.get("level") match {
    case None                                        => 1 //default value
    case Some(IntCompressionSetting(levelInt))       => validateLevel(levelInt)
    case Some(StringCompressionSetting(levelString)) => validateLevel(levelString.toInt)
    case _                                           => throw new IllegalArgumentException("Invalid compression level: " + level)
  }

  override def toString: String = "compressor=" + getId + "/level=" + level

  private def validateLevel(level: Int): Int = { // see new Deflater().setLevel(level);
    if (level != -1 && (level < 0 || level > 9))
      throw new IllegalArgumentException("Invalid compression level: " + level)
    level
  }

  override def getId = "gzip"

  @throws[IOException]
  override def compress(input: Array[Byte]): Array[Byte] = {
    val is = new ByteArrayInputStream(input)
    val os = new ByteArrayOutputStream()

    val dos = new GZIPOutputStream(os, level)
    try passThrough(is, dos)
    finally if (dos != null) dos.close()
    os.toByteArray
  }

  @throws[IOException]
  override def decompress(input: Array[Byte]): Array[Byte] = {
    val is = new ByteArrayInputStream(input)
    val os = new ByteArrayOutputStream()
    val iis = new GZIPInputStream(is)
    try passThrough(iis, os)
    finally if (iis != null) iis.close()
    os.toByteArray
  }
}

object BloscCompressor {
  val keyCname = "cname"
  val defaultCname = Blosc.Compressor.LZ4
  val keyClevel = "clevel"
  val defaultCLevel = 5
  val keyShuffle = "shuffle"
  val defaultShuffle = Blosc.Shuffle.BYTE_SHUFFLE
  val keyBlocksize = "blocksize"
  val defaultBlocksize = 0
  val supportedCnames: List[String] = Blosc.Compressor.values().map(_.getValue).toList
  val keyTypesize = "typesize"
  val defaultTypesize = 1
}

class BloscCompressor(val properties: Map[String, CompressionSetting]) extends Compressor {
  val cname: Blosc.Compressor = properties.get(BloscCompressor.keyCname) match {
    case None                                        => BloscCompressor.defaultCname
    case Some(StringCompressionSetting(cnameString)) => validateCname(cnameString)
    case _                                           => throw new IllegalArgumentException("Blosc cname must be string")
  }

  private def validateCname(cname: String): Blosc.Compressor = {
    val validatedCname = Blosc.Compressor.fromString(cname)
    if (validatedCname == null)
      throw new IllegalArgumentException(
        "blosc: compressor not supported: '" + cname + "'; expected one of " +
          BloscCompressor.supportedCnames.mkString(","))
    validatedCname
  }

  val clevel: Int = properties.get(BloscCompressor.keyClevel) match {
    case None                                         => BloscCompressor.defaultCLevel
    case Some(StringCompressionSetting(clevelString)) => validateClevel(clevelString.toInt)
    case Some(IntCompressionSetting(clevelInt))       => validateClevel(clevelInt)
    case _                                            => throw new IllegalArgumentException("Blosc clevel must be int or string")
  }

  private def validateClevel(clevel: Int): Int = {
    if (clevel < 0 || clevel > 9)
      throw new IllegalArgumentException("blosc: clevel parameter must be between 0 and 9 but was: " + clevel)
    clevel
  }

  val shuffle: Blosc.Shuffle = properties.get(BloscCompressor.keyShuffle) match {
    case None                                          => BloscCompressor.defaultShuffle
    case Some(StringCompressionSetting(shuffleString)) => validateShuffleStr(shuffleString)
    case Some(IntCompressionSetting(shuffleInt))       => validateShuffleInt(shuffleInt)
    case _                                             => throw new IllegalArgumentException("Blosc shuffle must be int or string")
  }

  private def validateShuffleStr(shuffle: String): Blosc.Shuffle = {
    val supportedShuffleNames =
      List("noshuffle", "shuffle", "bitshuffle")

    val validatedShuffle = Blosc.Shuffle.fromString(shuffle)
    if (validatedShuffle == null)
      throw new IllegalArgumentException(
        f"blosc: shuffle type '$shuffle' not supported. Expected one of ${supportedShuffleNames.mkString(",")}")
    validatedShuffle
  }

  private def validateShuffleInt(shuffle: Int): Blosc.Shuffle = {
    val supportedShuffleNames =
      List("-1 (AUTOSHUFFLE)", " 0 (NOSHUFFLE)", "1 (BYTESHUFFLE)", "2 (BITSHUFFLE)")

    val newShuffle = if (shuffle == -1) {
      if (typesize == 1)
        2
      else
        1
    } else shuffle

    val validatedShuffle = Blosc.Shuffle.fromInt(newShuffle)
    if (validatedShuffle == null)
      throw new IllegalArgumentException(
        f"blosc: shuffle type '$shuffle' not supported. Expected one of ${supportedShuffleNames.mkString(",")}")
    validatedShuffle
  }

  val blocksize: Int = properties.get(BloscCompressor.keyBlocksize) match {
    case None                                            => BloscCompressor.defaultBlocksize
    case Some(StringCompressionSetting(blockSizeString)) => blockSizeString.toInt
    case Some(IntCompressionSetting(blockSizeInt))       => blockSizeInt
    case _                                               => throw new IllegalArgumentException("Blosc blocksize must be int or string")
  }

  val typesize: Int = properties.get(BloscCompressor.keyTypesize) match {
    case None                                           => BloscCompressor.defaultTypesize
    case Some(StringCompressionSetting(typeSizeString)) => typeSizeString.toInt
    case Some(IntCompressionSetting(typeSizeInt))       => typeSizeInt
    case _                                              => throw new IllegalArgumentException("Blosc typesize must be int or string")
  }

  override def getId = "blosc"

  override def toString: String =
    "compressor=" + getId + "/cname=" + cname + "/clevel=" + clevel.toString + "/blocksize=" + blocksize + "/shuffle=" + shuffle + "/typesize=" + typesize

  @throws[IOException]
  override def compress(input: Array[Byte]): Array[Byte] =
    Blosc.compress(input, typesize, cname, clevel, shuffle, blocksize, 1)

  @throws[IOException]
  override def decompress(input: Array[Byte]): Array[Byte] =
    Blosc.decompress(input, 1)

}

class JpegCompressor() extends Compressor {

  override def getId = "jpeg"

  override def toString: String = getId

  @throws[IOException]
  override def compress(input: Array[Byte]): Array[Byte] = ???

  @throws[IOException]
  override def decompress(input: Array[Byte]): Array[Byte] = {
    val is = new ByteArrayInputStream(input)
    val iis: ImageInputStream = createImageInputStream(is)
    val bi: BufferedImage = ImageIO.read(iis: ImageInputStream)
    val raster = bi.getRaster
    val dbb: DataBufferByte = raster.getDataBuffer.asInstanceOf[DataBufferByte]
    val width = raster.getWidth
    val data = dbb.getData.grouped(width).toList
    data.flatten.toArray
  }
}

class CompressedSegmentationCompressor(dataType: ArrayDataType, volumeSize: Array[Int], blockSize: Vec3Int)
    extends Compressor {
  override def getId: String = "compressedsegmentation"

  override def toString: String = s"compressor=$getId/dataType=${dataType.toString}"

  override def decompress(input: Array[Byte]): Array[Byte] =
    dataType match {
      case ArrayDataType.u4 =>
        CompressedSegmentation32.decompress(input, volumeSize, blockSize)
      case ArrayDataType.u8 =>
        CompressedSegmentation64.decompress(input, volumeSize, blockSize)
      case _ =>
        throw new UnsupportedOperationException("Can not use compressed segmentation for datatypes other than u4, u8.")
    }

  override def compress(input: Array[Byte]): Array[Byte] = ???
}

class ZstdCompressor(level: Int, checksum: Boolean) extends Compressor {
  override def getId: String = "zstd"

  override def toString: String = s"compressor=$getId/level=$level/checksum=$checksum"

  override def compress(input: Array[Byte]): Array[Byte] = {
    val is = new ByteArrayInputStream(input)
    val os = new ByteArrayOutputStream()
    val zstd = ZstdCompressorOutputStream.builder
      .setOutputStream(os)
      .setLevel(level)
      .setCloseFrameOnFlush(true)
      .setChecksum(checksum)
      .get()
    try passThrough(is, zstd)
    finally if (zstd != null) zstd.close()
    os.toByteArray
  }

  override def decompress(input: Array[Byte]): Array[Byte] = {
    val is = new ByteArrayInputStream(input)
    val os = new ByteArrayOutputStream()
    val zstd = new ZstdCompressorInputStream(is)
    try passThrough(zstd, os)
    finally if (zstd != null) zstd.close()
    os.toByteArray
  }
}

class ChainedCompressor(compressors: Seq[Compressor]) extends Compressor {
  override def getId: String = "chainedcompressor"

  override def toString: String = s"compressor=$getId${compressors.map(_.toString).mkString("/nextCompressor->")}"

  override def compress(input: Array[Byte]): Array[Byte] =
    compressors.foldLeft(input)((bytes, c) => c.compress(bytes))

  override def decompress(input: Array[Byte]): Array[Byte] =
    compressors.foldRight(input)((c, bytes) => c.decompress(bytes))

}
