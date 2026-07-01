package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.util.tools.JsonHelper.{boxFormat, optionFormat}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{
  SkeletonTracing,
  SkeletonTracingOpt,
  SkeletonTracings,
  SkeletonTracingsWithIds,
  StringOpt
}
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.skeleton._
import com.scalableminds.webknossos.tracingstore.tracings.TracingSelector
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingStoreAccessTokenService}
import com.scalableminds.util.tools.Box
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class SkeletonTracingController @Inject() (
    skeletonTracingService: SkeletonTracingService,
    remoteWebknossosClient: TSRemoteWebknossosClient,
    annotationService: TSAnnotationService,
    accessTokenService: TracingStoreAccessTokenService,
    slackNotificationService: TSSlackNotificationService
)(implicit val ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller {

  private def packMultiple(tracings: Seq[Option[SkeletonTracing]]): SkeletonTracings =
    SkeletonTracings(tracings.map(t => SkeletonTracingOpt(t)))

  private def unpackMultiple(tracings: SkeletonTracings): Seq[Option[SkeletonTracing]] =
    tracings.tracings.map(_.tracing)

  def save(newTracingId: String): Action[SkeletonTracing] = Action.fox(validateProto[SkeletonTracing]) {
    implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
            val tracing = request.body
            skeletonTracingService.saveSkeleton(newTracingId, version = 0, tracing).map { _ =>
              Ok
            }
          }
        }
      }
  }

  def saveMultiple(): Action[SkeletonTracingsWithIds] = Action.fox(validateProto[SkeletonTracingsWithIds]) {
    implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
            val zipped: List[(SkeletonTracingOpt, StringOpt)] = request.body.tracings.zip(request.body.tracingId).toList
            for {
              resultBoxes: List[Box[Boolean]] <- Fox.fromFuture(Fox.sequence(zipped.map {
                case (SkeletonTracingOpt(Some(tracing), _), StringOpt(Some(tracingId), _)) =>
                  skeletonTracingService.saveSkeleton(tracingId, version = 0, tracing).map(_ => true)
                case _ => Fox.empty
              }))
            } yield Ok(Json.toJson(resultBoxes))
          }
        }
      }
  }

  def get(tracingId: String, annotationId: ObjectId, version: Option[Long]): Action[AnyContent] =
    Action.fox { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readAnnotation(annotationId)) {
          for {
            tracing <- annotationService.findSkeleton(annotationId, tracingId, version) ?~> Msg.Annotation.notFound
          } yield Ok(tracing.toByteArray).as(protobufMimeType)
        }
      }
    }

  def getMultiple: Action[List[Option[TracingSelector]]] =
    Action.fox(validateJson[List[Option[TracingSelector]]]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            tracings <- annotationService.findMultipleSkeletons(request.body)
          } yield Ok(packMultiple(tracings).toByteArray).as(protobufMimeType)
        }
      }
    }

  def mergedFromContents(newTracingId: String): Action[SkeletonTracings] =
    Action.fox(validateProto[SkeletonTracings]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          val tracings: Seq[Option[SkeletonTracing]] = unpackMultiple(request.body)
          for {
            mergedTracing <- skeletonTracingService
              .merge(tracings.flatten, newVersion = 0L, additionalBoundingBoxes = Seq.empty)
              .toFox
            processedTracing = skeletonTracingService.remapTooLargeTreeIds(mergedTracing)
            _ <- skeletonTracingService.saveSkeleton(newTracingId, processedTracing.version, processedTracing)
          } yield Ok
        }
      }
    }

  // Used in task creation. History is dropped. Caller is responsible to create and save a matching AnnotationProto object
  def duplicate(
      tracingId: String,
      newTracingId: String,
      ownerId: ObjectId,
      requestingUserId: ObjectId,
      editPosition: Option[String],
      editRotation: Option[String],
      boundingBox: Option[String]
  ): Action[AnyContent] =
    Action.fox { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
            for {
              annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
              editPositionParsed <- Fox.runOptional(editPosition)(p => Vec3Int.fromUriLiteral(p).toFox)
              editRotationParsed <- Fox.runOptional(editRotation)(r => Vec3Double.fromUriLiteral(r).toFox)
              boundingBoxParsed <- Fox.runOptional(boundingBox)(b => BoundingBox.fromLiteral(b).toFox)
              newestSourceVersion <- annotationService.currentMaterializableVersion(annotationId)
              _ <- annotationService.duplicateSkeletonTracing(
                annotationId,
                sourceTracingId = tracingId,
                sourceVersion = newestSourceVersion,
                newTracingId = newTracingId,
                ownerId = ownerId,
                requestingUserId = requestingUserId,
                newVersion = 0,
                editPosition = editPositionParsed,
                editRotation = editRotationParsed,
                boundingBox = boundingBoxParsed,
                isFromTask = false
              )
            } yield Ok
          }
        }
      }
    }
}
