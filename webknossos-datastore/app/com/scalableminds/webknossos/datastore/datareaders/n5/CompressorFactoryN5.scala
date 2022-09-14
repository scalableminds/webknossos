package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.webknossos.datastore.datareaders.{Compressor, GzipCompressor, NullCompressor, ZlibCompressor}

object CompressorFactoryN5 {
  val nullCompressor = new NullCompressor

  def create(properties: Map[String, Either[String, Int]]): Compressor =
    properties("type") match {
      case Left(id) => create(id, properties)
      case _        => throw new IllegalArgumentException("Compressor id must be string")
    }

  def create(id: String, properties: Map[String, Either[String, Int]]): Compressor =
    id match {
      case "null" => nullCompressor
      case "zlib" => new ZlibCompressor(properties)
      case "gzip" => new GzipCompressor(properties)
      case _      => throw new IllegalArgumentException("Compressor id:'" + id + "' not supported.")
    }
}
