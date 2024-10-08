package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingStoreRedisStore}
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.volume.MergedVolumeStats
import net.liftweb.common.{Box, Full}
import play.api.i18n.MessagesProvider

import scala.concurrent.ExecutionContext

class SkeletonTracingService @Inject()(
    tracingDataStore: TracingDataStore,
    val temporaryTracingStore: TemporaryTracingStore[SkeletonTracing],
    val handledGroupIdStore: TracingStoreRedisStore,
    val temporaryTracingIdStore: TracingStoreRedisStore,
    val remoteWebknossosClient: TSRemoteWebknossosClient,
    val uncommittedUpdatesStore: TracingStoreRedisStore,
    val tracingMigrationService: SkeletonTracingMigrationService)(implicit val ec: ExecutionContext)
    extends TracingService[SkeletonTracing]
    with KeyValueStoreImplicits
    with ProtoGeometryImplicits
    with FoxImplicits {

  val tracingType: TracingType.Value = TracingType.skeleton

  val tracingStore: FossilDBClient = tracingDataStore.skeletons

  implicit val tracingCompanion: SkeletonTracing.type = SkeletonTracing

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
                      toCache: Boolean)(implicit mp: MessagesProvider, tc: TokenContext): Fox[MergedVolumeStats] =
    Fox.successful(MergedVolumeStats.empty())

  def dummyTracing: SkeletonTracing = SkeletonTracingDefaults.createInstance

  def mergeEditableMappings(newTracingId: String, tracingsWithIds: List[(SkeletonTracing, String)])(
      implicit tc: TokenContext): Fox[Unit] =
    Fox.empty
}
