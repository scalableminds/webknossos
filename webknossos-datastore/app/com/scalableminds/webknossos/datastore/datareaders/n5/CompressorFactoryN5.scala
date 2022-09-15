package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.webknossos.datastore.datareaders.{
  BoolCompressionOption,
  CompressionOption,
  Compressor,
  GzipCompressor,
  NullCompressor,
  StringCompressionOption,
  ZlibCompressor
}

object CompressorFactoryN5 {
  val nullCompressor = new NullCompressor

  def create(properties: Map[String, CompressionOption]): Compressor =
    properties("type") match {
      case StringCompressionOption(id) => create(id, properties)
      case _                           => throw new IllegalArgumentException("Compressor id must be string")
    }

  def create(id: String, properties: Map[String, CompressionOption]): Compressor =
    id match {
      case "null" => nullCompressor
      case "zlib" => new ZlibCompressor(properties)
      case "gzip" if properties.getOrElse("useZlib", BoolCompressionOption(false)) == BoolCompressionOption(true) =>
        new ZlibCompressor(properties)
      case "gzip" => new GzipCompressor(properties)
      case _      => throw new IllegalArgumentException("Compressor id:'" + id + "' not supported.")
    }
}
