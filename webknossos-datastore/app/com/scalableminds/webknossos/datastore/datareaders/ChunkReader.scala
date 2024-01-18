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
           chunkSizeFromMetadata: Array[Int],
           range: Option[NumericRange[Long]],
           useSkipTypingShortcut: Boolean)(implicit ec: ExecutionContext): Fox[MultiArray] =
    for {
      chunkBytesAndSizeBox: Box[(Array[Byte], Option[Array[Int]])] <- readChunkBytesAndSize(path, range).futureBox
      chunkSize: Array[Int] = chunkBytesAndSizeBox.toOption.flatMap(_._2).getOrElse(chunkSizeFromMetadata)
      typed <- chunkBytesAndSizeBox.map(_._1) match {
        case Full(chunkBytes) if useSkipTypingShortcut =>
          shortcutChunkTyper.wrapAndType(chunkBytes, chunkSize).toFox ?~> "chunk.shortcutWrapAndType.failed"
        case Empty if useSkipTypingShortcut =>
          shortcutChunkTyper.createFromFillValue(chunkSize).toFox ?~> "chunk.shortcutCreateFromFillValue.failed"
        case Full(chunkBytes) =>
          chunkTyper.wrapAndType(chunkBytes, chunkSize).toFox ?~> "chunk.wrapAndType.failed"
        case Empty =>
          chunkTyper.createFromFillValue(chunkSize).toFox ?~> "chunk.createFromFillValue.failed"
        case f: Failure =>
          f.toFox ?~> s"Reading chunk at $path failed"
      }
    } yield typed

  // Returns bytes (optional, Fox.empty may later be replaced with fill value)
  // and chunk size (optional, only for data formats where each chunk reports its own size, e.g. N5)
  protected def readChunkBytesAndSize(path: VaultPath, range: Option[NumericRange[Long]])(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- path.readBytes(range)
      decompressed <- tryo(header.compressorImpl.decompress(bytes)).toFox ?~> "chunk.decompress.failed"
    } yield (decompressed, None)
}
