package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkReader, DatasetArray, DatasetPath}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{JsError, JsSuccess, Json}

import java.io.IOException
import java.nio.ByteOrder
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

object PrecomputedArray extends LazyLogging {
  @throws[IOException]
  def open(magPath: VaultPath, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int])(
      implicit ec: ExecutionContext): PrecomputedArray = {

    val basePath = magPath.parent
    val headerPath = s"${PrecomputedHeader.FILENAME_INFO}"
    val headerBytes = (basePath / headerPath).readBytes()
    if (headerBytes.isEmpty)
      throw new IOException(
        "'" + PrecomputedHeader.FILENAME_INFO + "' expected but is not readable or missing in store.")
    val headerString = new String(headerBytes.get, StandardCharsets.UTF_8)
    val rootHeader: PrecomputedHeader =
      Json.parse(headerString).validate[PrecomputedHeader] match {
        case JsSuccess(parsedHeader, _) =>
          parsedHeader
        case errors: JsError =>
          throw new Exception("Validating json as precomputed metadata failed: " + JsError.toJson(errors).toString())
      }

    val key = magPath.basename

    val scaleHeader: PrecomputedScaleHeader = PrecomputedScaleHeader(
      rootHeader.getScale(key).getOrElse(throw new IllegalArgumentException(s"Did not find a scale for key $key")),
      rootHeader)
    if (scaleHeader.bytesPerChunk > DatasetArray.chunkSizeLimitBytes) {
      throw new IllegalArgumentException(
        f"Chunk size of this Precomputed Array exceeds limit of ${DatasetArray.chunkSizeLimitBytes}, got ${scaleHeader.bytesPerChunk}")
    }
    val datasetPath = new DatasetPath(key)
    new PrecomputedArray(datasetPath,
                         basePath,
                         scaleHeader,
                         axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(scaleHeader.rank)),
                         channelIndex)
  }
}

