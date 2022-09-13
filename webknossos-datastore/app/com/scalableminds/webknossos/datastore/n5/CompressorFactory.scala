package com.scalableminds.webknossos.datastore.n5

import java.io.{DataInputStream, EOFException, IOException, InputStream, OutputStream}
import java.util.zip.{Deflater, DeflaterOutputStream, Inflater, InflaterInputStream}
import org.apache.commons.compress.compressors.gzip.{GzipCompressorInputStream, GzipCompressorOutputStream, GzipParameters}

import java.nio.ByteBuffer

abstract class Compressor {

  def getId: String

  def toString: String

  var bytesSize: Int

  @throws[IOException]
  def compress(is: InputStream, os: OutputStream)

  @throws[IOException]
  def uncompress(is: InputStream, os: OutputStream)

  @throws[IOException]
  def passThrough(is: InputStream, os: OutputStream): Unit = {
    val bytes = new Array[Byte](4096)
    var read = is.read(bytes)
    while ({ read >= 0 }) {
      if (read > 0) {
        os.write(bytes, 0, read)
      }
      read = is.read(bytes)
    }
  }

}

object CompressorFactory {
  val nullCompressor = new CompressorFactory.NullCompressor

  def create(properties: Map[String, Either[String, Int]]): Compressor =
    properties("type") match {
      case Left(id) => create(id, properties)
      case _ => throw new IllegalArgumentException("Compressor id must be string")
    }

  def create(id: String, properties: Map[String, Either[String, Int]]): Compressor =
    id match {
      case "null" => nullCompressor
      case "zlib" => new CompressorFactory.ZlibCompressor(properties)
      case "gzip" => new CompressorFactory.GzipCompressor(properties)
      case _ => throw new IllegalArgumentException("Compressor id:'" + id + "' not supported.")
    }

  class NullCompressor extends Compressor {
    override def getId: String = null

    override def toString: String = getId

    override var bytesSize: Int = 1

    @throws[IOException]
    override def compress(is: InputStream, os: OutputStream): Unit = passThrough(is, os)

    @throws[IOException]
    override def uncompress(is: InputStream, os: OutputStream): Unit = passThrough(is, os)
  }

  class ZlibCompressor(val properties: Map[String, Either[String, Int]]) extends Compressor {
    val level: Int = properties.get("level") match {
      case None => 1 //default value
      case Some(Right(levelInt)) => validateLevel(levelInt)
      case Some(Left(levelString)) => validateLevel(levelString.toInt)
      case _ => throw new IllegalArgumentException("Invalid compression level: " + level)
    }

    override var bytesSize: Int = 1

    override def toString: String = "compressor=" + getId + "/level=" + level

    private def validateLevel(level: Int): Int = { // see new Deflater().setLevel(level);
      if (level < -1 || level > 9)
        throw new IllegalArgumentException("Invalid compression level: " + level)
      level
    }

    override def getId = "zlib"

    @throws[IOException]
    override def compress(is: InputStream, os: OutputStream): Unit = {
      val dos = new DeflaterOutputStream(os, new Deflater(level))
      try passThrough(is, dos)
      finally if (dos != null) dos.close()
    }

    @throws[IOException]
    override def uncompress(is: InputStream, os: OutputStream): Unit = {
      val iis = new InflaterInputStream(is, new Inflater)
      try passThrough(iis, os)
      finally if (iis != null) iis.close()
    }
  }

  class GzipCompressor(val properties: Map[String, Either[String, Int]]) extends Compressor {
    val level: Int = properties.get("level") match {
      case None => 1 //default value
      case Some(Right(levelInt)) => validateLevel(levelInt)
      case Some(Left(levelString)) => validateLevel(levelString.toInt)
      case _ => throw new IllegalArgumentException("Invalid compression level: " + level)
    }

    override var bytesSize = 1

    override def toString: String = "compressor=" + getId + "/level=" + level

    private def validateLevel(level: Int): Int = { // see new Deflater().setLevel(level);
      if (level != -1 && (level < 0 || level > 9))
        throw new IllegalArgumentException("Invalid compression level: " + level)
      level
    }

    override def getId = "gzip"

    @throws[IOException]
    override def compress(is: InputStream, os: OutputStream): Unit = {
      val parameters = new GzipParameters
      parameters.setCompressionLevel(level)
      val dos = new GzipCompressorOutputStream(os, parameters)
      try passThrough(is, dos)
      finally if (dos != null) dos.close()
    }

    @throws[IOException]
    override def uncompress(is: InputStream, os: OutputStream): Unit = {
      val iis = new GzipCompressorInputStream(is, true)
      try passThrough(iis, os)
      finally if (iis != null) iis.close()
    }
  }
}
