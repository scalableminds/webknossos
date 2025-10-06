package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.{EditableMappingSegmentListResult, UserAccessRequest}
import com.scalableminds.webknossos.tracingstore.{
  TSChunkCacheService,
  TSRemoteWebknossosClient,
  TracingStoreAccessTokenService
}
import com.scalableminds.webknossos.tracingstore.annotation.{TSAnnotationService, UpdateAction}
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingIOService,
  EditableMappingService,
  MergeAgglomerateUpdateAction,
  MinCutParameters,
  NeighborsParameters,
  SplitAgglomerateUpdateAction
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.datavault.{FileSystemDataVault, VaultPath}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.tracingstore.files.TsTempFileService
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class EditableMappingController @Inject()(
    volumeTracingService: VolumeTracingService,
    annotationService: TSAnnotationService,
    remoteWebknossosClient: TSRemoteWebknossosClient,
    accessTokenService: TracingStoreAccessTokenService,
    editableMappingService: EditableMappingService,
    tracingDataStore: TracingDataStore,
    tempFileService: TsTempFileService,
    chunkCacheService: TSChunkCacheService,
    editableMappingIOService: EditableMappingIOService)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with KeyValueStoreImplicits {

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

  def agglomerateGraph(tracingId: String, agglomerateId: Long, version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
            tracing <- annotationService.findVolume(annotationId, tracingId, version)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerForVolumeTracing(tracing, annotationId)
            editableMappingInfo <- annotationService.findEditableMappingInfo(annotationId, tracingId)
            agglomerateGraph <- editableMappingService.getAgglomerateGraphForIdWithFallback(editableMappingInfo,
                                                                                            tracingId,
                                                                                            tracing.version,
                                                                                            agglomerateId,
                                                                                            remoteFallbackLayer)
          } yield Ok(agglomerateGraph.toByteArray).as(protobufMimeType)
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
          editedMappingEdgesZippedTempFilePath <- editableMappingIOService.editedMappingEdgesToZippedZarrTempFile(
            editedEdges,
            tracingId)

        } yield Ok.sendPath(editedMappingEdgesZippedTempFilePath)
      }
    }

  def saveFromZip(tracingId: String,
                  annotationId: ObjectId,
                  startVersion: Long,
                  baseMappingName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
        for {
          _ <- tracingDataStore.editableMappingsInfo.put(tracingId,
                                                         0L,
                                                         toProtoBytes(editableMappingService.create(baseMappingName)))
          _ = logger.info(s"stored editableMappingsInfo at $tracingId v0")
          editedEdgesZip <- request.body.asRaw.map(_.asFile).toFox ?~> "zipFile.notFound"
          unzippedDir = tempFileService.createDirectory()
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
          _ = logger.info(s"Creating updates from $numEdges touched edges")
          editedEdges <- editedEdgesZarrArray.readAsMultiArray(offset = Array(0L, 0L), shape = Array(numEdges.toInt, 2))
          _ = logger.info(s"editedEdges size: ${editedEdges.getSize}")
          edgeIsAddition <- edgeIsAdditionZarrArray.readAsMultiArray(offset = 0L, shape = numEdges.toInt)
          _ = logger.info(s"edgeIsAddition size: ${edgeIsAddition.getSize}")
          now = Instant.now
          updateActions: Seq[UpdateAction] = (0 until numEdges.toInt).map { edgeIndex =>
            val edgeSrc = editedEdges.getLong(editedEdges.getIndex.set(Array(edgeIndex, 0)))
            val edgeDst = editedEdges.getLong(editedEdges.getIndex.set(Array(edgeIndex, 1)))
            val isAddition = edgeIsAddition.getBoolean(edgeIndex)
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
                actionTimestamp = Some(now.epochMillis),
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
                actionTimestamp = Some(now.epochMillis),
                actionAuthorId = None,
                info = None
              )
            }
          }
          startVersionWithOffset = if (startVersion == 0L) startVersion + 1 else startVersion
          _ <- Fox.serialCombined(updateActions.grouped(5).zipWithIndex) {
            case (updateGroup: Seq[UpdateAction], updateGroupIndex) =>
              val actionJson = Json.toJson(updateGroup)
              tracingDataStore.annotationUpdates.put(annotationId.toString,
                                                     updateGroupIndex + startVersionWithOffset,
                                                     actionJson)
          }
          finalVersion = startVersionWithOffset + numEdges
        } yield Ok(Json.toJson(finalVersion))
      }
    }

}
