package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.{
  AnnotationLayerProto,
  AnnotationLayerTypeProto,
  AnnotationProto
}
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayer
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
            skeletonLayers = annotations.flatMap(
              _.annotationLayers.filter(_.`type` == AnnotationLayerTypeProto.Skeleton))
            volumeLayers = annotations.flatMap(_.annotationLayers.filter(_.`type` == AnnotationLayerTypeProto.Volume))
            // TODO: Volume
            // TODO: Merge updates? if so, iron out reverts?
            // TODO: Merge editable mappings
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
            skeletons <- annotationService.findMultipleSkeletons(skeletonLayers.map { l =>
              Some(TracingSelector(l.tracingId))
            }, applyUpdates = true)
            newSkeletonId = TracingId.generate
            newVolumeId = TracingId.generate
            mergedSkeletonName = allEqual(skeletonLayers.map(_.name))
              .getOrElse(AnnotationLayer.defaultSkeletonLayerName)
            mergedVolumeName = allEqual(volumeLayers.map(_.name)).getOrElse(AnnotationLayer.defaultVolumeLayerName)
            mergedSkeletonOpt <- Fox.runIf(skeletons.flatten.nonEmpty)(
              skeletonTracingService.merge(skeletons.flatten).toFox)
            mergedSkeletonLayerOpt: Option[AnnotationLayerProto] = mergedSkeletonOpt.map(
              _ =>
                AnnotationLayerProto(name = mergedSkeletonName,
                                     tracingId = newSkeletonId,
                                     `type` = AnnotationLayerTypeProto.Skeleton))
            mergedVolumeLayerOpt: Option[AnnotationLayerProto] = None // TODO
            mergedLayers = Seq(mergedSkeletonLayerOpt, mergedVolumeLayerOpt).flatten
            firstAnnotation <- annotations.headOption.toFox
            mergedAnnotation = firstAnnotation.withAnnotationLayers(mergedLayers)
            _ <- Fox.runOptional(mergedSkeletonOpt)(
              skeletonTracingService.save(_, Some(newSkeletonId), version = 0L, toCache = !persist))
            _ <- tracingDataStore.annotations.put(newAnnotationId, 0L, mergedAnnotation)
          } yield Ok(mergedAnnotation.toByteArray).as(protobufMimeType)
        }
      }
    }

  // TODO generalize, mix with assertAllOnSame*
  private def allEqual(str: Seq[String]): Option[String] =
    // returns the str if all names are equal, None otherwise
    str.headOption.map(name => str.forall(_ == name)).flatMap { _ =>
      str.headOption
    }
}
