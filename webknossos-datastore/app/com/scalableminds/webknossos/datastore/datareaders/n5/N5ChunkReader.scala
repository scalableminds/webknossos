package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, ChunkTyper, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging

import scala.collection.immutable.NumericRange

object N5ChunkReader {
  def create(vaultPath: VaultPath, header: DatasetHeader): ChunkReader =
    new N5ChunkReader(header, vaultPath, ChunkReader.createChunkTyper(header))
}

// N5 allows for a 'varmode' which means that the number of elements in the chunk can deviate from the set chunk size.
// This is used for end chunks, but apparently also for overlapping (see https://github.com/zarr-developers/zarr-specs/issues/44#issuecomment-360669270).
// Here, we provide only provide one implementation to handle the `varmode`:
// N5ChunkReader, always fills the chunk to the bytes necessary

class N5ChunkReader(header: DatasetHeader, vaultPath: VaultPath, typedChunkReader: ChunkTyper)
    extends ChunkReader(header, vaultPath, typedChunkReader)
    with LazyLogging {

  val dataExtractor: N5DataExtractor = new N5DataExtractor

  override protected def readChunkBytesAndShape(
      path: String,
      range: Option[NumericRange[Long]]): Option[(Array[Byte], Option[Array[Int]])] = {
    def processBytes(bytes: Array[Byte], expectedElementCount: Int): Array[Byte] = {
      val output = header.compressorImpl.uncompress(bytes)
      val paddedBlock = output ++ Array.fill(header.bytesPerElement * expectedElementCount - output.length) {
        header.fillValueNumber.byteValue()
      }
      paddedBlock
    }

    for {
      bytes <- (vaultPath / path).readBytes(range)
      (blockHeader, data) = dataExtractor.readBytesAndHeader(bytes)
      paddedChunkBytes = processBytes(data, blockHeader.blockSize.product)
    } yield (paddedChunkBytes, Some(blockHeader.blockSize))
  }
}
