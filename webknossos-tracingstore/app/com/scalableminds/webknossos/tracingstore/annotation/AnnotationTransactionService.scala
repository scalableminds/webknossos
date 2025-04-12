package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  BucketMutatingVolumeUpdateAction,
  UpdateBucketVolumeAction,
  VolumeTracingService
}
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore, TracingId}
import com.scalableminds.webknossos.tracingstore.{
  AnnotationUpdatesReport,
  TSRemoteWebknossosClient,
  TracingStoreRedisStore
}
import com.typesafe.scalalogging.LazyLogging
import play.api.http.Status.CONFLICT
import play.api.libs.json.Json

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class AnnotationTransactionService @Inject()(handledGroupIdStore: TracingStoreRedisStore,
                                             uncommittedUpdatesStore: TracingStoreRedisStore,
                                             volumeTracingService: VolumeTracingService,
                                             tracingDataStore: TracingDataStore,
                                             remoteWebknossosClient: TSRemoteWebknossosClient,
                                             annotationService: TSAnnotationService)
    extends KeyValueStoreImplicits
    with LazyLogging {

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

  private def saveUncommitted(annotationId: String,
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

  private def handleUpdateGroupOfTransaction(
      annotationId: String,
      previousVersionFox: Fox[Long],
      updateGroup: UpdateActionGroup)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      previousCommittedVersion: Long <- previousVersionFox
      result <- if (previousCommittedVersion + 1 == updateGroup.version) {
        if (updateGroup.transactionGroupCount == updateGroup.transactionGroupIndex + 1) {
          // Received the last group of this transaction
          commitWithPending(annotationId, updateGroup)
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
  private def commitWithPending(annotationId: String, updateGroup: UpdateActionGroup)(implicit ec: ExecutionContext,
                                                                                      tc: TokenContext): Fox[Long] =
    for {
      previousActionGroupsToCommit <- getAllUncommittedFor(annotationId, updateGroup.transactionId)
      _ <- Fox.fromBool(previousActionGroupsToCommit
        .exists(_.transactionGroupIndex == 0) || updateGroup.transactionGroupCount == 1) ?~> s"Trying to commit a transaction without a group that has transactionGroupIndex 0."
      concatenatedGroup = concatenateUpdateGroupsOfTransaction(previousActionGroupsToCommit, updateGroup)
      commitResult <- commitUpdates(annotationId, List(concatenatedGroup))
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

  private def concatenateUpdateGroupsOfTransaction(previousActionGroups: List[UpdateActionGroup],
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

  def handleSingleUpdateAction(annotationId: String, currentVersion: Long, updateAction: UpdateAction)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Long] = {
    val wrapped = List(
      UpdateActionGroup(
        currentVersion + 1,
        System.currentTimeMillis(),
        None,
        List(updateAction),
        None,
        None,
        "dummyTransactionId",
        1,
        0
      ))
    handleUpdateGroups(annotationId, wrapped)
  }

  def handleUpdateGroups(annotationId: String, updateGroups: List[UpdateActionGroup])(implicit ec: ExecutionContext,
                                                                                      tc: TokenContext): Fox[Long] =
    if (updateGroups.forall(_.transactionGroupCount == 1)) {
      commitUpdates(annotationId, updateGroups)
    } else {
      updateGroups.foldLeft(annotationService.currentMaterializableVersion(annotationId)) {
        (currentCommittedVersionFox, updateGroup) =>
          handleUpdateGroupOfTransaction(annotationId, currentCommittedVersionFox, updateGroup)
      }
    }

  // Perform version check and commit the passed updates
  private def commitUpdates(annotationId: String, updateGroups: List[UpdateActionGroup])(implicit ec: ExecutionContext,
                                                                                         tc: TokenContext): Fox[Long] =
    for {
      _ <- reportUpdates(annotationId, updateGroups)
      currentCommittedVersion: Fox[Long] = annotationService.currentMaterializableVersion(annotationId)
      newVersion <- updateGroups.foldLeft(currentCommittedVersion) { (previousVersion, updateGroup) =>
        previousVersion.flatMap { prevVersion: Long =>
          if (prevVersion + 1 == updateGroup.version) {
            for {
              _ <- handleUpdateGroup(annotationId, updateGroup)
              _ <- saveToHandledGroupIdStore(annotationId,
                                             updateGroup.transactionId,
                                             updateGroup.version,
                                             updateGroup.transactionGroupIndex)
            } yield updateGroup.version
          } else failUnlessAlreadyHandled(updateGroup, annotationId, prevVersion)
        }
      }
      _ <- applyImmediatelyIfNeeded(annotationId, updateGroups.flatMap(_.actions), newVersion)
    } yield newVersion

  private def applyImmediatelyIfNeeded(annotationId: String, updates: List[UpdateAction], newVersion: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Unit] =
    if (containsApplyImmediatelyUpdateActions(updates)) {
      annotationService.get(annotationId, Some(newVersion)).map(_ => ())
    } else Fox.successful(())

  private def containsApplyImmediatelyUpdateActions(updates: List[UpdateAction]) = updates.exists {
    case _: ApplyImmediatelyUpdateAction => true
    case _                               => false
  }

  private def handleUpdateGroup(annotationId: String, updateActionGroup: UpdateActionGroup)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Unit] =
    for {
      updateActionsJson <- Fox.successful(Json.toJson(preprocessActionsForStorage(updateActionGroup)))
      _ <- tracingDataStore.annotationUpdates.put(annotationId, updateActionGroup.version, updateActionsJson)
      bucketMutatingActions = findBucketMutatingActions(updateActionGroup)
      actionsGrouped: Map[String, List[BucketMutatingVolumeUpdateAction]] = bucketMutatingActions.groupBy(
        _.actionTracingId)
      _ <- Fox.serialCombined(actionsGrouped.keys.toList) { volumeTracingId =>
        for {
          tracing <- annotationService.findVolume(annotationId, volumeTracingId)
          _ <- volumeTracingService.applyBucketMutatingActions(volumeTracingId,
                                                               annotationId,
                                                               tracing,
                                                               actionsGrouped(volumeTracingId),
                                                               updateActionGroup.version)
        } yield ()
      }
    } yield ()

  private def findBucketMutatingActions(updateActionGroup: UpdateActionGroup): List[BucketMutatingVolumeUpdateAction] =
    updateActionGroup.actions.flatMap {
      case a: BucketMutatingVolumeUpdateAction => Some(a)
      case _                                   => None
    }

  private def preprocessActionsForStorage(updateActionGroup: UpdateActionGroup): List[UpdateAction] = {
    val actionsWithInfo = updateActionGroup.actions.map(
      _.addTimestamp(updateActionGroup.timestamp).addAuthorId(updateActionGroup.authorId)) match {
      case Nil => List[UpdateAction]()
      //to the first action in the group, attach the group's info
      case first :: rest => first.addInfo(updateActionGroup.info) :: rest
    }
    actionsWithInfo.map {
      case a: UpdateBucketVolumeAction => a.withoutBase64Data
      case a: AddLayerAnnotationAction => a.copy(tracingId = Some(TracingId.generate))
      case a                           => a
    }
  }

  /* If this update group has already been “handled” (successfully saved as either committed or uncommitted),
   * ignore it silently. This is in case the frontend sends a retry if it believes a save to be unsuccessful
   * despite the backend receiving it just fine.
   */
  private def failUnlessAlreadyHandled(updateGroup: UpdateActionGroup, annotationId: String, previousVersion: Long)(
      implicit ec: ExecutionContext): Fox[Long] = {
    val errorMessage = s"Incorrect version. Expected: ${previousVersion + 1}; Got: ${updateGroup.version}"
    for {
      _ <- Fox.assertTrue(
        handledGroupIdStoreContains(annotationId,
                                    updateGroup.transactionId,
                                    updateGroup.version,
                                    updateGroup.transactionGroupIndex)) ?~> errorMessage ~> CONFLICT
    } yield updateGroup.version
  }

  private def reportUpdates(annotationId: String, updateGroups: List[UpdateActionGroup])(
      implicit tc: TokenContext): Fox[Unit] =
    for {
      _ <- remoteWebknossosClient.reportAnnotationUpdates(
        AnnotationUpdatesReport(
          annotationId,
          timestamps = updateGroups.map(g => Instant(g.timestamp)),
          statistics = updateGroups.flatMap(_.stats).lastOption,
          significantChangesCount = updateGroups.map(_.significantChangesCount).sum,
          viewChangesCount = updateGroups.map(_.viewChangesCount).sum,
          tc.userTokenOpt
        ))
    } yield ()

}
