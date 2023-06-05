package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, ChunkTyper, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

object Zarr3ChunkReader {
  def create(vaultPath: VaultPath, header: Zarr3ArrayHeader, array: Zarr3Array): ChunkReader =
    new Zarr3ChunkReader(header, vaultPath, ChunkReader.createChunkTyper(header), array)
}

class Zarr3ChunkReader(header: DatasetHeader, vaultPath: VaultPath, typedChunkReader: ChunkTyper, array: Zarr3Array)
    extends ChunkReader(header, vaultPath, typedChunkReader)
    with LazyLogging {

  override protected def readChunkBytesAndShape(path: String, range: Option[NumericRange[Long]])(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- (vaultPath / path).readBytes(range) match {
        case Some(bytes) => Fox.successful(bytes)
        case None        => Fox.empty
      }
      decoded = array.codecs.foldRight(bytes)((c, bytes) =>
        c match {
          case codec: BytesToBytesCodec => codec.decode(bytes)
          case _                        => bytes
      })
    } yield (decoded, None)

}
