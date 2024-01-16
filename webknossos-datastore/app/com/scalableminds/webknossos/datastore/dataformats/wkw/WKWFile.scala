package com.scalableminds.webknossos.datastore.dataformats.wkw

import java.io._
import java.nio.channels.FileChannel
import java.nio.file.{Files, Paths, StandardCopyOption}
import org.apache.commons.io.IOUtils
import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.tools.BoxImplicits
import com.scalableminds.webknossos.datastore.dataformats.wkw.util.ExtendedMappedByteBuffer
import com.scalableminds.webknossos.datastore.dataformats.wkw.util.ResourceBox
import net.jpountz.lz4.LZ4Factory
import net.liftweb.common.{Box, Failure, Full}
import net.liftweb.common.Box.tryo

object FileMode extends Enumeration {
  val Read, ReadWrite = Value
}

trait WKWMortonHelper {

  protected def mortonEncode(x: Int, y: Int, z: Int): Int = {
    var morton = 0
    val bitLength = math.ceil(math.log(List(x, y, z).max + 1) / math.log(2)).toInt

    (0 until bitLength).foreach { i =>
      morton |= ((x & (1 << i)) << (2 * i)) |
        ((y & (1 << i)) << (2 * i + 1)) |
        ((z & (1 << i)) << (2 * i + 2))
    }
    morton
  }

  protected def mortonDecode(mortonIndex: Long): (Int, Int, Int) = {
    var morton = mortonIndex
    var x = 0
    var y = 0
    var z = 0
    var bit = 0

    while (morton > 0) {
      x |= ((morton & 1) << bit).toInt
      morton >>= 1
      y |= ((morton & 1) << bit).toInt
      morton >>= 1
      z |= ((morton & 1) << bit).toInt
      morton >>= 1
      bit += 1
    }
    (x, y, z)
  }
}

trait WKWCompressionHelper extends BoxImplicits {

  protected def error(msg: String): String =
    s"""Error processing WKW file: $msg."""

  protected def error(msg: String, expected: Any, actual: Any): String =
    s"""Error processing WKW file: $msg [expected: $expected, actual: $actual]."""

  private lazy val lz4Decompressor = LZ4Factory.nativeInstance().fastDecompressor()

  private lazy val lz4FastCompressor = LZ4Factory.nativeInstance().fastCompressor()

  private lazy val lz4HighCompressor = LZ4Factory.nativeInstance().highCompressor()

  protected def compressChunk(targetChunkType: ChunkType.Value)(rawChunk: Array[Byte]): Box[Array[Byte]] = {
    val result = targetChunkType match {
      case ChunkType.LZ4 | ChunkType.LZ4HC =>
        val compressor = if (targetChunkType == ChunkType.LZ4) lz4FastCompressor else lz4HighCompressor
        val maxCompressedLength = compressor.maxCompressedLength(rawChunk.length)
        val compressedChunk = Array.ofDim[Byte](maxCompressedLength)
        tryo(compressor.compress(rawChunk, compressedChunk)).map { compressedLength =>
          compressedChunk.slice(0, compressedLength)
        }
      case ChunkType.Raw =>
        Full(rawChunk)
      case _ =>
        Failure(error("Invalid targetChunkType for compression"))
    }
    result
  }

  protected def decompressChunk(sourceChunkType: ChunkType.Value, numBytesPerChunk: Int)(
      compressedChunk: Array[Byte]): Box[Array[Byte]] = {
    val result = sourceChunkType match {
      case ChunkType.LZ4 | ChunkType.LZ4HC =>
        val rawChunk: Array[Byte] = Array.ofDim[Byte](numBytesPerChunk)
        for {
          bytesDecompressed <- tryo(lz4Decompressor.decompress(compressedChunk, rawChunk, numBytesPerChunk))
          _ <- bool2Box(bytesDecompressed == compressedChunk.length) ?~! error(
            "Decompressed unexpected number of bytes",
            compressedChunk.length,
            bytesDecompressed)
        } yield {
          rawChunk
        }
      case ChunkType.Raw =>
        Full(compressedChunk)
      case _ =>
        Failure(error("Invalid sourceChunkType for decompression"))
    }
    result
  }
}

