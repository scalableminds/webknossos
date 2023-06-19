package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import ucar.ma2.{Array => MultiArray}

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class ChunkReader(header: DatasetHeader) {

  private lazy val chunkTyper = ChunkTyper.createFromHeader(header)

  def read(path: VaultPath, chunkShapeFromMetadata: Array[Int], range: Option[NumericRange[Long]])(
      implicit ec: ExecutionContext): Fox[MultiArray] =
    for {
      chunkBytesAndShapeBox: Box[(Array[Byte], Option[Array[Int]])] <- readChunkBytesAndShape(path, range).futureBox
      chunkShape: Array[Int] = chunkBytesAndShapeBox.toOption.flatMap(_._2).getOrElse(chunkShapeFromMetadata)
      typed <- chunkBytesAndShapeBox.map(_._1) match {
        case Full(chunkBytes) =>
          tryo(chunkTyper.wrapAndType(chunkBytes, chunkShape)).toFox ?~> "chunk.wrapAndType.failed"
        case Empty =>
          tryo(chunkTyper.createFromFillValue(chunkShape)).toFox ?~> "chunk.createFromFillValue.failed"
        case f: Failure =>
          f.toFox ?~> s"Reading chunk at $path failed"
      }
    } yield typed

  // Returns bytes (optional, Fox.empty may later be replaced with fill value)
  // and chunk shape (optional, only for data formats where each chunk reports its own shape, e.g. N5)
  protected def readChunkBytesAndShape(path: VaultPath, range: Option[NumericRange[Long]])(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- path.readBytes(range) match {
        case Some(bytes) => Fox.successful(bytes)
        case None        => Fox.empty
      }
      decompressed <- tryo(header.compressorImpl.decompress(bytes)).toFox ?~> "chunk.decompress.failed"
    } yield (decompressed, None)
}
