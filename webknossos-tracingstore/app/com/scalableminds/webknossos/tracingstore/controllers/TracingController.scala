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
import net.liftweb.common.Failure
import play.api.i18n.Messages
import scala.concurrent.duration._
import play.api.libs.json.{Json, Reads}
import play.api.mvc.PlayBodyParsers
import scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}

import scala.concurrent.ExecutionContext

trait TracingController[T <: GeneratedMessage with Message[T], Ts <: GeneratedMessage with Message[Ts]]
    extends Controller {

  def tracingService: TracingService[T]

  def webKnossosServer: TracingStoreWkRpcClient

  def accessTokenService: TracingStoreAccessTokenService

  implicit val tracingCompanion: GeneratedMessageCompanion[T] = tracingService.tracingCompanion

  implicit val tracingsCompanion: GeneratedMessageCompanion[Ts]

  implicit def unpackMultiple(tracings: Ts): List[Option[T]]

  implicit def packMultiple(tracings: List[T]): Ts

  implicit def packMultipleOpt(tracings: List[Option[T]]): Ts

  implicit val updateActionReads: Reads[UpdateAction[T]] = tracingService.updateActionReads

  implicit val ec: ExecutionContext

  implicit val bodyParsers: PlayBodyParsers

  def save = Action.async(validateProto[T]) { implicit request =>
    log {
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

  def saveMultiple = Action.async(validateProto[Ts]) { implicit request =>
    log {
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

  val transactionBatchExpiry = 20 minutes

  def update(tracingId: String) = Action.async(validateJson[List[UpdateActionGroup[T]]]) { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId)) {
        AllowRemoteOrigin {
          val updateGroups = request.body
          val userToken = request.getQueryString("token")
          if (updateGroups.forall(_.transactionGroupCount.getOrElse(1) == 1)) {
            logger.debug("only single-group transactions in this request. committing all.")
            commitUpdates(tracingId, updateGroups, userToken).map(_ => Ok)
          } else {
            for {
              currentCommittedVersion <- tracingService.currentVersion(tracingId)
              newestSavedVersion: Long <- updateGroups.foldLeft(Fox.successful(currentCommittedVersion)) {
                (currentCommittedVersionFox, updateGroup) =>
                  for {
                    currentCommittedVersion <- currentCommittedVersionFox
                    _ = logger.debug(
                      s"received group ${updateGroup.transactionId} v${updateGroup.version} (${updateGroup.transactionGroupIndex} of ${updateGroup.transactionGroupCount})")
                    previousVersion: Long = tracingService
                      .currentUncommittedVersion(tracingId, updateGroup.transactionId)
                      .getOrElse(currentCommittedVersion)
                    result <- if (previousVersion + 1 == updateGroup.version) {
                      if (updateGroup.transactionGroupCount.getOrElse(1) == updateGroup.transactionGroupIndex.getOrElse(
                            0) + 1) {
                        val updateActionGroupsToCommit =
                          tracingService.transactionBatchStore
                            .findAllConditional(keyTuple => keyTuple._2 == updateGroup.transactionId.get)
                            .toList
                            .sortBy(_.version) :+ updateGroup
                        commitUpdates(tracingId, updateActionGroupsToCommit, userToken).map(result => {
                          tracingService.transactionBatchStore.removeAllConditional(keyTuple =>
                            keyTuple._2 == updateGroup.transactionId.get)
                          result
                        })
                      } else {
                        logger.debug(
                          s"saving version ${updateGroup.version} uncommitted (from transaction ${updateGroup.transactionId})")
                        tracingService.transactionBatchStore.insert(
                          (tracingId, updateGroup.transactionId.get, updateGroup.version),
                          updateGroup,
                          Some(transactionBatchExpiry))
                        tracingService.saveToHandledGroupCache(tracingId,
                                                               updateGroup.version,
                                                               updateGroup.transactionId)
                        Fox.successful(updateGroup.version)
                      }
                    } else {
                      if (updateGroup.transactionId.exists(transactionId =>
                            tracingService.handledGroupCacheContains(transactionId, tracingId, updateGroup.version))) {
                        //this update group was received and successfully saved in a previous request. silently ignore this duplicate request
                        Fox.successful(updateGroup.version)
                      } else {
                        Fox.failure(s"Incorrect version. Expected: ${previousVersion + 1}; Got: ${updateGroup.version}") ~> CONFLICT
                      }
                    }
                  } yield result
              }
            } yield Ok
          }
        }
      }
    }
  }

  def commitUpdates(tracingId: String,
                    updateGroups: List[UpdateActionGroup[T]],
                    userToken: Option[String]): Fox[Long] = {
    val timestamps = updateGroups.map(_.timestamp)
    val latestStatistics = updateGroups.flatMap(_.stats).lastOption
    val currentVersion = tracingService.currentVersion(tracingId)
    webKnossosServer.reportTracingUpdates(tracingId, timestamps, latestStatistics, userToken).flatMap { _ =>
      updateGroups.foldLeft(currentVersion) { (previousVersion, updateGroup) =>
        previousVersion.flatMap { prevVersion =>
          if (prevVersion + 1 == updateGroup.version) {
            logger.debug(s"committing version ${updateGroup.version} (from transaction ${updateGroup.transactionId})")
            tracingService
              .handleUpdateGroup(tracingId, updateGroup, prevVersion)
              .map(_ =>
                Fox.successful(
                  tracingService.saveToHandledGroupCache(tracingId, updateGroup.version, updateGroup.transactionId)))
              .map(_ => updateGroup.version)
          } else {
            if (updateGroup.transactionId.exists(transactionId =>
                  tracingService.handledGroupCacheContains(transactionId, tracingId, updateGroup.version))) {
              //this update group was received and successfully saved in a previous request. silently ignore this duplicate request
              Fox.successful(updateGroup.version)
            } else {
              Fox.failure(s"Incorrect version. Expected: ${prevVersion + 1}; Got: ${updateGroup.version}") ~> CONFLICT
            }
          }
        }
      }
    }
  }

}
