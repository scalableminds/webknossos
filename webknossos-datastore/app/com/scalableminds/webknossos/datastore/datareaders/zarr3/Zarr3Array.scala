package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.{
  AxisOrder,
  ChunkReader,
  ChunkUtils,
  DatasetArray,
  DatasetPath
}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}

import java.io.IOException
import java.nio.charset.StandardCharsets
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

object Zarr3Array extends LazyLogging {
  @throws[IOException]
  def open(path: VaultPath, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int]): Zarr3Array = {
    val rootPath = new DatasetPath("")
    val headerPath = rootPath.resolve(Zarr3ArrayHeader.ZARR_JSON)
    val headerBytes = (path / headerPath.storeKey).readBytes()
    if (headerBytes.isEmpty)
      throw new IOException("'" + Zarr3ArrayHeader.ZARR_JSON + "' expected but is not readable or missing in store.")
    val headerString = new String(headerBytes.get, StandardCharsets.UTF_8)
    val header: Zarr3ArrayHeader =
      Json.parse(headerString).validate[Zarr3ArrayHeader] match {
        case JsSuccess(parsedHeader, _) =>
          parsedHeader
        case errors: JsError =>
          throw new Exception("Validating json as zarr v3 header failed: " + JsError.toJson(errors).toString())
      }
    new Zarr3Array(rootPath, path, header, axisOrderOpt.getOrElse(AxisOrder.asCxyzFromRank(header.rank)), channelIndex)
  }

}

class Zarr3Array(relativePath: DatasetPath,
                 vaultPath: VaultPath,
                 header: Zarr3ArrayHeader,
                 axisOrder: AxisOrder,
                 channelIndex: Option[Int])
    extends DatasetArray(relativePath, vaultPath, header, axisOrder, channelIndex)
    with LazyLogging {

  override protected def getChunkFilename(chunkIndex: Array[Int]): String =
    s"c${header.dimension_separator.toString}${super.getChunkFilename(chunkIndex)}"

  lazy val (shardingCodec: Option[ShardingCodec], codecs: Seq[Codec]) = initializeCodecs(header.codecs)

  private def initializeCodecs(codecSpecs: Seq[CodecConfiguration]): (Option[ShardingCodec], Seq[Codec]) = {
    val outerCodecs = codecSpecs.map {
      case EndianCodecConfiguration(endian)   => new EndianCodec(endian)
      case TransposeCodecConfiguration(order) => new TransposeCodec(order)
      case BloscCodecConfiguration(cname, clevel, shuffle, typesize, blocksize) =>
        new BloscCodec(cname, clevel, shuffle, typesize, blocksize)
      case GzipCodecConfiguration(level)                   => new GzipCodec(level)
      case ShardingCodecConfiguration(chunk_shape, codecs) => new ShardingCodec(chunk_shape, codecs)
    }
    val shardingCodecOpt: Option[ShardingCodec] = outerCodecs.flatMap {
      case codec: ShardingCodec => Some(codec)
      case _                    => None
    }.headOption

    shardingCodecOpt match {
      case Some(shardingCodec: ShardingCodec) =>
        (Some(shardingCodec), initializeCodecs(shardingCodec.codecs)._2)
      case None => (None, outerCodecs)
    }
  }

  override protected val chunkReader: ChunkReader =
    Zarr3ChunkReader.create(vaultPath, header, this)

  private val shardIndexCache: AlfuFoxCache[VaultPath, Array[Byte]] =
    AlfuFoxCache()

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

  private def readShardIndex(shardPath: VaultPath) = shardPath.readLastBytes(getShardIndexSize)

  private def parseShardIndex(index: Array[Byte]): Seq[(Long, Long)] = {
    val checksum = index.takeRight(4) // not checked for now
    val indexProper = index.dropRight(4)
    indexProper
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
