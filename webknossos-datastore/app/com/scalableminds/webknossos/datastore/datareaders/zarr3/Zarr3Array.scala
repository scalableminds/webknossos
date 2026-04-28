package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkReader, ChunkUtils, DatasetArray}
import com.scalableminds.webknossos.datastore.datavault.{ByteRange, StartEndExclusiveByteRange, VaultPath}
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataSourceId}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import ucar.ma2.{Array => MultiArray}

import scala.concurrent.ExecutionContext

object Zarr3Array extends LazyLogging with FoxImplicits {

  def open(path: VaultPath,
           dataSourceId: DataSourceId,
           layerName: String,
           axisOrderOpt: Option[AxisOrder],
           channelIndex: Option[Int],
           additionalAxes: Option[Seq[AdditionalAxis]],
           sharedChunkContentsCache: AlfuCache[String, MultiArray])(implicit ec: ExecutionContext,
                                                                    tc: TokenContext): Fox[Zarr3Array] =
    for {
      headerBytes <- (path / Zarr3ArrayHeader.FILENAME_ZARR_JSON)
        .readBytes() ?~> s"Could not read header at ${Zarr3ArrayHeader.FILENAME_ZARR_JSON}"
      header <- JsonHelper.parseAs[Zarr3ArrayHeader](headerBytes).toFox ?~> "Could not parse array header"
      array <- tryo(
        new Zarr3Array(path,
                       dataSourceId,
                       layerName,
                       header,
                       axisOrderOpt.getOrElse(AxisOrder.asCxyzFromRank(header.rank)),
                       channelIndex,
                       additionalAxes,
                       sharedChunkContentsCache)).toFox ?~> "Could not open zarr3 array"
    } yield array
}

