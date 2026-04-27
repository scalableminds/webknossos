package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.{ByteRange, VaultPath}

import scala.concurrent.ExecutionContext

class Zarr3ChunkReader(header: DatasetHeader, array: Zarr3Array) extends ChunkReader(header) {

  override protected def decompressBytes(bytes: Array[Byte]): Array[Byte] =
    array.codecs.foldRight(bytes)((c, b) =>
      c match {
        case codec: BytesToBytesCodec => codec.decode(b)
        case _                        => b
      })

  override protected def readChunkBytesAndShape(path: VaultPath, range: ByteRange)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], Option[Array[Int]])] =
    for {
      bytes <- path.readBytes(range)
    } yield (decompressBytes(bytes), None)

}
