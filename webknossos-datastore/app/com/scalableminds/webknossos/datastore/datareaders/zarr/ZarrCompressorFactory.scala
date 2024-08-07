package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  CompressionSetting,
  Compressor,
  IntCompressionSetting,
  NullCompressor,
  StringCompressionSetting,
  ZlibCompressor,
  ZstdCompressor
}

object ZarrCompressorFactory {
  val nullCompressor = new NullCompressor

  def create(properties: Map[String, CompressionSetting]): Compressor =
    properties("id") match {
      case StringCompressionSetting(id) => create(id, properties)
      case _                            => throw new IllegalArgumentException("Compressor id must be string")
    }

  def create(id: String, properties: Map[String, CompressionSetting]): Compressor =
    id match {
      case "null"  => nullCompressor
      case "zlib"  => new ZlibCompressor(properties)
      case "blosc" => new BloscCompressor(properties)
      case "zstd" => {
        val level = properties.get("level") match {
          case Some(IntCompressionSetting(l)) => l
          case _                              => throw new IllegalArgumentException("Zstd level must be int")
        }
        new ZstdCompressor(level, checksum = false)
      }
      case _ => throw new IllegalArgumentException("Compressor id:'" + id + "' not supported.")
    }
}
