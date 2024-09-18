package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.{
  AccessTokenService,
  EditableMappingSegmentListResult,
  UserAccessRequest
}
import com.scalableminds.webknossos.tracingstore.annotation.{
  AnnotationTransactionService,
  TSAnnotationService,
  UpdateActionGroup
}
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingService,
  MinCutParameters,
  NeighborsParameters
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.{UpdateMappingNameVolumeAction, VolumeTracingService}
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class EditableMappingController @Inject()(volumeTracingService: VolumeTracingService,
                                          annotationService: TSAnnotationService,
                                          accessTokenService: AccessTokenService,
                                          editableMappingService: EditableMappingService,
                                          annotationTransactionService: AnnotationTransactionService)(
    implicit ec: ExecutionContext,
    bodyParsers: PlayBodyParsers)
    extends Controller {

  def makeMappingEditable(token: Option[String], annotationId: String, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- volumeTracingService.find(annotationId, tracingId)
            tracingMappingName <- tracing.mappingName ?~> "annotation.noMappingSet"
            _ <- assertMappingIsNotLocked(tracing)
            _ <- bool2Fox(volumeTracingService.volumeBucketsAreEmpty(tracingId)) ?~> "annotation.volumeBucketsNotEmpty"
            editableMappingInfo <- editableMappingService.create(tracingId, baseMappingName = tracingMappingName)
            volumeUpdate = UpdateMappingNameVolumeAction(Some(tracingId),
                                                         isEditable = Some(true),
                                                         isLocked = Some(true),
                                                         actionTracingId = tracingId,
                                                         actionTimestamp = Some(System.currentTimeMillis()))
            _ <- annotationTransactionService
              .handleUpdateGroups( // TODO replace this route by the update action only? address editable mappings by volume tracing id?
                annotationId,
                List(
                  UpdateActionGroup(tracing.version + 1,
                                    System.currentTimeMillis(),
                                    None,
                                    List(volumeUpdate),
                                    None,
                                    None,
                                    "dummyTransactionId",
                                    1,
                                    0))
              )
            infoJson = editableMappingService.infoJson(tracingId = tracingId, editableMappingInfo = editableMappingInfo)
          } yield Ok(infoJson)
        }
      }
    }

  private def assertMappingIsNotLocked(volumeTracing: VolumeTracing): Fox[Unit] =
    bool2Fox(!volumeTracing.mappingIsLocked.getOrElse(false)) ?~> "annotation.mappingIsLocked"

  /*// TODO integrate all of this into annotation update

  def updateEditableMapping(token: Option[String],
                            annotationId: String,
                            tracingId: String): Action[List[UpdateActionGroup]] =
    Action.async(validateJson[List[UpdateActionGroup]]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId)) {
        for {
          tracing <- tracingService.find(annotationId, tracingId)
          mappingName <- tracing.mappingName.toFox
          _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
          currentVersion <- editableMappingService.getClosestMaterializableVersionOrZero(mappingName, None)
          _ <- bool2Fox(request.body.length == 1) ?~> "Editable mapping update request must contain exactly one update group"
          updateGroup <- request.body.headOption.toFox
          _ <- bool2Fox(updateGroup.version == currentVersion + 1) ?~> "version mismatch"
          report = TracingUpdatesReport(
            annotationId, // TODO integrate all of this into annotation update
            timestamps = List(Instant(updateGroup.timestamp)),
            statistics = None,
            significantChangesCount = updateGroup.actions.length,
            viewChangesCount = 0,
            tokenContextForRequest.userTokenOpt
          )
          _ <- remoteWebknossosClient.reportTracingUpdates(report)
          remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
          _ <- editableMappingService.update(mappingName, updateGroup, updateGroup.version, remoteFallbackLayer)
        } yield Ok
      }
    }
   */

  def editableMappingInfo(token: Option[String],
                          annotationId: String,
                          tracingId: String,
                          version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- volumeTracingService.find(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            editableMappingInfo <- annotationService.getEditableMappingInfo(annotationId, tracingId, version)
            infoJson = editableMappingService.infoJson(tracingId = tracingId, editableMappingInfo = editableMappingInfo)
          } yield Ok(infoJson)
        }
      }
    }

  def segmentIdsForAgglomerate(token: Option[String],
                               annotationId: String,
                               tracingId: String,
                               agglomerateId: Long): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          tracing <- volumeTracingService.find(annotationId, tracingId)
          _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
          remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
          agglomerateGraphBox: Box[AgglomerateGraph] <- editableMappingService
            .getAgglomerateGraphForId(tracingId, agglomerateId, remoteFallbackLayer)
            .futureBox
          segmentIds <- agglomerateGraphBox match {
            case Full(agglomerateGraph) => Fox.successful(agglomerateGraph.segments)
            case Empty                  => Fox.successful(List.empty)
            case f: Failure             => f.toFox
          }
          agglomerateIdIsPresent = agglomerateGraphBox.isDefined
        } yield Ok(Json.toJson(EditableMappingSegmentListResult(segmentIds.toList, agglomerateIdIsPresent)))
      }
    }
  }

  def agglomerateIdsForSegments(token: Option[String], annotationId: String, tracingId: String): Action[ListOfLong] =
    Action.async(validateProto[ListOfLong]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- volumeTracingService.find(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            (editableMappingInfo, editableMappingVersion) <- editableMappingService.getInfoAndActualVersion(
              tracingId,
              requestedVersion = None,
              remoteFallbackLayer = remoteFallbackLayer)
            relevantMapping: Map[Long, Long] <- editableMappingService.generateCombinedMappingForSegmentIds(
              request.body.items.toSet,
              editableMappingInfo,
              editableMappingVersion,
              tracingId,
              remoteFallbackLayer)
            agglomerateIdsSorted = relevantMapping.toSeq.sortBy(_._1).map(_._2)
          } yield Ok(ListOfLong(agglomerateIdsSorted).toByteArray)
        }
      }
    }

  def agglomerateGraphMinCut(token: Option[String], annotationId: String, tracingId: String): Action[MinCutParameters] =
    Action.async(validateJson[MinCutParameters]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- volumeTracingService.find(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            edges <- editableMappingService.agglomerateGraphMinCut(tracingId, request.body, remoteFallbackLayer)
          } yield Ok(Json.toJson(edges))
        }
      }
    }

  def agglomerateGraphNeighbors(token: Option[String],
                                annotationId: String,
                                tracingId: String): Action[NeighborsParameters] =
    Action.async(validateJson[NeighborsParameters]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- volumeTracingService.find(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            remoteFallbackLayer <- volumeTracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            (segmentId, edges) <- editableMappingService.agglomerateGraphNeighbors(tracingId,
                                                                                   request.body,
                                                                                   remoteFallbackLayer)
          } yield Ok(Json.obj("segmentId" -> segmentId, "neighbors" -> Json.toJson(edges)))
        }
      }
    }
}
