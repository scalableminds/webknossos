package com.scalableminds.webknossos.datastore.jzarr

import java.io.{BufferedReader, IOException, InputStreamReader}
import java.nio.ByteOrder
import java.nio.file.{Path, Paths}
import java.util

import com.scalableminds.webknossos.datastore.jzarr.CompressorFactory.nullCompressor
import com.scalableminds.webknossos.datastore.jzarr.ZarrConstants.FILENAME_DOT_ZARRAY
import com.scalableminds.webknossos.datastore.jzarr.chunk.ChunkReaderWriter
import com.scalableminds.webknossos.datastore.jzarr.storage.{FileSystemStore, Store}
import com.scalableminds.webknossos.datastore.jzarr.ucarutils.{NetCDF_Util, PartialDataCopier}
import ucar.ma2.{InvalidRangeException, Array => Ma2Array}

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
    val zarrHeaderPath = relativePath.resolve(FILENAME_DOT_ZARRAY)
    val storageStream = store.getInputStream(zarrHeaderPath.storeKey)
    try {
      if (storageStream == null)
        throw new IOException("'" + FILENAME_DOT_ZARRAY + "' expected but is not readable or missing in store.")
      val reader = new BufferedReader(new InputStreamReader(storageStream))
      try {
        val header = ZarrUtils.fromJson(reader, classOf[ZarrHeader])
        val shape = header.getShape
        val chunks = header.getChunks
        val dataType = header.getRawDataType
        val byteOrder = header.getByteOrder
        val fillValue = header.getFill_value
        var compressor = header.getCompressor
        if (compressor == null) compressor = nullCompressor
        var separator = header.getDimensionSeparator
        if (separator == null) separator = DimensionSeparator.DOT
        new ZarrArray(relativePath, shape, chunks, dataType, byteOrder, fillValue, compressor, separator, store)
      } finally if (reader != null) reader.close()
    } finally if (storageStream != null) storageStream.close()
  }
}

class ZarrArray private (relativePath: ZarrPath,
                         _shape: Array[Int],
                         _chunkShape: Array[Int],
                         _dataType: DataType,
                         _byteOrder: ByteOrder,
                         _fillValue: Number,
                         _compressor: Compressor,
                         _separator: DimensionSeparator,
                         _store: Store) {

  final private val _chunkReaderWriter =
    ChunkReaderWriter.create(_compressor, _dataType, _byteOrder, _chunkShape, _fillValue, _store)
  final private val _chunkContentsCache = new util.HashMap[String, Ma2Array]
  if (_separator == null) throw new IllegalArgumentException("separator must not be null")

  def getCompressor: Compressor = _compressor
  def getDataType: DataType = _dataType
  def getShape: Array[Int] = util.Arrays.copyOf(_shape, _shape.length)
  def getChunks: Array[Int] = util.Arrays.copyOf(_chunkShape, _chunkShape.length)
  def getFillValue: Number = _fillValue
  def getByteOrder: ByteOrder = _byteOrder

  @throws[IOException]
  @throws[InvalidRangeException]
  def read: Object = read(getShape)

  @throws[IOException]
  @throws[InvalidRangeException]
  def read(shape: Array[Int]): Object = read(shape, new Array[Int](shape.length))

  @throws[IOException]
  @throws[InvalidRangeException]
  def read(shape: Array[Int], offset: Array[Int]): Object = {
    val data = ZarrUtils.createDataBuffer(getDataType, shape)
    read(data, shape, offset)
    data
  }

  @throws[IOException]
  @throws[InvalidRangeException]
  def read(buffer: Any, bufferShape: Array[Int]): Unit = read(buffer, bufferShape, new Array[Int](bufferShape.length))

  @throws[IOException]
  @throws[InvalidRangeException]
  def read(buffer: Any, bufferShape: Array[Int], offset: Array[Int]): Unit = {
    if (!buffer.getClass.isArray) throw new IOException("Target buffer object is not an array.")
    val targetSize = java.lang.reflect.Array.getLength(buffer)
    val expectedSize = ZarrUtils.computeSize(bufferShape)
    if (targetSize != expectedSize)
      throw new IOException("Expected target buffer size is " + expectedSize + " but was " + targetSize)
    val chunkIndices = ZarrUtils.computeChunkIndices(_shape, _chunkShape, bufferShape, offset)
    for (chunkIndex <- chunkIndices) {
      val sourceChunk: Ma2Array = getSourceChunkData(chunkIndex)
      val offsetInChunk = computeOffsetInChunk(chunkIndex, offset)
      if (partialCopyingIsNotNeeded(bufferShape, offsetInChunk))
        System.arraycopy(sourceChunk.getStorage, 0, buffer, 0, sourceChunk.getSize.toInt)
      else {
        val target = NetCDF_Util.createArrayWithGivenStorage(buffer, bufferShape)
        PartialDataCopier.copy(offsetInChunk, sourceChunk, target)
      }
    }
  }

  private def getSourceChunkData(chunkIndex: Array[Int]): Ma2Array = {
    val chunkFilename = getChunkFilename(chunkIndex)
    val chunkFilePath = relativePath.resolve(chunkFilename)
    if (_chunkContentsCache.containsKey(chunkFilename)) {
      return _chunkContentsCache.get(chunkFilename)
    }
    val data = _chunkReaderWriter.read(chunkFilePath.storeKey)
    _chunkContentsCache.put(chunkFilename, data)
    data
  }

  private def getChunkFilename(chunkIndex: Array[Int]): String =
    chunkIndex.mkString(_separator.getSeparatorChar)

  private def partialCopyingIsNotNeeded(bufferShape: Array[Int], offset: Array[Int]): Boolean =
    isZeroOffset(offset) && isBufferShapeEqualChunkShape(bufferShape)

  private def isBufferShapeEqualChunkShape(bufferShape: Array[Int]): Boolean =
    util.Arrays.equals(bufferShape, _chunkShape)

  private def isZeroOffset(offset: Array[Int]): Boolean =
    util.Arrays.equals(offset, new Array[Int](offset.length))

  @throws[IOException]
  def getAttributes: util.Map[String, AnyRef] =
    ZarrUtils.readAttributes(relativePath, _store)

  override def toString: String =
    s"${getClass.getCanonicalName} {'/${relativePath.storeKey}' shape=${_shape.mkString(",")} chunks=${_chunkShape
      .mkString(",")} dtype=${_dataType} fillValue=${_fillValue}, ${_compressor}, store=${_store.getClass.getSimpleName}, byteOrder=${_byteOrder}}"

  private def computeOffsetInChunk(chunkIndex: Array[Int], globalOffset: Array[Int]): Array[Int] =
    chunkIndex.zipWithIndex.map {
      case (chunkIndexInDim, dim) =>
        -(chunkIndexInDim * _chunkShape(dim) - globalOffset(dim))
    }
}
