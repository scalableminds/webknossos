package com.scalableminds.webknossos.datastore.dataformats.wkw

import java.io._
import org.apache.commons.io.IOUtils
import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.tools.BoxUtils.bool2Box
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.jpountz.lz4.LZ4Factory
import net.liftweb.common.{Box, Failure, Full}
import net.liftweb.common.Box.tryo

import scala.concurrent.ExecutionContext

trait WKWCompressionHelper {

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

object WKWFile extends WKWCompressionHelper with FoxImplicits {

  def read[T](is: InputStream)(f: (WKWHeader, Iterator[Array[Byte]]) => Fox[T])(
      implicit ec: ExecutionContext): Fox[T] = {
    val dataStream = new LittleEndianDataInputStream(is)
    for {
      header <- WKWHeader(dataStream, readJumpTable = true).toFox
      blockIterator = header.blockLengths.flatMap { blockLength =>
        val data: Array[Byte] = IOUtils.toByteArray(dataStream, blockLength)
        if (header.isCompressed) decompressChunk(header.blockType, header.numBytesPerChunk)(data) else Full(data)
      }
      result <- f(header, blockIterator)
    } yield result
  }

  def write(os: OutputStream, header: WKWHeader, blocks: Iterator[Array[Byte]]): Box[Unit] = {
    val dataBuffer = new ByteArrayOutputStream()
    (0 until header.numChunksPerShard)
      .foldLeft[Box[Array[Int]]](Full(Array.emptyIntArray)) {
        case (Full(chunkLengths), _) =>
          if (blocks.hasNext) {
            val data = blocks.next()
            for {
              _ <- bool2Box(data.length == header.numBytesPerChunk) ?~! error("Unexpected chunk size",
                                                                              header.numBytesPerChunk,
                                                                              data.length)
              compressedChunk <- if (header.isCompressed) compressChunk(header.blockType)(data) else Full(data)
              _ <- tryo(dataBuffer.write(compressedChunk))
            } yield {
              chunkLengths :+ compressedChunk.length
            }
          } else {
            Failure("No more chunks in iterator.")
          }
        case (f, _) =>
          f
      }
      .map { chunkLengths =>
        val jumpTable =
          if (header.isCompressed) chunkLengths.map(_.toLong).scan(header.dataOffset)(_ + _)
          else Array(header.dataOffset)
        header.copy(jumpTable = jumpTable).writeTo(new DataOutputStream(os))
        dataBuffer.flush()
        dataBuffer.writeTo(os)
        dataBuffer.close()
      }
  }
}