class PrecomputedArray(relativePath: DatasetPath,
                       vaultPath: VaultPath,
                       header: PrecomputedScaleHeader,
                       axisOrder: AxisOrder,
                       channelIndex: Option[Int])(implicit ec: ExecutionContext)
    extends DatasetArray(relativePath, vaultPath, header, axisOrder, channelIndex)
    with FoxImplicits
    with LazyLogging {

  override protected val chunkReader: ChunkReader =
    PrecomputedChunkReader.create(vaultPath, header)

  lazy val voxelOffset: Array[Int] = header.precomputedScale.voxel_offset.getOrElse(Array(0, 0, 0))
  override protected def getChunkFilename(chunkIndex: Array[Int]): String = {

    val bbox = header.chunkIndexToNDimensionalBoundingBox(chunkIndex)
    bbox
      .map(dim => {
        s"${dim._1}-${dim._2}"
      })
      .mkString(header.dimension_separator.toString)
  }

  // SHARDING
  // Implemented according to https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/sharded.md,
  // directly adapted from https://github.com/scalableminds/webknossos-connect/blob/master/wkconnect/backends/neuroglancer/sharding.py.

  private val shardIndexCache: AlfuFoxCache[VaultPath, Array[Byte]] =
    AlfuFoxCache()

  private val minishardIndexCache: AlfuFoxCache[(VaultPath, Int), Seq[(Long, Long, Long)]] =
    AlfuFoxCache()

  private def getHashForChunk(chunkIndex: Array[Int]): Long =
    CompressedMortonCode.encode(chunkIndex, header.gridSize)

  private lazy val minishardMask = {
    header.precomputedScale.sharding match {
      case Some(shardingSpec: ShardingSpecification) =>
        if (shardingSpec.minishard_bits == 0) {
          0
        } else {
          var minishardMask = 1L
          for (_ <- 0 until shardingSpec.minishard_bits - 1) {
            minishardMask <<= 1
            minishardMask |= 1
          }
          minishardMask
        }
      case None => 0
    }
  }

  private lazy val shardMask = {
    header.precomputedScale.sharding match {
      case Some(shardingSpec: ShardingSpecification) =>
        val oneMask = Long.MinValue // 0xFFFFFFFFFFFFFFFF
        val cursor = shardingSpec.minishard_bits + shardingSpec.shard_bits
        val shardMask = ~((oneMask >> cursor) << cursor)
        shardMask & (~minishardMask)
      case None => 0
    }
  }

  private lazy val minishardCount = 1 << header.precomputedScale.sharding.map(_.minishard_bits).getOrElse(0)

  private lazy val shardIndexRange: NumericRange.Exclusive[Long] = {
    val end = minishardCount * 16
    Range.Long(0, end, 1)
  }

  private def getShardIndex(shardPath: VaultPath)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    shardIndexCache.getOrLoad(shardPath, readShardIndex)

  private def readShardIndex(shardPath: VaultPath)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    Fox.option2Fox(shardPath.readBytes(Some(shardIndexRange)))

  private def parseShardIndex(index: Array[Byte]): Seq[(Long, Long)] =
    // See https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/sharded.md#shard-index-format
    index
      .grouped(16) // 16 Bytes: 2 uint64 numbers: start_offset, end_offset
      .map((bytes: Array[Byte]) => {
        (BigInt(bytes.take(8).reverse).toLong, BigInt(bytes.slice(8, 16).reverse).toLong) // bytes reversed because they are stored little endian
      })
      .toSeq

  private def getMinishardInfo(chunkHash: Long): (Long, Long) =
    header.precomputedScale.sharding match {
      case Some(shardingSpec: ShardingSpecification) =>
        val rawChunkIdentifier = chunkHash >> shardingSpec.preshift_bits
        val chunkIdentifier = shardingSpec.hashFunction(rawChunkIdentifier)
        val minishardNumber = chunkIdentifier & minishardMask
        val shardNumber = (chunkIdentifier & shardMask) >> shardingSpec.minishard_bits
        (shardNumber, minishardNumber)
      case None => (0, 0)
    }

  private def getPathForShard(shardNumber: Long): VaultPath = {
    val shardBits = header.precomputedScale.sharding.map(_.shard_bits.toFloat).getOrElse(0f)
    if (shardBits == 0) {
      vaultPath / relativePath.storeKey / "0.shard"
    } else {
      val shardString = String.format(s"%1$$${(shardBits / 4).ceil.toInt}s", shardNumber.toHexString).replace(' ', '0')
      vaultPath / relativePath.storeKey / s"$shardString.shard"
    }

  }

  private def getMinishardIndexRange(minishardNumber: Int,
                                     parsedShardIndex: Seq[(Long, Long)]): NumericRange.Exclusive[Long] = {
    val miniShardIndexStart: Long = (shardIndexRange.end) + parsedShardIndex(minishardNumber)._1
    val miniShardIndexEnd: Long = (shardIndexRange.end) + parsedShardIndex(minishardNumber)._2
    Range.Long(miniShardIndexStart, miniShardIndexEnd, 1)
  }

  private def parseMinishardIndex(bytes: Array[Byte]): Seq[(Long, Long, Long)] = {
    // Because readBytes already decodes gzip, we don't need to decompress here
    /*
     From: https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/sharded.md#minishard-index-format
     The decoded "minishard index" is a binary string of 24*n bytes, specifying a contiguous C-order array of [3, n]
      uint64le values.
     */
    val n = bytes.length / 24
    val buf = ByteBuffer.allocate(bytes.length)
    buf.put(bytes)

    val longArray = new Array[Long](n * 3)
    buf.position(0)
    buf.order(ByteOrder.LITTLE_ENDIAN)
    buf.asLongBuffer().get(longArray)
    // longArray is row major / C-order
    /*
     From: https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/sharded.md#minishard-index-format
     Values array[0, 0], ..., array[0, n-1] specify the chunk IDs in the minishard, and are delta encoded, such that
     array[0, 0] is equal to the ID of the first chunk, and the ID of chunk i is equal to the sum
     of array[0, 0], ..., array[0, i].
     */
    val chunkIds = new Array[Long](n)
    chunkIds(0) = longArray(0)
    for (i <- 1 until n) {
      chunkIds(i) = longArray(i) + chunkIds(i - 1)
    }
    /*
     From: https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/sharded.md#minishard-index-format
     The size of the data for chunk i is stored as array[2, i].
     Values array[1, 0], ..., array[1, n-1] specify the starting offsets in the shard file of the data corresponding to
     each chunk, and are also delta encoded relative to the end of the prior chunk, such that the starting offset of the
     first chunk is equal to shard_index_end + array[1, 0], and the starting offset of chunk i is the sum of
     shard_index_end + array[1, 0], ..., array[1, i] and array[2, 0], ..., array[2, i-1].
     */
    val chunkSizes = longArray.slice(2 * n, 3 * n)
    val chunkStartOffsets = new Array[Long](n)
    chunkStartOffsets(0) = longArray(n)
    for (i <- 1 until n) {
      val startOffsetIndex = i + n
      chunkStartOffsets(i) = chunkStartOffsets(i - 1) + longArray(startOffsetIndex) + chunkSizes(i - 1)
    }
    (chunkIds, chunkStartOffsets, chunkSizes).zipped.map((a, b, c) => (a, b, c))
  }

  private def getMinishardIndex(shardPath: VaultPath, minishardNumber: Int)(
      implicit ec: ExecutionContext): Fox[Seq[(Long, Long, Long)]] =
    minishardIndexCache.getOrLoad((shardPath, minishardNumber), readMinishardIndex)

  private def readMinishardIndex(vaultPathAndMinishardNumber: (VaultPath, Int))(
      implicit ec: ExecutionContext): Fox[Seq[(Long, Long, Long)]] = {
    val (vaultPath, minishardNumber) = vaultPathAndMinishardNumber
    for {
      index <- getShardIndex(vaultPath)
      parsedIndex = parseShardIndex(index)
      minishardIndexRange = getMinishardIndexRange(minishardNumber, parsedIndex)
      indexRaw <- vaultPath.readBytes(Some(minishardIndexRange))
      minishardIndex <- tryo(parseMinishardIndex(indexRaw))
    } yield minishardIndex
  }

  private def getChunkRange(chunkId: Long, minishardIndex: Seq[(Long, Long, Long)]): Fox[NumericRange.Exclusive[Long]] =
    for {
      chunkSpecification <- minishardIndex
        .find(_._1 == chunkId)
        .toFox ?~> s"Could not find chunk id $chunkId in minishard index"
      chunkStart = (shardIndexRange.end) + chunkSpecification._2
      chunkEnd = (shardIndexRange.end) + chunkSpecification._2 + chunkSpecification._3
    } yield Range.Long(chunkStart, chunkEnd, 1)

  override def getShardedChunkPathAndRange(chunkIndex: Array[Int])(
      implicit ec: ExecutionContext): Fox[(VaultPath, NumericRange[Long])] = {
    val chunkIdentifier = getHashForChunk(chunkIndex)
    val minishardInfo = getMinishardInfo(chunkIdentifier)
    val shardPath = getPathForShard(minishardInfo._1)
    for {
      minishardIndex <- getMinishardIndex(shardPath, minishardInfo._2.toInt) ?~> f"Could not get minishard index for chunkIndex ${chunkIndex
        .mkString(",")}"
      chunkRange: NumericRange.Exclusive[Long] <- getChunkRange(chunkIdentifier, minishardIndex) ?~> s"Could not get chunk range for chunkIndex ${chunkIndex
        .mkString(",")}  with chunkIdentifier $chunkIdentifier in minishard index."
    } yield (shardPath, chunkRange)
  }

}
