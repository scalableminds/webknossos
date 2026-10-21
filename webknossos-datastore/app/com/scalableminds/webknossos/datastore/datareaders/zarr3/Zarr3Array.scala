package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.webknossos.datastore.datareaders.ChunkReadCoalescing.ChunkByteRange
import com.scalableminds.webknossos.datastore.datareaders.{
  AxisOrder,
  ChunkReadCoalescing,
  ChunkReader,
  ChunkUtils,
  DatasetArray
}
import com.scalableminds.webknossos.datastore.datavault.{ByteRange, StartEndExclusiveByteRange, VaultPath}
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataSourceId}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.box.Box.tryo
import ucar.ma2.Array as MultiArray

import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.{ExecutionContext, Promise}
import scala.jdk.CollectionConverters.*

object Zarr3Array extends LazyLogging {

  def open(
      path: VaultPath,
      dataSourceId: DataSourceId,
      layerName: String,
      axisOrderOpt: Option[AxisOrder],
      channelIndex: Option[Int],
      additionalAxes: Option[Seq[AdditionalAxis]],
      sharedChunkContentsCache: AlfuCache[String, MultiArray]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Zarr3Array] =
    for {
      headerBytes <- (path / Zarr3ArrayHeader.FILENAME_ZARR_JSON)
        .readBytes() ?~> s"Could not read header at ${Zarr3ArrayHeader.FILENAME_ZARR_JSON}"
      header <- JsonHelper.parseAs[Zarr3ArrayHeader](headerBytes).toFox ?~> "Could not parse array header"
      array <- tryo(
        new Zarr3Array(
          path,
          dataSourceId,
          layerName,
          header,
          axisOrderOpt.getOrElse(AxisOrder.asCxyzFromRank(header.rank)),
          channelIndex,
          additionalAxes,
          sharedChunkContentsCache
        )
      ).toFox ?~> "Could not open zarr3 array"
    } yield array

  def openForAttachment(
      path: VaultPath,
      sharedChunkContentsCache: AlfuCache[String, MultiArray]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Zarr3Array] =
    open(path, DataSourceId("dummy", "unused"), "layer", None, None, None, sharedChunkContentsCache)
}

