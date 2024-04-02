package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonHelper.{boxFormat, optionFormat}
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.{
  TracingSelector,
  TracingService,
  UpdateAction,
  UpdateActionGroup
}
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteWebknossosClient,
  TracingStoreAccessTokenService,
  TracingUpdatesReport
}
import net.liftweb.common.{Empty, Failure, Full}
import play.api.i18n.Messages
import play.api.libs.json.{Format, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

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

  implicit val updateActionJsonFormat: Format[UpdateAction[T]] = tracingService.updateActionJsonFormat

  implicit val ec: ExecutionContext

  implicit val bodyParsers: PlayBodyParsers

  override def allowRemoteOrigin: Boolean = true

  def save(token: Option[String]): Action[T] = Action.async(validateProto[T]) { implicit request =>
    log() {
      logTime(slackNotificationService.noticeSlowRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
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
        accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
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

  def get(token: Option[String], tracingId: String, version: Option[Long]): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
          } yield {
            Ok(tracing.toByteArray).as(protobufMimeType)
          }
        }
      }
  }

  def getMultiple(token: Option[String]): Action[List[Option[TracingSelector]]] =
    Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
          for {
            tracings <- tracingService.findMultiple(request.body, applyUpdates = true)
          } yield {
            Ok(tracings.toByteArray).as(protobufMimeType)
          }
        }
      }
    }

  def newestVersion(token: Option[String], tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), token) {
        for {
          newestVersion <- tracingService.currentVersion(tracingId) ?~> "annotation.getNewestVersion.failed"
        } yield {
          JsonOk(Json.obj("version" -> newestVersion))
        }
      }
    }
  }

  def update(token: Option[String], tracingId: String): Action[List[UpdateActionGroup[T]]] =
    Action.async(validateJson[List[UpdateActionGroup[T]]]) { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId), urlOrHeaderToken(token, request)) {
            val updateGroups = request.body
            if (updateGroups.forall(_.transactionGroupCount == 1)) {
              commitUpdates(tracingId, updateGroups, urlOrHeaderToken(token, request)).map(_ => Ok)
            } else {
              updateGroups
                .foldLeft(tracingService.currentVersion(tracingId)) { (currentCommittedVersionFox, updateGroup) =>
                  handleUpdateGroupForTransaction(tracingId,
                                                  currentCommittedVersionFox,
                                                  updateGroup,
                                                  urlOrHeaderToken(token, request))
                }
                .map(_ => Ok)
            }
          }
        }
      }
    }

  private val transactionGroupExpiry: FiniteDuration = 24 hours

  private def handleUpdateGroupForTransaction(tracingId: String,
                                              previousVersionFox: Fox[Long],
                                              updateGroup: UpdateActionGroup[T],
                                              userToken: Option[String]): Fox[Long] =
    for {
      previousCommittedVersion: Long <- previousVersionFox
      result <- if (previousCommittedVersion + 1 == updateGroup.version) {
        if (updateGroup.transactionGroupCount == updateGroup.transactionGroupIndex + 1) {
          // Received the last group of this transaction
          commitWithPending(tracingId, updateGroup, userToken)
        } else {
          tracingService
            .saveUncommitted(tracingId,
                             updateGroup.transactionId,
                             updateGroup.transactionGroupIndex,
                             updateGroup.version,
                             updateGroup,
                             transactionGroupExpiry)
            .flatMap(
              _ =>
                tracingService.saveToHandledGroupIdStore(tracingId,
                                                         updateGroup.transactionId,
                                                         updateGroup.version,
                                                         updateGroup.transactionGroupIndex))
            .map(_ => previousCommittedVersion) // no updates have been committed, do not yield version increase
        }
      } else {
        failUnlessAlreadyHandled(updateGroup, tracingId, previousCommittedVersion)
      }
    } yield result

  // For an update group (that is the last of a transaction), fetch all previous uncommitted for the same transaction
  // and commit them all.
  private def commitWithPending(tracingId: String,
                                updateGroup: UpdateActionGroup[T],
                                userToken: Option[String]): Fox[Long] =
    for {
      previousActionGroupsToCommit <- tracingService.getAllUncommittedFor(tracingId, updateGroup.transactionId)
      _ <- bool2Fox(
        previousActionGroupsToCommit
          .exists(_.transactionGroupIndex == 0) || updateGroup.transactionGroupCount == 1) ?~> s"Trying to commit a transaction without a group that has transactionGroupIndex 0."
      concatenatedGroup = concatenateUpdateGroupsOfTransaction(previousActionGroupsToCommit, updateGroup)
      commitResult <- commitUpdates(tracingId, List(concatenatedGroup), userToken)
      _ <- tracingService.removeAllUncommittedFor(tracingId, updateGroup.transactionId)
    } yield commitResult

  private def concatenateUpdateGroupsOfTransaction(previousActionGroups: List[UpdateActionGroup[T]],
                                                   lastActionGroup: UpdateActionGroup[T]): UpdateActionGroup[T] =
    if (previousActionGroups.isEmpty) lastActionGroup
    else {
      val allActionGroups = previousActionGroups :+ lastActionGroup
      UpdateActionGroup[T](
        version = lastActionGroup.version,
        timestamp = lastActionGroup.timestamp,
        authorId = lastActionGroup.authorId,
        actions = allActionGroups.flatMap(_.actions),
        stats = lastActionGroup.stats, // the latest stats do count
        info = lastActionGroup.info, // frontend sets this identically for all groups of transaction
        transactionId = f"${lastActionGroup.transactionId}-concatenated",
        transactionGroupCount = 1,
        transactionGroupIndex = 0,
      )
    }

  // Perform version check and commit the passed updates
  private def commitUpdates(tracingId: String,
                            updateGroups: List[UpdateActionGroup[T]],
                            userToken: Option[String]): Fox[Long] = {
    val currentCommittedVersion: Fox[Long] = tracingService.currentVersion(tracingId)
    val report = TracingUpdatesReport(
      tracingId,
      timestamps = updateGroups.map(g => Instant(g.timestamp)),
      statistics = updateGroups.flatMap(_.stats).lastOption,
      significantChangesCount = updateGroups.map(_.significantChangesCount).sum,
      viewChangesCount = updateGroups.map(_.viewChangesCount).sum,
      userToken
    )
    remoteWebknossosClient.reportTracingUpdates(report).flatMap { _ =>
      updateGroups.foldLeft(currentCommittedVersion) { (previousVersion, updateGroup) =>
        previousVersion.flatMap { prevVersion: Long =>
          if (prevVersion + 1 == updateGroup.version) {
            tracingService
              .handleUpdateGroup(tracingId, updateGroup, prevVersion, userToken)
              .flatMap(
                _ =>
                  tracingService.saveToHandledGroupIdStore(tracingId,
                                                           updateGroup.transactionId,
                                                           updateGroup.version,
                                                           updateGroup.transactionGroupIndex))
              .map(_ => updateGroup.version)
          } else failUnlessAlreadyHandled(updateGroup, tracingId, prevVersion)
        }
      }
    }
  }

  /* If this update group has already been “handled” (successfully saved as either committed or uncommitted),
   * ignore it silently. This is in case the frontend sends a retry if it believes a save to be unsuccessful
   * despite the backend receiving it just fine.
   */
  private def failUnlessAlreadyHandled(updateGroup: UpdateActionGroup[T],
                                       tracingId: String,
                                       previousVersion: Long): Fox[Long] = {
    val errorMessage = s"Incorrect version. Expected: ${previousVersion + 1}; Got: ${updateGroup.version}"
    for {
      _ <- Fox.assertTrue(
        tracingService.handledGroupIdStoreContains(tracingId,
                                                   updateGroup.transactionId,
                                                   updateGroup.version,
                                                   updateGroup.transactionGroupIndex)) ?~> errorMessage ~> CONFLICT
    } yield updateGroup.version
  }

  def mergedFromIds(token: Option[String], persist: Boolean): Action[List[Option[TracingSelector]]] =
    Action.async(validateJson[List[Option[TracingSelector]]]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos, urlOrHeaderToken(token, request)) {
          for {
            tracingOpts <- tracingService.findMultiple(request.body, applyUpdates = true) ?~> Messages(
              "tracing.notFound")
            tracingsWithIds = tracingOpts.zip(request.body).flatMap {
              case (Some(tracing), Some(selector)) => Some((tracing, selector.tracingId))
              case _                               => None
            }
            newId = tracingService.generateTracingId
            mergedVolumeStats <- tracingService.mergeVolumeData(request.body.flatten,
                                                                tracingsWithIds.map(_._1),
                                                                newId,
                                                                newVersion = 0L,
                                                                toCache = !persist,
                                                                token)
            newEditableMappingIdBox <- tracingService
              .mergeEditableMappings(tracingsWithIds, urlOrHeaderToken(token, request))
              .futureBox
            newEditableMappingIdOpt <- newEditableMappingIdBox match {
              case Full(newEditableMappingId) => Fox.successful(Some(newEditableMappingId))
              case Empty                      => Fox.successful(None)
              case f: Failure                 => f.toFox
            }
            mergedTracing <- Fox.box2Fox(
              tracingService.merge(tracingsWithIds.map(_._1), mergedVolumeStats, newEditableMappingIdOpt))
            _ <- tracingService.save(mergedTracing, Some(newId), version = 0, toCache = !persist)
          } yield Ok(Json.toJson(newId))
        }
      }
    }
}
