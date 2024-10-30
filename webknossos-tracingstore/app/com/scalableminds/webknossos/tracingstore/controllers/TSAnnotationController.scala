package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.{AnnotationLayerTypeProto, AnnotationProto}
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.tracings.{
  KeyValueStoreImplicits,
  TracingDataStore,
  TracingId,
  TracingSelector
}
import com.scalableminds.webknossos.tracingstore.TracingStoreAccessTokenService
import com.scalableminds.webknossos.tracingstore.annotation.{
  AnnotationTransactionService,
  TSAnnotationService,
  UpdateActionGroup
}
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.SkeletonTracingService
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class TSAnnotationController @Inject()(
    accessTokenService: TracingStoreAccessTokenService,
    slackNotificationService: TSSlackNotificationService,
    annotationService: TSAnnotationService,
    annotationTransactionService: AnnotationTransactionService,
    skeletonTracingService: SkeletonTracingService,
    tracingDataStore: TracingDataStore)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with KeyValueStoreImplicits {

  def save(annotationId: String): Action[AnnotationProto] =
    Action.async(validateProto[AnnotationProto]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            _ <- tracingDataStore.annotations.put(annotationId, 0L, request.body)
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

  def updateActionStatistics(tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          statistics <- annotationService.updateActionStatistics(tracingId)
        } yield Ok(statistics)
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
                version: Option[Long],
                isFromTask: Boolean,
                datasetBoundingBox: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
            for {
              datasetBoundingBoxParsed <- Fox.runOptional(datasetBoundingBox)(BoundingBox.fromLiteral)
              annotationProto <- annotationService.duplicate(annotationId,
                                                             newAnnotationId,
                                                             version,
                                                             isFromTask,
                                                             datasetBoundingBoxParsed)
            } yield Ok(annotationProto.toByteArray).as(protobufMimeType)
          }
        }
      }
    }

  def mergedFromIds(persist: Boolean, newAnnotationId: String): Action[List[String]] =
    Action.async(validateJson[List[String]]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            annotations: Seq[AnnotationProto] <- annotationService.getMultiple(request.body) ?~> Messages(
              "annotation.notFound")
            annotationsWithIds = annotations.zip(annotations)
            skeletonIds = annotations.flatMap(
              _.annotationLayers.filter(_.`type` == AnnotationLayerTypeProto.Skeleton).map(_.tracingId))
            volumeIds = annotations.flatMap(
              _.annotationLayers.filter(_.`type` == AnnotationLayerTypeProto.Skeleton).map(_.tracingId))
            /*mergedVolumeStats <- volumeTracingService.mergeVolumeData(request.body.flatten,
                                                                        tracingsWithIds.map(_._1),
                                                                        newTracingId,
                                                                        newVersion = 0L,
                                                                        toCache = !persist)
            mergeEditableMappingsResultBox <- skeletonTracingService
              .mergeEditableMappings(newTracingId, tracingsWithIds)
              .futureBox
            newEditableMappingIdOpt <- mergeEditableMappingsResultBox match {
              case Full(())   => Fox.successful(Some(newTracingId))
              case Empty      => Fox.successful(None)
              case f: Failure => f.toFox
            }*/
            skeletons <- annotationService.findMultipleSkeletons(skeletonIds.map { s =>
              Some(TracingSelector(s))
            }, applyUpdates = true)
            // TODO handle zero-skeletons / zero-volumes case
            newSkeletonId = TracingId.generate
            newVolumeId = TracingId.generate
            mergedSkeleton <- skeletonTracingService.merge(skeletons.flatten).toFox
            _ <- skeletonTracingService.save(mergedSkeleton, Some(newSkeletonId), version = 0, toCache = !persist)
          } yield Ok
        }
      }
    }
}
