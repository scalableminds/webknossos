package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.{Compressor, JpegCompressor, NullCompressor}

object PrecomputedCompressorFactory {
  val nullCompressor = new NullCompressor

  def create(encoding: String): Compressor =
    encoding.toLowerCase match {
      case "raw"                     => nullCompressor
      case "jpeg"                    => new JpegCompressor
      case "compressed_segmentation" => throw new NotImplementedError
      case _                         => throw new IllegalArgumentException(s"Chunk encoding '$encoding' not supported.")
    }

}