class WKWFile(val header: WKWHeader,
              fileMode: FileMode.Value,
              underlyingFile: RandomAccessFile,
              underlyingFilePath: String)
    extends WKWCompressionHelper
    with WKWMortonHelper {

  private val channel = underlyingFile.getChannel

  private val mappedBuffers: Array[ExtendedMappedByteBuffer] = mapBuffers

  private def mapBuffers: Array[ExtendedMappedByteBuffer] = {
    val mapMode = fileMode match {
      case FileMode.Read =>
        FileChannel.MapMode.READ_ONLY
      case FileMode.ReadWrite =>
        FileChannel.MapMode.READ_WRITE
    }
    (0L until underlyingFile.length by Int.MaxValue.toLong).toArray.map { offset =>
      val length = Math.min(Int.MaxValue, underlyingFile.length - offset)
      new ExtendedMappedByteBuffer(channel.map(mapMode, offset, length))
    }
  }

  private def readFromUnderlyingBuffers(offset: Long, length: Int): Box[Array[Byte]] = {
    val dest = Array.ofDim[Byte](length)
    val bufferIndex = (offset / Int.MaxValue).toInt
    val bufferOffset = (offset % Int.MaxValue).toInt
    val buffer = mappedBuffers(bufferIndex)

    if (buffer.capacity - bufferOffset < length) {
      val firstPart: Int = buffer.capacity - bufferOffset
      val secondPart = length - firstPart
      for {
        _ <- buffer.copyTo(bufferOffset, dest, 0, firstPart)
        _ <- mappedBuffers(bufferIndex + 1).copyTo(0, dest, firstPart, secondPart)
      } yield dest
    } else {
      buffer.copyTo(bufferOffset, dest, 0, length).map(_ => dest)
    }
  }

  private def writeToUnderlyingBuffers(offset: Long, data: Array[Byte]): Box[Unit] = {
    val bufferIndex = (offset / Int.MaxValue).toInt
    val bufferOffset = (offset % Int.MaxValue).toInt
    val buffer = mappedBuffers(bufferIndex)

    if (buffer.capacity - bufferOffset < data.length) {
      val firstPart: Int = buffer.capacity - bufferOffset
      val secondPart = data.length - firstPart
      buffer.copyFrom(bufferOffset, data, 0, firstPart).flatMap { _ =>
        mappedBuffers(bufferIndex + 1).copyFrom(0, data, firstPart, secondPart)
      }
    } else {
      buffer.copyFrom(bufferOffset, data, 0, data.length)
    }
  }

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
    } yield {
      mortonEncode(x, y, z)
    }

  def readChunk(x: Int, y: Int, z: Int): Box[Array[Byte]] =
    for {
      mortonIndex <- computeMortonIndex(x, y, z)
      (offset, length) <- header.blockBoundaries(mortonIndex)
      data <- readFromUnderlyingBuffers(offset, length)
      decompressedData <- decompressChunk(header.blockType, header.numBytesPerChunk)(data)
    } yield {
      decompressedData
    }

  def writeChunk(x: Int, y: Int, z: Int, data: Array[Byte]): Box[Unit] =
    for {
      _ <- bool2Box(fileMode == FileMode.ReadWrite) ?~! error("Cannot write to read-only files")
      _ <- bool2Box(!header.isCompressed) ?~! error("Cannot write to compressed files")
      _ <- bool2Box(data.length == header.numBytesPerChunk) ?~! error("Data to be written has invalid length",
                                                                      header.numBytesPerChunk,
                                                                      data.length)
      mortonIndex <- computeMortonIndex(x, y, z)
      (offset, _) <- header.blockBoundaries(mortonIndex)
      _ <- writeToUnderlyingBuffers(offset, data)
    } yield ()

  def close(): Unit = {
    channel.close()
    underlyingFile.close()
  }

  private def replaceUnderlyingFile(tempFile: File): Unit = {
    Files.move(tempFile.toPath, Paths.get(underlyingFilePath), StandardCopyOption.REPLACE_EXISTING)
    close()
  }

  private def transcodeFile(targetChunkType: ChunkType.Value)(file: RandomAccessFile): Box[Unit] = {
    val toCompressed = ChunkType.isCompressed(targetChunkType)
    val jumpTableSize = if (toCompressed) header.numChunksPerShard + 1 else 1
    val tempHeader = header.copy(blockType = targetChunkType, jumpTable = Array.ofDim[Long](jumpTableSize))
    tempHeader.writeTo(file)

    val dataOffset = file.getFilePointer
    underlyingFile.seek(header.dataOffset)

    val sourceChunkLengths = if (header.isCompressed) {
      header.jumpTable.sliding(2).map(a => (a(1) - a(0)).toInt)
    } else {
      Array.fill(header.numChunksPerShard)(header.numBytesPerChunk).iterator
    }

    val targetChunkLengths = sourceChunkLengths.foldLeft[Box[Seq[Int]]](Full(Seq.empty)) {
      case (Full(result), blockLength) =>
        val blockData = Array.ofDim[Byte](blockLength)
        underlyingFile.read(blockData)
        for {
          rawChunk <- decompressChunk(header.blockType, header.numBytesPerChunk)(blockData)
          encodedChunk <- compressChunk(targetChunkType)(rawChunk)
        } yield {
          file.write(encodedChunk)
          result :+ encodedChunk.length
        }
      case (failure, _) =>
        failure
    }

    targetChunkLengths.map { blockLengths =>
      val jumpTable = if (toCompressed) {
        blockLengths.map(_.toLong).scan(dataOffset)(_ + _).toArray
      } else {
        Array(dataOffset)
      }
      val newHeader = tempHeader.copy(jumpTable = jumpTable)
      file.seek(0)
      newHeader.writeTo(file)
    }
  }

  def changeChunkType(targetChunkType: ChunkType.Value): Box[WKWFile] = {
    val tempFile = new File(underlyingFilePath + ".tmp")
    val targetFile = new File(underlyingFilePath)

    for {
      _ <- bool2Box(targetChunkType != header.blockType) ?~! error("File already has requested blockType")
      _ <- ResourceBox.manage(new RandomAccessFile(tempFile, "rw"))(transcodeFile(targetChunkType))
      _ <- tryo(replaceUnderlyingFile(tempFile))
      wkwFile <- WKWFile(targetFile, fileMode)
    } yield wkwFile
  }

  def decompress: Box[WKWFile] = changeChunkType(ChunkType.Raw)

  def compress(targetChunkType: ChunkType.Value): Box[WKWFile] = changeChunkType(targetChunkType)
}