class Zarr3Array(vaultPath: VaultPath,
                 dataSourceId: DataSourceId,
                 layerName: String,
                 header: Zarr3ArrayHeader,
                 axisOrder: AxisOrder,
                 channelIndex: Option[Int],
                 additionalAxes: Option[Seq[AdditionalAxis]],
                 sharedChunkContentsCache: AlfuCache[String, MultiArray])
    extends DatasetArray(vaultPath,
                         dataSourceId,
                         layerName,
                         header,
                         axisOrder,
                         channelIndex,
                         additionalAxes,
                         sharedChunkContentsCache)
    with LazyLogging {

  override protected def getChunkFilename(chunkIndex: Array[Int]): String =
    if (header.chunk_key_encoding.name == "default") {
      s"c${header.dimension_separator.toString}${super.getChunkFilename(chunkIndex)}"
    } else {
      super.getChunkFilename(chunkIndex)
    }

  lazy val (shardingCodec: Option[ShardingCodec], codecs: Seq[Codec], indexCodecs: Seq[Codec]) =
    initializeCodecs(header.codecs)

  private def initializeCodecs(codecSpecs: Seq[CodecConfiguration]): (Option[ShardingCodec], Seq[Codec], Seq[Codec]) = {
    val outerCodecs = codecSpecs.map {
      case BytesCodecConfiguration(endian)             => new BytesCodec(endian)
      case TransposeCodecConfiguration(order)          => new TransposeCodec(order)
      case bloscConfiguration: BloscCodecConfiguration => BloscCodec.fromConfiguration(bloscConfiguration)
      case GzipCodecConfiguration(level)               => new GzipCodec(level)
      case ZstdCodecConfiguration(level, checksum)     => new ZstdCodec(level, checksum)
      case Crc32CCodecConfiguration                    => new Crc32CCodec
      case ShardingCodecConfiguration(chunk_shape, codecs, index_codecs, index_location) =>
        new ShardingCodec(chunk_shape, codecs, index_codecs, index_location)
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

  private val parsedShardIndexCache: AlfuCache[VaultPath, Array[(Long, Long)]] = AlfuCache()

  private def shardShape =
    header.outerChunkShape // Only valid for one hierarchy of sharding codecs, describes total shape of a shard (in voxels)
  private def innerChunkShape =
    header.chunkShape // Describes shape (in voxels) of a real chunk, that is a chunk that is stored in a shard
  private def indexShape =
    shardShape.zip(innerChunkShape).map { case (s, ics) => s / ics } // Describes how many chunks are in a shard, i.e. in the index

  private lazy val chunksPerShard = indexShape.product
  private def shardIndexEntryLength = 16

  private def getChunkIndexInShardIndex(chunkIndex: Array[Int], shardCoordinates: Array[Int]): Int = {
    // C-order (row-major) linear index within the shard. Avoids intermediate collection allocations.
    var result = 0
    var stride = 1
    var i = chunkIndex.length - 1
    while (i >= 0) {
      result += stride * (chunkIndex(i) - shardCoordinates(i) * indexShape(i))
      stride *= indexShape(i)
      i -= 1
    }
    result
  }

  private def readAndParseShardIndex(shardPath: VaultPath)(implicit ec: ExecutionContext,
                                                           tc: TokenContext): Fox[Array[(Long, Long)]] =
    for {
      shardIndexRaw <- readShardIndex(shardPath) ?=> "zarr.readShardIndex.failed"
      parsed = parseShardIndex(shardIndexRaw)
    } yield parsed

  private lazy val shardIndexChecksumLength =
    shardingCodec match {
      case Some(codec) =>
        if (codec.index_codecs.exists(_.name == "crc32c")) Crc32CCodecConfiguration.checkSumByteLength
        else 0
      case None => 0
    }
  private def getShardIndexSize = shardIndexEntryLength * chunksPerShard + shardIndexChecksumLength

  private def readShardIndex(shardPath: VaultPath)(implicit ec: ExecutionContext, tc: TokenContext) =
    shardingCodec match {
      case Some(codec) if codec.index_location == IndexLocationSetting.start =>
        shardPath.readBytes(ByteRange.startEndExclusive(0, getShardIndexSize.toLong))
      case Some(codec) if codec.index_location == IndexLocationSetting.end => shardPath.readLastBytes(getShardIndexSize)
      case _                                                               => Fox.failure("No sharding codec found")
    }

  private def parseShardIndex(index: Array[Byte]): Array[(Long, Long)] = {
    val decodedIndex = shardingCodec match {
      case Some(_: ShardingCodec) =>
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
      .toArray
  }

  private def chunkIndexToShardIndex(chunkIndex: Array[Int]) =
    ChunkUtils.computeChunkIndices(
      header.datasetShape,
      header.outerChunkShape,
      header.chunkShape,
      chunkIndex.zip(header.chunkShape).map { case (i, s) => i.toLong * s }
    )

  override protected def getShardedChunkPathAndRange(chunkIndex: Array[Int])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(VaultPath, StartEndExclusiveByteRange)] =
    for {
      shardCoordinates <- chunkIndexToShardIndex(chunkIndex).headOption.toFox
      shardFilename = getChunkFilename(shardCoordinates)
      shardPath = vaultPath / shardFilename
      parsedShardIndex <- parsedShardIndexCache.getOrLoad(shardPath, readAndParseShardIndex)
      chunkIndexInShardIndex = getChunkIndexInShardIndex(chunkIndex, shardCoordinates)
      (chunkOffset, chunkLength) = parsedShardIndex(chunkIndexInShardIndex)
      _ <- if (chunkOffset == -1 && chunkLength == -1) {
        Fox.empty // -1 signifies empty/missing chunk
      } else Fox.successful(())
      range = ByteRange.startEndExclusive(chunkOffset, chunkOffset + chunkLength)
    } yield (shardPath, range)

  // Overrides the default one-future-per-chunk implementation with one-future-per-shard,
  // reducing Future overhead from O(N*rank) to O(S*rank) where S is the number of distinct shards.
  override protected def groupUncachedChunksByShardForPrefetch(uncachedIndices: Seq[Array[Int]])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[(VaultPath, Seq[Array[Int]], Seq[StartEndExclusiveByteRange])]] = {
    val withShardInfo: Seq[(Array[Int], Array[Int], String)] = uncachedIndices.flatMap { chunkIndex =>
      chunkIndexToShardIndex(chunkIndex).headOption.map { shardCoordinates =>
        (chunkIndex, shardCoordinates, getChunkFilename(shardCoordinates))
      }
    }
    Fox.combined(
      withShardInfo.groupBy(_._3).toSeq.map {
        case (shardFilename, entries) =>
          val shardPath = vaultPath / shardFilename
          for {
            parsedShardIndex <- parsedShardIndexCache.getOrLoad(shardPath, readAndParseShardIndex)
          } yield {
            val validSorted = entries.flatMap {
              case (chunkIndex, shardCoordinates, _) =>
                val pos = getChunkIndexInShardIndex(chunkIndex, shardCoordinates)
                val (chunkOffset, chunkLength) = parsedShardIndex(pos)
                if (chunkOffset == -1 && chunkLength == -1) None
                else
                  Some(
                    (chunkIndex,
                     ByteRange.startEndExclusive(chunkOffset, chunkOffset + chunkLength): StartEndExclusiveByteRange))
            }.sortBy { case (_, range) => range.start }
            (shardPath, validSorted.map(_._1), validSorted.map(_._2))
          }
      }
    )
  }
}
