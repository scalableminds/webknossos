package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Box.tryo
import ucar.ma2.{Array => MultiArray}

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class ChunkReader(header: DatasetHeader) extends FoxImplicits {

  private lazy val chunkTyper = ChunkTyper.createFromHeader(header)
  private lazy val shortcutChunkTyper = new ShortcutChunkTyper(header)

  def read(path: VaultPath,
           chunkShapeFromMetadata: Array[Int],
           range: Option[NumericRange[Long]],
           useSkipTypingShortcut: Boolean)(implicit ec: ExecutionContext, tc: TokenContext): Fox[MultiArray] =
    for {
      chunkBytesAndShapeBox: Box[(Array[Byte], Option[Array[Int]])] <- readChunkBytesAndShape(path, range).shiftBox
      chunkShape: Array[Int] = chunkBytesAndShapeBox.toOption.flatMap(_._2).getOrElse(chunkShapeFromMetadata)
      typed <- chunkBytesAndShapeBox.map(_._1) match {
        case Full(chunkBytes) if useSkipTypingShortcut =>
          shortcutChunkTyper.wrapAndType(chunkBytes, chunkShape).toFox ?~> "chunk.shortcutWrapAndType.failed"
        case Full(chunkBytes) =>
          chunkTyper.wrapAndType(chunkBytes, chunkShape).toFox ?~> "chunk.wrapAndType.failed"
        case Empty =>
          createFromFillValue(chunkShape, useSkipTypingShortcut)
        case f: Failure =>
          f.toFox ?~> s"Reading chunk at $path failed"
      }
    } yield typed

  def createFromFillValue(chunkShape: Array[Int], useSkipTypingShortcut: Boolean)(
      implicit ec: ExecutionContext): Fox[MultiArray] =
    if (useSkipTypingShortcut)
      shortcutChunkTyper.createFromFillValueCached(chunkShape) ?~> "chunk.shortcutCreateFromFillValue.failed"
    else
      chunkTyper.createFromFillValueCached(chunkShape) ?~> "chunk.createFromFillValue.failed"

  // Returns bytes (optional, Fox.empty may later be replaced with fill value)
  // and chunk shape (optional, only for data formats where each chunk reports its own shape, e.g. N5)
  protected def readChunkBytesAndShape(path: VaultPath, range: Option[NumericRange[Long]])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- path.readBytes(range)
      decompressed <- tryo(header.compressorImpl.decompress(bytes)).toFox ?~> "chunk.decompress.failed"
    } yield (decompressed, None)
}
