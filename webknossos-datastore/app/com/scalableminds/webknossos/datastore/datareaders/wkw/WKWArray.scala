package com.scalableminds.webknossos.datastore.datareaders.wkw

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonHelper.bool2Box
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataFormat, WKWHeader, WKWMortonHelper}
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkUtils, DatasetArray}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataSourceId}
import net.liftweb.common.Box
import ucar.ma2.{Array => MultiArray}

import java.io.ByteArrayInputStream
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

object WKWArray {
  def open(path: VaultPath,
           dataSourceId: DataSourceId,
           layerName: String,
           sharedChunkContentsCache: AlfuCache[String, MultiArray])(implicit ec: ExecutionContext): Fox[WKWArray] =
    for {
      headerBytes <- (path / WKWDataFormat.FILENAME_HEADER_WKW)
        .readBytes() ?~> s"Could not read header at ${WKWDataFormat.FILENAME_HEADER_WKW}"
      dataInputStream = new LittleEndianDataInputStream(new ByteArrayInputStream(headerBytes))
      header <- WKWHeader(dataInputStream, readJumpTable = false).toFox
    } yield
      new WKWArray(path,
                   dataSourceId,
                   layerName,
                   header,
                   AxisOrder.asZyxFromRank(3),
                   None,
                   None,
                   sharedChunkContentsCache)
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
    with WKWMortonHelper {

  private val parsedShardIndexCache: AlfuCache[VaultPath, Array[Long]] = AlfuCache()

  override protected def getShardedChunkPathAndRange(chunkIndex: Array[Int])(
      implicit ec: ExecutionContext): Fox[(VaultPath, NumericRange[Long])] =
    for {
      shardCoordinates <- Fox.option2Fox(chunkIndexToShardIndex(chunkIndex).headOption)
      shardFilename = getChunkFilename(shardCoordinates)
      shardPath = vaultPath / shardFilename
      _ = logger.info(s"Reading chunk ${chunkIndex.mkString(",")} from shard at $shardPath...")
      // TODO in uncompressed case, no shardIndex is needed
      //parsedShardIndex <- parsedShardIndexCache.getOrLoad(shardPath, readAndParseShardIndex)
      parsedShardIndex <- readAndParseShardIndex(shardPath)
      chunkIndexInShardIndex <- getChunkIndexInShardIndex(chunkIndex, shardCoordinates)
      chunkByteOffset = parsedShardIndex(chunkIndexInShardIndex)
      nextChunkByteOffset = parsedShardIndex(chunkIndexInShardIndex + 1)
      range = Range.Long(chunkByteOffset, nextChunkByteOffset, 1)
    } yield (shardPath, range)

  private def readAndParseShardIndex(shardPath: VaultPath)(implicit ec: ExecutionContext): Fox[Array[Long]] = {
    val skipBytes = 8
    val bytesPerShardIndexEntry = 8
    val rangeInShardFile =
      Range.Long(skipBytes, skipBytes + (1 + header.numChunksPerShard) * bytesPerShardIndexEntry, 1)
    for {
      shardIndexBytes <- shardPath.readBytes(Some(rangeInShardFile))
      dataInputStream = new LittleEndianDataInputStream(new ByteArrayInputStream(shardIndexBytes))
      shardIndex = (0 to header.numChunksPerShard).map(_ => dataInputStream.readLong()).toArray
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

  private def getChunkIndexInShardIndex(chunkIndex: Array[Int], shardCoordinates: Array[Int]): Box[Int] = {
    val x = chunkIndex(0) // TODO double check order
    val y = chunkIndex(1)
    val z = chunkIndex(2)
    val chunkOffsetX = x % header.numChunksPerShardDimension
    val chunkOffsetY = y % header.numChunksPerShardDimension
    val chunkOffsetZ = z % header.numChunksPerShardDimension
    computeMortonIndex(chunkOffsetX, chunkOffsetY, chunkOffsetZ)
  }

  override protected def getChunkFilename(chunkIndex: Array[Int]): String = {
    val x = chunkIndex(0) // TODO double check order
    val y = chunkIndex(1)
    val z = chunkIndex(2)
    f"z$z/y$y/x$x.wkw"
  }
  // TODO add .wkw, ignore channels

  private def chunkIndexToShardIndex(chunkIndex: Array[Int]) =
    ChunkUtils.computeChunkIndices(
      header.datasetShape.map(axisOrder.permuteIndicesReverse),
      axisOrder.permuteIndicesReverse(header.shardShape),
      header.chunkSize,
      chunkIndex.zip(header.chunkSize).map { case (i, s) => i * s }
    )
}
