package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

// N5 allows for a 'varmode' which means that the number of elements in the chunk can deviate from the set chunk size.
// This is used for end chunks, but apparently also for overlapping (see https://github.com/zarr-developers/zarr-specs/issues/44#issuecomment-360669270).
// Here, we provide only provide one implementation to handle the `varmode`:
// N5ChunkReader, always fills the chunk to the bytes necessary

class N5ChunkReader(header: DatasetHeader) extends ChunkReader(header) with LazyLogging {

  private val dataExtractor: N5DataExtractor = new N5DataExtractor

  override protected def readChunkBytesAndShape(path: VaultPath, range: Option[NumericRange[Long]])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], Option[Array[Int]])] = {

    def processBytes(bytes: Array[Byte], expectedElementCount: Int): Box[Array[Byte]] =
      for {
        output <- tryo(header.compressorImpl.decompress(bytes))
        paddedBlock = output ++ Array.fill(header.bytesPerElement * expectedElementCount - output.length) {
          header.fillValueNumber.byteValue()
        }
      } yield paddedBlock

    for {
      bytes <- path.readBytes(range)
      (blockHeader, data) <- dataExtractor.readBytesAndHeader(bytes).toFox
      paddedChunkBytes <- processBytes(data, blockHeader.blockSize.product).toFox ?~> "chunk.decompress.failed"
    } yield (paddedChunkBytes, Some(blockHeader.blockSize))
  }
}
