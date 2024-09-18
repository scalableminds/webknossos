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

  def save(token: Option[String], annotationId: String): Action[AnnotationProto] =
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

  def update(token: Option[String], annotationId: String): Action[List[UpdateActionGroup]] =
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

  def updateActionLog(token: Option[String],
                      annotationId: String,
                      newestVersion: Option[Long] = None,
                      oldestVersion: Option[Long] = None): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
        for {
          updateLog <- annotationService.updateActionLog(annotationId, newestVersion, oldestVersion)
        } yield Ok(updateLog)
      }
    }
  }

  def newestVersion(token: Option[String], annotationId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
          for {
            newestVersion <- annotationService.currentMaterializableVersion(annotationId)
          } yield JsonOk(Json.obj("version" -> newestVersion))
        }
      }
  }

  def updateActionStatistics(token: Option[String], tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            statistics <- annotationService.updateActionStatistics(tracingId)
          } yield Ok(statistics)
        }
      }
  }

  def get(token: Option[String], annotationId: String, version: Option[Long]): Action[AnyContent] =
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

}

// get version history

// update layer

// restore of layer

// delete layer

// add layer

// skeleton + volume routes can now take annotationVersion

// Is an editable mapping a layer?
