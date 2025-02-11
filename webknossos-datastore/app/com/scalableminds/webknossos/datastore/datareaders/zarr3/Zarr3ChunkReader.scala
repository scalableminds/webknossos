package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class Zarr3ChunkReader(header: DatasetHeader, array: Zarr3Array) extends ChunkReader(header) {

  override protected def readChunkBytesAndShape(path: VaultPath, range: Option[NumericRange[Long]])(implicit
      ec: ExecutionContext
  ): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- path.readBytes(range)
      decoded = array.codecs.foldRight(bytes)((c, bytes) =>
        c match {
          case codec: BytesToBytesCodec => codec.decode(bytes)
          case _                        => bytes
        }
      )
    } yield (decoded, None)

}
