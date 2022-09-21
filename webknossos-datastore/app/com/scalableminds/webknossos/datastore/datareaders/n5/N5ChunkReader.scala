package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.webknossos.datastore.datareaders.{
  ChunkReader,
  DatasetHeader,
  FileSystemStore,
  TypedChunkReader
}

import java.io.{ByteArrayInputStream, ByteArrayOutputStream}
import scala.util.Using

object N5ChunkReader {
  def create(store: FileSystemStore, header: DatasetHeader): ChunkReader =
    new PaddedChunkReader(header, store, ChunkReader.createTypedChunkReader(header))
}

// N5 allows for a 'varmode' which means that the number of elements in the chunk can deviate from the set chunk size.
// This is used for end chunks, but apparently also for overlapping (see https://github.com/zarr-developers/zarr-specs/issues/44#issuecomment-360669270).
// Here, we provide only provide one implementation to handle the `varmode`:
// PaddedChunkReader, always fills the chunk to the bytes necessary

class PaddedChunkReader(header: DatasetHeader, store: FileSystemStore, typedChunkReader: TypedChunkReader)
    extends ChunkReader(header, store, typedChunkReader) {

  val dataExtractor: N5DataExtractor = new N5DataExtractor

  override protected def readBytes(path: String): Option[Array[Byte]] =
    Using.Manager { use =>
      def processBytes(bytes: Array[Byte]): Array[Byte] = {
        val is = use(new ByteArrayInputStream(bytes))
        val os = use(new ByteArrayOutputStream())
        header.compressorImpl.uncompress(is, os)
        val output = os.toByteArray
        val paddedBlock = output ++ Array.fill(header.bytesPerChunk - output.length) {
          header.fillValueNumber.byteValue()
        }
        paddedBlock
      }

      for {
        bytes <- store.readBytes(path)
        (blockHeader, data) = dataExtractor.readBytesAndHeader(bytes)
        _ = assert(chunkSize == blockHeader.blockSize.product, "Chunk has to have same size as described in metadata")
        unpackedData <- data
        paddedChunk = processBytes(unpackedData)
      } yield paddedChunk
    }.get
}
