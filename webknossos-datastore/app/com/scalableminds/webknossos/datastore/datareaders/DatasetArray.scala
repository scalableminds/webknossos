package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import net.liftweb.common.Box.tryo
import ucar.ma2.{Array => MultiArray}

import java.nio.ByteOrder
import java.util
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class DatasetArray(vaultPath: VaultPath,
                   dataSourceId: DataSourceId,
                   layerName: String,
                   header: DatasetHeader,
                   // axisOrder and additionalAxes match those from “outer” metadata, and can directly be used to compute chunk indices.
                   // For each chunk’s contents, additionally the transpose codecs/ArrayOrder.C/F from the DatasetHeader must be applied)
                   axisOrder: AxisOrder,
                   channelIndex: Option[Int],
                   additionalAxes: Option[Seq[AdditionalAxis]],
                   sharedChunkContentsCache: AlfuCache[String, MultiArray])
    extends FoxImplicits {

  protected lazy val fullAxisOrder: FullAxisOrder =
    FullAxisOrder.fromAxisOrderAndAdditionalAxes(rank, axisOrder, additionalAxes)

  protected lazy val chunkReader: ChunkReader = new ChunkReader(header)

  private lazy val additionalAxesMap: Map[String, AdditionalAxis] =
    additionalAxes match {
      case Some(additionalAxis) =>
        additionalAxis.map(additionalAxis => additionalAxis.name -> additionalAxis).toMap
      case None => Map()
    }

  // Helper variables to allow reading 2d datasets as 3d datasets with depth 1

  lazy val rank: Int = if (axisOrder.hasZAxis) {
    header.rank
  } else {
    header.rank + 1
  }

  lazy val datasetShape: Option[Array[Int]] = if (axisOrder.hasZAxis) {
    header.datasetShape
  } else {
    header.datasetShape.map(shape => shape :+ 1)
  }

  lazy val chunkShape: Array[Int] = if (axisOrder.hasZAxis) {
    header.chunkShape
  } else {
    header.chunkShape :+ 1
  }

  private def chunkShapeAtIndex(index: Array[Int]) =
    if (axisOrder.hasZAxis) { header.chunkShapeAtIndex(index) } else {
      chunkShape // irregular shaped chunk indexes are currently not supported for 2d datasets
    }

  def readBytesWithAdditionalCoordinates(
      shapeXYZ: Vec3Int,
      offsetXYZ: Vec3Int,
      additionalCoordinatesOpt: Option[Seq[AdditionalCoordinate]],
      shouldReadUint24: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      (shapeArray, offsetArray) <- tryo(constructShapeAndOffsetArrays(
        shapeXYZ,
        offsetXYZ,
        additionalCoordinatesOpt,
        shouldReadUint24)).toFox ?~> "failed to construct shape and offset array for requested coordinates"
      bytes <- readBytes(shapeArray, offsetArray)
    } yield bytes

  private def constructShapeAndOffsetArrays(shapeXYZ: Vec3Int,
                                            offsetXYZ: Vec3Int,
                                            additionalCoordinatesOpt: Option[Seq[AdditionalCoordinate]],
                                            shouldReadUint24: Boolean): (Array[Int], Array[Int]) = {
    val shapeArray: Array[Int] = Array.fill(rank)(1)
    shapeArray(rank - 3) = shapeXYZ.x
    shapeArray(rank - 2) = shapeXYZ.y
    shapeArray(rank - 1) = shapeXYZ.z

    val offsetArray: Array[Int] = Array.fill(rank)(0)
    offsetArray(rank - 3) = offsetXYZ.x
    offsetArray(rank - 2) = offsetXYZ.y
    offsetArray(rank - 1) = offsetXYZ.z

    axisOrder.c.foreach { channelAxisInner =>
      val channelAxisOuter = fullAxisOrder.arrayToWkPermutation(channelAxisInner)
      // If a channelIndex is requested, and a channel axis is known, add an offset to the channel axis
      channelIndex.foreach { requestedChannelOffset =>
        offsetArray(channelAxisOuter) = requestedChannelOffset
      }
      // If uint24 is to be read, increase channel axis shape value from 1 to 3
      if (shouldReadUint24) {
        shapeArray(channelAxisOuter) = 3
      }
    }

    additionalCoordinatesOpt.foreach { additionalCoordinates =>
      for (additionalCoordinate <- additionalCoordinates) {
        val index = fullAxisOrder.arrayToWkPermutation(additionalAxesMap(additionalCoordinate.name).index)
        offsetArray(index) = additionalCoordinate.value
        // shapeArray at positions of additional coordinates is always 1
      }
    }
    (shapeArray, offsetArray)
  }

  // returns byte array in fortran-order with little-endian values
  private def readBytes(shape: Array[Int], offset: Array[Int])(implicit ec: ExecutionContext,
                                                               tc: TokenContext): Fox[Array[Byte]] =
    for {
      typedMultiArray <- readAsFortranOrder(shape, offset)
      asBytes <- BytesConverter.toByteArray(typedMultiArray, header.resolvedDataType, ByteOrder.LITTLE_ENDIAN).toFox
    } yield asBytes

  private def printAsInner(values: Array[Int], flip: Boolean = false): String = {
    val axisNames = fullAxisOrder.axes.map(_.name)
    val axisNamesFlippedIfNeeded = if (flip) axisNames.reverse else axisNames
    val raw = axisNamesFlippedIfNeeded
      .zip(values)
      .map { tuple =>
        f"${tuple._1}=${tuple._2}"
      }
      .mkString(",")
    f"inner($raw)"
  }

  private def printAsOuterF(values: Array[Int]): String = {
    val axisNamesFOrder = fullAxisOrder.axesWk.map(_.name).reverse
    val raw = axisNamesFOrder
      .zip(values)
      .map { tuple =>
        f"${tuple._1}=${tuple._2}"
      }
      .mkString(",")
    f"outer($raw)"
  }

  // Read from array. Note that shape and offset should be passed in “wk” order (…CXYZ)
  // The local variables like chunkIndices are also in this order unless explicitly named.
  // Loading data adapts to the array's axis order so that …CXYZ data in fortran-order is
  // returned, regardless of the array’s internal storage.
  private def readAsFortranOrder(shape: Array[Int], offset: Array[Int])(implicit ec: ExecutionContext,
                                                                        tc: TokenContext): Fox[MultiArray] = {
    val totalOffset: Array[Int] = offset.zip(header.voxelOffset).map { case (o, v) => o - v }.padTo(offset.length, 0)
    val chunkIndices = ChunkUtils.computeChunkIndices(datasetShape.map(fullAxisOrder.permuteIndicesArrayToWk),
                                                      fullAxisOrder.permuteIndicesArrayToWk(chunkShape),
                                                      shape,
                                                      totalOffset)
    if (partialCopyingIsNotNeededForWkOrder(shape, totalOffset, chunkIndices)) {
      for {
        chunkIndex <- chunkIndices.headOption.toFox
        sourceChunk: MultiArray <- getSourceChunkDataWithCache(fullAxisOrder.permuteIndicesWkToArray(chunkIndex),
                                                               useSkipTypingShortcut = true)
      } yield sourceChunk
    } else {
      val targetBuffer = MultiArrayUtils.createDataBuffer(header.resolvedDataType, shape)
      val targetMultiArray = MultiArrayUtils.createArrayWithGivenStorage(targetBuffer, shape.reverse)
      val copiedFuture = Fox.combined(chunkIndices.map { chunkIndex: Array[Int] =>
        for {
          sourceChunk: MultiArray <- getSourceChunkDataWithCache(fullAxisOrder.permuteIndicesWkToArray(chunkIndex))
          sourceChunkInWkFOrder: MultiArray = MultiArrayUtils
            .axisOrderXYZViewF(sourceChunk, fullAxisOrder, sourceIsF = header.order == ArrayOrder.F)
          offsetInChunkFOrder = computeOffsetInChunk(chunkIndex, totalOffset).reverse
          _ <- tryo(MultiArrayUtils.copyRange(offsetInChunkFOrder, sourceChunkInWkFOrder, targetMultiArray)).toFox ?~> formatCopyRangeError(
            offsetInChunkFOrder,
            sourceChunkInWkFOrder,
            targetMultiArray)
        } yield ()
      })
      for {
        _ <- copiedFuture
      } yield targetMultiArray
    }
  }

  def readAsMultiArray(shape: Array[Int], offset: Array[Int])(implicit ec: ExecutionContext,
                                                              tc: TokenContext): Fox[MultiArray] = {
    val totalOffset: Array[Int] = offset.zip(header.voxelOffset).map { case (o, v) => o - v }.padTo(offset.length, 0)
    val chunkIndices = ChunkUtils.computeChunkIndices(datasetShape, chunkShape, shape, totalOffset)
    if (partialCopyingIsNotNeededForMultiArray(shape, totalOffset, chunkIndices)) {
      for {
        chunkIndex <- chunkIndices.headOption.toFox
        sourceChunk: MultiArray <- getSourceChunkDataWithCache(chunkIndex, useSkipTypingShortcut = true)
      } yield sourceChunk
    } else {
      val targetBuffer = MultiArrayUtils.createDataBuffer(header.resolvedDataType, shape)
      val targetMultiArray = MultiArrayUtils.createArrayWithGivenStorage(targetBuffer, shape.reverse)
      val copiedFuture = Fox.combined(chunkIndices.map { chunkIndex: Array[Int] =>
        for {
          sourceChunk: MultiArray <- getSourceChunkDataWithCache(chunkIndex)
          offsetInChunk = computeOffsetInChunkIgnoringAxisOrder(chunkIndex, totalOffset).reverse
          _ <- tryo(MultiArrayUtils.copyRange(offsetInChunk, sourceChunk, targetMultiArray)).toFox ?~> formatCopyRangeErrorWithoutAxisOrder(
            offsetInChunk,
            sourceChunk,
            targetMultiArray)
        } yield ()
      })
      for {
        _ <- copiedFuture
      } yield targetMultiArray
    }
  }

  private def formatCopyRangeError(offsetInChunk: Array[Int], sourceChunk: MultiArray, target: MultiArray): String =
    s"Copying data from dataset chunk failed. Chunk shape (F): ${printAsOuterF(sourceChunk.getShape)}, target shape (F): ${printAsOuterF(
      target.getShape)}, offsetInChunk: ${printAsOuterF(offsetInChunk)}. Axis order (C): $fullAxisOrder (outer: ${fullAxisOrder.toStringWk})"

  private def formatCopyRangeErrorWithoutAxisOrder(offsetInChunk: Array[Int],
                                                   sourceChunk: MultiArray,
                                                   target: MultiArray): String =
    s"Copying data from dataset chunk failed. Chunk shape ${sourceChunk.getShape.mkString(",")}, target shape ${target.getShape
      .mkString(",")}, offsetInChunk: ${offsetInChunk.mkString(",")}"

  protected def getShardedChunkPathAndRange(
      chunkIndex: Array[Int])(implicit ec: ExecutionContext, tc: TokenContext): Fox[(VaultPath, NumericRange[Long])] =
    ??? // Defined in subclass

  private def chunkContentsCacheKey(chunkIndex: Array[Int]): String =
    s"${dataSourceId}__${layerName}__${vaultPath}__chunk_${chunkIndex.mkString(",")}"

  private def getSourceChunkDataWithCache(chunkIndex: Array[Int], useSkipTypingShortcut: Boolean = false)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[MultiArray] =
    // Note: we omit the tokenContext from the cacheKey because (a) Failures aren’t cached anyway and (b) the dataset access is checked again in the controllers. Omitting it here prevents wasteful data duplicates in the cache.
    sharedChunkContentsCache.getOrLoad(chunkContentsCacheKey(chunkIndex),
                                       _ => readSourceChunkData(chunkIndex, useSkipTypingShortcut))

  private def readSourceChunkData(chunkIndex: Array[Int], useSkipTypingShortcut: Boolean)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[MultiArray] =
    if (header.isSharded) {
      for {
        (shardPath, chunkRange) <- getShardedChunkPathAndRange(chunkIndex) ?~> "chunk.getShardedPathAndRange.failed"
        chunkShape = chunkShapeAtIndex(chunkIndex)
        multiArray <- chunkReader.read(shardPath, chunkShape, Some(chunkRange), useSkipTypingShortcut)
      } yield multiArray
    } else {
      val chunkPath = vaultPath / getChunkFilename(chunkIndex)
      val chunkShape = chunkShapeAtIndex(chunkIndex)
      chunkReader.read(chunkPath, chunkShape, None, useSkipTypingShortcut)
    }

  protected def getChunkFilename(chunkIndex: Array[Int]): String =
    if (axisOrder.hasZAxis) {
      chunkIndex.mkString(header.dimension_separator.toString)
    } else {
      chunkIndex.drop(1).mkString(header.dimension_separator.toString) // (c),x,y,z -> z is dropped in 2d case
    }

  private def partialCopyingIsNotNeededForMultiArray(bufferShape: Array[Int],
                                                     globalOffset: Array[Int],
                                                     chunkIndices: List[Array[Int]]): Boolean =
    chunkIndices match {
      case chunkIndex :: Nil =>
        val offsetInChunk = computeOffsetInChunkIgnoringAxisOrder(chunkIndex, globalOffset)
        isZeroOffset(offsetInChunk) &&
        isBufferShapeEqualChunkShape(bufferShape)
      case _ => false
    }

  private def partialCopyingIsNotNeededForWkOrder(bufferShape: Array[Int],
                                                  globalOffset: Array[Int],
                                                  chunkIndices: List[Array[Int]]): Boolean =
    chunkIndices match {
      case chunkIndex :: Nil =>
        val offsetInChunk = computeOffsetInChunk(chunkIndex, globalOffset)
        header.order == ArrayOrder.F &&
        isZeroOffset(offsetInChunk) &&
        isBufferShapeEqualChunkShape(bufferShape) &&
        axisOrder == AxisOrder.asCxyzFromRank(rank)
      case _ => false
    }

  private def isBufferShapeEqualChunkShape(bufferShape: Array[Int]): Boolean =
    util.Arrays.equals(bufferShape, chunkShape)

  private def isZeroOffset(offset: Array[Int]): Boolean =
    util.Arrays.equals(offset, new Array[Int](offset.length))

  private def computeOffsetInChunk(chunkIndex: Array[Int], globalOffset: Array[Int]): Array[Int] =
    chunkIndex.indices.map { dim =>
      globalOffset(dim) - (chunkIndex(dim) * fullAxisOrder.permuteIndicesArrayToWk(chunkShape)(dim))
    }.toArray

  private def computeOffsetInChunkIgnoringAxisOrder(chunkIndex: Array[Int], globalOffset: Array[Int]): Array[Int] =
    chunkIndex.indices.map { dim =>
      globalOffset(dim) - (chunkIndex(dim) * chunkShape(dim))
    }.toArray

  override def toString: String =
    s"${getClass.getCanonicalName} fullAxisOrder=$fullAxisOrder shape=${header.datasetShape.map(s => printAsInner(s))} chunkShape=${printAsInner(
      header.chunkShape)} dtype=${header.resolvedDataType} fillValue=${header.fillValueNumber}, ${header.compressorImpl}, byteOrder=${header.byteOrder}, vault=${vaultPath.summary}}"

}

object DatasetArray {
  private val chunkSizeLimitBytes: Int = 300 * 1024 * 1024

  def assertChunkSizeLimit(bytesPerChunk: Int)(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.fromBool(bytesPerChunk <= chunkSizeLimitBytes) ?~> f"Array chunk size exceeds limit of $chunkSizeLimitBytes, got $bytesPerChunk"
}
