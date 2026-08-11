package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Full}
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.{ByteRange, VaultPath}
import ucar.ma2.Array as MultiArray

import scala.concurrent.ExecutionContext

class Zarr3ChunkReader(header: DatasetHeader, array: Zarr3Array) extends ChunkReader(header) {

  override protected def readChunkBytesAndShape(path: VaultPath, range: ByteRange)(implicit
      ec: ExecutionContext,
      tc: TokenContext
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

  // Applies array->array codec decodes in reverse codec-chain order to the typed chunk. foldRight
  // visits the codec closest to the bytes codec first (e.g. cast_value before scale_offset).
  override protected def decodeArrayToArrayCodecs(chunk: MultiArray): Box[MultiArray] =
    array.codecs.foldRight[Box[MultiArray]](Full(chunk)) { (codec, acc) =>
      acc.flatMap { current =>
        codec match {
          case c: ArrayToArrayCodec => tryo(c.decode(current))
          case _                    => Full(current)
        }
      }
    }

}
