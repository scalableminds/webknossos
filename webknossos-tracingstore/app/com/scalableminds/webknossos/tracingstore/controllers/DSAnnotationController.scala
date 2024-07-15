package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore, UpdateActionGroup}
import com.scalableminds.webknossos.tracingstore.TracingStoreAccessTokenService
import com.scalableminds.webknossos.tracingstore.annotation.{AnnotationTransactionService, DSAnnotationService}
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

case class GenericUpdateActionGroup(transactionGroupCount: Int,
                                    transactionGroupIndex: Int,
                                    version: Long,
                                    transactionId: String)
object GenericUpdateActionGroup {
  implicit val jsonFormat: OFormat[GenericUpdateActionGroup] = Json.format[GenericUpdateActionGroup]
}

class DSAnnotationController @Inject()(
    accessTokenService: TracingStoreAccessTokenService,
    slackNotificationService: TSSlackNotificationService,
    annotationService: DSAnnotationService,
    transactionService: AnnotationTransactionService,
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
            val updateGroups = request.body
            if (updateGroups.forall(_.transactionGroupCount == 1)) {
              commitUpdates(annotationId, updateGroups, urlOrHeaderToken(token, request)).map(_ => Ok)
              Fox.successful(Ok)
            } else {
              updateGroups
                .foldLeft(annotationService.newestMaterializableVersion(annotationId)) {
                  (currentCommittedVersionFox, updateGroup) =>
                    transactionService.handleUpdateGroupForTransaction(annotationId,
                                                                       currentCommittedVersionFox,
                                                                       updateGroup,
                                                                       urlOrHeaderToken(token, request))
                }
                .map(_ => Ok)
              Fox.successful(Ok)
            }
          }
        }
      }
    }

  private val transactionGroupExpiry: FiniteDuration = 24 hours

  private def commitUpdates(annotationId: String,
                            updateGroups: List[GenericUpdateActionGroup],
                            token: Option[String]): Fox[Unit] = {
    val currentCommittedVersion: Fox[Long] =
      tracingDataStore.annotationUpdates.getVersion(annotationId, mayBeEmpty = Some(true), emptyFallback = Some(0L))
    Fox.successful(())
  }
}

// get version history

// update layer

// restore of layer

// delete layer

// add layer

// skeleton + volume routes can now take annotationVersion

// Is an editable mapping a layer?
