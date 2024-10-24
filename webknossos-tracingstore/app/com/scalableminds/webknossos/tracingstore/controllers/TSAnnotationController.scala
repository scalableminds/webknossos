package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore}
import com.scalableminds.webknossos.tracingstore.TracingStoreAccessTokenService
import com.scalableminds.webknossos.tracingstore.annotation.{
  AnnotationTransactionService,
  TSAnnotationService,
  UpdateActionGroup
}
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class TSAnnotationController @Inject()(
    accessTokenService: TracingStoreAccessTokenService,
    slackNotificationService: TSSlackNotificationService,
    annotationService: TSAnnotationService,
    annotationTransactionService: AnnotationTransactionService,
    tracingDataStore: TracingDataStore)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with KeyValueStoreImplicits {

  def save(annotationId: String): Action[AnnotationProto] =
    Action.async(validateProto[AnnotationProto]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            // TODO assert id does not already exist
            _ <- tracingDataStore.annotations.put(annotationId, 0L, request.body)
            _ = logger.info(s"stored annotationProto for $annotationId")
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
                isFromTask: Option[Boolean],
                minMag: Option[Int],
                maxMag: Option[Int],
                downsample: Option[Boolean],
                editPosition: Option[String],
                editRotation: Option[String],
                boundingBox: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeAnnotation(annotationId)) {
            for {
              annotationProto <- annotationService.duplicate(annotationId, newAnnotationId, version)
            } yield Ok(annotationProto.toByteArray).as(protobufMimeType)
          }
        }
      }
    }
}