class Zarr3Array(
    vaultPath: VaultPath,
    dataSourceId: DataSourceId,
    layerName: String,
    header: Zarr3ArrayHeader,
    axisOrder: AxisOrder,
    channelIndex: Option[Int],
    additionalAxes: Option[Seq[AdditionalAxis]],
    sharedChunkContentsCache: AlfuCache[String, MultiArray]
) extends DatasetArray(
      vaultPath,
      dataSourceId,
      layerName,
      header,
      axisOrder,
      channelIndex,
      additionalAxes,
      sharedChunkContentsCache
    )
    with LazyLogging {

  override protected def getChunkFilename(chunkIndex: Array[Long]): String =
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
        (
          Some(shardingCodec),
          initializeCodecs(shardingCodec.codecs)._2,
          initializeCodecs(shardingCodec.index_codecs)._2
        )
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
    shardShape.zip(innerChunkShape).map { case (s, ics) =>
      s / ics
    } // Describes how many chunks are in a shard, i.e. in the index

  private lazy val chunksPerShard = indexShape.product
  private def shardIndexEntryLength = 16

  private def getChunkIndexInShardIndex(chunkIndex: Array[Long], shardCoordinates: Array[Long]): Int = {
    val shardOffset = shardCoordinates.zip(indexShape).map { case (sc, is) => sc * is }
    val indexWithinShard = indexShape.tails.toList
      .dropRight(1)
      .zipWithIndex
      .map { case (shape, i) => shape.tail.product.toLong * (chunkIndex(i) - shardOffset(i)) }
      .sum
    Math.toIntExact(indexWithinShard)
  }

  private def readAndParseShardIndex(
      shardPath: VaultPath
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[(Long, Long)]] =
    for {
      shardIndexRaw <- readShardIndex(shardPath) ?-> Msg.Zarr.readShardIndexFailed
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

  private def readShardIndex(shardPath: VaultPath)(using ec: ExecutionContext, tc: TokenContext) =
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
          }
        )
      case None => ???
    }
    decodedIndex
      .grouped(shardIndexEntryLength)
      .map((bytes: Array[Byte]) =>
        // BigInt constructor is big endian, sharding index stores values little endian, thus reverse is used.
        (BigInt(bytes.take(8).reverse).toLong, BigInt(bytes.slice(8, 16).reverse).toLong)
      )
      .toArray
  }

  private def chunkIndexToShardIndex(chunkIndex: Array[Long]) =
    ChunkUtils.computeChunkIndices(
      header.datasetShape,
      header.outerChunkShape,
      header.chunkShape,
      chunkIndex.zip(header.chunkShape).map { case (i, s) => i * s }
    )

  /* Reads the stored chunks of a shard that lie close together with a single request. Chunks that are neither cached
   * nor being read are claimed in the chunk cache first, so that concurrent reads of the same chunks wait for this read
   * instead of requesting them again.
   */
  override def readChunkBoxes(chunkIndices: Seq[Array[Long]], coalescing: ChunkReadCoalescing)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Box[MultiArray]]] =
    if (shardingCodec.isEmpty || !coalescing.isEnabled) super.readChunkBoxes(chunkIndices, coalescing)
    else {
      val claims = new ConcurrentHashMap[Int, Promise[Box[MultiArray]]]()
      // The cache calls the loader while getOrLoad is called, if the chunk is absent.
      val chunks = chunkIndices.indices.map { i =>
        sharedChunkContentsCache.getOrLoad(
          typedChunkCacheKey(chunkIndices(i)),
          _ => {
            val promise = Promise[Box[MultiArray]]()
            claims.put(i, promise)
            Fox.fromFutureBox(promise.future)
          }
        )
      }
      val claimedPositions = claims.keySet().asScala.toSeq.sorted
      for {
        fetched <- Fox.fromFuture(readClaimedChunks(chunkIndices, claimedPositions, claims, coalescing).futureBox)
        // Waiting reads must not hang if the read failed before completing all claims.
        _ = claims.values().asScala.foreach(_.trySuccess(Failure(s"Reading chunks failed: $fetched")))
        result <- Fox.combined(chunks.map(_.shiftBox))
      } yield result
    }

  private def readClaimedChunks(
      chunkIndices: Seq[Array[Long]],
      claimedPositions: Seq[Int],
      claims: ConcurrentHashMap[Int, Promise[Box[MultiArray]]],
      coalescing: ChunkReadCoalescing
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Unit] = {
    def complete(position: Int, chunk: Fox[MultiArray]): Fox[Unit] =
      Fox.fromFuture(chunk.futureBox.map(box => claims.get(position).trySuccess(box)).map(_ => ()))
    for {
      locations <- Fox.combined(claimedPositions.map { i =>
        getShardedChunkPathAndRange(chunkIndices(i)).shiftBox.map(location => (i, location))
      })
      storedChunks = locations.collect { case (i, Full((shardPath, range))) => (shardPath, i, range) }
      _ <- Fox.serialCombined(locations.collect { case (i, Empty) => i }) { i =>
        complete(i, chunkReader.createFromFillValue(chunkShapeAtIndex(chunkIndices(i)), useSkipTypingShortcut = false))
      }
      _ = locations.collect { case (i, failure: Failure) => claims.get(i).trySuccess(failure) }
      requests = storedChunks.groupBy(_._1).toSeq.flatMap { case (shardPath, chunksOfShard) =>
        ChunkReadCoalescing
          .coalesce(chunksOfShard.map { case (_, i, range) => ChunkByteRange(i, range.start, range.end) }, coalescing)
          .map(request => (shardPath, request))
      }
      _ <- Fox.batchCombined(requests, coalescing.maxParallelRequests) { case (shardPath, request) =>
        for {
          requestBytes <- shardPath.readBytes(ByteRange.startEndExclusive(request.start, request.endExclusive))
          _ <- Fox.serialCombined(request.chunks) { chunk =>
            val chunkBytes = requestBytes.slice(
              Math.toIntExact(chunk.start - request.start),
              Math.toIntExact(chunk.endExclusive - request.start)
            )
            complete(chunk.key, chunkReader.decodeAndType(chunkBytes, chunkShapeAtIndex(chunkIndices(chunk.key))))
          }
        } yield ()
      }
    } yield ()
  }

  override protected def getShardedChunkPathAndRange(
      chunkIndex: Array[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[(VaultPath, StartEndExclusiveByteRange)] =
    for {
      shardCoordinates <- chunkIndexToShardIndex(chunkIndex).headOption.toFox
      shardFilename = getChunkFilename(shardCoordinates)
      shardPath = vaultPath / shardFilename
      parsedShardIndex <- parsedShardIndexCache.getOrLoad(shardPath, readAndParseShardIndex)
      chunkIndexInShardIndex = getChunkIndexInShardIndex(chunkIndex, shardCoordinates)
      (chunkOffset, chunkLength) = parsedShardIndex(chunkIndexInShardIndex)
      _ <-
        if (chunkOffset == -1 && chunkLength == -1) {
          Fox.empty // -1 signifies empty/missing chunk
        } else Fox.successful(())
      range = ByteRange.startEndExclusive(chunkOffset, chunkOffset + chunkLength)
    } yield (shardPath, range)
}
