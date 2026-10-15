package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, DatasetHeader}

class Zarr3ChunkReader(header: DatasetHeader, array: Zarr3Array) extends ChunkReader(header) {

  override protected def decodeChunkBytes(storedBytes: Array[Byte]): Box[Array[Byte]] =
    tryo(
      array.codecs.foldRight(storedBytes)((c, bytes) =>
        c match {
          case codec: BytesToBytesCodec => codec.decode(bytes)
          case _                        => bytes
        }
      )
    )

}
