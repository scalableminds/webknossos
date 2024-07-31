package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.TracingStoreRedisStore
import com.scalableminds.webknossos.tracingstore.annotation.LayerUpdateAction
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating._
import com.scalableminds.webknossos.tracingstore.tracings.volume.MergedVolumeStats
import net.liftweb.common.{Box, Empty, Full}
import play.api.i18n.MessagesProvider

import scala.concurrent.ExecutionContext

class SkeletonTracingService @Inject()(
    tracingDataStore: TracingDataStore,
    val temporaryTracingStore: TemporaryTracingStore[SkeletonTracing],
    val handledGroupIdStore: TracingStoreRedisStore,
    val temporaryTracingIdStore: TracingStoreRedisStore,
    val uncommittedUpdatesStore: TracingStoreRedisStore,
    val tracingMigrationService: SkeletonTracingMigrationService)(implicit val ec: ExecutionContext)
    extends TracingService[SkeletonTracing]
    with KeyValueStoreImplicits
    with ProtoGeometryImplicits
    with FoxImplicits {

  val tracingType: TracingType.Value = TracingType.skeleton

  val tracingStore: FossilDBClient = tracingDataStore.skeletons

  implicit val tracingCompanion: SkeletonTracing.type = SkeletonTracing

  def currentVersion(tracingId: String): Fox[Long] =
    tracingDataStore.skeletonUpdates.getVersion(tracingId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  def currentVersion(tracing: SkeletonTracing): Long = tracing.version

  override def applyPendingUpdates(tracing: SkeletonTracing,
                                   tracingId: String,
                                   desiredVersion: Option[Long]): Fox[SkeletonTracing] = {
    val existingVersion = tracing.version
    findDesiredOrNewestPossibleVersion(tracing, tracingId, desiredVersion).flatMap { newVersion =>
      if (newVersion > existingVersion) {
        for {
          pendingUpdates <- findPendingUpdates(tracingId, existingVersion, newVersion)
          updatedTracing <- update(tracing, tracingId, pendingUpdates, newVersion)
          _ <- save(updatedTracing, Some(tracingId), newVersion)
        } yield updatedTracing
      } else {
        Full(tracing)
      }
    }
  }

  private def findDesiredOrNewestPossibleVersion(tracing: SkeletonTracing,
                                                 tracingId: String,
                                                 desiredVersion: Option[Long]): Fox[Long] =
    /*
     * Determines the newest saved version from the updates column.
     * if there are no updates at all, assume tracing is brand new (possibly created from NML,
     * hence the emptyFallbck tracing.version)
     */
    for {
      newestUpdateVersion <- tracingDataStore.skeletonUpdates.getVersion(tracingId,
                                                                         mayBeEmpty = Some(true),
                                                                         emptyFallback = Some(tracing.version))
    } yield {
      desiredVersion match {
        case None              => newestUpdateVersion
        case Some(desiredSome) => math.min(desiredSome, newestUpdateVersion)
      }
    }

  private def findPendingUpdates(tracingId: String,
                                 existingVersion: Long,
                                 desiredVersion: Long): Fox[List[SkeletonUpdateAction]] = ???

  private def applyUpdateOn(tracing: SkeletonTracing, update: LayerUpdateAction): SkeletonTracing = ???

  private def update(tracing: SkeletonTracing,
                     tracingId: String,
                     updates: List[SkeletonUpdateAction],
                     newVersion: Long): Fox[SkeletonTracing] = {
    def updateIter(tracingFox: Fox[SkeletonTracing],
                   remainingUpdates: List[SkeletonUpdateAction]): Fox[SkeletonTracing] =
      tracingFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(tracing) =>
          remainingUpdates match {
            case List() => Fox.successful(tracing)
            case RevertToVersionSkeletonAction(sourceVersion, tracingId, _, _, _) :: tail =>
              val sourceTracing = find(tracingId, Some(sourceVersion), useCache = false, applyUpdates = true)
              updateIter(sourceTracing, tail)
            case update :: tail => updateIter(Full(applyUpdateOn(tracing, update)), tail)
          }
        case _ => tracingFox
      }

    updates match {
      case List() => Full(tracing)
      case _ :: _ =>
        for {
          updated <- updateIter(Some(tracing), updates)
        } yield updated.withVersion(newVersion)
    }
  }

  def duplicate(tracing: SkeletonTracing,
                fromTask: Boolean,
                editPosition: Option[Vec3Int],
                editRotation: Option[Vec3Double],
                boundingBox: Option[BoundingBox]): Fox[String] = {
    val taskBoundingBox = if (fromTask) {
      tracing.boundingBox.map { bb =>
        val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
        NamedBoundingBoxProto(newId, Some("task bounding box"), Some(true), Some(getRandomColor), bb)
      }
    } else None

    val newTracing =
      tracing
        .copy(
          createdTimestamp = System.currentTimeMillis(),
          editPosition = editPosition.map(vec3IntToProto).getOrElse(tracing.editPosition),
          editRotation = editRotation.map(vec3DoubleToProto).getOrElse(tracing.editRotation),
          boundingBox = boundingBoxOptToProto(boundingBox).orElse(tracing.boundingBox),
          version = 0
        )
        .addAllUserBoundingBoxes(taskBoundingBox)
    val finalTracing = if (fromTask) newTracing.clearBoundingBox else newTracing
    save(finalTracing, None, finalTracing.version)
  }

  def merge(tracings: Seq[SkeletonTracing],
            mergedVolumeStats: MergedVolumeStats,
            newEditableMappingIdOpt: Option[String]): Box[SkeletonTracing] =
    for {
      tracing <- tracings.map(Full(_)).reduceLeft(mergeTwo)
    } yield
      tracing.copy(
        createdTimestamp = System.currentTimeMillis(),
        version = 0L,
      )

  private def mergeTwo(tracingA: Box[SkeletonTracing], tracingB: Box[SkeletonTracing]): Box[SkeletonTracing] =
    for {
      tracingA <- tracingA
      tracingB <- tracingB
      mergedAdditionalAxes <- AdditionalAxis.mergeAndAssertSameAdditionalAxes(
        Seq(tracingA, tracingB).map(t => AdditionalAxis.fromProtosAsOpt(t.additionalAxes)))
      nodeMapping = TreeUtils.calculateNodeMapping(tracingA.trees, tracingB.trees)
      groupMapping = GroupUtils.calculateTreeGroupMapping(tracingA.treeGroups, tracingB.treeGroups)
      mergedTrees = TreeUtils.mergeTrees(tracingA.trees, tracingB.trees, nodeMapping, groupMapping)
      mergedGroups = GroupUtils.mergeTreeGroups(tracingA.treeGroups, tracingB.treeGroups, groupMapping)
      mergedBoundingBox = combineBoundingBoxes(tracingA.boundingBox, tracingB.boundingBox)
      userBoundingBoxes = combineUserBoundingBoxes(tracingA.userBoundingBox,
                                                   tracingB.userBoundingBox,
                                                   tracingA.userBoundingBoxes,
                                                   tracingB.userBoundingBoxes)
    } yield
      tracingA.copy(
        trees = mergedTrees,
        treeGroups = mergedGroups,
        boundingBox = mergedBoundingBox,
        userBoundingBox = None,
        userBoundingBoxes = userBoundingBoxes,
        additionalAxes = AdditionalAxis.toProto(mergedAdditionalAxes)
      )

  // Can be removed again when https://github.com/scalableminds/webknossos/issues/5009 is fixed
  override def remapTooLargeTreeIds(skeletonTracing: SkeletonTracing): SkeletonTracing =
    if (skeletonTracing.trees.exists(_.treeId > 1048576)) {
      val newTrees = for ((tree, index) <- skeletonTracing.trees.zipWithIndex) yield tree.withTreeId(index + 1)
      skeletonTracing.withTrees(newTrees)
    } else skeletonTracing

  def mergeVolumeData(tracingSelectors: Seq[TracingSelector],
                      tracings: Seq[SkeletonTracing],
                      newId: String,
                      newVersion: Long,
                      toCache: Boolean,
                      userToken: Option[String])(implicit mp: MessagesProvider): Fox[MergedVolumeStats] =
    Fox.successful(MergedVolumeStats.empty())

  def dummyTracing: SkeletonTracing = SkeletonTracingDefaults.createInstance

  def mergeEditableMappings(tracingsWithIds: List[(SkeletonTracing, String)], userToken: Option[String]): Fox[String] =
    Fox.empty
}