object WKWFile extends WKWCompressionHelper {

  private def fileModeString(isCompressed: Boolean, fileMode: FileMode.Value): Box[String] =
    fileMode match {
      case FileMode.Read =>
        Full("r")
      case FileMode.ReadWrite =>
        if (isCompressed) {
          Failure(error("Compressed files can only be opened read-only"))
        } else {
          Full("rw")
        }
    }

  def apply(file: File, fileMode: FileMode.Value = FileMode.Read): Box[WKWFile] =
    for {
      header <- WKWHeader(file, readJumpTable = true)
      _ <- bool2Box(header.expectedFileSize == file.length) ?~! error("Unexpected file size",
                                                                      header.expectedFileSize,
                                                                      file.length)
      mode <- fileModeString(header.isCompressed, fileMode)
      underlyingFile <- ResourceBox(new RandomAccessFile(file, mode))
    } yield new WKWFile(header, fileMode, underlyingFile, underlyingFilePath = file.getPath)

  def read[T](is: InputStream)(f: (WKWHeader, Iterator[Array[Byte]]) => T): Box[T] =
    ResourceBox.manage(new LittleEndianDataInputStream(is)) { dataStream =>
      for {
        header <- WKWHeader(dataStream, readJumpTable = true)
      } yield {
        val blockIterator = header.blockLengths.flatMap { blockLength =>
          val data: Array[Byte] = IOUtils.toByteArray(dataStream, blockLength)
          if (header.isCompressed) decompressChunk(header.blockType, header.numBytesPerChunk)(data) else Full(data)
        }
        f(header, blockIterator)
      }
    }

  def write(os: OutputStream, header: WKWHeader, blocks: Iterator[Array[Byte]]): Box[Unit] = {
    val dataBuffer = new ByteArrayOutputStream()
    (0 until header.numChunksPerShard)
      .foldLeft[Box[Array[Int]]](Full(Array.emptyIntArray)) {
        case (Full(blockLengths), _) =>
          if (blocks.hasNext) {
            val data = blocks.next()
            for {
              _ <- bool2Box(data.length == header.numBytesPerChunk) ?~! error("Unexpected block size",
                                                                              header.numBytesPerChunk,
                                                                              data.length)
              compressedChunk <- if (header.isCompressed) compressChunk(header.blockType)(data) else Full(data)
              _ <- tryo(dataBuffer.write(compressedChunk))
            } yield {
              blockLengths :+ compressedChunk.length
            }
          } else {
            Failure("No more blocks in iterator.")
          }
        case (f, _) =>
          f
      }
      .map { blockLengths =>
        val jumpTable =
          if (header.isCompressed) blockLengths.map(_.toLong).scan(header.dataOffset)(_ + _)
          else Array(header.dataOffset)
        header.copy(jumpTable = jumpTable).writeTo(new DataOutputStream(os))
        dataBuffer.flush()
        dataBuffer.writeTo(os)
        dataBuffer.close()
      }
  }
}
