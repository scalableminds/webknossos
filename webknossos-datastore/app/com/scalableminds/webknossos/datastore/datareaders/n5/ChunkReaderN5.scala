package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.webknossos.datastore.datareaders.ChunkReader.createTypedChunkReader
import com.scalableminds.webknossos.datastore.datareaders.{ArrayOrder, ChunkReader, DatasetHeader, TypedChunkReader}

import java.io.{ByteArrayInputStream, ByteArrayOutputStream}
import scala.util.Using

object ChunkReaderN5 {
  def create(store: FileSystemStoreN5, header: DatasetHeader): ChunkReader =
    new PaddedChunkReader(header, store, ChunkReader.createTypedChunkReader(header))
}

// N5 allows for a 'varmode' which means that the number of elements in the chunk can deviate from the set chunk size.
// This is used for end chunks, but apparently also for overlapping (see https://github.com/zarr-developers/zarr-specs/issues/44#issuecomment-360669270).
// Here, we provide two implementations to handle this:
// (1) PaddedChunkReader always fills the chunk to the bytes necessary
// (2) ChunkSpecificReader
class PaddedChunkReader(header: DatasetHeader, store: FileSystemStoreN5, typedChunkReader: TypedChunkReader)
    extends ChunkReader(header, store, typedChunkReader) {

  override protected def readBytes(path: String): Option[Array[Byte]] =
    Using.Manager { use =>
      val (blockHeader, data) = store.readBytesAndHeader(path)
      assert(chunkSize == blockHeader.blockSize.product, "Chunk has to have same size as described in metadata")

      data.map { bytes =>
        val paddedBlock = bytes ++ new Array[Byte](header.bytesPerChunk - bytes.length)
        val is = use(new ByteArrayInputStream(paddedBlock))
        val os = use(new ByteArrayOutputStream())
        header.compressorImpl.uncompress(is, os)
        os.toByteArray
      }
    }.get
}

class ChunkSpecificReader(header: DatasetHeader, store: FileSystemStoreN5, typedChunkReader: TypedChunkReader)
    extends ChunkReader(header, store, typedChunkReader) {

  override protected def readBytes(path: String): Option[Array[Byte]] =
    Using.Manager { use =>
      val (blockHeader, data) = store.readBytesAndHeader(path)

      // This should work if it is written correctly
      val x: Int = blockHeader.numElements / header.chunkShapeOrdered(0)
      val y: Int = blockHeader.numElements / header.chunkShapeOrdered(0) / header.chunkShapeOrdered(1)
      val z: Int = blockHeader.numElements / header.chunkShapeOrdered(0) / header.chunkShapeOrdered(1) / header
        .chunkShapeOrdered(2)
      val customSize = Array(x, y, z)

      typedChunkReader.chunkSize = if (header.order == ArrayOrder.C) customSize else customSize.reverse
      data.map { bytes =>
        val is = use(new ByteArrayInputStream(bytes))
        val os = use(new ByteArrayOutputStream())
        header.compressorImpl.uncompress(is, os)
        os.toByteArray
      }
    }.get
}
