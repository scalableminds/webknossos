package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.{TracingId, TracingSelector}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton._
import com.scalableminds.webknossos.tracingstore.tracings.volume.MergedVolumeStats
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingStoreAccessTokenService}
import net.liftweb.common.{Empty, Failure, Full}
import play.api.i18n.Messages
import play.api.libs.json.Json
import com.scalableminds.webknossos.datastore.controllers.Controller
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import com.scalableminds.util.tools.JsonHelper.{boxFormat, optionFormat}
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService

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
          skeletonTracingService.save(tracing, None, 0).map { newId =>
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
              case Some(tracing) => skeletonTracingService.save(tracing, None, 0).map(Some(_))
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
            tracing <- annotationService.findSkeleton(annotationId, tracingId, version, applyUpdates = true) ?~> Messages(
              "tracing.notFound")
          } yield Ok(tracing.toByteArray).as(protobufMimeType)
        }
      }
    }

  def getMultiple: Action[List[Option[TracingSelector]]] =
    Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            tracings <- annotationService.findMultipleSkeletons(request.body, applyUpdates = true)
          } yield {
            Ok(tracings.toByteArray).as(protobufMimeType)
          }
        }
      }
    }

  def mergedFromIds(persist: Boolean): Action[List[Option[TracingSelector]]] =
    Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            tracingOpts <- annotationService.findMultipleSkeletons(request.body, applyUpdates = true) ?~> Messages(
              "tracing.notFound")
            tracingsWithIds = tracingOpts.zip(request.body).flatMap {
              case (Some(tracing), Some(selector)) => Some((tracing, selector.tracingId))
              case _                               => None
            }
            newTracingId = TracingId.generate
            mergedVolumeStats <- skeletonTracingService.mergeVolumeData(request.body.flatten,
                                                                        tracingsWithIds.map(_._1),
                                                                        newTracingId,
                                                                        newVersion = 0L,
                                                                        toCache = !persist)
            mergeEditableMappingsResultBox <- skeletonTracingService
              .mergeEditableMappings(newTracingId, tracingsWithIds)
              .futureBox
            newEditableMappingIdOpt <- mergeEditableMappingsResultBox match {
              case Full(())   => Fox.successful(Some(newTracingId))
              case Empty      => Fox.successful(None)
              case f: Failure => f.toFox
            }
            mergedTracing <- Fox.box2Fox(skeletonTracingService.merge(tracingsWithIds.map(_._1)))
            _ <- skeletonTracingService.save(mergedTracing, Some(newTracingId), version = 0, toCache = !persist)
          } yield Ok(Json.toJson(newTracingId))
        }
      }
    }

  def mergedFromContents(persist: Boolean): Action[SkeletonTracings] =
    Action.async(validateProto[SkeletonTracings]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          val tracings: List[Option[SkeletonTracing]] = request.body
          for {
            mergedTracing <- Fox.box2Fox(skeletonTracingService.merge(tracings.flatten))
            processedTracing = skeletonTracingService.remapTooLargeTreeIds(mergedTracing)
            newId <- skeletonTracingService.save(processedTracing, None, processedTracing.version, toCache = !persist)
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
