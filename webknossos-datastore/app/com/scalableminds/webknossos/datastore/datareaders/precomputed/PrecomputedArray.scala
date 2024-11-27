package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.{AxisOrder, DatasetArray}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext
import com.scalableminds.util.tools.Fox.{box2Fox, option2Fox}
import ucar.ma2.{Array => MultiArray}

object PrecomputedArray extends LazyLogging {
  def open(
      magPath: VaultPath,
      dataSourceId: DataSourceId,
      layerName: String,
      axisOrderOpt: Option[AxisOrder],
      channelIndex: Option[Int],
      additionalAxes: Option[Seq[AdditionalAxis]],
      sharedChunkContentsCache: AlfuCache[String, MultiArray])(implicit ec: ExecutionContext): Fox[PrecomputedArray] =
    for {
      headerBytes <- (magPath.parent / PrecomputedHeader.FILENAME_INFO)
        .readBytes() ?~> s"Could not read header at ${PrecomputedHeader.FILENAME_INFO}"
      rootHeader <- JsonHelper.parseAndValidateJson[PrecomputedHeader](headerBytes) ?~> "Could not parse array header"
      scale <- rootHeader.getScale(magPath.basename) ?~> s"Header does not contain scale ${magPath.basename}"
      scaleHeader = PrecomputedScaleHeader(scale, rootHeader)
      _ <- DatasetArray.assertChunkSizeLimit(scaleHeader.bytesPerChunk)
      array <- tryo(
        new PrecomputedArray(
          magPath,
          dataSourceId,
          layerName,
          scaleHeader,
          axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(scaleHeader.rank)),
          channelIndex,
          additionalAxes,
          sharedChunkContentsCache
        )) ?~> "Could not open neuroglancerPrecomputed array"
    } yield array
}

class PrecomputedArray(vaultPath: VaultPath,
                       dataSourceId: DataSourceId,
                       layerName: String,
                       header: PrecomputedScaleHeader,
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
    with FoxImplicits
    with LazyLogging
    with NeuroglancerPrecomputedShardingUtils {

  lazy val voxelOffset: Array[Int] = header.precomputedScale.voxel_offset.getOrElse(Array(0, 0, 0))
  override protected def getChunkFilename(chunkIndex: Array[Int]): String = {

    val bbox = header.chunkIndexToNDimensionalBoundingBox(chunkIndex)
    bbox
      .map(dim => {
        s"${dim._1}-${dim._2}"
      })
      .mkString(header.dimension_separator.toString)
  }

  val shardingSpecification: ShardingSpecification =
    header.precomputedScale.sharding.getOrElse(ShardingSpecification.empty)

  private def getHashForChunk(chunkIndex: Array[Int]): Long =
    CompressedMortonCode.encode(chunkIndex, header.gridSize)

  override def getShardedChunkPathAndRange(chunkIndex: Array[Int])(
      implicit ec: ExecutionContext): Fox[(VaultPath, NumericRange[Long])] = {
    val chunkIdentifier = getHashForChunk(chunkIndex)
    val minishardInfo = shardingSpecification.getMinishardInfo(chunkIdentifier)
    val shardPath = shardingSpecification.getPathForShard(vaultPath, minishardInfo._1)
    for {
      minishardIndex <- getMinishardIndex(shardPath, minishardInfo._2.toInt) ?~> f"Could not get minishard index for chunkIndex ${chunkIndex
        .mkString(",")}"
      chunkRange: NumericRange.Exclusive[Long] <- getChunkRange(chunkIdentifier, minishardIndex) ?~> s"Could not get chunk range for chunkIndex ${chunkIndex
        .mkString(",")}  with chunkIdentifier $chunkIdentifier in minishard index."
    } yield (shardPath, chunkRange)
  }

}
