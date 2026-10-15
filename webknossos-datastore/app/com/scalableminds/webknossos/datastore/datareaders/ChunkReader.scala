package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.datavault.{ByteRange, VaultPath}
import Box.tryo
import ucar.ma2.Array as MultiArray

import scala.concurrent.ExecutionContext

class ChunkReader(header: DatasetHeader) {

  private lazy val chunkTyper = ChunkTyper.createFromHeader(header)
  private lazy val shortcutChunkTyper = new ShortcutChunkTyper(header)

  def read(path: VaultPath, chunkShapeFromMetadata: Array[Int], range: ByteRange, useSkipTypingShortcut: Boolean)(
      implicit
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[MultiArray] =
    for {
      chunkBytesAndShapeBox: Box[(Array[Byte], Option[Array[Int]])] <- readChunkBytesAndShape(path, range).shiftBox
      chunkShape: Array[Int] = chunkBytesAndShapeBox.toOption.flatMap(_._2).getOrElse(chunkShapeFromMetadata)
      typed <- chunkBytesAndShapeBox.map(_._1) match {
        case Full(chunkBytes) => typeChunkBytes(chunkBytes, chunkShape, useSkipTypingShortcut)
        case Empty            =>
          createFromFillValue(chunkShape, useSkipTypingShortcut)
        case f: Failure =>
          f.toFox ?~> s"Reading chunk at $path failed"
      }
    } yield typed

  // Decodes and types the stored bytes of a chunk that were read by the caller.
  def decodeAndType(storedBytes: Array[Byte], chunkShape: Array[Int])(implicit
      ec: ExecutionContext
  ): Fox[MultiArray] =
    for {
      decoded <- decodeChunkBytes(storedBytes).toFox ?~> Msg.Dataset.Chunk.decompressFailed
      typed <- typeChunkBytes(decoded, chunkShape, useSkipTypingShortcut = false)
    } yield typed

  private def typeChunkBytes(chunkBytes: Array[Byte], chunkShape: Array[Int], useSkipTypingShortcut: Boolean)(implicit
      ec: ExecutionContext
  ): Fox[MultiArray] =
    if (useSkipTypingShortcut)
      shortcutChunkTyper.wrapAndType(chunkBytes, chunkShape).toFox ?~> Msg.Dataset.Chunk.shortcutWrapAndTypeFailed
    else
      chunkTyper.wrapAndType(chunkBytes, chunkShape).toFox ?~> Msg.Dataset.Chunk.wrapAndTypeFailed

  def createFromFillValue(chunkShape: Array[Int], useSkipTypingShortcut: Boolean)(implicit
      ec: ExecutionContext
  ): Fox[MultiArray] =
    if (useSkipTypingShortcut)
      shortcutChunkTyper.createFromFillValueCached(chunkShape) ?~> Msg.Dataset.Chunk.shortcutCreateFromFillValueFailed
    else
      chunkTyper.createFromFillValueCached(chunkShape) ?~> Msg.Dataset.Chunk.createFromFillValueFailed

  // Returns bytes (optional, Fox.empty may later be replaced with fill value)
  // and chunk shape (optional, only for data formats where each chunk reports its own shape, e.g. N5)
  protected def readChunkBytesAndShape(path: VaultPath, range: ByteRange)(implicit
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- path.readBytes(range)
      decompressed <- decodeChunkBytes(bytes).toFox ?~> Msg.Dataset.Chunk.decompressFailed
    } yield (decompressed, None)

  protected def decodeChunkBytes(storedBytes: Array[Byte]): Box[Array[Byte]] =
    tryo(header.compressorImpl.decompress(storedBytes))
}
