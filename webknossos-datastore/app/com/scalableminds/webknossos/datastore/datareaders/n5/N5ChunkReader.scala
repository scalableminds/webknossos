package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.webknossos.datastore.datareaders.{
  ChunkReader,
  DatasetHeader,
  FileSystemStore,
  ChunkTyper
}
import com.typesafe.scalalogging.LazyLogging

import java.io.{ByteArrayInputStream, ByteArrayOutputStream}
import scala.util.Using

object N5ChunkReader {
  def create(store: FileSystemStore, header: DatasetHeader): ChunkReader =
    new N5ChunkReader(header, store, ChunkReader.createChunkTyper(header))
}

// N5 allows for a 'varmode' which means that the number of elements in the chunk can deviate from the set chunk size.
// This is used for end chunks, but apparently also for overlapping (see https://github.com/zarr-developers/zarr-specs/issues/44#issuecomment-360669270).
// Here, we provide only provide one implementation to handle the `varmode`:
// N5ChunkReader, always fills the chunk to the bytes necessary

class N5ChunkReader(header: DatasetHeader, store: FileSystemStore, typedChunkReader: ChunkTyper)
    extends ChunkReader(header, store, typedChunkReader)
    with LazyLogging {

  val dataExtractor: N5DataExtractor = new N5DataExtractor

  override protected def readChunkBytesAndShape(path: String): Option[(Array[Byte], Option[Array[Int]])] =
    Using.Manager { use =>
      def processBytes(bytes: Array[Byte], expectedElementCount: Int): Array[Byte] = {
        val is = use(new ByteArrayInputStream(bytes))
        val os = use(new ByteArrayOutputStream())
        header.compressorImpl.uncompress(is, os)
        val output = os.toByteArray
        val paddedBlock = output ++ Array.fill(header.bytesPerElement * expectedElementCount - output.length) {
          header.fillValueNumber.byteValue()
        }
        paddedBlock
      }

      for {
        bytes <- store.readBytes(path)
        (blockHeader, data) = dataExtractor.readBytesAndHeader(bytes)
        paddedChunkBytes = processBytes(data, blockHeader.blockSize.product)
      } yield (paddedChunkBytes, Some(blockHeader.blockSize))
    }.get
}
