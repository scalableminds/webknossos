package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.skeleton._
import com.scalableminds.webknossos.tracingstore.{TracingStoreAccessTokenService, TSRemoteWebKnossosClient}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class SkeletonTracingController @Inject()(val tracingService: SkeletonTracingService,
                                          val remoteWebKnossosClient: TSRemoteWebKnossosClient,
                                          val accessTokenService: TracingStoreAccessTokenService,
                                          val slackNotificationService: TSSlackNotificationService)(
    implicit val ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends TracingController[SkeletonTracing, SkeletonTracings] {

  implicit val tracingsCompanion: SkeletonTracings.type = SkeletonTracings

  implicit def packMultiple(tracings: List[SkeletonTracing]): SkeletonTracings =
    SkeletonTracings(tracings.map(t => SkeletonTracingOpt(Some(t))))

  implicit def packMultipleOpt(tracings: List[Option[SkeletonTracing]]): SkeletonTracings =
    SkeletonTracings(tracings.map(t => SkeletonTracingOpt(t)))

  implicit def unpackMultiple(tracings: SkeletonTracings): List[Option[SkeletonTracing]] =
    tracings.tracings.toList.map(_.tracing)

  def mergedFromContents(token: Option[String], persist: Boolean): Action[SkeletonTracings] =
    Action.async(validateProto[SkeletonTracings]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, token) {
          AllowRemoteOrigin {
            val tracings: List[Option[SkeletonTracing]] = request.body
            val mergedTracing = tracingService.merge(tracings.flatten)
            val processedTracing = tracingService.remapTooLargeTreeIds(mergedTracing)
            for {
              newId <- tracingService.save(processedTracing, None, processedTracing.version, toCache = !persist)
            } yield Ok(Json.toJson(newId))
          }
        }
      }
    }

  def duplicate(token: Option[String],
                tracingId: String,
                version: Option[Long],
                fromTask: Option[Boolean]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, token) {
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

  def updateActionLog(token: Option[String], tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
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

  def updateActionStatistics(token: Option[String], tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
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
