package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.util.tools.{Box, Full}

import scala.concurrent.ExecutionContext

class SkeletonTracingService @Inject() (
    tracingDataStore: TracingDataStore,
    temporaryTracingService: TemporaryTracingService
)(implicit val ec: ExecutionContext)
    extends KeyValueStoreImplicits
    with ProtoGeometryImplicits
    with BoundingBoxMerger
    with ColorGenerator
    with FoxImplicits {

  implicit val tracingCompanion: SkeletonTracing.type = SkeletonTracing

  def saveSkeleton(
      tracing: SkeletonTracing,
      tracingId: Option[String],
      version: Long,
      toTemporaryStore: Boolean = false
  ): Fox[String] = {
    val id = tracingId.getOrElse(TracingId.generate)
    if (toTemporaryStore) {
      temporaryTracingService.saveSkeleton(id, tracing).map(_ => id)
    } else {
      tracingDataStore.skeletons.put(id, version, tracing).map(_ => id)
    }
  }

  def adaptSkeletonForDuplicate(
      tracing: SkeletonTracing,
      fromTask: Boolean,
      editPosition: Option[Vec3Int],
      editRotation: Option[Vec3Double],
      boundingBox: Option[BoundingBox],
      newVersion: Long
  ): SkeletonTracing = {
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
          version = newVersion
        )
        .addAllUserBoundingBoxes(taskBoundingBox)
    if (fromTask) newTracing.clearBoundingBox else newTracing
  }

  def merge(tracings: Seq[SkeletonTracing], newVersion: Long): Box[SkeletonTracing] =
    for {
      tracing <- tracings.map(Full(_)).reduceLeft(mergeTwo)
    } yield tracing.copy(
      createdTimestamp = System.currentTimeMillis(),
      version = newVersion
    )

  private def mergeTwo(tracingA: Box[SkeletonTracing], tracingB: Box[SkeletonTracing]): Box[SkeletonTracing] =
    for {
      tracingA <- tracingA
      tracingB <- tracingB
      mergedAdditionalAxes <- AdditionalAxis.mergeAndAssertSameAdditionalAxes(
        Seq(tracingA, tracingB).map(t => AdditionalAxis.fromProtosAsOpt(t.additionalAxes))
      )
      nodeMapping = TreeUtils.calculateNodeMapping(tracingA.trees, tracingB.trees)
      groupMapping = GroupUtils.calculateTreeGroupMapping(tracingA.treeGroups, tracingB.treeGroups)
      mergedTrees = TreeUtils.mergeTrees(tracingA.trees, tracingB.trees, nodeMapping, groupMapping)
      mergedGroups = GroupUtils.mergeTreeGroups(tracingA.treeGroups, tracingB.treeGroups, groupMapping)
      mergedBoundingBox = combineBoundingBoxes(tracingA.boundingBox, tracingB.boundingBox)
      userBoundingBoxes = combineUserBoundingBoxes(
        tracingA.userBoundingBox,
        tracingB.userBoundingBox,
        tracingA.userBoundingBoxes,
        tracingB.userBoundingBoxes
      )
    } yield tracingA.copy(
      trees = mergedTrees,
      treeGroups = mergedGroups,
      boundingBox = mergedBoundingBox,
      userBoundingBox = None,
      userBoundingBoxes = userBoundingBoxes,
      additionalAxes = AdditionalAxis.toProto(mergedAdditionalAxes)
    )

  // Can be removed again when https://github.com/scalableminds/webknossos/issues/5009 is fixed
  def remapTooLargeTreeIds(skeletonTracing: SkeletonTracing): SkeletonTracing =
    if (skeletonTracing.trees.exists(_.treeId > 1048576)) {
      val newTrees = for ((tree, index) <- skeletonTracing.trees.zipWithIndex) yield tree.withTreeId(index + 1)
      skeletonTracing.withTrees(newTrees)
    } else skeletonTracing

  def dummyTracing: SkeletonTracing = SkeletonTracingDefaults.createInstance

}
