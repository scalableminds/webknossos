package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.cache.AlfuCache
import ucar.ma2.{Array => MultiArray}
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkReader, ChunkUtils, DatasetArray}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Fox.box2Fox

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

object Zarr3Array extends LazyLogging {

  def open(path: VaultPath,
           dataSourceId: DataSourceId,
           layerName: String,
           axisOrderOpt: Option[AxisOrder],
           channelIndex: Option[Int],
           sharedChunkContentsCache: AlfuCache[String, MultiArray])(implicit ec: ExecutionContext): Fox[Zarr3Array] =
    for {
      headerBytes <- (path / Zarr3ArrayHeader.ZARR_JSON)
        .readBytes() ?~> s"Could not read header at ${Zarr3ArrayHeader.ZARR_JSON}"
      header <- JsonHelper.parseAndValidateJson[Zarr3ArrayHeader](headerBytes) ?~> "Could not parse array header"
    } yield
      new Zarr3Array(path,
                     dataSourceId,
                     layerName,
                     header,
                     axisOrderOpt.getOrElse(AxisOrder.asCxyzFromRank(header.rank)),
                     channelIndex,
                     sharedChunkContentsCache)
}

class Zarr3Array(vaultPath: VaultPath,
                 dataSourceId: DataSourceId,
                 layerName: String,
                 header: Zarr3ArrayHeader,
                 axisOrder: AxisOrder,
                 channelIndex: Option[Int],
                 sharedChunkContentsCache: AlfuCache[String, MultiArray])
    extends DatasetArray(vaultPath, dataSourceId, layerName, header, axisOrder, channelIndex, sharedChunkContentsCache)
    with LazyLogging {

  override protected def getChunkFilename(chunkIndex: Array[Int]): String =
    s"c${header.dimension_separator.toString}${super.getChunkFilename(chunkIndex)}"

  lazy val (shardingCodec: Option[ShardingCodec], codecs: Seq[Codec], indexCodecs: Seq[Codec]) = initializeCodecs(
    header.codecs)

  private def initializeCodecs(codecSpecs: Seq[CodecConfiguration]): (Option[ShardingCodec], Seq[Codec], Seq[Codec]) = {
    val outerCodecs = codecSpecs.map {
      case EndianCodecConfiguration(endian)   => new EndianCodec(endian)
      case TransposeCodecConfiguration(order) => new TransposeCodec(order)
      case BloscCodecConfiguration(cname, clevel, shuffle, typesize, blocksize) =>
        new BloscCodec(cname, clevel, shuffle, typesize, blocksize)
      case GzipCodecConfiguration(level) => new GzipCodec(level)
      case Crc32CodecConfiguration       => new Crc32Codec
      case ShardingCodecConfiguration(chunk_shape, codecs, index_codecs) =>
        new ShardingCodec(chunk_shape, codecs, index_codecs)
    }
    val shardingCodecOpt: Option[ShardingCodec] = outerCodecs.flatMap {
      case codec: ShardingCodec => Some(codec)
      case _                    => None
    }.headOption

    shardingCodecOpt match {
      case Some(shardingCodec: ShardingCodec) =>
        (Some(shardingCodec),
         initializeCodecs(shardingCodec.codecs)._2,
         initializeCodecs(shardingCodec.index_codecs)._2)
      case None => (None, outerCodecs, Seq())
    }
  }

  override protected lazy val chunkReader: ChunkReader =
    new Zarr3ChunkReader(header, this)

  private val shardIndexCache: AlfuCache[VaultPath, Array[Byte]] =
    AlfuCache()

  private def shardShape =
    header.outerChunkSize // Only valid for one hierarchy of sharding codecs, describes total voxel size of a shard
  private def innerChunkShape =
    header.chunkSize // Describes voxel size of a real chunk, that is a chunk that is stored in a shard
  private def indexShape =
    (shardShape, innerChunkShape).zipped.map(_ / _) // Describes how many chunks are in a shard, i.e. in the index

  private lazy val chunksPerShard = indexShape.product
  private def shardIndexEntryLength = 16

  private def checkSumLength = 4 // 32-bit checksum
  private def getShardIndexSize = shardIndexEntryLength * chunksPerShard + checkSumLength

  private def getChunkIndexInShardIndex(chunkIndex: Array[Int], shardCoordinates: Array[Int]) = {
    val shardOffset = (shardCoordinates, indexShape).zipped.map(_ * _)
    indexShape.tails.toList
      .dropRight(1)
      .zipWithIndex
      .map { case (shape, i) => shape.tail.product * (chunkIndex(i) - shardOffset(i)) }
      .sum
  }

  private def readShardIndex(shardPath: VaultPath)(implicit ec: ExecutionContext) =
    shardPath.readLastBytes(getShardIndexSize)

  private def parseShardIndex(index: Array[Byte]): Seq[(Long, Long)] = {
    val decodedIndex = shardingCodec match {
      case Some(shardingCodec: ShardingCodec) =>
        indexCodecs.foldRight(index)((c, bytes) =>
          c match {
            case codec: BytesToBytesCodec => codec.decode(bytes)
            case _                        => bytes
        })
      case None => ???
    }
    decodedIndex
      .grouped(shardIndexEntryLength)
      .map((bytes: Array[Byte]) => {
        // BigInt constructor is big endian, sharding index stores values little endian, thus reverse is used.
        (BigInt(bytes.take(8).reverse).toLong, BigInt(bytes.slice(8, 16).reverse).toLong)
      })
      .toSeq
  }

  private def chunkIndexToShardIndex(chunkIndex: Array[Int]) =
    ChunkUtils.computeChunkIndices(
      axisOrder.permuteIndicesReverse(header.datasetShape),
      axisOrder.permuteIndicesReverse(header.outerChunkSize),
      header.chunkSize,
      (chunkIndex, header.chunkSize).zipped.map(_ * _)
    )

  override protected def getShardedChunkPathAndRange(chunkIndex: Array[Int])(
      implicit ec: ExecutionContext): Fox[(VaultPath, NumericRange[Long])] =
    for {
      shardCoordinates <- Fox.option2Fox(chunkIndexToShardIndex(chunkIndex).headOption)
      shardFilename = getChunkFilename(shardCoordinates)
      shardPath = vaultPath / shardFilename
      shardIndex <- shardIndexCache.getOrLoad(shardPath, readShardIndex)
      chunkIndexInShardIndex = getChunkIndexInShardIndex(chunkIndex, shardCoordinates)
      (chunkOffset, chunkLength) = parseShardIndex(shardIndex)(chunkIndexInShardIndex)
      _ <- Fox.bool2Fox(!(chunkOffset == -1 && chunkLength == -1)) ~> Fox.empty // -1 signifies empty/missing chunk
      range = Range.Long(chunkOffset, chunkOffset + chunkLength, 1)
    } yield (shardPath, range)
}
