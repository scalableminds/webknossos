package com.scalableminds.webknossos.datastore.datareaders.jzarr

import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  CompressionOption,
  Compressor,
  NullCompressor,
  StringCompressionOption,
  ZlibCompressor
}

object CompressorFactoryZarr {
  val nullCompressor = new NullCompressor

  def create(properties: Map[String, CompressionOption]): Compressor =
    properties("id") match {
      case StringCompressionOption(id) => create(id, properties)
      case _                           => throw new IllegalArgumentException("Compressor id must be string")
    }

  def create(id: String, properties: Map[String, CompressionOption]): Compressor =
    id match {
      case "null"  => nullCompressor
      case "zlib"  => new ZlibCompressor(properties)
      case "blosc" => new BloscCompressor(properties)
      case _       => throw new IllegalArgumentException("Compressor id:'" + id + "' not supported.")
    }
}
