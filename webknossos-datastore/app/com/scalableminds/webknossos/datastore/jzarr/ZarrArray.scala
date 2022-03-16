package com.scalableminds.webknossos.datastore.jzarr

import java.io.IOException
import java.nio.file.{Path, Paths}
import java.util

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.geometry.Vec3Int
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}
import ucar.ma2.{InvalidRangeException, Array => MultiArray}

import scala.io.Source

object ZarrArray extends LazyLogging {
  private val chunkSizeLimitBytes = 64 * 1024 * 1024

  @throws[IOException]
  def open(path: String): ZarrArray =
    open(Paths.get(path))

  @throws[IOException]
  def open(fileSystemPath: Path): ZarrArray =
    open(new FileSystemStore(fileSystemPath))

  @throws[IOException]
  def open(store: Store): ZarrArray =
    open(new ZarrPath(""), store)

  @throws[IOException]
  def open(relativePath: ZarrPath, store: Store): ZarrArray = {
    val headerPath = relativePath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)
    val headerInputStream = store.getInputStream(headerPath.storeKey)
    try {
      if (headerInputStream == null)
        throw new IOException(
          "'" + ZarrHeader.FILENAME_DOT_ZARRAY + "' expected but is not readable or missing in store.")
      val headerString = Source.fromInputStream(headerInputStream).mkString
      logger.info(headerString)
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
      new ZarrArray(relativePath, store, header)
    } finally if (headerInputStream != null) headerInputStream.close()
  }

}

class ChunkContentsCache(maxSizeBytes: Int, bytesPerEntry: Int) extends LRUConcurrentCache[String, MultiArray] {
  def maxEntries: Int = maxSizeBytes / bytesPerEntry
}

class ZarrArray(relativePath: ZarrPath, store: Store, header: ZarrHeader) extends LazyLogging {

  final private val chunkReaderWriter =
    ChunkReader.create(store, header)

  // cache currently limited to 100 MB per array
  lazy val chunkContentsCache: ChunkContentsCache =
    new ChunkContentsCache(maxSizeBytes = 1000 * 1000 * 100, bytesPerEntry = header.bytesPerChunk)

  @throws[IOException]
  @throws[InvalidRangeException]
  def readBytesXYZ(shape: Vec3Int, offset: Vec3Int): Array[Byte] = {
    // Assumes that the last three dimensions of the array are x, y, z
    val paddingDimensionsCount = header.shape.length - 3
    val offsetArray = Array.fill(paddingDimensionsCount)(0) :+ offset.x :+ offset.y :+ offset.z
    val shapeArray = Array.fill(paddingDimensionsCount)(1) :+ shape.x :+ shape.y :+ shape.z

    readBytes(shapeArray, offsetArray)
  }

  @throws[IOException]
  @throws[InvalidRangeException]
  def readBytes(shape: Array[Int], offset: Array[Int]): Array[Byte] =
    BytesConverter.toByteArray(read(shape, offset), header.dataType, header.byteOrder)

  @throws[IOException]
  @throws[InvalidRangeException]
  def read(shape: Array[Int], offset: Array[Int]): Object = {
    val buffer = MultiArrayUtils.createDataBuffer(header.dataType, shape)
    val chunkIndices = ChunkUtils.computeChunkIndices(header.shape, header.chunks, shape, offset)
    for (chunkIndex <- chunkIndices) {
      val sourceChunk: MultiArray = getSourceChunkDataWithCache(chunkIndex)
      val offsetInChunk = computeOffsetInChunk(chunkIndex, offset)
      if (partialCopyingIsNotNeeded(shape, offsetInChunk))
        System.arraycopy(sourceChunk.getStorage, 0, buffer, 0, sourceChunk.getSize.toInt)
      else {
        val target = MultiArrayUtils.createArrayWithGivenStorage(buffer, shape)
        println(
          s"Copying at global offset ${offset.toList} (offset in chunk: ${offsetInChunk.toList}) from chunk ${chunkIndex.toList} to buffer with shape ${shape.toList}")
        MultiArrayUtils.copyRange(offsetInChunk, sourceChunk, target)
      }
    }
    MultiArrayUtils.flipOrder(MultiArrayUtils.createArrayWithGivenStorage(buffer, shape)).getStorage
  }

  private def getSourceChunkDataWithCache(chunkIndex: Array[Int]): MultiArray = {
    val chunkFilename = getChunkFilename(chunkIndex)
    val chunkFilePath = relativePath.resolve(chunkFilename)
    val storeKey = chunkFilePath.storeKey
    chunkContentsCache.getOrLoad(storeKey)(chunkReaderWriter.readAsCOrder)
  }

  private def getChunkFilename(chunkIndex: Array[Int]): String =
    chunkIndex.mkString(header.dimension_separator.toString)

  private def partialCopyingIsNotNeeded(bufferShape: Array[Int], offset: Array[Int]): Boolean =
    isZeroOffset(offset) && isBufferShapeEqualChunkShape(bufferShape)

  private def isBufferShapeEqualChunkShape(bufferShape: Array[Int]): Boolean =
    util.Arrays.equals(bufferShape, header.chunks)

  private def isZeroOffset(offset: Array[Int]): Boolean =
    util.Arrays.equals(offset, new Array[Int](offset.length))

  override def toString: String =
    s"${getClass.getCanonicalName} {'/${relativePath.storeKey}' shape=${header.shape.mkString(",")} chunks=${header.chunks
      .mkString(",")} dtype=${header.dtype} fillValue=${header.fillValueNumber}, ${header.compressorImpl}, byteOrder=${header.byteOrder}, store=${store.getClass.getSimpleName}}"

  private def computeOffsetInChunk(chunkIndex: Array[Int], globalOffset: Array[Int]): Array[Int] =
    chunkIndex.zipWithIndex.map {
      case (chunkIndexInDim, dim) =>
        globalOffset(dim) - (chunkIndexInDim * header.chunks(dim))
    }
}
