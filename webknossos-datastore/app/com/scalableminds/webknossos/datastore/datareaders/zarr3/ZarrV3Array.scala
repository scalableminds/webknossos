package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.{
  AxisOrder,
  ChunkReader,
  DatasetArray,
  DatasetHeader,
  DatasetPath
}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}

import java.io.IOException
import java.nio.charset.StandardCharsets
import scala.annotation.tailrec
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

// TODO: Copied from zarr array, maybe extract something
object ZarrV3Array extends LazyLogging {
  @throws[IOException]
  def open(path: VaultPath, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int]): ZarrV3Array = {
    val rootPath = new DatasetPath("")
    val headerPath = rootPath.resolve(ZarrArrayHeader.ZARR_JSON)
    val headerBytes = (path / headerPath.storeKey).readBytes()
    if (headerBytes.isEmpty)
      throw new IOException("'" + ZarrArrayHeader.ZARR_JSON + "' expected but is not readable or missing in store.")
    val headerString = new String(headerBytes.get, StandardCharsets.UTF_8)
    val header: ZarrArrayHeader =
      Json.parse(headerString).validate[ZarrArrayHeader] match {
        case JsSuccess(parsedHeader, _) =>
          parsedHeader
        case errors: JsError =>
          throw new Exception("Validating json as zarr v3 header failed: " + JsError.toJson(errors).toString())
      }
    new ZarrV3Array(rootPath, path, header, axisOrderOpt.getOrElse(AxisOrder.asCxyzFromRank(header.rank)), channelIndex)
  }

}

class ZarrV3Array(relativePath: DatasetPath,
                  vaultPath: VaultPath,
                  header: DatasetHeader,
                  axisOrder: AxisOrder,
                  channelIndex: Option[Int])
    extends DatasetArray(relativePath, vaultPath, header, axisOrder, channelIndex)
    with LazyLogging {

  override protected def getChunkFilename(chunkIndex: Array[Int]): String =
    s"c${header.dimension_separator.toString}${super.getChunkFilename(chunkIndex)}"

  lazy val codecs: Seq[Codec] = initializeCodecs(specificHeader.codecs)
  var shardingCodec: Option[ShardingCodec] = None

  private def specificHeader: ZarrArrayHeader = header.asInstanceOf[ZarrArrayHeader]

  @tailrec
  private def initializeCodecs(codecSpecs: Seq[CodecSpecification]): Seq[Codec] = {
    val outerCodecs = codecSpecs.map {
      case EndianCodecSpecification(endian)   => new EndianCodec(endian)
      case TransposeCodecSpecification(order) => new TransposeCodec(order)
      case BloscCodecSpecification(cname, clevel, shuffle, typesize, blocksize) =>
        new BloscCodec(cname, clevel, shuffle, typesize, blocksize)
      case GzipCodecSpecification(level)                   => new GzipCodec(level)
      case ShardingCodecSpecification(chunk_shape, codecs) => new ShardingCodec(chunk_shape, codecs)
    }
    val shardingCodecOpt: Option[ShardingCodec] = outerCodecs.flatMap {
      case codec: ShardingCodec => Some(codec)
      case _                    => None
    }.headOption

    shardingCodecOpt match {
      case Some(shardingCodec: ShardingCodec) =>
        this.shardingCodec = Some(shardingCodec); initializeCodecs(shardingCodec.codecs)
      case None => outerCodecs
    }
  }

  override protected val chunkReader: ChunkReader =
    ZarrV3ChunkReader.create(vaultPath, specificHeader, this)

  private val shardIndexCache: AlfuFoxCache[VaultPath, Array[Byte]] =
    AlfuFoxCache()

  private def shardShape = header.chunkSize // Only valid for one hierarchy of sharding codecs
  private def innerChunkShape = shardingCodec.map(s => s.chunk_shape).getOrElse(Array(1, 1, 1))
  private def indexShape = (shardShape, innerChunkShape).zipped.map(_ / _)

  private lazy val chunksPerShard = indexShape.product
  private def shardIndexEntryLength = 16
  private def getShardIndexSize = shardIndexEntryLength * chunksPerShard

  private def getChunkIndexInIndex(chunkIndex: Array[Int]) =
    indexShape.tails.zipWithIndex.map { case (shape, i) => shape.product * chunkIndex(i) }.sum * shardIndexEntryLength

  private def readShardIndex(shardPath: VaultPath) = shardPath.readLastBytes(getShardIndexSize)

  private def parseShardIndex(index: Array[Byte]): Seq[(Long, Long)] =
    index
      .grouped(shardIndexEntryLength)
      .map((bytes: Array[Byte]) => {
        (BigInt(bytes.take(8).reverse).toLong, BigInt(bytes.slice(8, 16).reverse).toLong)
      })
      .toSeq
  override protected def getShardedChunkPathAndRange(chunkIndex: Array[Int])(
      implicit ec: ExecutionContext): Fox[(VaultPath, NumericRange[Long])] = {
    val shardFilename = getChunkFilename(chunkIndex)
    val shardPath = vaultPath / shardFilename
    for {
      shardIndex <- shardIndexCache.getOrLoad(shardPath, readShardIndex)
      chunkIndexInIndex = getChunkIndexInIndex(chunkIndex) // TODO: Does this work?
      (chunkOffset, chunkLength) = parseShardIndex(shardIndex)(chunkIndexInIndex)
      range = Range.Long(chunkOffset, chunkOffset + chunkLength, 1)
    } yield (shardPath, range)
  }
}
