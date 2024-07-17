package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.bool2Fox
import com.scalableminds.webknossos.tracingstore.TracingStoreRedisStore
import play.api.http.Status.CONFLICT
import play.api.libs.json.Json

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class AnnotationTransactionService @Inject()(
    handledGroupIdStore: TracingStoreRedisStore, // TODO: instantiate here rather than with injection, give fix namespace prefix?
    uncommittedUpdatesStore: TracingStoreRedisStore,
    annotationService: TSAnnotationService) {

  private val transactionGroupExpiry: FiniteDuration = 24 hours
  private val handledGroupCacheExpiry: FiniteDuration = 24 hours

  private def transactionGroupKey(annotationId: String,
                                  transactionId: String,
                                  transactionGroupIndex: Int,
                                  version: Long) =
    s"transactionGroup___${annotationId}___${transactionId}___${transactionGroupIndex}___$version"

  private def handledGroupKey(annotationId: String, transactionId: String, version: Long, transactionGroupIndex: Int) =
    s"handledGroup___${annotationId}___${transactionId}___${version}___$transactionGroupIndex"

  private def patternFor(annotationId: String, transactionId: String) =
    s"transactionGroup___${annotationId}___${transactionId}___*"

  def saveUncommitted(annotationId: String,
                      transactionId: String,
                      transactionGroupIndex: Int,
                      version: Long,
                      updateGroup: UpdateActionGroup,
                      expiry: FiniteDuration)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.runIf(transactionGroupIndex > 0)(
        Fox.assertTrue(
          uncommittedUpdatesStore.contains(transactionGroupKey(
            annotationId,
            transactionId,
            transactionGroupIndex - 1,
            version))) ?~> s"Incorrect transaction index. Got: $transactionGroupIndex but ${transactionGroupIndex - 1} does not exist" ~> CONFLICT)
      _ <- uncommittedUpdatesStore.insert(
        transactionGroupKey(annotationId, transactionId, transactionGroupIndex, version),
        Json.toJson(updateGroup).toString(),
        Some(expiry))
    } yield ()

  private def handleUpdateGroupForTransaction(annotationId: String,
                                              previousVersionFox: Fox[Long],
                                              updateGroup: UpdateActionGroup,
                                              userToken: Option[String])(implicit ec: ExecutionContext): Fox[Long] =
    for {
      previousCommittedVersion: Long <- previousVersionFox
      result <- if (previousCommittedVersion + 1 == updateGroup.version) {
        if (updateGroup.transactionGroupCount == updateGroup.transactionGroupIndex + 1) {
          // Received the last group of this transaction
          commitWithPending(annotationId, updateGroup, userToken)
        } else {
          for {
            _ <- saveUncommitted(annotationId,
                                 updateGroup.transactionId,
                                 updateGroup.transactionGroupIndex,
                                 updateGroup.version,
                                 updateGroup,
                                 transactionGroupExpiry)
            _ <- saveToHandledGroupIdStore(annotationId,
                                           updateGroup.transactionId,
                                           updateGroup.version,
                                           updateGroup.transactionGroupIndex)
          } yield previousCommittedVersion // no updates have been committed, do not yield version increase
        }
      } else {
        failUnlessAlreadyHandled(updateGroup, annotationId, previousCommittedVersion)
      }
    } yield result

  // For an update group (that is the last of a transaction), fetch all previous uncommitted for the same transaction
  // and commit them all.
  private def commitWithPending(annotationId: String, updateGroup: UpdateActionGroup, userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[Long] =
    for {
      previousActionGroupsToCommit <- getAllUncommittedFor(annotationId, updateGroup.transactionId)
      _ <- bool2Fox(
        previousActionGroupsToCommit
          .exists(_.transactionGroupIndex == 0) || updateGroup.transactionGroupCount == 1) ?~> s"Trying to commit a transaction without a group that has transactionGroupIndex 0."
      concatenatedGroup = concatenateUpdateGroupsOfTransaction(previousActionGroupsToCommit, updateGroup)
      commitResult <- commitUpdates(annotationId, List(concatenatedGroup), userToken)
      _ <- removeAllUncommittedFor(annotationId, updateGroup.transactionId)
    } yield commitResult

  private def removeAllUncommittedFor(tracingId: String, transactionId: String): Fox[Unit] =
    uncommittedUpdatesStore.removeAllConditional(patternFor(tracingId, transactionId))

  private def getAllUncommittedFor(annotationId: String, transactionId: String): Fox[List[UpdateActionGroup]] =
    for {
      raw: Seq[String] <- uncommittedUpdatesStore.findAllConditional(patternFor(annotationId, transactionId))
      parsed: Seq[UpdateActionGroup] = raw.flatMap(itemAsString =>
        JsonHelper.jsResultToOpt(Json.parse(itemAsString).validate[UpdateActionGroup]))
    } yield parsed.toList.sortBy(_.transactionGroupIndex)

  private def saveToHandledGroupIdStore(annotationId: String,
                                        transactionId: String,
                                        version: Long,
                                        transactionGroupIndex: Int): Fox[Unit] = {
    val key = handledGroupKey(annotationId, transactionId, version, transactionGroupIndex)
    handledGroupIdStore.insert(key, "()", Some(handledGroupCacheExpiry))
  }

  private def handledGroupIdStoreContains(annotationId: String,
                                          transactionId: String,
                                          version: Long,
                                          transactionGroupIndex: Int): Fox[Boolean] =
    handledGroupIdStore.contains(handledGroupKey(annotationId, transactionId, version, transactionGroupIndex))

  private def concatenateUpdateGroupsOfTransaction(
                                                    previousActionGroups: List[UpdateActionGroup],
                                                    lastActionGroup: UpdateActionGroup): UpdateActionGroup =
    if (previousActionGroups.isEmpty) lastActionGroup
    else {
      val allActionGroups = previousActionGroups :+ lastActionGroup
      UpdateActionGroup(
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

  def handleUpdateGroups(annotationId: String, updateGroups: List[UpdateActionGroup], userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[Long] =
    if (updateGroups.forall(_.transactionGroupCount == 1)) {
      commitUpdates(annotationId, updateGroups, userToken)
    } else {
      updateGroups.foldLeft(annotationService.currentVersion(annotationId)) {
        (currentCommittedVersionFox, updateGroup) =>
          handleUpdateGroupForTransaction(annotationId, currentCommittedVersionFox, updateGroup, userToken)
      }
    }

  // Perform version check and commit the passed updates
  private def commitUpdates(annotationId: String,
                            updateGroups: List[UpdateActionGroup],
                            userToken: Option[String])(implicit ec: ExecutionContext): Fox[Long] =
    for {
      _ <- annotationService.reportUpdates(annotationId, updateGroups, userToken)
      currentCommittedVersion: Fox[Long] = annotationService.currentVersion(annotationId)
      newVersion <- updateGroups.foldLeft(currentCommittedVersion) { (previousVersion, updateGroup) =>
        previousVersion.flatMap { prevVersion: Long =>
          if (prevVersion + 1 == updateGroup.version) {
            for {
              _ <- annotationService.handleUpdateGroup(annotationId, updateGroup, prevVersion, userToken)
              _ <- saveToHandledGroupIdStore(annotationId,
                                             updateGroup.transactionId,
                                             updateGroup.version,
                                             updateGroup.transactionGroupIndex)
            } yield updateGroup.version
          } else failUnlessAlreadyHandled(updateGroup, annotationId, prevVersion)
        }
      }
    } yield newVersion

  /* If this update group has already been “handled” (successfully saved as either committed or uncommitted),
   * ignore it silently. This is in case the frontend sends a retry if it believes a save to be unsuccessful
   * despite the backend receiving it just fine.
   */
  private def failUnlessAlreadyHandled(updateGroup: UpdateActionGroup, tracingId: String, previousVersion: Long)(
      implicit ec: ExecutionContext): Fox[Long] = {
    val errorMessage = s"Incorrect version. Expected: ${previousVersion + 1}; Got: ${updateGroup.version}"
    for {
      _ <- Fox.assertTrue(
        handledGroupIdStoreContains(tracingId,
                                    updateGroup.transactionId,
                                    updateGroup.version,
                                    updateGroup.transactionGroupIndex)) ?~> errorMessage ~> CONFLICT
    } yield updateGroup.version
  }

}
