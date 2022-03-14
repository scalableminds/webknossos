package com.scalableminds.webknossos.datastore.jzarr

import java.io.IOException
import java.nio.file.{Path, Paths}
import java.util

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.JsonHelper
import com.scalableminds.webknossos.datastore.jzarr.ZarrConstants.FILENAME_DOT_ZARRAY
import com.scalableminds.webknossos.datastore.jzarr.chunk.ChunkReader
import com.scalableminds.webknossos.datastore.jzarr.storage.{FileSystemStore, Store}
import com.scalableminds.webknossos.datastore.jzarr.ucarutils.{BytesConverter, NetCDF_Util, PartialDataCopier}
import ucar.ma2.{InvalidRangeException, Array => Ma2Array}

import scala.io.Source

object ZarrArray {
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
    val headerPath = relativePath.resolve(FILENAME_DOT_ZARRAY)
    val headerInputStream = store.getInputStream(headerPath.storeKey)
    try {
      if (headerInputStream == null)
        throw new IOException("'" + FILENAME_DOT_ZARRAY + "' expected but is not readable or missing in store.")
      val headerString = Source.fromInputStream(headerInputStream).mkString
      val header: ZarrHeader = JsonHelper
        .parseJsonToBox[ZarrHeader](headerString)
        .openOrThrowException("Error handling in jzarr currently done via exceptions")
      new ZarrArray(relativePath, store, header)
    } finally if (headerInputStream != null) headerInputStream.close()
  }

}

class ChunkContentsCache(maxSizeBytes: Int, bytesPerEntry: Int) extends LRUConcurrentCache[String, Ma2Array] {
  def maxEntries: Int = maxSizeBytes / bytesPerEntry
}

class ZarrArray(relativePath: ZarrPath, store: Store, header: ZarrHeader) {

  final private val _chunkReaderWriter =
    ChunkReader.create(store, header)

  // cache currently limited to 100 MB per array
  lazy val _chunkContentsCache: ChunkContentsCache =
    new ChunkContentsCache(maxSizeBytes = 1000 * 1000 * 100, bytesPerEntry = header.bytesPerChunk)

  @throws[IOException]
  @throws[InvalidRangeException]
  def readBytesXYZ(shape: Vec3Int, offset: Vec3Int): Array[Byte] = {
    // TODO. Determine order. This currently assumes z, y, x are the last three entries
    val paddingDimensionsCount = header.shape.length - 3
    val offsetArray = Array.fill(paddingDimensionsCount)(0) :+ offset.z :+ offset.y :+ offset.x
    val shapeArray = Array.fill(paddingDimensionsCount)(1) :+ shape.z :+ shape.y :+ shape.x

    // TODO transpose?
    readBytes(shapeArray, offsetArray)
  }

  @throws[IOException]
  @throws[InvalidRangeException]
  def readBytes(shape: Array[Int], offset: Array[Int]): Array[Byte] =
    BytesConverter.toByteArray(read(shape, offset), header.dataType, header.byteOrder)

  @throws[IOException]
  @throws[InvalidRangeException]
  def read(shape: Array[Int], offset: Array[Int]): Object = {
    val buffer = ZarrUtils.createDataBuffer(header.dataType, shape)
    val chunkIndices = ZarrUtils.computeChunkIndices(header.shape, header.chunks, shape, offset)
    for (chunkIndex <- chunkIndices) {
      val sourceChunk: Ma2Array = getSourceChunkDataWithCache(chunkIndex)
      val offsetInChunk = computeOffsetInChunk(chunkIndex, offset)
      if (partialCopyingIsNotNeeded(shape, offsetInChunk))
        System.arraycopy(sourceChunk.getStorage, 0, buffer, 0, sourceChunk.getSize.toInt)
      else {
        val target = NetCDF_Util.createArrayWithGivenStorage(buffer, shape)
        PartialDataCopier.copy(offsetInChunk, sourceChunk, target)
      }
    }
    buffer
  }

  private def getSourceChunkDataWithCache(chunkIndex: Array[Int]): Ma2Array = {
    val chunkFilename = getChunkFilename(chunkIndex)
    val chunkFilePath = relativePath.resolve(chunkFilename)
    val storeKey = chunkFilePath.storeKey
    _chunkContentsCache.getOrLoad(storeKey)(getSourceChunkData)
  }

  private def getSourceChunkData(chunkStoreKey: String): Ma2Array =
    _chunkReaderWriter.read(chunkStoreKey)

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
      .mkString(",")} dtype=${header.dtype} fillValue=${header.fill_value}, ${header.compressorImpl}, byteOrder=${header.byteOrder}, store=${store.getClass.getSimpleName}}"

  private def computeOffsetInChunk(chunkIndex: Array[Int], globalOffset: Array[Int]): Array[Int] =
    chunkIndex.zipWithIndex.map {
      case (chunkIndexInDim, dim) =>
        -(chunkIndexInDim * header.chunks(dim) - globalOffset(dim))
    }
}
