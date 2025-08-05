package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.io.{NamedFunctionStream, ZipIO}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  IntCompressionSetting,
  StringCompressionSetting
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{
  BloscCodecConfiguration,
  BytesCodecConfiguration,
  ChunkGridConfiguration,
  ChunkGridSpecification,
  ChunkKeyEncoding,
  ChunkKeyEncodingConfiguration,
  EmptyZarr3GroupHeader,
  Zarr3ArrayHeader,
  Zarr3DataType
}
import com.scalableminds.webknossos.tracingstore.files.TsTempFileService
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject

import java.io.{BufferedOutputStream, File, FileOutputStream}
import java.nio.ByteBuffer
import java.nio.file.Path
import java.util.zip.Deflater
import scala.concurrent.ExecutionContext

class EditableMappingIOService @Inject()(tempFileService: TsTempFileService) extends LazyLogging {

  // 10000 edges per chunk (an edge is two Longs in edges and one bool in edgeIsAddition)
  private val ChunkSize: Int = 10000
  private val arrayNameEdges = "edges"
  private val arrayNameEdgeIsAddition = "edgeIsAddition"

  def editedMappingEdgesToZippedZarrTempFile(editedEdges: Seq[(Long, Long, Boolean)], tracingId: String)(
      implicit ec: ExecutionContext): Fox[Path] =
    for {
      before <- Instant.nowFox
      edgesZarrChunks: Iterator[Array[Byte]] = editedEdgesToZarrChunks(editedEdges)
      isAdditionZarrChunks: Iterator[Array[Byte]] = edgeIsAdditionToZarrChunks(editedEdges)
      edgesZarrChunksStream = edgesZarrChunks.zipWithIndex.map {
        case (chunk, index) => NamedFunctionStream.fromBytes(f"$arrayNameEdges/$index.0", chunk)
      }
      edgesZarrHeader = Zarr3ArrayHeader(
        zarr_format = 3,
        node_type = "array",
        shape = Array(editedEdges.length, 2),
        data_type = Left(Zarr3DataType.uint64.toString),
        chunk_grid = Left(
          ChunkGridSpecification("regular",
                                 ChunkGridConfiguration(
                                   chunk_shape = Array(ChunkSize, 2)
                                 ))),
        chunk_key_encoding =
          ChunkKeyEncoding("v2", configuration = Some(ChunkKeyEncodingConfiguration(separator = Some(".")))),
        fill_value = Right(0),
        attributes = None,
        codecs = Seq(BytesCodecConfiguration(Some("big")), compressorConfiguration),
        storage_transformers = None,
        dimension_names = Some(Array("edge", "srcDst"))
      )
      isAdditionZarrChunksStream = isAdditionZarrChunks.zipWithIndex.map {
        case (chunk, index) => NamedFunctionStream.fromBytes(f"$arrayNameEdgeIsAddition/$index", chunk)
      }
      isAdditionZarrHeader = Zarr3ArrayHeader(
        zarr_format = 3,
        node_type = "array",
        shape = Array(editedEdges.length),
        data_type = Left(Zarr3DataType.bool.toString),
        chunk_grid = Left(
          ChunkGridSpecification("regular",
                                 ChunkGridConfiguration(
                                   chunk_shape = Array(ChunkSize)
                                 ))),
        chunk_key_encoding =
          ChunkKeyEncoding("v2", configuration = Some(ChunkKeyEncodingConfiguration(separator = Some(".")))),
        fill_value = Left("false"),
        attributes = None,
        codecs = Seq(BytesCodecConfiguration(Some("big")), compressorConfiguration),
        storage_transformers = None,
        dimension_names = Some(Array("edge"))
      )
      edgesHeaderStream = NamedFunctionStream.fromJsonSerializable(
        s"$arrayNameEdges/${Zarr3ArrayHeader.FILENAME_ZARR_JSON}",
        edgesZarrHeader)
      isAdditionHeaderStream = NamedFunctionStream.fromJsonSerializable(
        s"$arrayNameEdgeIsAddition/${Zarr3ArrayHeader.FILENAME_ZARR_JSON}",
        isAdditionZarrHeader)
      groupHeader = EmptyZarr3GroupHeader()
      groupHeaderStream = NamedFunctionStream.fromJsonSerializable(EmptyZarr3GroupHeader.FILENAME_ZARR_JSON,
                                                                   groupHeader)
      allStreams = edgesZarrChunksStream ++ isAdditionZarrChunksStream ++ Seq(edgesHeaderStream,
                                                                              isAdditionHeaderStream,
                                                                              groupHeaderStream)
      tempFilePath = tempFileService.create(f"${tracingId}_editedMappingEdges")
      outputStream = new BufferedOutputStream(new FileOutputStream(new File(tempFilePath.toString)))
      _ <- ZipIO.zip(allStreams, outputStream, level = Deflater.BEST_SPEED)
      _ = Instant.logSince(before, s"Exporting ${editedEdges.length} edited mapping edges to zipped zarr", logger)
    } yield tempFilePath

  private def edgeIsAdditionToZarrChunks(editedEdges: Seq[(Long, Long, Boolean)]): Iterator[Array[Byte]] =
    editedEdges.grouped(ChunkSize).map { edgeTupleChunk: Seq[(Long, Long, Boolean)] =>
      val bytes = ByteBuffer.allocate(ChunkSize)
      edgeTupleChunk.foreach {
        case (_, _, isAddedEdge) =>
          val boolAsByte: Byte = if (isAddedEdge) 1 else 0
          bytes.put(boolAsByte)
      }
      compressor.compress(bytes.array)
    }

  private def editedEdgesToZarrChunks(editedEdges: Seq[(Long, Long, Boolean)]): Iterator[Array[Byte]] =
    editedEdges.grouped(ChunkSize).map { edgeTupleChunk: Seq[(Long, Long, Boolean)] =>
      val bytes = ByteBuffer.allocate(2 * ChunkSize * 8)
      edgeTupleChunk.foreach {
        case (src, dst, _) =>
          bytes.putLong(src)
          bytes.putLong(dst)
      }
      compressor.compress(bytes.array)
    }

  private lazy val compressorConfiguration =
    BloscCodecConfiguration(
      BloscCompressor.defaultCname,
      BloscCompressor.defaultCLevel,
      StringCompressionSetting(BloscCodecConfiguration.shuffleSettingFromInt(BloscCompressor.defaultShuffle)),
      Some(BloscCompressor.defaultTypesize),
      BloscCompressor.defaultBlocksize
    )

  private lazy val compressor =
    new BloscCompressor(
      Map(
        BloscCompressor.keyCname -> StringCompressionSetting(BloscCompressor.defaultCname),
        BloscCompressor.keyClevel -> IntCompressionSetting(BloscCompressor.defaultCLevel),
        BloscCompressor.keyShuffle -> IntCompressionSetting(BloscCompressor.defaultShuffle),
        BloscCompressor.keyBlocksize -> IntCompressionSetting(BloscCompressor.defaultBlocksize),
        BloscCompressor.keyTypesize -> IntCompressionSetting(BloscCompressor.defaultTypesize)
      ))

}
