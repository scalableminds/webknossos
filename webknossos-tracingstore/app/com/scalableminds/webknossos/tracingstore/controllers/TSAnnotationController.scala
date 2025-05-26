package com.scalableminds.webknossos.tracingstore.controllers

import collections.SequenceUtils
import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.{
  AnnotationLayerProto,
  AnnotationLayerTypeProto,
  AnnotationProto
}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayer
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.TracingStoreAccessTokenService
import com.scalableminds.webknossos.tracingstore.annotation.{
  AnnotationTransactionService,
  ResetToBaseAnnotationAction,
  TSAnnotationService,
  UpdateActionGroup
}
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingMergeService
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.SkeletonTracingService
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService
import net.liftweb.common.{Empty, Failure, Full}
import play.api.i18n.Messages
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

case class MergedFromIdsRequest(annotationIds: Seq[String], ownerIds: Seq[String])

object MergedFromIdsRequest {
  implicit val jsonFormat: OFormat[MergedFromIdsRequest] = Json.format[MergedFromIdsRequest]
}

class TSAnnotationController @Inject()(
    accessTokenService: TracingStoreAccessTokenService,
    slackNotificationService: TSSlackNotificationService,
    annotationService: TSAnnotationService,
    editableMappingMergeService: EditableMappingMergeService,
    annotationTransactionService: AnnotationTransactionService,
    skeletonTracingService: SkeletonTracingService,
    volumeTracingService: VolumeTracingService)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with KeyValueStoreImplicits {

  def save(annotationId: String, toTemporaryStore: Boolean = false): Action[AnnotationProto] =
    Action.async(validateProto[AnnotationProto]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            _ <- annotationService.saveAnnotationProto(annotationId, 0L, request.body, toTemporaryStore)
          } yield Ok
        }
      }
    }

  def update(annotationId: String): Action[List[UpdateActionGroup]] =
    Action.async(validateJson[List[UpdateActionGroup]]) { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeAnnotation(annotationId)) {
            for {
              _ <- annotationTransactionService.handleUpdateGroups(annotationId, request.body)
            } yield Ok
          }
        }
      }
    }

  def updateActionLog(annotationId: String,
                      newestVersion: Option[Long] = None,
                      oldestVersion: Option[Long] = None): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
        for {
          newestMaterializableVersion <- annotationService.currentMaterializableVersion(annotationId)
          updateLog <- annotationService.updateActionLog(annotationId,
                                                         newestVersion.getOrElse(newestMaterializableVersion),
                                                         oldestVersion.getOrElse(0))
        } yield Ok(updateLog)
      }
    }
  }

  def newestVersion(annotationId: String): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
        for {
          newestVersion <- annotationService.currentMaterializableVersion(annotationId)
        } yield JsonOk(Json.obj("version" -> newestVersion))
      }
    }
  }

  def get(annotationId: String, version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
            for {
              annotationProto <- annotationService.get(annotationId, version)
            } yield Ok(annotationProto.toByteArray).as(protobufMimeType)
          }
        }
      }
    }

  def duplicate(annotationId: String,
                newAnnotationId: String,
                ownerId: String,
                requestingUserId: String,
                version: Option[Long],
                isFromTask: Boolean,
                datasetBoundingBox: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
            for {
              datasetBoundingBoxParsed <- Fox.runOptional(datasetBoundingBox)(b => BoundingBox.fromLiteral(b).toFox)
              annotationProto <- annotationService.duplicate(annotationId,
                                                             newAnnotationId,
                                                             ownerId,
                                                             requestingUserId,
                                                             version,
                                                             isFromTask,
                                                             datasetBoundingBoxParsed) ?~> "annotation.duplicate.failed"
            } yield Ok(annotationProto.toByteArray).as(protobufMimeType)
          }
        }
      }
    }

  def resetToBase(annotationId: String): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
            for {
              currentVersion <- annotationService.currentMaterializableVersion(annotationId)
              _ <- annotationTransactionService.handleSingleUpdateAction(annotationId,
                                                                         currentVersion,
                                                                         ResetToBaseAnnotationAction())
            } yield Ok
          }
        }
      }
    }

  private def findAndAdaptVolumesForAnnotation(annotation: AnnotationProto, requestingUserId: String, ownerId: String)(
      implicit tc: TokenContext): Fox[Seq[VolumeTracing]] = {
    val volumeLayersOfAnnotation = annotation.annotationLayers.filter(_.typ == AnnotationLayerTypeProto.Volume)
    for {
      volumeTracings <- annotationService
        .findMultipleVolumes(volumeLayersOfAnnotation.map { l =>
          Some(TracingSelector(l.tracingId))
        })
        .map(_.flatten)
      volumeTracingsAdapted = volumeTracings.map(
        tracing =>
          tracing.copy(userStates =
            Seq(volumeTracingService.renderUserStateForVolumeTracingIntoUserState(tracing, requestingUserId, ownerId))))
    } yield volumeTracingsAdapted
  }

  private def findAndAdaptSkeletonsForAnnotation(
      annotation: AnnotationProto,
      requestingUserId: String,
      ownerId: String)(implicit tc: TokenContext): Fox[Seq[SkeletonTracing]] = {
    val volumeLayersOfAnnotation = annotation.annotationLayers.filter(_.typ == AnnotationLayerTypeProto.Skeleton)
    for {
      skeletonTracings <- annotationService
        .findMultipleSkeletons(volumeLayersOfAnnotation.map { l =>
          Some(TracingSelector(l.tracingId))
        })
        .map(_.flatten)
      skeletonTracingsAdapted = skeletonTracings.map(
        tracing =>
          tracing.copy(userStates = Seq(
            skeletonTracingService.renderUserStateForSkeletonTracingIntoUserState(tracing, requestingUserId, ownerId))))
    } yield skeletonTracingsAdapted
  }

  def mergedFromIds(toTemporaryStore: Boolean,
                    newAnnotationId: String,
                    requestingUserId: String): Action[MergedFromIdsRequest] =
    Action.async(validateJson[MergedFromIdsRequest]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            annotations: Seq[AnnotationProto] <- annotationService.getMultiple(request.body.annotationIds) ?~> Messages(
              "annotation.notFound")
            skeletonLayers = annotations.flatMap(_.annotationLayers.filter(_.typ == AnnotationLayerTypeProto.Skeleton))
            volumeLayers = annotations.flatMap(_.annotationLayers.filter(_.typ == AnnotationLayerTypeProto.Volume))
            newSkeletonId = TracingId.generate
            newVolumeId = TracingId.generate
            mergedSkeletonName = SequenceUtils
              .findUniqueElement(skeletonLayers.map(_.name))
              .getOrElse(AnnotationLayer.defaultSkeletonLayerName)
            mergedVolumeName = SequenceUtils
              .findUniqueElement(volumeLayers.map(_.name))
              .getOrElse(AnnotationLayer.defaultVolumeLayerName)
            volumeTracingsAdaptedNested: Seq[Seq[VolumeTracing]] <- Fox.serialCombined(
              annotations.zip(request.body.ownerIds)) {
              case (annotation, ownerId) =>
                findAndAdaptVolumesForAnnotation(annotation, requestingUserId, ownerId)
            }
            volumeTracings = volumeTracingsAdaptedNested.flatten
            firstVolumeAnnotationIndex = annotations.indexWhere(
              _.annotationLayers.exists(_.typ == AnnotationLayerTypeProto.Volume))
            firstVolumeAnnotationId = if (firstVolumeAnnotationIndex < 0) None
            else Some(request.body.annotationIds(firstVolumeAnnotationIndex))
            mergeEditableMappingsResultBox <- editableMappingMergeService
              .mergeEditableMappings(request.body.annotationIds,
                                     firstVolumeAnnotationId,
                                     newAnnotationId,
                                     newVolumeId,
                                     volumeTracings.zip(volumeLayers.map(_.tracingId)),
                                     toTemporaryStore)
              .shiftBox
            (newMappingName: Option[String], newTargetVersion: Long) <- mergeEditableMappingsResultBox match {
              case Full(targetVersion) => Fox.successful((Some(newVolumeId), targetVersion))
              case Empty               => Fox.successful((None, 0L))
              case f: Failure          => f.toFox
            }
            mergedVolumeStats <- volumeTracingService.mergeVolumeData(firstVolumeAnnotationId,
                                                                      volumeLayers.map(_.tracingId),
                                                                      volumeTracings,
                                                                      newVolumeId,
                                                                      newVersion = newTargetVersion,
                                                                      toTemporaryStore) ?~> "mergeVolumeData.failed"
            mergedVolumeOpt <- Fox.runIf(volumeTracings.nonEmpty)(
              volumeTracingService
                .merge(volumeTracings, mergedVolumeStats, newMappingName, newVersion = newTargetVersion)
                .toFox) ?~> "mergeVolume.failed"
            _ <- Fox.runOptional(mergedVolumeOpt)(
              volumeTracingService.saveVolume(newVolumeId, version = newTargetVersion, _, toTemporaryStore))
            skeletonTracingsAdaptedNested: Seq[Seq[SkeletonTracing]] <- Fox.serialCombined(
              annotations.zip(request.body.ownerIds)) {
              case (annotation, ownerId) =>
                findAndAdaptSkeletonsForAnnotation(annotation, requestingUserId, ownerId)
            }
            skeletonTracings = skeletonTracingsAdaptedNested.flatten
            mergedSkeletonOpt <- Fox.runIf(skeletonTracings.nonEmpty)(
              skeletonTracingService
                .merge(skeletonTracings, newVersion = newTargetVersion, Some(requestingUserId))
                .toFox)
            _ <- Fox.runOptional(mergedSkeletonOpt)(
              skeletonTracingService
                .saveSkeleton(newSkeletonId, version = newTargetVersion, _, toTemporaryStore = toTemporaryStore))
            mergedSkeletonLayerOpt = mergedSkeletonOpt.map(
              _ =>
                AnnotationLayerProto(name = mergedSkeletonName,
                                     tracingId = newSkeletonId,
                                     typ = AnnotationLayerTypeProto.Skeleton))
            mergedVolumeLayerOpt = mergedVolumeOpt.map(
              _ =>
                AnnotationLayerProto(name = mergedVolumeName,
                                     tracingId = newVolumeId,
                                     typ = AnnotationLayerTypeProto.Volume))
            mergedLayers = Seq(mergedSkeletonLayerOpt, mergedVolumeLayerOpt).flatten
            firstAnnotation <- annotations.headOption.toFox
            mergedAnnotation = firstAnnotation
              .withAnnotationLayers(mergedLayers)
              .withEarliestAccessibleVersion(newTargetVersion)
              .withVersion(newTargetVersion)
            _ <- annotationService.saveAnnotationProto(newAnnotationId,
                                                       newTargetVersion,
                                                       mergedAnnotation,
                                                       toTemporaryStore)
          } yield Ok(mergedAnnotation.toByteArray).as(protobufMimeType)
        }
      }
    }

}
