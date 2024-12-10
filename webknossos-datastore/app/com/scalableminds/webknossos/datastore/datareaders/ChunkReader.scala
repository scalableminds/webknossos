package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.common.Box.tryo
import ucar.ma2.{Array => MultiArray}

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class ChunkReader(header: DatasetHeader) {

  private lazy val chunkTyper = ChunkTyper.createFromHeader(header)
  private lazy val shortcutChunkTyper = new ShortcutChunkTyper(header)

  def read(path: VaultPath,
           chunkShapeFromMetadata: Array[Int],
           range: Option[NumericRange[Long]],
           useSkipTypingShortcut: Boolean)(implicit ec: ExecutionContext): Fox[MultiArray] =
    for {
      chunkBytesAndShapeBox: Box[(Array[Byte], Option[Array[Int]])] <- readChunkBytesAndShape(path, range).futureBox
      chunkShape: Array[Int] = chunkBytesAndShapeBox.toOption.flatMap(_._2).getOrElse(chunkShapeFromMetadata)
      typed <- chunkBytesAndShapeBox.map(_._1) match {
        case Full(chunkBytes) if useSkipTypingShortcut =>
          shortcutChunkTyper.wrapAndType(chunkBytes, chunkShape).toFox ?~> "chunk.shortcutWrapAndType.failed"
        case Empty if useSkipTypingShortcut =>
          shortcutChunkTyper.createFromFillValueCached(chunkShape).toFox ?~> "chunk.shortcutCreateFromFillValue.failed"
        case Full(chunkBytes) =>
          chunkTyper.wrapAndType(chunkBytes, chunkShape).toFox ?~> "chunk.wrapAndType.failed"
        case Empty =>
          chunkTyper.createFromFillValueCached(chunkShape).toFox ?~> "chunk.createFromFillValue.failed"
        case f: Failure =>
          f.toFox ?~> s"Reading chunk at $path failed"
      }
    } yield typed

  // Returns bytes (optional, Fox.empty may later be replaced with fill value)
  // and chunk shape (optional, only for data formats where each chunk reports its own shape, e.g. N5)
  protected def readChunkBytesAndShape(path: VaultPath, range: Option[NumericRange[Long]])(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- path.readBytes(range)
      decompressed <- tryo(header.compressorImpl.decompress(bytes)).toFox ?~> "chunk.decompress.failed"
    } yield (decompressed, None)
}
