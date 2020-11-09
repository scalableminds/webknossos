package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, UserAccessRequest}
import com.scalableminds.webknossos.tracingstore.{TracingStoreAccessTokenService, TracingStoreWkRpcClient}
import com.scalableminds.webknossos.tracingstore.tracings.{
  TracingSelector,
  TracingService,
  UpdateAction,
  UpdateActionGroup
}
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.scalableminds.util.tools.JsonHelper.optionFormat
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.webknossos.tracingstore.slacknotification.SlackNotificationService
import net.liftweb.common.Failure
import play.api.i18n.Messages

import scala.concurrent.duration._
import play.api.libs.json.{Format, Json, Reads}
import play.api.mvc.PlayBodyParsers
import scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}

import scala.concurrent.ExecutionContext

trait TracingController[T <: GeneratedMessage with Message[T], Ts <: GeneratedMessage with Message[Ts]]
    extends Controller {

  def tracingService: TracingService[T]

  def webKnossosServer: TracingStoreWkRpcClient

  def accessTokenService: TracingStoreAccessTokenService

  def slackNotificationService: SlackNotificationService

  implicit val tracingCompanion: GeneratedMessageCompanion[T] = tracingService.tracingCompanion

  implicit val tracingsCompanion: GeneratedMessageCompanion[Ts]

  implicit def unpackMultiple(tracings: Ts): List[Option[T]]

  implicit def packMultiple(tracings: List[T]): Ts

  implicit def packMultipleOpt(tracings: List[Option[T]]): Ts

  implicit val updateActionJsonFormat: Format[UpdateAction[T]] = tracingService.updateActionJsonFormat

  implicit val ec: ExecutionContext

  implicit val bodyParsers: PlayBodyParsers

  def save = Action.async(validateProto[T]) { implicit request =>
    log {
      logTime(slackNotificationService.reportUnusalRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          AllowRemoteOrigin {
            val tracing = request.body
            tracingService.save(tracing, None, 0).map { newId =>
              Ok(Json.toJson(newId))
            }
          }
        }
      }
    }
  }

  def saveMultiple = Action.async(validateProto[Ts]) { implicit request =>
    log {
      logTime(slackNotificationService.reportUnusalRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          AllowRemoteOrigin {
            val savedIds = Fox.sequence(request.body.map { tracingOpt: Option[T] =>
              tracingOpt match {
                case Some(tracing) => tracingService.save(tracing, None, 0, toCache = false).map(Some(_))
                case _             => Fox.successful(None)
              }
            })
            savedIds.map(id => Ok(Json.toJson(id)))
          }
        }
      }
    }
  }

  def get(tracingId: String, version: Option[Long]) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        AllowRemoteOrigin {
          for {
            tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
          } yield {
            Ok(tracing.toByteArray).as("application/x-protobuf")
          }
        }
      }
    }
  }

  def getMultiple = Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            tracings <- tracingService.findMultiple(request.body, applyUpdates = true)
          } yield {
            Ok(tracings.toByteArray).as("application/x-protobuf")
          }
        }
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[UpdateActionGroup[T]]]) { implicit request =>
    log {
      logTime(slackNotificationService.reportUnusalRequest) {
        accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId)) {
          AllowRemoteOrigin {
            val updateGroups = request.body
            val userToken = request.getQueryString("token")
            if (updateGroups.forall(_.transactionGroupCount.getOrElse(1) == 1)) {
              commitUpdates(tracingId, updateGroups, userToken).map(_ => Ok)
            } else {
              updateGroups
                .foldLeft(tracingService.currentVersion(tracingId)) { (currentCommittedVersionFox, updateGroup) =>
                  handleUpdateGroupForTransaction(tracingId, currentCommittedVersionFox, updateGroup, userToken)
                }
                .map(_ => Ok)
            }
          }
        }
      }
    }
  }

  val transactionBatchExpiry: FiniteDuration = 20 minutes

  private def handleUpdateGroupForTransaction(tracingId: String,
                                              previousVersionFox: Fox[Long],
                                              updateGroup: UpdateActionGroup[T],
                                              userToken: Option[String]): Fox[Long] =
    for {
      previousVersionTentative <- previousVersionFox
      currentUncommittedVersion <- tracingService.currentUncommittedVersion(tracingId, updateGroup.transactionId)
      previousVersion: Long = currentUncommittedVersion.getOrElse(previousVersionTentative)
      result <- if (previousVersion + 1 == updateGroup.version) {
        if (updateGroup.transactionGroupCount.getOrElse(1) == updateGroup.transactionGroupIndex.getOrElse(0) + 1) {
          commitPending(tracingId, updateGroup, userToken)
        } else {
          tracingService
            .saveUncommitted(tracingId,
                             updateGroup.transactionId,
                             updateGroup.transactionGroupIndex,
                             updateGroup.version,
                             updateGroup,
                             transactionBatchExpiry)
            .flatMap(_ =>
              tracingService.saveToHandledGroupIdStore(tracingId, updateGroup.transactionId, updateGroup.version))
            .map(_ => updateGroup.version)
        }
      } else {
        failUnlessAlreadyHandled(updateGroup, tracingId, previousVersion)
      }
    } yield result

  private def commitPending(tracingId: String,
                            updateGroup: UpdateActionGroup[T],
                            userToken: Option[String]): Fox[Long] =
    for {
      previousActionGroupsToCommit <- tracingService.getAllUncommittedFor(tracingId, updateGroup.transactionId)
      count = previousActionGroupsToCommit.length + 1
      _ = if (count > 1)
        logger.info(
          s"Committing $count updateActionGroups for batched transaction ${updateGroup.transactionId} of tracing $tracingId...")
      commitResult <- commitUpdates(tracingId, previousActionGroupsToCommit :+ updateGroup, userToken)
      _ = if (count > 1)
        logger.info(
          s"Successfully Committed $count updateActionGroups for batched transaction ${updateGroup.transactionId} of tracing $tracingId. Now at version $commitResult.")
      _ <- tracingService.removeAllUncommittedFor(tracingId, updateGroup.transactionId)
    } yield commitResult

  private def commitUpdates(tracingId: String,
                            updateGroups: List[UpdateActionGroup[T]],
                            userToken: Option[String]): Fox[Long] = {
    val timestamps = updateGroups.map(_.timestamp)
    val latestStatistics = updateGroups.flatMap(_.stats).lastOption
    val currentVersion = tracingService.currentVersion(tracingId)
    webKnossosServer.reportTracingUpdates(tracingId, timestamps, latestStatistics, userToken).flatMap { _ =>
      updateGroups.foldLeft(currentVersion) { (previousVersion, updateGroup) =>
        previousVersion.flatMap { prevVersion: Long =>
          if (prevVersion + 1 == updateGroup.version) {
            tracingService
              .handleUpdateGroup(tracingId, updateGroup, prevVersion)
              .flatMap(_ =>
                tracingService.saveToHandledGroupIdStore(tracingId, updateGroup.transactionId, updateGroup.version))
              .map(_ => updateGroup.version)
          } else {
            failUnlessAlreadyHandled(updateGroup, tracingId, prevVersion)
          }
        }
      }
    }
  }

  private def failUnlessAlreadyHandled(updateGroup: UpdateActionGroup[T],
                                       tracingId: String,
                                       previousVersion: Long): Fox[Long] = {
    val errorMessage = s"Incorrect version. Expected: ${previousVersion + 1}; Got: ${updateGroup.version}"
    updateGroup.transactionId match {
      case Some(transactionId) =>
        for {
          _ <- Fox.assertTrue(tracingService.handledGroupIdStoreContains(transactionId, tracingId, updateGroup.version)) ?~> errorMessage ~> CONFLICT
        } yield updateGroup.version
      case None => Fox.failure(errorMessage) ~> CONFLICT
    }
  }

  def mergedFromIds(persist: Boolean) = Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            tracings <- tracingService.findMultiple(request.body, applyUpdates = true) ?~> Messages("tracing.notFound")
            newId = tracingService.generateTracingId
            mergedTracing = tracingService.merge(tracings.flatten)
            _ <- tracingService.save(mergedTracing, Some(newId), version = 0, toCache = !persist)
            _ <- tracingService.mergeVolumeData(request.body.flatten,
                                                tracings.flatten,
                                                newId,
                                                mergedTracing,
                                                toCache = !persist)
          } yield {
            Ok(Json.toJson(newId))
          }
        }
      }
    }
  }
}
