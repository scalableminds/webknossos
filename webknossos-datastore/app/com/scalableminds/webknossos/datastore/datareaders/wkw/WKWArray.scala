package com.scalableminds.webknossos.datastore.datareaders.wkw

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.BoxUtils.bool2Box
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{MortonEncoding, WKWDataFormatHelper, WKWHeader}
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkUtils, DatasetArray}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataSourceId}
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo
import ucar.ma2.{Array => MultiArray}

import java.io.ByteArrayInputStream
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

object WKWArray extends WKWDataFormatHelper with FoxImplicits {
  def open(path: VaultPath,
           dataSourceId: DataSourceId,
           layerName: String,
           sharedChunkContentsCache: AlfuCache[String, MultiArray])(implicit ec: ExecutionContext,
                                                                    tc: TokenContext): Fox[WKWArray] =
    for {
      headerBytes <- (path / FILENAME_HEADER_WKW).readBytes() ?~> s"Could not read header at $FILENAME_HEADER_WKW"
      dataInputStream = new LittleEndianDataInputStream(new ByteArrayInputStream(headerBytes))
      header <- WKWHeader(dataInputStream, readJumpTable = false).toFox
      array <- tryo(new WKWArray(path,
                                 dataSourceId,
                                 layerName,
                                 header,
                                 AxisOrder.cxyz,
                                 None,
                                 None,
                                 sharedChunkContentsCache)).toFox ?~> "Could not open wkw array"
    } yield array
}

class WKWArray(vaultPath: VaultPath,
               dataSourceId: DataSourceId,
               layerName: String,
               header: WKWHeader,
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
    with MortonEncoding
    with WKWDataFormatHelper {

  private val parsedShardIndexCache: AlfuCache[VaultPath, Array[Long]] = AlfuCache()

  override protected def getShardedChunkPathAndRange(
      chunkIndex: Array[Int])(implicit ec: ExecutionContext, tc: TokenContext): Fox[(VaultPath, NumericRange[Long])] =
    for {
      shardCoordinates <- chunkIndexToShardIndex(chunkIndex).headOption.toFox
      shardFilename = getChunkFilename(shardCoordinates)
      shardPath = vaultPath / shardFilename
      parsedShardIndex <- parsedShardIndexCache.getOrLoad(shardPath, readAndParseShardIndex)
      chunkIndexInShardIndex <- getChunkIndexInShardIndex(chunkIndex).toFox
      chunkByteOffset = shardIndexEntryAt(parsedShardIndex, chunkIndexInShardIndex)
      nextChunkByteOffset = shardIndexEntryAt(parsedShardIndex, chunkIndexInShardIndex + 1)
      range = Range.Long(chunkByteOffset, nextChunkByteOffset, 1)
    } yield (shardPath, range)

  private def shardIndexEntryAt(shardIndex: Array[Long], chunkIndexInShardIndex: Int): Long =
    if (header.isCompressed) shardIndex(chunkIndexInShardIndex)
    else
      shardIndex(0) + header.numBytesPerChunk.toLong * chunkIndexInShardIndex.toLong

  private def readAndParseShardIndex(shardPath: VaultPath)(implicit ec: ExecutionContext,
                                                           tc: TokenContext): Fox[Array[Long]] = {
    val skipBytes = 8 // First 8 bytes of header are other metadata
    val bytesPerShardIndexEntry = 8
    val numEntriesToRead = if (header.isCompressed) 1 + header.numChunksPerShard else 1
    val rangeInShardFile =
      Range.Long(skipBytes, skipBytes + numEntriesToRead * bytesPerShardIndexEntry, 1)
    for {
      shardIndexBytes <- shardPath.readBytes(Some(rangeInShardFile))
      dataInputStream = new LittleEndianDataInputStream(new ByteArrayInputStream(shardIndexBytes))
      shardIndex = (0 until numEntriesToRead).map(_ => dataInputStream.readLong()).toArray
    } yield shardIndex
  }

  protected def error(msg: String, expected: Any, actual: Any): String =
    s"""Error processing WKW file: $msg [expected: $expected, actual: $actual]."""

  private def computeMortonIndex(x: Int, y: Int, z: Int): Box[Int] =
    for {
      _ <- bool2Box(x >= 0 && x < header.numChunksPerShardDimension) ?~! error(
        "X coordinate is out of range",
        s"[0, ${header.numChunksPerShardDimension})",
        x)
      _ <- bool2Box(y >= 0 && y < header.numChunksPerShardDimension) ?~! error(
        "Y coordinate is out of range",
        s"[0, ${header.numChunksPerShardDimension})",
        y)
      _ <- bool2Box(z >= 0 && z < header.numChunksPerShardDimension) ?~! error(
        "Z coordinate is out of range",
        s"[0, ${header.numChunksPerShardDimension})",
        z)
    } yield mortonEncode(x, y, z)

  private def getChunkIndexInShardIndex(chunkIndex: Array[Int]): Box[Int] = {
    val x = chunkIndex(axisOrder.x)
    val y = chunkIndex(axisOrder.y)
    val z = chunkIndex(axisOrder.z.getOrElse(3))
    val chunkOffsetX = x % header.numChunksPerShardDimension
    val chunkOffsetY = y % header.numChunksPerShardDimension
    val chunkOffsetZ = z % header.numChunksPerShardDimension
    computeMortonIndex(chunkOffsetX, chunkOffsetY, chunkOffsetZ)
  }

  override protected def getChunkFilename(chunkIndex: Array[Int]): String = {
    val x = chunkIndex(axisOrder.x)
    val y = chunkIndex(axisOrder.y)
    val z = chunkIndex(axisOrder.z.getOrElse(3))
    wkwFilePath(x, y, z)
  }

  private def chunkIndexToShardIndex(chunkIndex: Array[Int]) =
    ChunkUtils.computeChunkIndices(
      header.datasetShape.map(fullAxisOrder.permuteIndicesArrayToWk),
      fullAxisOrder.permuteIndicesArrayToWk(header.shardShape),
      header.chunkShape,
      chunkIndex.zip(header.chunkShape).map { case (i, s) => i * s }
    )
}
