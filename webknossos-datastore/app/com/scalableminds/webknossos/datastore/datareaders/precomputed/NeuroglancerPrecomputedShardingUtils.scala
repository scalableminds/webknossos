package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo

import java.nio.{ByteBuffer, ByteOrder}
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

trait NeuroglancerPrecomputedShardingUtils extends FoxImplicits {

  // SHARDING
  // Implemented according to https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/sharded.md,
  // directly adapted from https://github.com/scalableminds/webknossos-connect/blob/master/wkconnect/backends/neuroglancer/sharding.py.

  val shardingSpecification: ShardingSpecification

  private val minishardIndexCache: AlfuCache[(VaultPath, Int), Array[(Long, Long, Long)]] =
    AlfuCache()

  private val shardIndexCache: AlfuCache[VaultPath, Array[Byte]] =
    AlfuCache()

  private lazy val minishardCount = 1 << shardingSpecification.minishard_bits

  protected lazy val shardIndexRange: NumericRange.Exclusive[Long] = {
    val end = minishardCount * 16
    Range.Long(0, end, 1)
  }

  private def getShardIndex(shardPath: VaultPath)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    shardIndexCache.getOrLoad(shardPath, readShardIndex)

  private def readShardIndex(shardPath: VaultPath)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    shardPath.readBytes(Some(shardIndexRange))

  private def parseShardIndex(index: Array[Byte]): Seq[(Long, Long)] =
    // See https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/sharded.md#shard-index-format
    index
      .grouped(16) // 16 Bytes: 2 uint64 numbers: start_offset, end_offset
      .map((bytes: Array[Byte]) => {
        (BigInt(bytes.take(8).reverse).toLong, BigInt(bytes.slice(8, 16).reverse).toLong) // bytes reversed because they are stored little endian
      })
      .toSeq

  private def getMinishardIndexRange(minishardNumber: Int,
                                     parsedShardIndex: Seq[(Long, Long)]): NumericRange.Exclusive[Long] = {
    val miniShardIndexStart: Long = (shardIndexRange.end) + parsedShardIndex(minishardNumber)._1
    val miniShardIndexEnd: Long = (shardIndexRange.end) + parsedShardIndex(minishardNumber)._2
    Range.Long(miniShardIndexStart, miniShardIndexEnd, 1)
  }

  private def decodeMinishardIndex(bytes: Array[Byte]) =
    shardingSpecification.minishard_index_encoding match {
      case "gzip" => ZipIO.gunzip(bytes)
      case _      => bytes

    }

  private def parseMinishardIndex(input: Array[Byte]): Box[Array[(Long, Long, Long)]] = tryo {
    val bytes = decodeMinishardIndex(input)
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

    chunkIds.lazyZip(chunkStartOffsets).lazyZip(chunkSizes).toArray
  }

  def getMinishardIndex(shardPath: VaultPath, minishardNumber: Int)(implicit ec: ExecutionContext,
                                                                    tc: TokenContext): Fox[Array[(Long, Long, Long)]] =
    minishardIndexCache.getOrLoad((shardPath, minishardNumber), readMinishardIndex)

  private def readMinishardIndex(vaultPathAndMinishardNumber: (VaultPath, Int))(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Array[(Long, Long, Long)]] = {
    val (vaultPath, minishardNumber) = vaultPathAndMinishardNumber
    for {
      index <- getShardIndex(vaultPath)
      parsedIndex = parseShardIndex(index)
      minishardIndexRange = getMinishardIndexRange(minishardNumber, parsedIndex)
      indexRaw <- vaultPath.readBytes(Some(minishardIndexRange))
      minishardIndex <- parseMinishardIndex(indexRaw).toFox
    } yield minishardIndex
  }

  def getChunkRange(chunkId: Long, minishardIndex: Array[(Long, Long, Long)])(
    implicit ec: ExecutionContext): Fox[NumericRange.Exclusive[Long]] =
    for {
      chunkSpecification <- minishardIndex
        .find(_._1 == chunkId)
        .toFox ?~> s"Could not find chunk id $chunkId in minishard index"
      chunkStart = (shardIndexRange.end) + chunkSpecification._2
      chunkEnd = (shardIndexRange.end) + chunkSpecification._2 + chunkSpecification._3
    } yield Range.Long(chunkStart, chunkEnd, 1)

  def getChunk(chunkRange: NumericRange[Long], shardPath: VaultPath)(implicit ec: ExecutionContext,
                                                                     tc: TokenContext): Fox[Array[Byte]] =
    for {
      rawBytes <- shardPath.readBytes(Some(chunkRange))
      bytes = shardingSpecification.data_encoding match {
        // Check for GZIP Magic bytes to check if it was already decompressed
        case "gzip" if rawBytes(0) == 31 && rawBytes(1) == -117 => ZipIO.gunzip(rawBytes)
        case _                                                  => rawBytes
      }
    } yield bytes
}
