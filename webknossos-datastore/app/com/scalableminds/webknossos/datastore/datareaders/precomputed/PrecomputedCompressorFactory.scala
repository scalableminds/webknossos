package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedDataType.PrecomputedDataType
import com.scalableminds.webknossos.datastore.datareaders.precomputed.compressedsegmentation.CompressedSegmentation64
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
             compressedSegmentationBlockSize: Option[Vec3Int]): Compressor =
    encoding.toLowerCase match {
      case "raw"  => nullCompressor
      case "jpeg" => new JpegCompressor
      case "compressed_segmentation" =>
        new CompressedSegmentationCompressor(
          dataType,
          chunkSize,
          compressedSegmentationBlockSize.getOrElse(CompressedSegmentation64.defaultBlockSize))
      case _ => throw new IllegalArgumentException(s"Chunk encoding '$encoding' not supported.")
    }

}
