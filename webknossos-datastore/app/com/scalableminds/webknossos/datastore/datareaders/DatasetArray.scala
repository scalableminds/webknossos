package com.scalableminds.webknossos.datastore.datareaders

import akka.http.caching.scaladsl.Cache
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.webknossos.datastore.datareaders.jzarr.BytesConverter
import com.typesafe.scalalogging.LazyLogging
import ucar.ma2.{InvalidRangeException, Array => MultiArray}

import java.io.IOException
import java.nio.ByteOrder
import java.util
import scala.concurrent.{ExecutionContext, Future}

class DatasetArray(relativePath: DatasetPath, store: FileSystemStore, header: DatasetHeader, axisOrder: AxisOrder)
    extends LazyLogging {

  protected val chunkReader: ChunkReader =
    ChunkReader.create(store, header)

  // cache currently limited to 100 MB per array
  private lazy val chunkContentsCache: Cache[String, MultiArray] = {
    val maxSizeBytes = 1000 * 1000 * 100
    val maxEntries = maxSizeBytes / header.bytesPerChunk
    AlfuCache(maxEntries)
  }

  // @return Byte array in fortran-order with little-endian values
  @throws[IOException]
  @throws[InvalidRangeException]
  def readBytesXYZ(shape: Vec3Int, offset: Vec3Int)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val paddingDimensionsCount = header.rank - 3
    val offsetArray = Array.fill(paddingDimensionsCount)(0) :+ offset.x :+ offset.y :+ offset.z
    val shapeArray = Array.fill(paddingDimensionsCount)(1) :+ shape.x :+ shape.y :+ shape.z

    readBytes(shapeArray, offsetArray)
  }

  // @return Byte array in fortran-order with little-endian values
  @throws[IOException]
  @throws[InvalidRangeException]
  private def readBytes(shape: Array[Int], offset: Array[Int])(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      typedData <- readAsFortranOrder(shape, offset)
    } yield BytesConverter.toByteArray(typedData, header.resolvedDataType, ByteOrder.LITTLE_ENDIAN)

  // Read from array. Note that shape and offset should be passed in XYZ order, left-padded with 0 and 1 respectively.
  // This function will internally adapt to the array's axis order so that XYZ data in fortran-order is returned.
  @throws[IOException]
  @throws[InvalidRangeException]
  private def readAsFortranOrder(shape: Array[Int], offset: Array[Int])(implicit ec: ExecutionContext): Fox[Object] = {
    val chunkIndices = ChunkUtils.computeChunkIndices(axisOrder.permuteIndicesReverse(header.datasetShape),
                                                      axisOrder.permuteIndicesReverse(header.chunkSize),
                                                      shape,
                                                      offset)
    if (partialCopyingIsNotNeeded(shape, offset, chunkIndices)) {
      for {
        chunkIndex <- chunkIndices.headOption.toFox
        sourceChunk: MultiArray <- getSourceChunkDataWithCache(axisOrder.permuteIndices(chunkIndex))
      } yield sourceChunk.getStorage
    } else {
      val targetBuffer = MultiArrayUtils.createDataBuffer(header.resolvedDataType, shape)
      val targetInCOrder: MultiArray =
        MultiArrayUtils.orderFlippedView(MultiArrayUtils.createArrayWithGivenStorage(targetBuffer, shape.reverse))
      val wasCopiedFox = Fox.serialCombined(chunkIndices) { chunkIndex: Array[Int] =>
        for {
          sourceChunk: MultiArray <- getSourceChunkDataWithCache(axisOrder.permuteIndices(chunkIndex))
          offsetInChunk = computeOffsetInChunk(chunkIndex, offset)
          sourceChunkInCOrder: MultiArray = MultiArrayUtils.axisOrderXYZView(sourceChunk,
                                                                             axisOrder,
                                                                             flip = header.order != ArrayOrder.C)
          _ = MultiArrayUtils.copyRange(offsetInChunk, sourceChunkInCOrder, targetInCOrder)
        } yield ()
      }
      for {
        _ <- wasCopiedFox
      } yield targetBuffer
    }
  }

  private def getSourceChunkDataWithCache(chunkIndex: Array[Int]): Future[MultiArray] = {
    val chunkFilename = getChunkFilename(chunkIndex)
    val chunkFilePath = relativePath.resolve(chunkFilename)
    val storeKey = chunkFilePath.storeKey

    chunkContentsCache.getOrLoad(storeKey, chunkReader.read)
  }

  private def getChunkFilename(chunkIndex: Array[Int]): String =
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
    s"${getClass.getCanonicalName} {'/${relativePath.storeKey}' axisOrder=$axisOrder shape=${header.datasetShape.mkString(
      ",")} chunks=${header.chunkSize.mkString(",")} dtype=${header.dataType} fillValue=${header.fillValueNumber}, ${header.compressorImpl}, byteOrder=${header.byteOrder}, store=${store.getClass.getSimpleName}}"

}

object DatasetArray {
  val chunkSizeLimitBytes: Int = 64 * 1024 * 1024
}
