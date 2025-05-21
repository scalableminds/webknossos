package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonUserStateProto, TreeBody}
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.tracings.GroupUtils.FunctionalGroupMapping
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.TreeUtils.FunctionalTreeMapping
import net.liftweb.common.{Box, Full}

import scala.concurrent.ExecutionContext

class SkeletonTracingService @Inject()(
    tracingDataStore: TracingDataStore,
    temporaryTracingService: TemporaryTracingService
) extends KeyValueStoreImplicits
    with ProtoGeometryImplicits
    with BoundingBoxMerger
    with ColorGenerator
    with FoxImplicits {

  implicit val tracingCompanion: SkeletonTracing.type = SkeletonTracing

  def saveSkeleton(tracingId: String,
                   version: Long,
                   tracing: SkeletonTracing,
                   flushOnlyTheseTreeIds: Option[Set[Int]] = None,
                   toTemporaryStore: Boolean = false)(implicit ec: ExecutionContext): Fox[Unit] =
    if (toTemporaryStore) {
      temporaryTracingService.saveSkeleton(tracingId, tracing)
    } else {
      val nowPresentTrees = tracing.trees.map(_.treeId).toSet
      val wasPreviouslyStoredWithExternalTreeBodies = tracing.getStoredWithExternalTreeBodies
      val treeIdsToFlush = flushOnlyTheseTreeIds match {
        case Some(requestedTreeIdsToFlush) if wasPreviouslyStoredWithExternalTreeBodies =>
          nowPresentTrees.intersect(requestedTreeIdsToFlush)
        case _ =>
          nowPresentTrees
      }
      val skeletonTreeBodiesPutBuffer = new FossilDBPutBuffer(tracingDataStore.skeletonTreeBodies, Some(version))
      for {
        _ <- Fox.serialCombined(treeIdsToFlush) { treeId =>
          for {
            treeBody <- extractTreeBody(tracing, treeId).toFox
            _ <- skeletonTreeBodiesPutBuffer.put(f"$tracingId/$treeId", treeBody)
          } yield ()
        }
        _ <- skeletonTreeBodiesPutBuffer.flush()
        skeletonWithoutExtraTreeInfo = stripTreeBodies(tracing)
        _ <- tracingDataStore.skeletons.put(tracingId, version, skeletonWithoutExtraTreeInfo)
      } yield ()
    }

  def adaptSkeletonForDuplicate(tracing: SkeletonTracing,
                                fromTask: Boolean,
                                editPosition: Option[Vec3Int],
                                editRotation: Option[Vec3Double],
                                boundingBox: Option[BoundingBox],
                                newVersion: Long): SkeletonTracing = {
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
          version = newVersion,
          storedWithExternalTreeBodies = Some(false)
        )
        .addAllUserBoundingBoxes(taskBoundingBox)
    if (fromTask) newTracing.clearBoundingBox else newTracing
  }

  def merge(tracings: Seq[SkeletonTracing], newVersion: Long): Box[SkeletonTracing] =
    for {
      tracing <- tracings.map(Full(_)).reduceLeft(mergeTwo)
    } yield
      tracing.copy(
        createdTimestamp = System.currentTimeMillis(),
        version = newVersion,
        storedWithExternalTreeBodies = Some(false)
      )

  private def mergeTwo(tracingA: Box[SkeletonTracing], tracingB: Box[SkeletonTracing]): Box[SkeletonTracing] =
    for {
      tracingA <- tracingA
      tracingB <- tracingB
      mergedAdditionalAxes <- AdditionalAxis.mergeAndAssertSameAdditionalAxes(
        Seq(tracingA, tracingB).map(t => AdditionalAxis.fromProtosAsOpt(t.additionalAxes)))
      nodeMapping = TreeUtils.calculateNodeMapping(tracingA.trees, tracingB.trees)
      treeMapping = TreeUtils.calculateTreeMapping(tracingB.trees)
      groupMapping = GroupUtils.calculateTreeGroupMapping(tracingA.treeGroups, tracingB.treeGroups)
      mergedTrees = TreeUtils.mergeTrees(tracingA.trees, tracingB.trees, treeMapping, nodeMapping, groupMapping)
      mergedGroups = GroupUtils.mergeTreeGroups(tracingA.treeGroups, tracingB.treeGroups, groupMapping)
      mergedBoundingBox = combineBoundingBoxes(tracingA.boundingBox, tracingB.boundingBox)
      (userBoundingBoxes, bboxIdMapA, bboxIdMapB) = combineUserBoundingBoxes(tracingA.userBoundingBox,
                                                                             tracingB.userBoundingBox,
                                                                             tracingA.userBoundingBoxes,
                                                                             tracingB.userBoundingBoxes)
      userStates = mergeUserStates(tracingA.userStates,
                                   tracingB.userStates,
                                   groupMapping,
                                   treeMapping,
                                   bboxIdMapA,
                                   bboxIdMapB)
    } yield
      tracingA.copy(
        trees = mergedTrees,
        treeGroups = mergedGroups,
        boundingBox = mergedBoundingBox,
        userBoundingBox = None,
        userBoundingBoxes = userBoundingBoxes,
        additionalAxes = AdditionalAxis.toProto(mergedAdditionalAxes),
        userStates = userStates
      )

  private def mergeUserStates(tracingAUserStates: Seq[SkeletonUserStateProto],
                              tracingBUserStates: Seq[SkeletonUserStateProto],
                              groupMapping: FunctionalGroupMapping,
                              treeMapping: FunctionalTreeMapping,
                              bboxIdMapA: UserBboxIdMap,
                              bboxIdMapB: UserBboxIdMap): Seq[SkeletonUserStateProto] = {
    val tracingAUserStatesMapped =
      tracingAUserStates.map(appylIdMappingsOnUserState(_, groupMapping, treeMapping, bboxIdMapA))
    val tracingBUserStatesMapped = tracingBUserStates.map(applyBboxIdMapOnUserState(_, bboxIdMapB))

    val byUserId = scala.collection.mutable.Map[String, SkeletonUserStateProto]()
    tracingAUserStatesMapped.foreach { userState =>
      byUserId.put(userState.userId, userState)
    }
    tracingBUserStatesMapped.foreach { userState =>
      byUserId.get(userState.userId) match {
        case Some(existingUserState) => byUserId.put(userState.userId, mergeTwoUserStates(existingUserState, userState))
        case None                    => byUserId.put(userState.userId, userState)
      }
    }

    byUserId.values.toSeq
  }

  private def mergeTwoUserStates(tracingAUserState: SkeletonUserStateProto,
                                 tracingBUserState: SkeletonUserStateProto): SkeletonUserStateProto =
    SkeletonUserStateProto(
      userId = tracingAUserState.userId,
      activeNodeId = tracingAUserState.activeNodeId,
      treeGroupIds = tracingAUserState.treeGroupIds ++ tracingBUserState.treeGroupIds,
      treeGroupExpandedStates = tracingAUserState.treeGroupExpandedStates ++ tracingBUserState.treeGroupExpandedStates,
      boundingBoxIds = tracingAUserState.boundingBoxIds ++ tracingBUserState.boundingBoxIds,
      boundingBoxVisibilities = tracingAUserState.boundingBoxVisibilities ++ tracingBUserState.boundingBoxVisibilities,
      treeIds = tracingAUserState.treeIds ++ tracingBUserState.treeIds,
      treeVisibilities = tracingAUserState.treeVisibilities ++ tracingBUserState.treeVisibilities
    )

  private def appylIdMappingsOnUserState(userState: SkeletonUserStateProto,
                                         groupMapping: FunctionalGroupMapping,
                                         treeMapping: FunctionalTreeMapping,
                                         bboxIdMapA: Map[Int, Int]): SkeletonUserStateProto =
    applyBboxIdMapOnUserState(userState, bboxIdMapA).copy(
      treeGroupIds = userState.treeGroupIds.map(groupMapping),
      treeIds = userState.treeIds.map(treeMapping)
    )

  private def applyBboxIdMapOnUserState(userState: SkeletonUserStateProto,
                                        bboxIdMap: Map[Int, Int]): SkeletonUserStateProto = {
    val newIdsAndVisibilities = userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).flatMap {
      case (boundingBoxId, boundingBoxVisibility) =>
        bboxIdMap.get(boundingBoxId) match {
          case Some(newId) => Some((newId, boundingBoxVisibility))
          case None        => None
        }
    }
    userState.copy(
      boundingBoxIds = newIdsAndVisibilities.map(_._1),
      boundingBoxVisibilities = newIdsAndVisibilities.map(_._2)
    )
  }

  // Can be removed again when https://github.com/scalableminds/webknossos/issues/5009 is fixed
  // Note that this is only used for freshly uploaded annotations, so there is no user state that would have to be mapped with the id changes
  def remapTooLargeTreeIds(skeletonTracing: SkeletonTracing): SkeletonTracing =
    if (skeletonTracing.trees.exists(_.treeId > 1048576)) {
      val newTrees = for ((tree, index) <- skeletonTracing.trees.zipWithIndex) yield tree.withTreeId(index + 1)
      skeletonTracing.withTrees(newTrees)
    } else skeletonTracing

  def dummyTracing: SkeletonTracing = SkeletonTracingDefaults.createInstance

  private def extractTreeBody(tracing: SkeletonTracing, treeId: Int): Box[TreeBody] =
    for {
      tree <- tracing.trees.find(_.treeId == treeId)
    } yield TreeBody(nodes = tree.nodes, edges = tree.edges)

  private def stripTreeBodies(tracing: SkeletonTracing): SkeletonTracing =
    tracing.copy(trees = tracing.trees.map(_.copy(nodes = Seq(), edges = Seq())),
                 storedWithExternalTreeBodies = Some(true))
}
