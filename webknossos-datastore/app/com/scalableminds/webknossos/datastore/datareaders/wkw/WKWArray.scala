package com.scalableminds.webknossos.datastore.datareaders.wkw

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataFormat, WKWHeader}
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, ChunkUtils, DatasetArray}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataSourceId}
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
                         sharedChunkContentsCache) {

  override protected def getShardedChunkPathAndRange(chunkIndex: Array[Int])(
      implicit ec: ExecutionContext): Fox[(VaultPath, NumericRange[Long])] =
    for {
      shardCoordinates <- Fox.option2Fox(chunkIndexToShardIndex(chunkIndex).headOption)
      shardFilename = getChunkFilename(shardCoordinates)
      shardPath = vaultPath / shardFilename
      parsedShardIndex <- parsedShardIndexCache.getOrLoad(shardPath, readAndParseShardIndex)
      chunkIndexInShardIndex = getChunkIndexInShardIndex(chunkIndex, shardCoordinates)
      (chunkOffset, chunkLength) = parsedShardIndex(chunkIndexInShardIndex)
      _ <- Fox.bool2Fox(!(chunkOffset == -1 && chunkLength == -1)) ~> Fox.empty // -1 signifies empty/missing chunk
      range = Range.Long(chunkOffset, chunkOffset + chunkLength, 1)
    } yield (shardPath, range)

  override protected def getChunkFilename(chunkIndex: Array[Int]): String = ???
  // TODO add .wkw, ignore channels

  private def chunkIndexToShardIndex(chunkIndex: Array[Int]) =
    ChunkUtils.computeChunkIndices(
      header.datasetShape.map(axisOrder.permuteIndicesReverse),
      axisOrder.permuteIndicesReverse(header.shardShape),
      header.chunkSize,
      chunkIndex.zip(header.chunkSize).map { case (i, s) => i * s }
    )
}
