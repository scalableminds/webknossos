package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, UserAccessRequest}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.tracingstore.{TracingStoreAccessTokenService, TracingStoreWkRpcClient}
import com.scalableminds.webknossos.tracingstore.tracings.TracingSelector
import com.scalableminds.webknossos.tracingstore.tracings.skeleton._
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.scalableminds.util.tools.JsonHelper.optionFormat
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.webknossos.tracingstore.slacknotification.SlackNotificationService
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.PlayBodyParsers

import scala.concurrent.ExecutionContext

class SkeletonTracingController @Inject()(val tracingService: SkeletonTracingService,
                                          val webKnossosServer: TracingStoreWkRpcClient,
                                          val accessTokenService: TracingStoreAccessTokenService,
                                          val slackNotificationService: SlackNotificationService)(
    implicit val ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends TracingController[SkeletonTracing, SkeletonTracings] {

  implicit val tracingsCompanion = SkeletonTracings

  implicit def packMultiple(tracings: List[SkeletonTracing]): SkeletonTracings =
    SkeletonTracings(tracings.map(t => SkeletonTracingOpt(Some(t))))

  implicit def packMultipleOpt(tracings: List[Option[SkeletonTracing]]): SkeletonTracings =
    SkeletonTracings(tracings.map(t => SkeletonTracingOpt(t)))

  implicit def unpackMultiple(tracings: SkeletonTracings): List[Option[SkeletonTracing]] =
    tracings.tracings.toList.map(_.tracing)

  def mergedFromContents(persist: Boolean) = Action.async(validateProto[SkeletonTracings]) { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          val tracings: List[Option[SkeletonTracing]] = request.body
          val mergedTracing = tracingService.merge(tracings.flatten)
          tracingService.save(mergedTracing, None, mergedTracing.version, toCache = !persist).map { newId =>
            Ok(Json.toJson(newId))
          }
        }
      }
    }
  }

  def duplicate(tracingId: String, version: Option[Long], fromTask: Option[Boolean]) = Action.async {
    implicit request =>
      log {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          AllowRemoteOrigin {
            for {
              tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
              newId <- tracingService.duplicate(tracing, fromTask.getOrElse(false))
            } yield {
              Ok(Json.toJson(newId))
            }
          }
        }
      }
  }

  def updateActionLog(tracingId: String) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        AllowRemoteOrigin {
          for {
            updateLog <- tracingService.updateActionLog(tracingId)
          } yield {
            Ok(updateLog)
          }
        }
      }
    }
  }

  def updateActionStatistics(tracingId: String) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        AllowRemoteOrigin {
          for {
            statistics <- tracingService.updateActionStatistics(tracingId)
          } yield {
            Ok(statistics)
          }
        }
      }
    }
  }
}
