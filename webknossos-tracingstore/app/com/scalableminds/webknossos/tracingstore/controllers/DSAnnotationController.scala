package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore}
import com.scalableminds.webknossos.tracingstore.TracingStoreAccessTokenService
import com.scalableminds.webknossos.tracingstore.annotation.{AnnotationTransactionService, GenericUpdateActionGroup}
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class DSAnnotationController @Inject()(
    accessTokenService: TracingStoreAccessTokenService,
    slackNotificationService: TSSlackNotificationService,
    annotationTransactionService: AnnotationTransactionService,
    tracingDataStore: TracingDataStore)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with KeyValueStoreImplicits {

  def initialize(annotationId: String, token: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
          for {
            _ <- tracingDataStore.annotations.put(annotationId, 0L, AnnotationProto(version = 0L))
          } yield Ok
        }
      }
    }

  def update(annotationId: String, token: Option[String]): Action[List[GenericUpdateActionGroup]] =
    Action.async(validateJson[List[GenericUpdateActionGroup]]) { implicit request =>
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

}

// get version history

// update layer

// restore of layer

// delete layer

// add layer

// skeleton + volume routes can now take annotationVersion

// Is an editable mapping a layer?
