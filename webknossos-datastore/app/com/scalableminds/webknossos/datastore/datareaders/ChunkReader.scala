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

  // Types the chunk bytes in their stored data type (see DatasetHeader.storedDataType).
  private lazy val chunkTyper = ChunkTyper.createFromHeader(header)
  // Fill values live in the logical (resolvedDataType) space and need no array->array decoding.
  private lazy val fillValueTyper = ChunkTyper.createForDataType(header, header.resolvedDataType)
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
        case Full(chunkBytes) if useSkipTypingShortcut =>
          shortcutChunkTyper.wrapAndType(chunkBytes, chunkShape).toFox ?~> Msg.Dataset.Chunk.shortcutWrapAndTypeFailed
        case Full(chunkBytes) =>
          chunkTyper
            .wrapAndType(chunkBytes, chunkShape)
            .flatMap(decodeArrayToArrayCodecs)
            .toFox ?~> Msg.Dataset.Chunk.wrapAndTypeFailed
        case Empty =>
          createFromFillValue(chunkShape, useSkipTypingShortcut)
        case f: Failure =>
          f.toFox ?~> s"Reading chunk at $path failed"
      }
    } yield typed

  // Applies array->array codec decodes to an already-typed chunk. Default is a no-op; formats with
  // value/data-type-transforming array->array codecs (e.g. Zarr3 scale_offset, cast_value) override this.
  protected def decodeArrayToArrayCodecs(chunk: MultiArray): Box[MultiArray] = Full(chunk)

  def createFromFillValue(chunkShape: Array[Int], useSkipTypingShortcut: Boolean)(implicit
      ec: ExecutionContext
  ): Fox[MultiArray] =
    if (useSkipTypingShortcut)
      shortcutChunkTyper.createFromFillValueCached(chunkShape) ?~> Msg.Dataset.Chunk.shortcutCreateFromFillValueFailed
    else
      fillValueTyper.createFromFillValueCached(chunkShape) ?~> Msg.Dataset.Chunk.createFromFillValueFailed

  // Returns bytes (optional, Fox.empty may later be replaced with fill value)
  // and chunk shape (optional, only for data formats where each chunk reports its own shape, e.g. N5)
  protected def readChunkBytesAndShape(path: VaultPath, range: ByteRange)(implicit
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- path.readBytes(range)
      decompressed <- tryo(header.compressorImpl.decompress(bytes)).toFox ?~> Msg.Dataset.Chunk.decompressFailed
    } yield (decompressed, None)
}
