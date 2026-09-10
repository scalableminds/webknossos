package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  EagerUpdateBucketVolumeAction,
  LazyBucketMutatingVolumeUpdateAction,
  VolumeTracingService
}
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreConversions, TracingDataStore, TracingId}
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
import scala.concurrent.duration.*

class AnnotationTransactionService @Inject() (
    handledGroupIdStore: TracingStoreRedisStore,
    uncommittedUpdatesStore: TracingStoreRedisStore,
    volumeTracingService: VolumeTracingService,
    tracingDataStore: TracingDataStore,
    remoteWebknossosClient: TSRemoteWebknossosClient,
    annotationService: TSAnnotationService
) extends KeyValueStoreConversions
    with LazyLogging {

  private val transactionGroupExpiry: FiniteDuration = 24 hours
  private val handledGroupCacheExpiry: FiniteDuration = 24 hours

  private def transactionGroupKey(
      annotationId: ObjectId,
      transactionId: String,
      transactionGroupIndex: Int,
      version: Long
  ) =
    s"transactionGroup___${annotationId}___${transactionId}___${transactionGroupIndex}___$version"

  private def handledGroupKey(
      annotationId: ObjectId,
      transactionId: String,
      version: Long,
      transactionGroupIndex: Int
  ) =
    s"handledGroup___${annotationId}___${transactionId}___${version}___$transactionGroupIndex"

  private def patternFor(annotationId: ObjectId, transactionId: String) =
    s"transactionGroup___${annotationId}___${transactionId}___*"

  private def saveUncommitted(
      annotationId: ObjectId,
      transactionId: String,
      transactionGroupIndex: Int,
      version: Long,
      updateGroup: UpdateActionGroup,
      expiry: FiniteDuration
  )(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.runIf(transactionGroupIndex > 0) {
        for {
          transactionIsPresentUncommitted <- uncommittedUpdatesStore.contains(
            transactionGroupKey(annotationId, transactionId, transactionGroupIndex - 1, version)
          )
          _ <- Fox.fromBool(
            transactionIsPresentUncommitted
          ) ?~> s"Incorrect transaction index. Got: $transactionGroupIndex but ${transactionGroupIndex - 1} does not exist" ~> CONFLICT
        } yield ()
      }
      _ <- uncommittedUpdatesStore.insert(
        transactionGroupKey(annotationId, transactionId, transactionGroupIndex, version),
        Json.toJson(updateGroup).toString(),
        Some(expiry)
      )
    } yield ()

  private def handleUpdateGroupOfTransaction(
      annotationId: ObjectId,
      previousVersionFox: Fox[Long],
      updateGroup: UpdateActionGroup
  )(using ec: ExecutionContext, tc: TokenContext, stats: UpdateTimingStats): Fox[Long] =
    for {
      previousCommittedVersion: Long <- previousVersionFox
      result <-
        if (previousCommittedVersion + 1 == updateGroup.version) {
          if (updateGroup.transactionGroupCount == updateGroup.transactionGroupIndex + 1) {
            // Received the last group of this transaction
            commitWithPending(annotationId, updateGroup)
          } else {
            for {
              _ <- saveUncommitted(
                annotationId,
                updateGroup.transactionId,
                updateGroup.transactionGroupIndex,
                updateGroup.version,
                updateGroup,
                transactionGroupExpiry
              )
              _ <- saveToHandledGroupIdStore(
                annotationId,
                updateGroup.transactionId,
                updateGroup.version,
                updateGroup.transactionGroupIndex
              )
            } yield previousCommittedVersion // no updates have been committed, do not yield version increase
          }
        } else {
          failUnlessAlreadyHandled(updateGroup, annotationId, previousCommittedVersion)
        }
    } yield result

  // For an update group (that is the last of a transaction), fetch all previous uncommitted for the same transaction
  // and commit them all.
  private def commitWithPending(annotationId: ObjectId, updateGroup: UpdateActionGroup)(using
      ec: ExecutionContext,
      tc: TokenContext,
      stats: UpdateTimingStats
  ): Fox[Long] =
    for {
      previousActionGroupsToCommit <- getAllUncommittedFor(annotationId, updateGroup.transactionId)
      _ <- assertAllGroupsInTransactionArePresent(annotationId, updateGroup, previousActionGroupsToCommit)
      concatenatedGroup = concatenateUpdateGroupsOfTransaction(previousActionGroupsToCommit, updateGroup)
      commitResult <- commitUpdates(annotationId, List(concatenatedGroup))
      _ <- removeAllUncommittedFor(annotationId, updateGroup.transactionId)
    } yield commitResult

  // The last group (updateGroup itself) is not part of previousActionGroupsToCommit, so all indices
  // from 0 until (but excluding) its own index are expected to have been found among them.
  private def assertAllGroupsInTransactionArePresent(
      annotationId: ObjectId,
      updateGroup: UpdateActionGroup,
      previousActionGroupsToCommit: List[UpdateActionGroup]
  )(implicit ec: ExecutionContext): Fox[Unit] = {
    val expectedPreviousIndices = (0 until updateGroup.transactionGroupIndex).toSet
    val actualPreviousIndices = previousActionGroupsToCommit.map(_.transactionGroupIndex).toSet
    val missingIndices = (expectedPreviousIndices -- actualPreviousIndices).toSeq.sorted
    val errorMessage = s"Trying to commit transaction ${updateGroup.transactionId} for annotation $annotationId, " +
      s"but not all update groups are present. Missing indices: ${missingIndices.mkString(", ")}"
    Fox.fromBool(missingIndices.isEmpty) ?~> errorMessage
  }

  private def removeAllUncommittedFor(annotationId: ObjectId, transactionId: String): Fox[Unit] =
    uncommittedUpdatesStore.removeAllConditional(patternFor(annotationId, transactionId))

  private def getAllUncommittedFor(annotationId: ObjectId, transactionId: String): Fox[List[UpdateActionGroup]] =
    for {
      raw: Seq[String] <- uncommittedUpdatesStore.findAllConditional(patternFor(annotationId, transactionId))
      parsed: Seq[UpdateActionGroup] = raw.flatMap(itemAsString =>
        JsonHelper.parseAs[UpdateActionGroup](itemAsString).toOption
      )
    } yield parsed.toList.sortBy(_.transactionGroupIndex)

  private def saveToHandledGroupIdStore(
      annotationId: ObjectId,
      transactionId: String,
      version: Long,
      transactionGroupIndex: Int
  ): Fox[Unit] = {
    val key = handledGroupKey(annotationId, transactionId, version, transactionGroupIndex)
    handledGroupIdStore.insert(key, "()", Some(handledGroupCacheExpiry))
  }

  private def handledGroupIdStoreContains(
      annotationId: ObjectId,
      transactionId: String,
      version: Long,
      transactionGroupIndex: Int
  ): Fox[Boolean] =
    handledGroupIdStore.contains(handledGroupKey(annotationId, transactionId, version, transactionGroupIndex))

  private def concatenateUpdateGroupsOfTransaction(
      previousActionGroups: List[UpdateActionGroup],
      lastActionGroup: UpdateActionGroup
  ): UpdateActionGroup =
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
        transactionId = lastActionGroup.transactionId, // needed for correct handledGroup lookup in case of retry
        transactionGroupCount = 1,
        transactionGroupIndex =
          lastActionGroup.transactionGroupIndex // needed for correct handledGroup lookup in case of retry
      )
    }

  def handleSingleUpdateAction(annotationId: ObjectId, currentVersion: Long, updateAction: UpdateAction)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Long] = {
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
      )
    )
    handleUpdateGroups(annotationId, wrapped)
  }

  def handleUpdateGroups(annotationId: ObjectId, updateGroups: List[UpdateActionGroup])(using
      ec: ExecutionContext,
      tc: TokenContext,
      stats: UpdateTimingStats = new UpdateTimingStats
  ): Fox[Long] = for {
    _ <- handledGroupIdStore.checkHealth
    _ = stats.recordRequestShape(updateGroups)
    newVersion <-
      if (updateGroups.forall(_.transactionGroupCount == 1)) {
        commitUpdates(annotationId, updateGroups)
      } else {
        updateGroups.foldLeft(annotationService.currentMaterializableVersion(annotationId)) {
          (currentCommittedVersionFox, updateGroup) =>
            handleUpdateGroupOfTransaction(annotationId, currentCommittedVersionFox, updateGroup)
        }
      }
  } yield newVersion

  // Perform version check and commit the passed updates
  private def commitUpdates(annotationId: ObjectId, updateGroups: List[UpdateActionGroup])(using
      ec: ExecutionContext,
      tc: TokenContext,
      stats: UpdateTimingStats
  ): Fox[Long] =
    for {
      _ <- reportUpdates(annotationId, updateGroups)
      currentCommittedVersion: Fox[Long] = annotationService.currentMaterializableVersion(annotationId)
      newVersion <- updateGroups.foldLeft(currentCommittedVersion) { (previousVersion, updateGroup) =>
        previousVersion.flatMap { (prevVersion: Long) =>
          if (prevVersion + 1 == updateGroup.version) {
            for {
              _ <- stats.time("handleUpdateGroup")(handleUpdateGroup(annotationId, updateGroup))
              _ <- saveToHandledGroupIdStore(
                annotationId,
                updateGroup.transactionId,
                updateGroup.version,
                updateGroup.transactionGroupIndex
              )
            } yield updateGroup.version
          } else failUnlessAlreadyHandled(updateGroup, annotationId, prevVersion)
        }
      }
      _ <- applyImmediatelyIfNeeded(annotationId, updateGroups.flatMap(_.actions), newVersion)
    } yield newVersion

  private def applyImmediatelyIfNeeded(annotationId: ObjectId, updates: List[UpdateAction], newVersion: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Unit] =
    if (containsApplyImmediatelyUpdateActions(updates)) {
      annotationService.get(annotationId, Some(newVersion)).map(_ => ())
    } else Fox.successful(())

  private def containsApplyImmediatelyUpdateActions(updates: List[UpdateAction]) = updates.exists {
    case _: ApplyImmediatelyUpdateAction => true
    case _                               => false
  }

  /* Handles a single update group by applying bucket-mutating actions and storing the updates as a single version entry
     in annotationUpdates.
     Note on ordering: bucket-mutating actions are applied *before* the update actions are written to annotationUpdates.
     This protects against inconsistent states because all readers will consider annotationUpdates the source of truth
     for the newest version number. Only after that last put succeeds the data is considered committed.
     If it or anything before fails, readers will see the previous versions and a save retry will write the same data
     at the same version again.
   */
  private def handleUpdateGroup(annotationId: ObjectId, updateActionGroup: UpdateActionGroup)(using
      ec: ExecutionContext,
      tc: TokenContext,
      stats: UpdateTimingStats
  ): Fox[Unit] =
    for {
      updateActionsProcessed <- Fox.successful(preprocessActionsForStorage(updateActionGroup))
      eagerUpdateBucketActions = findEagerUpdateBucketActions(updateActionGroup)
      _ = stats.count("eagerUpdateBucketActions", eagerUpdateBucketActions.length)
      _ <- assertNoInvalidUpdateGroupCombinations(updateActionGroup, eagerUpdateBucketActions)
      _ <- applyEagerUpdateBucketActions(eagerUpdateBucketActions, annotationId, updateActionGroup.version)
      updateActionsJson = Json.toJson(updateActionsProcessed)
      _ <- stats.time("annotationUpdates.put")(
        tracingDataStore.annotationUpdates.put(
          annotationId.toString,
          updateActionGroup.version,
          jsonToBytes(updateActionsJson)
        )
      )
    } yield ()

  private def applyEagerUpdateBucketActions(
      actions: Seq[EagerUpdateBucketVolumeAction],
      annotationId: ObjectId,
      version: Long
  )(implicit ec: ExecutionContext, tc: TokenContext, stats: UpdateTimingStats): Fox[Unit] = {
    val actionsGrouped: Map[String, Seq[EagerUpdateBucketVolumeAction]] = actions.groupBy(
      _.actionTracingId
    )
    Fox
      .serialCombined(actionsGrouped.keys) { volumeTracingId =>
        for {
          // findVolume here also materializes all update actions up to here, which is necessary to guarantee version ordering
          // when mixing eager bucket mutating actions with lazily applied ones (see LazyBucketMutatingVolumeUpdateAction).
          tracing <- stats.time("findVolume")(annotationService.findVolume(annotationId, volumeTracingId))
          _ <- stats.time("applyBucketMutatingActions")(
            volumeTracingService.applyEagerUpdateBucketActions(
              volumeTracingId,
              annotationId,
              tracing,
              actionsGrouped(volumeTracingId),
              version
            )
          )
        } yield ()
      }
      .map(_ => ())
  }

  private def assertNoInvalidUpdateGroupCombinations(
      updateGroup: UpdateActionGroup,
      eagerBucketMutatingActions: Seq[EagerUpdateBucketVolumeAction]
  )(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.fromBool(
        updateGroup.actions.length <= 1000000
      ) ?~> "Annotation update transactions with more than 1M update actions are not currently supported"
      // Reverts, resets and add-layer actions are assumed, by the replay-time regrouping in
      // UpdateGroupHandling, to always be the only update in their update group. That assumption is only
      // ever established here, at commit time, since nothing re-validates or restores it during replay.
      _ <- Fox.fromBool(
        updateGroup.actions.length <= 1 || !updateGroup.actions.exists(
          UpdateGroupHandling.isIsolationSensitiveAction
        )
      ) ?~> "An update group containing a revert, reset-to-base, or add-layer action must not contain any other actions"

      _ <- Fox.fromBool(
        eagerBucketMutatingActions.isEmpty || !updateGroup.actions.exists(
          _.isInstanceOf[LazyBucketMutatingVolumeUpdateAction]
        )
      ) ?~> "Cannot mix eager bucket mutating actions with lazily applied bucket mutating actions in the same update group"
    } yield ()

  private def findEagerUpdateBucketActions(
      updateActionGroup: UpdateActionGroup
  ): List[EagerUpdateBucketVolumeAction] =
    updateActionGroup.actions.flatMap {
      case a: EagerUpdateBucketVolumeAction => Some(a)
      case _                                => None
    }

  private def preprocessActionsForStorage(updateActionGroup: UpdateActionGroup): List[UpdateAction] = {
    val actionsWithInfo = updateActionGroup.actions.map(
      _.addTimestamp(updateActionGroup.timestamp).addAuthorId(updateActionGroup.authorId)
    ) match {
      case Nil => List[UpdateAction]()
      // to the first action in the group, attach the group's info
      case first :: rest => first.addInfo(updateActionGroup.info) :: rest
    }
    actionsWithInfo.map {
      case a: EagerUpdateBucketVolumeAction => a.withoutBase64Data
      case a: AddLayerAnnotationAction      =>
        // Note: this generated tracingId must not be read from this action before it was committed to fossildb,
        // to keep save retries idempotent.
        a.copy(tracingId = Some(TracingId.generate))
      case a => a
    }
  }

  /* If this update group has already been “handled” (successfully saved as either committed or uncommitted),
   * ignore it silently. This is in case the frontend sends a retry if it believes a save to be unsuccessful
   * despite the backend receiving it just fine.
   */
  private def failUnlessAlreadyHandled(updateGroup: UpdateActionGroup, annotationId: ObjectId, previousVersion: Long)(
      implicit ec: ExecutionContext
  ): Fox[Long] = {
    val errorMessage = s"Incorrect version. Expected: ${previousVersion + 1}; Got: ${updateGroup.version}"
    for {
      groupWasHandled <- handledGroupIdStoreContains(
        annotationId,
        updateGroup.transactionId,
        updateGroup.version,
        updateGroup.transactionGroupIndex
      )
      _ <- Fox.fromBool(groupWasHandled) ?~> errorMessage ~> CONFLICT
    } yield updateGroup.version
  }

  private def reportUpdates(annotationId: ObjectId, updateGroups: List[UpdateActionGroup])(using
      tc: TokenContext
  ): Fox[Unit] =
    for {
      _ <- remoteWebknossosClient.reportAnnotationUpdates(
        AnnotationUpdatesReport(
          annotationId,
          timestamps = updateGroups.map(g => Instant(g.timestamp)),
          statistics = updateGroups.flatMap(_.stats).lastOption,
          significantChangesCount = updateGroups.map(_.significantChangesCount).sum,
          viewChangesCount = updateGroups.map(_.viewChangesCount).sum,
          tc.userTokenOpt
        )
      )
    } yield ()

}
