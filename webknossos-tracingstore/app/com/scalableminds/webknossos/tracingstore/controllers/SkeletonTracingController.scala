package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.skeleton._
import com.scalableminds.webknossos.tracingstore.tracings.volume.MergedVolumeStats
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingStoreAccessTokenService}
import net.liftweb.common.Empty
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class SkeletonTracingController @Inject()(val tracingService: SkeletonTracingService,
                                          val remoteWebknossosClient: TSRemoteWebknossosClient,
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
        accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
          val tracings: List[Option[SkeletonTracing]] = request.body
          for {
            mergedTracing <- Fox.box2Fox(tracingService.merge(tracings.flatten, MergedVolumeStats.empty(), Empty))
            processedTracing = tracingService.remapTooLargeTreeIds(mergedTracing)
            newId <- tracingService.save(processedTracing, None, processedTracing.version, toCache = !persist)
          } yield Ok(Json.toJson(newId))
        }
      }
    }

  def duplicate(token: Option[String],
                tracingId: String,
                version: Option[Long],
                fromTask: Option[Boolean],
                editPosition: Option[String],
                editRotation: Option[String],
                boundingBox: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
            editPositionParsed <- Fox.runOptional(editPosition)(Vec3Int.fromUriLiteral)
            editRotationParsed <- Fox.runOptional(editRotation)(Vec3Double.fromUriLiteral)
            boundingBoxParsed <- Fox.runOptional(boundingBox)(BoundingBox.fromLiteral)
            newId <- tracingService.duplicate(tracing,
                                              fromTask.getOrElse(false),
                                              editPositionParsed,
                                              editRotationParsed,
                                              boundingBoxParsed)
          } yield {
            Ok(Json.toJson(newId))
          }
        }
      }
    }

  def updateActionLog(token: Option[String],
                      tracingId: String,
                      newestVersion: Option[Long],
                      oldestVersion: Option[Long]): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          updateLog <- tracingService.updateActionLog(tracingId, newestVersion, oldestVersion)
        } yield {
          Ok(updateLog)
        }
      }
    }
  }

  def updateActionStatistics(token: Option[String], tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            statistics <- tracingService.updateActionStatistics(tracingId)
          } yield {
            Ok(statistics)
          }
        }
      }
  }
}
