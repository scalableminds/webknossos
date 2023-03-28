package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedDataType.PrecomputedDataType
import com.scalableminds.webknossos.datastore.datareaders.{
  CompressedSegmentationCompressor,
  Compressor,
  JpegCompressor,
  NullCompressor
}

object PrecomputedCompressorFactory {
  private val nullCompressor = new NullCompressor

  def create(encoding: String,
             dataType: PrecomputedDataType,
             chunkSize: Array[Int],
             compressedSegmentationBlockSize: Option[Array[Int]]): Compressor =
    encoding.toLowerCase match {
      case "raw"  => nullCompressor
      case "jpeg" => new JpegCompressor
      case "compressed_segmentation" =>
        new CompressedSegmentationCompressor(dataType,
                                             chunkSize,
                                             compressedSegmentationBlockSize.getOrElse(Array(8, 8, 8)))
      case _ => throw new IllegalArgumentException(s"Chunk encoding '$encoding' not supported.")
    }

}
