package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.{NamedFunctionStream, ZipIO}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datareaders.zarr3._
import com.scalableminds.webknossos.datastore.datavault.{FileSystemDataVault, VaultPath}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.tracingstore.TSChunkCacheService
import com.scalableminds.webknossos.tracingstore.annotation.UpdateAction
import com.scalableminds.webknossos.tracingstore.files.TsTempFileService
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore}
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject
import play.api.libs.json.Json
import ucar.ma2.{Array => MultiArray}

import java.io.{BufferedOutputStream, File, FileOutputStream}
import java.nio.ByteBuffer
import java.nio.file.Path
import java.util.zip.Deflater
import scala.concurrent.ExecutionContext

class EditableMappingIOService @Inject()(tempFileService: TsTempFileService,
                                         tracingDataStore: TracingDataStore,
                                         chunkCacheService: TSChunkCacheService,
                                         editableMappingService: EditableMappingService)
    extends LazyLogging
    with FoxImplicits
    with KeyValueStoreImplicits {

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
      edgesZarrChunkStreams = edgesZarrChunks.zipWithIndex.map {
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
        codecs = Seq(BytesCodecConfiguration(Some("big")), BloscCodecConfiguration.defaultForWKZarrOutput),
        storage_transformers = None,
        dimension_names = Some(Array("edge", "srcDst"))
      )
      isAdditionZarrChunkStreams = isAdditionZarrChunks.zipWithIndex.map {
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
        codecs = Seq(BytesCodecConfiguration(Some("big")), BloscCodecConfiguration.defaultForWKZarrOutput),
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
      allStreams = edgesZarrChunkStreams ++ isAdditionZarrChunkStreams ++ Seq(edgesHeaderStream,
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

  private lazy val compressor = BloscCodec.fromConfiguration(BloscCodecConfiguration.defaultForWKZarrOutput).compressor

  def initializeFromUploadedZip(tracingId: String,
                                annotationId: ObjectId,
                                startVersion: Long,
                                baseMappingName: String,
                                editedEdgesZip: File)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      _ <- tracingDataStore.editableMappingsInfo.put(
        tracingId,
        0L, // Note: updates start at startVersion, but info is V0 for consistency with the annotationProto v0
        toProtoBytes(editableMappingService.create(baseMappingName))
      )
      (editedEdges, edgeIsAddition) <- unzipAndReadZarr(editedEdgesZip)
      timestamp = Instant.now.epochMillis
      updateActions: Seq[UpdateAction] = (0 until edgeIsAddition.getSize.toInt).map { edgeIndex =>
        val edgeSrc = editedEdges.getLong(editedEdges.getIndex.set(Array(edgeIndex, 0)))
        val edgeDst = editedEdges.getLong(editedEdges.getIndex.set(Array(edgeIndex, 1)))
        val isAddition = edgeIsAddition.getBoolean(edgeIndex)
        buildUpdateActionFromEdge(edgeSrc, edgeDst, isAddition, tracingId, timestamp)
      }
      updatesGrouped = updateActions.grouped(100).toSeq
      _ <- Fox.serialCombined(updatesGrouped.zipWithIndex) {
        case (updateGroup: Seq[UpdateAction], updateGroupIndex) =>
          tracingDataStore.annotationUpdates.put(annotationId.toString,
                                                 startVersion + updateGroupIndex,
                                                 Json.toJson(updateGroup))
      }
      numberOfSavedVersions = updatesGrouped.length
    } yield numberOfSavedVersions

  private def unzipAndReadZarr(editedEdgesZip: File)(implicit ec: ExecutionContext,
                                                     tc: TokenContext): Fox[(MultiArray, MultiArray)] = {
    val unzippedDir = tempFileService.createDirectory()
    for {
      _ <- ZipIO
        .unzipToDirectory(editedEdgesZip,
                          unzippedDir,
                          includeHiddenFiles = true,
                          List.empty,
                          truncateCommonPrefix = false,
                          excludeFromPrefix = None)
        .toFox
      unzippedVaultPath = new VaultPath(UPath.fromLocalPath(unzippedDir), FileSystemDataVault.create)
      editedEdgesZarrArray <- Zarr3Array.open(unzippedVaultPath / "edges/",
                                              DataSourceId("dummy", "unused"),
                                              "layer",
                                              None,
                                              None,
                                              None,
                                              chunkCacheService.sharedChunkContentsCache)
      edgeIsAdditionZarrArray <- Zarr3Array.open(unzippedVaultPath / "edgeIsAddition/",
                                                 DataSourceId("dummy", "unused"),
                                                 "layer",
                                                 None,
                                                 None,
                                                 None,
                                                 chunkCacheService.sharedChunkContentsCache)
      numEdges <- editedEdgesZarrArray.datasetShape.flatMap(_.headOption).toFox
      _ <- Fox.fromBool(numEdges.toInt.toLong == numEdges) ?~> "editableMappingFromZip.numEdges.exceedsInt"
      editedEdges <- editedEdgesZarrArray.readAsMultiArray(offset = Array(0L, 0L), shape = Array(numEdges.toInt, 2))
      edgeIsAddition <- edgeIsAdditionZarrArray.readAsMultiArray(offset = 0L, shape = numEdges.toInt)
    } yield (editedEdges, edgeIsAddition)
  }

  private def buildUpdateActionFromEdge(edgeSrc: Long,
                                        edgeDst: Long,
                                        isAddition: Boolean,
                                        tracingId: String,
                                        timestamp: Long): EditableMappingUpdateAction =
    if (isAddition) {
      MergeAgglomerateUpdateAction(
        agglomerateId1 = 0,
        agglomerateId2 = 0,
        segmentPosition1 = None,
        segmentPosition2 = None,
        segmentId1 = Some(edgeSrc),
        segmentId2 = Some(edgeDst),
        mag = Vec3Int.ones,
        actionTracingId = tracingId,
        actionTimestamp = Some(timestamp),
        actionAuthorId = None,
        info = None
      )
    } else {
      SplitAgglomerateUpdateAction(
        agglomerateId = 0,
        segmentPosition1 = None,
        segmentPosition2 = None,
        segmentId1 = Some(edgeSrc),
        segmentId2 = Some(edgeDst),
        mag = Vec3Int.ones,
        actionTracingId = tracingId,
        actionTimestamp = Some(timestamp),
        actionAuthorId = None,
        info = None
      )
    }
}
