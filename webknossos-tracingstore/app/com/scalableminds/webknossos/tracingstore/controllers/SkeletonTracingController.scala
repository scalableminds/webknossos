package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, UserAccessRequest}
import com.scalableminds.webknossos.tracingstore.{TracingStoreAccessTokenService, TracingStoreWkRpcClient}
import com.scalableminds.webknossos.tracingstore.tracings.TracingSelector
import com.scalableminds.webknossos.tracingstore.tracings.skeleton._
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.PlayBodyParsers

import scala.concurrent.ExecutionContext

class SkeletonTracingController @Inject()(val tracingService: SkeletonTracingService,
                                          val webKnossosServer: TracingStoreWkRpcClient,
                                          val accessTokenService: TracingStoreAccessTokenService)
                                         (implicit val ec: ExecutionContext,
                                          val bodyParsers: PlayBodyParsers)
  extends TracingController[SkeletonTracing, SkeletonTracings] {

  implicit val tracingsCompanion = SkeletonTracings

  implicit def packMultiple(tracings: List[SkeletonTracing]): SkeletonTracings = SkeletonTracings(tracings)

  implicit def unpackMultiple(tracings: SkeletonTracings): List[SkeletonTracing] = tracings.tracings.toList

  def mergedFromContents(persist: Boolean) = Action.async(validateProto[SkeletonTracings]) { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          val tracings = request.body.tracings
          val mergedTracing = tracingService.merge(tracings)
          tracingService.save(mergedTracing, None, mergedTracing.version, toCache = !persist).map { newId =>
            Ok(Json.toJson(newId))
          }
        }
      }
    }
  }

  def mergedFromIds(persist: Boolean) = Action.async(validateJson[List[TracingSelector]]) { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            tracings <- tracingService.findMultiple(request.body, applyUpdates = true) ?~> Messages("tracing.notFound")
            mergedTracing = tracingService.merge(tracings)
            newId <- tracingService.save(mergedTracing, None, mergedTracing.version, toCache = !persist)
          } yield {
            Ok(Json.toJson(newId))
          }
        }
      }
    }
  }

  def duplicate(tracingId: String, version: Option[Long]) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
            newId <- tracingService.duplicate(tracing)
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
