package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  BoolCompressionSetting,
  CompressionSetting,
  Compressor,
  GzipCompressor,
  NullCompressor,
  StringCompressionSetting,
  ZlibCompressor,
  ZstdCompressor,
  IntCompressionSetting
}

object N5CompressorFactory {
  val nullCompressor = new NullCompressor

  def create(properties: Map[String, CompressionSetting]): Compressor =
    properties("type") match {
      case StringCompressionSetting(id) => create(id, properties)
      case _                            => throw new IllegalArgumentException("N5 compressor id must be string")
    }

  def create(id: String, properties: Map[String, CompressionSetting]): Compressor =
    id match {
      case "raw" | "null" => nullCompressor
      case "zlib"         => new ZlibCompressor(properties)
      case "gzip" if properties.getOrElse("useZlib", BoolCompressionSetting(false)) == BoolCompressionSetting(true) =>
        new ZlibCompressor(properties)
      case "gzip"  => new GzipCompressor(properties)
      case "blosc" => new BloscCompressor(properties)
      case "zstd"  =>
        val level = properties.get("level") match {
          case Some(IntCompressionSetting(l)) => l
          case _                              => throw new IllegalArgumentException("Zstd level must be int")
        }
        new ZstdCompressor(level, checksum = false)
      case _ => throw new IllegalArgumentException(s"N5 compressor with id: “$id” not supported.")
    }
}
