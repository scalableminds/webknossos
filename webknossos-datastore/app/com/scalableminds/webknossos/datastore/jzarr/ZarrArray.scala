package com.scalableminds.webknossos.datastore.jzarr

import java.io.IOException
import java.nio.ByteOrder
import java.nio.file.Path
import java.util

import akka.http.caching.scaladsl.Cache
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}
import ucar.ma2.{InvalidRangeException, Array => MultiArray}

import scala.concurrent.{ExecutionContext, Future}
import scala.io.Source

object ZarrArray extends LazyLogging {
  private val chunkSizeLimitBytes = 64 * 1024 * 1024

  @throws[IOException]
  def open(path: Path, axisOrderOpt: Option[AxisOrder]): ZarrArray = {
    val store = new FileSystemStore(path)
    val rootPath = new ZarrPath("")
    val headerPath = rootPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)
    val headerInputStream = store.getInputStream(headerPath.storeKey)
    try {
      if (headerInputStream == null)
        throw new IOException(
          "'" + ZarrHeader.FILENAME_DOT_ZARRAY + "' expected but is not readable or missing in store.")
      val headerString = Source.fromInputStream(headerInputStream).mkString
      val header: ZarrHeader =
        Json.parse(headerString).validate[ZarrHeader] match {
          case JsSuccess(parsedHeader, _) =>
            parsedHeader
          case errors: JsError =>
            throw new Exception("Validating json as zarr header failed: " + JsError.toJson(errors).toString())
        }
      if (header.bytesPerChunk > chunkSizeLimitBytes) {
        throw new IllegalArgumentException(
          f"Chunk size of this Zarr Array exceeds limit of $chunkSizeLimitBytes, got ${header.bytesPerChunk}")
      }
      new ZarrArray(rootPath, store, header, axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(header.rank)))
    } finally if (headerInputStream != null) headerInputStream.close()
  }

}

class ZarrArray(relativePath: ZarrPath, store: Store, header: ZarrHeader, axisOrder: AxisOrder) extends LazyLogging {

  private val chunkReader =
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
    } yield BytesConverter.toByteArray(typedData, header.dataType, ByteOrder.LITTLE_ENDIAN)

  // Read from array. Note that shape and offset should be passed in XYZ order, left-padded with 0 and 1 respectively.
  // This function will internally adapt to the array's axis order so that XYZ data in fortran-order is returned.
  @throws[IOException]
  @throws[InvalidRangeException]
  private def readAsFortranOrder(shape: Array[Int], offset: Array[Int])(implicit ec: ExecutionContext): Fox[Object] = {
    val chunkIndices = ChunkUtils.computeChunkIndices(axisOrder.permuteIndicesReverse(header.shape),
                                                      axisOrder.permuteIndicesReverse(header.chunks),
                                                      shape,
                                                      offset)
    if (partialCopyingIsNotNeeded(shape, offset, chunkIndices)) {
      for {
        chunkIndex <- chunkIndices.headOption.toFox
        sourceChunk: MultiArray <- getSourceChunkDataWithCache(axisOrder.permuteIndices(chunkIndex))
      } yield sourceChunk.getStorage
    } else {
      val targetBuffer = MultiArrayUtils.createDataBuffer(header.dataType, shape)
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
        axisOrder == AxisOrder.asXyzFromRank(header.rank)
      case _ => false
    }

  private def isBufferShapeEqualChunkShape(bufferShape: Array[Int]): Boolean =
    util.Arrays.equals(bufferShape, header.chunks)

  private def isZeroOffset(offset: Array[Int]): Boolean =
    util.Arrays.equals(offset, new Array[Int](offset.length))

  private def computeOffsetInChunk(chunkIndex: Array[Int], globalOffset: Array[Int]): Array[Int] =
    chunkIndex.indices.map { dim =>
      globalOffset(dim) - (chunkIndex(dim) * axisOrder.permuteIndicesReverse(header.chunks)(dim))
    }.toArray

  override def toString: String =
    s"${getClass.getCanonicalName} {'/${relativePath.storeKey}' axisOrder=$axisOrder shape=${header.shape.mkString(",")} chunks=${header.chunks
      .mkString(",")} dtype=${header.dtype} fillValue=${header.fillValueNumber}, ${header.compressorImpl}, byteOrder=${header.byteOrder}, store=${store.getClass.getSimpleName}}"

}
