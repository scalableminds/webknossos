package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.{Compressor, NullCompressor}

object PrecomputedCompressorFactory {
  val nullCompressor = new NullCompressor

  def create(encoding: String): Compressor =
    encoding.toLowerCase match {
      case "raw"                     => nullCompressor
      case "jpeg"                    => throw new NotImplementedError
      case "compressed_segmentation" => throw new NotImplementedError
      case _                         => throw new IllegalArgumentException(s"Chunk encoding '$encoding' not supported.")
    }

}
