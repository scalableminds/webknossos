package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonHelper.{boxFormat, optionFormat}
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.{TracingSelector, TracingService}
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingStoreAccessTokenService}
import net.liftweb.common.{Empty, Failure, Full}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}

import scala.concurrent.ExecutionContext

trait TracingController[T <: GeneratedMessage, Ts <: GeneratedMessage] extends Controller {

  def tracingService: TracingService[T]

  def remoteWebknossosClient: TSRemoteWebknossosClient

  def accessTokenService: TracingStoreAccessTokenService

  def slackNotificationService: TSSlackNotificationService

  implicit val tracingCompanion: GeneratedMessageCompanion[T] = tracingService.tracingCompanion

  implicit val tracingsCompanion: GeneratedMessageCompanion[Ts]

  implicit def unpackMultiple(tracings: Ts): List[Option[T]]

  implicit def packMultiple(tracings: List[T]): Ts

  implicit def packMultipleOpt(tracings: List[Option[T]]): Ts

  implicit val ec: ExecutionContext

  implicit val bodyParsers: PlayBodyParsers

  override def allowRemoteOrigin: Boolean = true

  def save(token: Option[String]): Action[T] = Action.async(validateProto[T]) { implicit request =>
    log() {
      logTime(slackNotificationService.noticeSlowRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          val tracing = request.body
          tracingService.save(tracing, None, 0).map { newId =>
            Ok(Json.toJson(newId))
          }
        }
      }
    }
  }

  def saveMultiple(token: Option[String]): Action[Ts] = Action.async(validateProto[Ts]) { implicit request =>
    log() {
      logTime(slackNotificationService.noticeSlowRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          val savedIds = Fox.sequence(request.body.map { tracingOpt: Option[T] =>
            tracingOpt match {
              case Some(tracing) => tracingService.save(tracing, None, 0).map(Some(_))
              case _             => Fox.successful(None)
            }
          })
          savedIds.map(id => Ok(Json.toJson(id)))
        }
      }
    }
  }

  def get(token: Option[String], annotationId: String, tracingId: String, version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId, version, applyUpdates = true) ?~> Messages(
              "tracing.notFound")
          } yield Ok(tracing.toByteArray).as(protobufMimeType)
        }
      }
    }

  def getMultiple(token: Option[String]): Action[List[Option[TracingSelector]]] =
    Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          for {
            tracings <- tracingService.findMultiple(request.body, applyUpdates = true)
          } yield {
            Ok(tracings.toByteArray).as(protobufMimeType)
          }
        }
      }
    }

  def mergedFromIds(token: Option[String], persist: Boolean): Action[List[Option[TracingSelector]]] =
    Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          for {
            tracingOpts <- tracingService.findMultiple(request.body, applyUpdates = true) ?~> Messages(
              "tracing.notFound")
            tracingsWithIds = tracingOpts.zip(request.body).flatMap {
              case (Some(tracing), Some(selector)) => Some((tracing, selector.tracingId))
              case _                               => None
            }
            newTracingId = tracingService.generateTracingId
            mergedVolumeStats <- tracingService.mergeVolumeData(request.body.flatten,
                                                                tracingsWithIds.map(_._1),
                                                                newTracingId,
                                                                newVersion = 0L,
                                                                toCache = !persist)
            newEditableMappingIdBox <- tracingService.mergeEditableMappings(newTracingId, tracingsWithIds).futureBox
            newEditableMappingIdOpt <- newEditableMappingIdBox match {
              case Full(newEditableMappingId) => Fox.successful(Some(newEditableMappingId))
              case Empty                      => Fox.successful(None)
              case f: Failure                 => f.toFox
            }
            mergedTracing <- Fox.box2Fox(
              tracingService.merge(tracingsWithIds.map(_._1), mergedVolumeStats, newEditableMappingIdOpt))
            _ <- tracingService.save(mergedTracing, Some(newTracingId), version = 0, toCache = !persist)
          } yield Ok(Json.toJson(newTracingId))
        }
      }
    }
}
