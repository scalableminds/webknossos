package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.io.{NamedFunctionStream, ZipIO}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.{EditableMappingSegmentListResult, UserAccessRequest}
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingStoreAccessTokenService}
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingService,
  MinCutParameters,
  NeighborsParameters
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
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
import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  IntCompressionSetting,
  StringCompressionSetting
}
import com.scalableminds.webknossos.tracingstore.files.TsTempFileService
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import java.io.{BufferedOutputStream, File, FileOutputStream}
import java.nio.ByteBuffer
import java.util.zip.Deflater
import scala.concurrent.ExecutionContext

class EditableMappingController @Inject()(
    volumeTracingService: VolumeTracingService,
    annotationService: TSAnnotationService,
    remoteWebknossosClient: TSRemoteWebknossosClient,
    tempFileService: TsTempFileService,
    accessTokenService: TracingStoreAccessTokenService,
    editableMappingService: EditableMappingService)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def editableMappingInfo(tracingId: String, annotationId: ObjectId, version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
          for {
            tracing <- annotationService.findVolume(annotationId, tracingId, version)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            editableMappingInfo <- annotationService.findEditableMappingInfo(annotationId, tracingId, version)
            infoJson = editableMappingService.infoJson(tracingId = tracingId, editableMappingInfo = editableMappingInfo)
          } yield Ok(infoJson)
        }
      }
    }

  def segmentIdsForAgglomerate(tracingId: String, agglomerateId: Long): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
            tracing <- annotationService.findVolume(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            agglomerateGraphBox: Box[AgglomerateGraph] <- editableMappingService
              .getAgglomerateGraphForId(tracingId, tracing.version, agglomerateId)
              .shiftBox
            segmentIds <- agglomerateGraphBox match {
              case Full(agglomerateGraph) => Fox.successful(agglomerateGraph.segments)
              case Empty                  => Fox.successful(List.empty)
              case f: Failure             => f.toFox ?~> "annotation.editableMapping.getAgglomerateGraph.failed"
            }
            agglomerateIdIsPresent = agglomerateGraphBox.isDefined
          } yield Ok(Json.toJson(EditableMappingSegmentListResult(segmentIds.toList, agglomerateIdIsPresent)))
        }
      }
    }

  def agglomerateIdsForSegments(tracingId: String, annotationId: ObjectId, version: Option[Long]): Action[ListOfLong] =
    Action.async(validateProto[ListOfLong]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
          for {
            annotation <- annotationService.get(annotationId, version)
            tracing <- annotationService.findVolume(annotationId, tracingId, version)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerForVolumeTracing(tracing, annotationId)
            editableMappingInfo <- annotationService.findEditableMappingInfo(annotationId, tracingId, version)
            relevantMapping: Map[Long, Long] <- editableMappingService.generateCombinedMappingForSegmentIds(
              request.body.items.toSet,
              editableMappingInfo,
              annotation.version,
              tracingId,
              remoteFallbackLayer) ?~> "annotation.editableMapping.getAgglomerateIdsForSegments.failed"
            agglomerateIdsSorted = relevantMapping.toSeq.sortBy(_._1).map(_._2)
          } yield Ok(ListOfLong(agglomerateIdsSorted).toByteArray)
        }
      }
    }

  def agglomerateGraphMinCut(tracingId: String): Action[MinCutParameters] =
    Action.async(validateJson[MinCutParameters]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
            tracing <- annotationService.findVolume(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerForVolumeTracing(tracing, annotationId)
            editableMappingInfo <- annotationService.findEditableMappingInfo(annotationId, tracingId)
            edges <- editableMappingService.agglomerateGraphMinCut(tracingId,
                                                                   tracing.version,
                                                                   editableMappingInfo,
                                                                   request.body,
                                                                   remoteFallbackLayer)
          } yield Ok(Json.toJson(edges))
        }
      }
    }

  def agglomerateGraphNeighbors(tracingId: String): Action[NeighborsParameters] =
    Action.async(validateJson[NeighborsParameters]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
            tracing <- annotationService.findVolume(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerForVolumeTracing(tracing, annotationId)
            editableMappingInfo <- annotationService.findEditableMappingInfo(annotationId, tracingId)
            (segmentId, edges) <- editableMappingService.agglomerateGraphNeighbors(tracingId,
                                                                                   editableMappingInfo,
                                                                                   tracing.version,
                                                                                   request.body,
                                                                                   remoteFallbackLayer)
          } yield Ok(Json.obj("segmentId" -> segmentId, "neighbors" -> Json.toJson(edges)))
        }
      }
    }

  def agglomerateSkeleton(tracingId: String, agglomerateId: Long): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId)
          _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
          editableMappingInfo <- annotationService.findEditableMappingInfo(annotationId, tracingId)
          remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerForVolumeTracing(tracing, annotationId)
          agglomerateSkeletonBytes <- editableMappingService.getAgglomerateSkeletonWithFallback(tracingId,
                                                                                                tracing.version,
                                                                                                editableMappingInfo,
                                                                                                remoteFallbackLayer,
                                                                                                agglomerateId)
        } yield Ok(agglomerateSkeletonBytes)
      }
    }

  val chunkShape = 10000

  def editedEdgesZip(tracingId: String, version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId)
          _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
          remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerForVolumeTracing(tracing, annotationId)
          editedEdges: Seq[(Long, Long, Boolean)] <- editableMappingService.getEditedEdges(annotationId,
                                                                                           tracingId,
                                                                                           version,
                                                                                           remoteFallbackLayer)
          edgesZarrChunks: Iterator[Array[Byte]] = editedEdgesToZarrChunks(editedEdges)
          isAdditionZarrChunks: Iterator[Array[Byte]] = edgeIsAdditionToZarrChunks(editedEdges)
          edgesZarrChunksStream = edgesZarrChunks.zipWithIndex.map {
            case (chunk, index) => NamedFunctionStream.fromBytes(f"edges/$index.0", chunk)
          }
          edgesZarrHeader = Zarr3ArrayHeader(
            zarr_format = 3,
            node_type = "array",
            shape = Array(editedEdges.length, 2),
            data_type = Left(Zarr3DataType.uint64.toString),
            chunk_grid = Left(
              ChunkGridSpecification("regular",
                                     ChunkGridConfiguration(
                                       chunk_shape = Array(chunkShape, 2)
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
            case (chunk, index) => NamedFunctionStream.fromBytes(f"edgeIsAddition/$index", chunk)
          }
          isAdditionZarrHeader = Zarr3ArrayHeader(
            zarr_format = 3,
            node_type = "array",
            shape = Array(editedEdges.length),
            data_type = Left(Zarr3DataType.bool.toString),
            chunk_grid = Left(
              ChunkGridSpecification("regular",
                                     ChunkGridConfiguration(
                                       chunk_shape = Array(chunkShape)
                                     ))),
            chunk_key_encoding =
              ChunkKeyEncoding("v2", configuration = Some(ChunkKeyEncodingConfiguration(separator = Some(".")))),
            fill_value = Left("false"),
            attributes = None,
            codecs = Seq(BytesCodecConfiguration(Some("big")), compressorConfiguration),
            storage_transformers = None,
            dimension_names = Some(Array("edge"))
          )
          edgesHeaderStream = NamedFunctionStream.fromString("edges/zarr.json",
                                                             Json.prettyPrint(Json.toJson(edgesZarrHeader)))
          isAdditionHeaderStream = NamedFunctionStream.fromString("edgeIsAddition/zarr.json",
                                                                  Json.prettyPrint(Json.toJson(isAdditionZarrHeader)))
          groupHeader = EmptyZarr3GroupHeader(
            zarr_format = 3,
            node_type = "group"
          )
          groupHeaderStream = NamedFunctionStream.fromString("zarr.json", Json.toJson(groupHeader).toString())
          allStreams = edgesZarrChunksStream ++ isAdditionZarrChunksStream ++ Seq(edgesHeaderStream,
                                                                                  isAdditionHeaderStream,
                                                                                  groupHeaderStream)
          zipped = tempFileService.create(f"${tracingId}_editedMappingEdges.zip")
          outputStream = new BufferedOutputStream(new FileOutputStream(new File(zipped.toString)))
          _ <- ZipIO.zip(allStreams, outputStream, level = Deflater.BEST_SPEED)
        } yield Ok.sendPath(zipped)
      }
    }

  private lazy val compressorConfiguration =
    BloscCodecConfiguration(
      BloscCompressor.defaultCname,
      BloscCompressor.defaultCLevel,
      StringCompressionSetting(BloscCodecConfiguration.shuffleSettingFromInt(BloscCompressor.defaultShuffle)),
      Some(BloscCompressor.defaultTypesize),
      BloscCompressor.defaultBlocksize
    )

  private def edgeIsAdditionToZarrChunks(editedEdges: Seq[(Long, Long, Boolean)]): Iterator[Array[Byte]] = {
    val chunkSize = 10000 // 10000 edges per chunk (an edge is one boolean)
    editedEdges.grouped(chunkSize).map { edgeTupleChunk: Seq[(Long, Long, Boolean)] =>
      val bytes = ByteBuffer.allocate(chunkSize)
      edgeTupleChunk.foreach {
        case (_, _, isAddedEdge) =>
          val boolAsByte: Byte = if (isAddedEdge) 0 else 1
          bytes.put(boolAsByte)
      }
      compressor.compress(bytes.array)
    }
  }

  private def editedEdgesToZarrChunks(editedEdges: Seq[(Long, Long, Boolean)]): Iterator[Array[Byte]] = {
    val chunkSize = 10000 // 10000 edges per chunk (an edge is two Longs)
    editedEdges.grouped(chunkSize).map { edgeTupleChunk: Seq[(Long, Long, Boolean)] =>
      val bytes = ByteBuffer.allocate(2 * chunkSize * 8)
      edgeTupleChunk.foreach {
        case (src, dst, _) =>
          bytes.putLong(src)
          bytes.putLong(dst)
      }
      compressor.compress(bytes.array)
    }
  }

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
