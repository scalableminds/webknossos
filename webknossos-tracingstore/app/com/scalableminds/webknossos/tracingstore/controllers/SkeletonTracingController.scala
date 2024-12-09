package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonHelper.{boxFormat, optionFormat}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.skeleton._
import com.scalableminds.webknossos.tracingstore.tracings.{TracingId, TracingSelector}
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingStoreAccessTokenService}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class SkeletonTracingController @Inject()(skeletonTracingService: SkeletonTracingService,
                                          remoteWebknossosClient: TSRemoteWebknossosClient,
                                          annotationService: TSAnnotationService,
                                          accessTokenService: TracingStoreAccessTokenService,
                                          slackNotificationService: TSSlackNotificationService)(
    implicit val ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends Controller {

  implicit val tracingsCompanion: SkeletonTracings.type = SkeletonTracings

  implicit def packMultiple(tracings: List[SkeletonTracing]): SkeletonTracings =
    SkeletonTracings(tracings.map(t => SkeletonTracingOpt(Some(t))))

  implicit def packMultipleOpt(tracings: List[Option[SkeletonTracing]]): SkeletonTracings =
    SkeletonTracings(tracings.map(t => SkeletonTracingOpt(t)))

  implicit def unpackMultiple(tracings: SkeletonTracings): List[Option[SkeletonTracing]] =
    tracings.tracings.toList.map(_.tracing)

  def save(): Action[SkeletonTracing] = Action.async(validateProto[SkeletonTracing]) { implicit request =>
    log() {
      logTime(slackNotificationService.noticeSlowRequest) {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          val tracing = request.body
          skeletonTracingService.saveSkeleton(tracing, None, 0).map { newId =>
            Ok(Json.toJson(newId))
          }
        }
      }
    }
  }

  def saveMultiple(): Action[SkeletonTracings] = Action.async(validateProto[SkeletonTracings]) { implicit request =>
    log() {
      logTime(slackNotificationService.noticeSlowRequest) {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          val savedIds = Fox.sequence(request.body.map { tracingOpt: Option[SkeletonTracing] =>
            tracingOpt match {
              case Some(tracing) => skeletonTracingService.saveSkeleton(tracing, None, 0).map(Some(_))
              case _             => Fox.successful(None)
            }
          })
          savedIds.map(id => Ok(Json.toJson(id)))
        }
      }
    }
  }

  def get(tracingId: String, version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
            tracing <- annotationService.findSkeleton(annotationId, tracingId, version) ?~> Messages("tracing.notFound")
          } yield Ok(tracing.toByteArray).as(protobufMimeType)
        }
      }
    }

  def getMultiple: Action[List[Option[TracingSelector]]] =
    Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            tracings <- annotationService.findMultipleSkeletons(request.body)
          } yield {
            Ok(tracings.toByteArray).as(protobufMimeType)
          }
        }
      }
    }

  def mergedFromContents: Action[SkeletonTracings] =
    Action.async(validateProto[SkeletonTracings]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          val tracings: List[Option[SkeletonTracing]] = request.body
          for {
            mergedTracing <- Fox.box2Fox(skeletonTracingService.merge(tracings.flatten, newVersion = 0L))
            processedTracing = skeletonTracingService.remapTooLargeTreeIds(mergedTracing)
            newId <- skeletonTracingService.saveSkeleton(processedTracing, None, processedTracing.version)
          } yield Ok(Json.toJson(newId))
        }
      }
    }

  // Used in task creation. History is dropped. Caller is responsible to create and save a matching AnnotationProto object
  def duplicate(tracingId: String,
                editPosition: Option[String],
                editRotation: Option[String],
                boundingBox: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
            for {
              annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
              editPositionParsed <- Fox.runOptional(editPosition)(Vec3Int.fromUriLiteral)
              editRotationParsed <- Fox.runOptional(editRotation)(Vec3Double.fromUriLiteral)
              boundingBoxParsed <- Fox.runOptional(boundingBox)(BoundingBox.fromLiteral)
              newestSourceVersion <- annotationService.currentMaterializableVersion(annotationId)
              newTracingId <- annotationService.duplicateSkeletonTracing(
                annotationId,
                sourceTracingId = tracingId,
                sourceVersion = newestSourceVersion,
                newTracingId = TracingId.generate,
                newVersion = 0,
                editPosition = editPositionParsed,
                editRotation = editRotationParsed,
                boundingBox = boundingBoxParsed,
                isFromTask = false
              )
            } yield Ok(Json.toJson(newTracingId))
          }
        }
      }
    }
}
