package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
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
import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  IntCompressionSetting,
  StringCompressionSetting
}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import java.nio.ByteBuffer
import scala.concurrent.ExecutionContext

class EditableMappingController @Inject()(
    volumeTracingService: VolumeTracingService,
    annotationService: TSAnnotationService,
    remoteWebknossosClient: TSRemoteWebknossosClient,
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
        } yield Ok(Json.obj("editedEdges" -> Json.toJson(editedEdges)))
      }
    }

  private def edgeIsAdditionToZarrChunks(editedEdges: Seq[(Long, Long, Boolean)]): Iterator[Array[Byte]] = {
    val chunkSize = 10000 // 10000 edges per chunk (an edge is one boolean)
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
