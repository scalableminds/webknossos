package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.precomputed.compressedsegmentation.CompressedSegmentation64
import com.scalableminds.webknossos.datastore.datareaders.{
  ChainedCompressor,
  CompressedSegmentationCompressor,
  Compressor,
  GzipCompressor,
  JpegCompressor,
  NullCompressor
}

object PrecomputedCompressorFactory {
  private val nullCompressor = new NullCompressor

  def create(header: PrecomputedScaleHeader): Compressor = {

    val shardingCompression = header.precomputedScale.sharding match {
      case Some(shardingSpecification: ShardingSpecification) =>
        // If the dataset is sharded, the sharding may have another compression
        getCompressorForShardingChunks(shardingSpecification.data_encoding)
      case None => nullCompressor
    }
    val chunkCompression = getCompressorForEncoding(header)

    new ChainedCompressor(Seq(chunkCompression, shardingCompression))

  }

  private def getCompressorForEncoding(header: PrecomputedScaleHeader) =
    header.precomputedScale.encoding.toLowerCase match {
      case "raw"  => nullCompressor
      case "jpeg" => new JpegCompressor
      case "compressed_segmentation" =>
        new CompressedSegmentationCompressor(
          header.resolvedDataType,
          header.chunkShape,
          header.precomputedScale.compressed_segmentation_block_size
            .getOrElse(CompressedSegmentation64.defaultBlockSize)
        )
      case _ =>
        throw new IllegalArgumentException(s"Chunk encoding '${header.precomputedScale.encoding}' not supported.")
    }

  private def getCompressorForShardingChunks(encoding: String) =
    encoding match {
      case "raw"  => nullCompressor
      case "gzip" => new GzipCompressor(Map())
      case _      => throw new IllegalArgumentException(s"Chunk encoding '$encoding' not supported.")
    }

}
