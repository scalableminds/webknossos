package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.datareaders.zarr.BytesConverter
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.util.Helpers.tryo
import ucar.ma2.{Array => MultiArray}

import java.nio.ByteOrder
import java.util
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class DatasetArray(vaultPath: VaultPath,
                   dataSourceId: DataSourceId,
                   layerName: String,
                   header: DatasetHeader,
                   axisOrder: AxisOrder,
                   channelIndex: Option[Int],
                   sharedChunkContentsCache: AlfuCache[String, MultiArray])
    extends LazyLogging {

  protected lazy val chunkReader: ChunkReader = new ChunkReader(header)

  // Returns byte array in fortran-order with little-endian values
  def readBytesXYZ(shape: Vec3Int, offset: Vec3Int)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val paddingDimensionsCount = header.rank - 3
    val offsetArray = channelIndex match {
      case Some(c) if header.rank >= 4 =>
        Array.fill(paddingDimensionsCount - 1)(0) :+ c :+ offset.x :+ offset.y :+ offset.z
      case _ => Array.fill(paddingDimensionsCount)(0) :+ offset.x :+ offset.y :+ offset.z
    }
    val shapeArray = Array.fill(paddingDimensionsCount)(1) :+ shape.x :+ shape.y :+ shape.z

    readBytes(shapeArray, offsetArray)
  }

  // returns byte array in fortran-order with little-endian values
  private def readBytes(shape: Array[Int], offset: Array[Int])(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      typedData <- readAsFortranOrder(shape, offset)
      asBytes <- BytesConverter.toByteArray(typedData, header.resolvedDataType, ByteOrder.LITTLE_ENDIAN)
    } yield asBytes

  // Read from array. Note that shape and offset should be passed in XYZ order, left-padded with 0 and 1 respectively.
  // This function will internally adapt to the array's axis order so that XYZ data in fortran-order is returned.
  private def readAsFortranOrder(shape: Array[Int], offset: Array[Int])(implicit ec: ExecutionContext): Fox[Object] = {
    val totalOffset: Array[Int] = (offset, header.voxelOffset).zipped.map(_ - _)
    val chunkIndices = ChunkUtils.computeChunkIndices(axisOrder.permuteIndicesReverse(header.datasetShape),
                                                      axisOrder.permuteIndicesReverse(header.chunkSize),
                                                      shape,
                                                      totalOffset)
    if (partialCopyingIsNotNeeded(shape, totalOffset, chunkIndices)) {
      for {
        chunkIndex <- chunkIndices.headOption.toFox
        sourceChunk: MultiArray <- getSourceChunkDataWithCache(axisOrder.permuteIndices(chunkIndex))
      } yield sourceChunk.getStorage
    } else {
      val targetBuffer = MultiArrayUtils.createDataBuffer(header.resolvedDataType, shape)
      val targetInCOrder: MultiArray =
        MultiArrayUtils.orderFlippedView(MultiArrayUtils.createArrayWithGivenStorage(targetBuffer, shape.reverse))
      val copiedFuture = Fox.combined(chunkIndices.map { chunkIndex: Array[Int] =>
        for {
          sourceChunk: MultiArray <- getSourceChunkDataWithCache(axisOrder.permuteIndices(chunkIndex))
          offsetInChunk = computeOffsetInChunk(chunkIndex, totalOffset)
          sourceChunkInCOrder: MultiArray = MultiArrayUtils.axisOrderXYZView(sourceChunk,
                                                                             axisOrder,
                                                                             flip = header.order != ArrayOrder.C)
          _ <- tryo(MultiArrayUtils.copyRange(offsetInChunk, sourceChunkInCOrder, targetInCOrder)) ?~> formatCopyRangeError(
            offsetInChunk,
            sourceChunkInCOrder,
            targetInCOrder)
        } yield ()
      })
      for {
        _ <- copiedFuture
      } yield targetBuffer
    }
  }

  private def formatCopyRangeError(offsetInChunk: Array[Int], sourceChunk: MultiArray, target: MultiArray): String =
    s"Copying data from dataset chunk failed. Chunk shape: ${sourceChunk.getShape.mkString(",")}, target shape: ${target.getShape
      .mkString(",")}, offset: ${offsetInChunk.mkString(",")}"

  protected def getShardedChunkPathAndRange(chunkIndex: Array[Int])(
      implicit ec: ExecutionContext): Fox[(VaultPath, NumericRange[Long])] = ???

  private def chunkContentsCacheKey(chunkIndex: Array[Int]): String =
    s"${dataSourceId}__${layerName}__${vaultPath}__chunk_${chunkIndex.mkString(",")}"

  private def getSourceChunkDataWithCache(chunkIndex: Array[Int])(implicit ec: ExecutionContext): Fox[MultiArray] =
    sharedChunkContentsCache.getOrLoad(chunkContentsCacheKey(chunkIndex), _ => readSourceChunkData(chunkIndex))

  private def readSourceChunkData(chunkIndex: Array[Int])(implicit ec: ExecutionContext): Fox[MultiArray] =
    if (header.isSharded) {
      for {
        (shardPath, chunkRange) <- getShardedChunkPathAndRange(chunkIndex) ?~> "chunk.getShardedPathAndRange.failed"
        chunkShape = header.chunkSizeAtIndex(chunkIndex)
        multiArray <- chunkReader.read(shardPath, chunkShape, Some(chunkRange))
      } yield multiArray
    } else {
      val chunkPath = vaultPath / getChunkFilename(chunkIndex)
      val chunkShape = header.chunkSizeAtIndex(chunkIndex)
      chunkReader.read(chunkPath, chunkShape, None)
    }

  protected def getChunkFilename(chunkIndex: Array[Int]): String =
    chunkIndex.mkString(header.dimension_separator.toString)

  private def partialCopyingIsNotNeeded(bufferShape: Array[Int],
                                        globalOffset: Array[Int],
                                        chunkIndices: List[Array[Int]]): Boolean =
    chunkIndices match {
      case chunkIndex :: Nil =>
        val offsetInChunk = computeOffsetInChunk(chunkIndex, globalOffset)
        header.order == ArrayOrder.F &&
        isZeroOffset(offsetInChunk) &&
        isBufferShapeEqualChunkShape(bufferShape) &&
        axisOrder == AxisOrder.asCxyzFromRank(header.rank)
      case _ => false
    }

  private def isBufferShapeEqualChunkShape(bufferShape: Array[Int]): Boolean =
    util.Arrays.equals(bufferShape, header.chunkSize)

  private def isZeroOffset(offset: Array[Int]): Boolean =
    util.Arrays.equals(offset, new Array[Int](offset.length))

  private def computeOffsetInChunk(chunkIndex: Array[Int], globalOffset: Array[Int]): Array[Int] =
    chunkIndex.indices.map { dim =>
      globalOffset(dim) - (chunkIndex(dim) * axisOrder.permuteIndicesReverse(header.chunkSize)(dim))
    }.toArray

  override def toString: String =
    s"${getClass.getCanonicalName} {axisOrder=$axisOrder shape=${header.datasetShape.mkString(",")} chunks=${header.chunkSize.mkString(
      ",")} dtype=${header.dataType} fillValue=${header.fillValueNumber}, ${header.compressorImpl}, byteOrder=${header.byteOrder}, vault=${vaultPath.summary}}"

}

object DatasetArray {
  private val chunkSizeLimitBytes: Int = 300 * 1024 * 1024

  def assertChunkSizeLimit(bytesPerChunk: Int)(implicit ec: ExecutionContext): Fox[Unit] =
    bool2Fox(bytesPerChunk <= chunkSizeLimitBytes) ?~> f"Array chunk size exceeds limit of ${chunkSizeLimitBytes}, got ${bytesPerChunk}"
}
