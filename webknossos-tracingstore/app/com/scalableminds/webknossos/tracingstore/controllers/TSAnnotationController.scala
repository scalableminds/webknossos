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

  def initialize(token: Option[String], annotationId: String): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
          for {
            _ <- tracingDataStore.annotations.put(annotationId, 0L, AnnotationProto(version = 0L))
          } yield Ok
        }
      }
    }

  def update(token: Option[String], annotationId: String): Action[List[UpdateActionGroup]] =
    Action.async(validateJson[List[UpdateActionGroup]]) { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccess(UserAccessRequest.writeAnnotation(annotationId),
                                            urlOrHeaderToken(token, request)) {
            for {
              _ <- annotationTransactionService.handleUpdateGroups(annotationId,
                                                                   request.body,
                                                                   urlOrHeaderToken(token, request))
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
      accessTokenService.validateAccess(UserAccessRequest.readAnnotation(annotationId),
                                        urlOrHeaderToken(token, request)) {
        for {
          updateLog <- annotationService.updateActionLog(annotationId, newestVersion, oldestVersion)
        } yield Ok(updateLog)
      }
    }
  }

  def updateActionStatistics(token: Option[String], tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            statistics <- annotationService.updateActionStatistics(tracingId)
          } yield Ok(statistics)
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
