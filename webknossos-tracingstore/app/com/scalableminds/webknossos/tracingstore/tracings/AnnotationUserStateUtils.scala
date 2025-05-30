package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.Annotation.{AnnotationProto, AnnotationUserStateProto}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonUserStateProto}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeUserStateProto}
import com.scalableminds.webknossos.datastore.helpers.SkeletonTracingDefaults
import com.scalableminds.webknossos.datastore.models.annotation.FetchedAnnotationLayer
import com.scalableminds.webknossos.tracingstore.tracings.GroupUtils.FunctionalGroupMapping
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.TreeUtils.TreeIdMap
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults

trait AnnotationUserStateUtils extends BoundingBoxMerger {

  protected def renderUserState(annotationProto: AnnotationProto,
                                annotationLayers: List[FetchedAnnotationLayer],
                                requestingUserId: Option[String],
                                ownerId: String): List[FetchedAnnotationLayer] = {
    val annotationUserState = findBestUserStateFor(annotationProto, requestingUserId, ownerId)
    annotationLayers.map { annotationLayer =>
      annotationLayer.copy(
        tracing = renderUserStateForTracing(annotationLayer.tracing, annotationUserState, requestingUserId, ownerId))
    }
  }

  private def findBestUserStateFor(annotationProto: AnnotationProto,
                                   requestingUserIdOpt: Option[String],
                                   ownerId: String): Option[AnnotationUserStateProto] =
    annotationProto.userStates
      .find(_.userId == requestingUserIdOpt.getOrElse(ownerId))
      .orElse(annotationProto.userStates.find(_.userId == ownerId))

  private def renderUserStateForTracing(tracing: Either[SkeletonTracing, VolumeTracing],
                                        annotationUserState: Option[AnnotationUserStateProto],
                                        requestingUserId: Option[String],
                                        ownerId: String): Either[SkeletonTracing, VolumeTracing] = tracing match {
    case Left(s: SkeletonTracing) =>
      val requestingUserState = requestingUserId.flatMap(u => s.userStates.find(_.userId == u))
      val ownerUserState = s.userStates.find(_.userId == ownerId)
      val requestingUserTreeVisibilityMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.treeIds.zip(userState.treeVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerTreeVisibilityMap: Map[Int, Boolean] =
        ownerUserState
          .map(userState => userState.treeIds.zip(userState.treeVisibilities).toMap)
          .getOrElse(Map.empty[Int, Boolean])
      val requestingUserBoundingBoxVisibilityMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerBoundingBoxVisibilityMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val requestingUserTreeGroupExpandedMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.treeGroupIds.zip(userState.treeGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerTreeGroupExpandedMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.treeGroupIds.zip(userState.treeGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      Left(
        s.copy(
          editPosition = annotationUserState.map(_.editPosition).getOrElse(s.editPosition),
          editRotation = annotationUserState.map(_.editRotation).getOrElse(s.editRotation),
          zoomLevel = annotationUserState.map(_.zoomLevel).getOrElse(s.zoomLevel),
          editPositionAdditionalCoordinates =
            annotationUserState.map(_.editPositionAdditionalCoordinates).getOrElse(s.editPositionAdditionalCoordinates),
          activeNodeId = requestingUserState
            .flatMap(_.activeNodeId)
            .orElse(ownerUserState.flatMap(_.activeNodeId))
            .orElse(s.activeNodeId),
          trees = s.trees.map { tree =>
            tree.copy(
              isVisible = requestingUserTreeVisibilityMap
                .get(tree.treeId)
                .orElse(ownerTreeVisibilityMap.get(tree.treeId))
                .orElse(tree.isVisible)
            )
          },
          userBoundingBoxes = s.userBoundingBoxes.map { bbox =>
            bbox.copy(
              isVisible = requestingUserBoundingBoxVisibilityMap
                .get(bbox.id)
                .orElse(ownerBoundingBoxVisibilityMap.get(bbox.id))
                .orElse(bbox.isVisible)
            )
          },
          treeGroups = s.treeGroups.map { treeGroup =>
            treeGroup.copy(
              isExpanded = requestingUserTreeGroupExpandedMap
                .get(treeGroup.groupId)
                .orElse(ownerTreeGroupExpandedMap.get(treeGroup.groupId).orElse(treeGroup.isExpanded))
            )
          }
        )
      )
    case Right(v: VolumeTracing) =>
      val requestingUserState = requestingUserId.flatMap(u => v.userStates.find(_.userId == u))
      val ownerUserState = v.userStates.find(_.userId == ownerId)
      val requestingUserBoundingBoxVisibilityMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerBoundingBoxVisibilityMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val requestingUserSegmentGroupExpandedMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.segmentGroupIds.zip(userState.segmentGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerSegmentGroupExpandedMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.segmentGroupIds.zip(userState.segmentGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      Right(
        v.copy(
          editPosition = annotationUserState.map(_.editPosition).getOrElse(v.editPosition),
          editRotation = annotationUserState.map(_.editRotation).getOrElse(v.editRotation),
          zoomLevel = annotationUserState.map(_.zoomLevel).getOrElse(v.zoomLevel),
          editPositionAdditionalCoordinates =
            annotationUserState.map(_.editPositionAdditionalCoordinates).getOrElse(v.editPositionAdditionalCoordinates),
          activeSegmentId = requestingUserState
            .flatMap(_.activeSegmentId)
            .orElse(ownerUserState.flatMap(_.activeSegmentId))
            .orElse(v.activeSegmentId),
          userBoundingBoxes = v.userBoundingBoxes.map { bbox =>
            bbox.copy(
              isVisible = requestingUserBoundingBoxVisibilityMap
                .get(bbox.id)
                .orElse(ownerBoundingBoxVisibilityMap.get(bbox.id))
                .orElse(bbox.isVisible)
            )
          },
          segmentGroups = v.segmentGroups.map { segmentGroup =>
            segmentGroup.copy(
              isExpanded = requestingUserSegmentGroupExpandedMap
                .get(segmentGroup.groupId)
                .orElse(ownerSegmentGroupExpandedMap.get(segmentGroup.groupId).orElse(segmentGroup.isExpanded))
            )
          }
        )
      )
  }

  // Since the owner may change in duplicate, we need to render what they would see into a single user state for them
  def renderSkeletonUserStateIntoUserState(s: SkeletonTracing,
                                           requestingUserId: String,
                                           ownerId: String): SkeletonUserStateProto = {
    val ownerUserState = s.userStates.find(_.userId == ownerId).map(_.copy(userId = requestingUserId))

    if (requestingUserId == ownerId)
      ownerUserState.getOrElse(SkeletonTracingDefaults.emptyUserState(requestingUserId))
    else {
      val requestingUserState = s.userStates.find(_.userId == requestingUserId)
      val requestingUserTreeVisibilityMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.treeIds.zip(userState.treeVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerTreeVisibilityMap: Map[Int, Boolean] =
        ownerUserState
          .map(userState => userState.treeIds.zip(userState.treeVisibilities).toMap)
          .getOrElse(Map.empty[Int, Boolean])
      val mergedTreeVisibilityMap = (ownerTreeVisibilityMap ++ requestingUserTreeVisibilityMap).toSeq
      val requestingUserBoundingBoxVisibilityMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerBoundingBoxVisibilityMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val mergedBoundingBoxVisibilityMap =
        (ownerBoundingBoxVisibilityMap ++ requestingUserBoundingBoxVisibilityMap).toSeq
      val requestingUserTreeGroupExpandedMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.treeGroupIds.zip(userState.treeGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerTreeGroupExpandedMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.treeGroupIds.zip(userState.treeGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val mergedTreeGroupExpandedMap = (ownerTreeGroupExpandedMap ++ requestingUserTreeGroupExpandedMap).toSeq
      SkeletonUserStateProto(
        userId = requestingUserId,
        activeNodeId = requestingUserState.flatMap(_.activeNodeId).orElse(ownerUserState.flatMap(_.activeNodeId)),
        treeGroupIds = mergedTreeGroupExpandedMap.map(_._1),
        treeGroupExpandedStates = mergedTreeGroupExpandedMap.map(_._2),
        boundingBoxIds = mergedBoundingBoxVisibilityMap.map(_._1),
        boundingBoxVisibilities = mergedBoundingBoxVisibilityMap.map(_._2),
        treeIds = mergedTreeVisibilityMap.map(_._1),
        treeVisibilities = mergedTreeVisibilityMap.map(_._2)
      )
    }
  }

  // Since the owner may change in duplicate, we need to render what they would see into a single user state for them
  def renderVolumeUserStateIntoUserState(s: VolumeTracing,
                                         requestingUserId: String,
                                         ownerId: String): VolumeUserStateProto = {
    val ownerUserState = s.userStates.find(_.userId == ownerId).map(_.copy(userId = requestingUserId))

    if (requestingUserId == ownerId)
      ownerUserState.getOrElse(VolumeTracingDefaults.emptyUserState(requestingUserId))
    else {
      val requestingUserState = s.userStates.find(_.userId == requestingUserId)
      val requestingUserSegmentVisibilityMap: Map[Long, Boolean] = requestingUserState
        .map(userState => userState.segmentIds.zip(userState.segmentVisibilities).toMap)
        .getOrElse(Map.empty[Long, Boolean])
      val ownerSegmentVisibilityMap: Map[Long, Boolean] =
        ownerUserState
          .map(userState => userState.segmentIds.zip(userState.segmentVisibilities).toMap)
          .getOrElse(Map.empty[Long, Boolean])
      val mergedSegmentVisibilityMap = (ownerSegmentVisibilityMap ++ requestingUserSegmentVisibilityMap).toSeq
      val requestingUserBoundingBoxVisibilityMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerBoundingBoxVisibilityMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val mergedBoundingBoxVisibilityMap =
        (ownerBoundingBoxVisibilityMap ++ requestingUserBoundingBoxVisibilityMap).toSeq
      val requestingUserSegmentGroupExpandedMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.segmentGroupIds.zip(userState.segmentGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerSegmentGroupExpandedMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.segmentGroupIds.zip(userState.segmentGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val mergedSegmentGroupExpandedMap = (ownerSegmentGroupExpandedMap ++ requestingUserSegmentGroupExpandedMap).toSeq
      VolumeUserStateProto(
        userId = requestingUserId,
        activeSegmentId =
          requestingUserState.flatMap(_.activeSegmentId).orElse(ownerUserState.flatMap(_.activeSegmentId)),
        segmentGroupIds = mergedSegmentGroupExpandedMap.map(_._1),
        segmentGroupExpandedStates = mergedSegmentGroupExpandedMap.map(_._2),
        boundingBoxIds = mergedBoundingBoxVisibilityMap.map(_._1),
        boundingBoxVisibilities = mergedBoundingBoxVisibilityMap.map(_._2),
        segmentIds = mergedSegmentVisibilityMap.map(_._1),
        segmentVisibilities = mergedSegmentVisibilityMap.map(_._2)
      )
    }
  }

  // Merges user states of multiple skeleton tracings, respecting mapped ids of the tracing elements. The user set is preserved
  protected def mergeSkeletonUserStates(tracingAUserStates: Seq[SkeletonUserStateProto],
                                        tracingBUserStates: Seq[SkeletonUserStateProto],
                                        groupMapping: FunctionalGroupMapping,
                                        treeIdMapA: TreeIdMap,
                                        treeIdMapB: TreeIdMap,
                                        bboxIdMapA: UserBboxIdMap,
                                        bboxIdMapB: UserBboxIdMap): Seq[SkeletonUserStateProto] = {
    val tracingAUserStatesMapped =
      tracingAUserStates.map(applyIdMappingsOnSkeletonUserState(_, groupMapping, treeIdMapA, bboxIdMapA))
    val tracingBUserStatesMapped = tracingBUserStates
      .map(userState => userState.copy(treeIds = userState.treeIds.map(treeId => treeIdMapB.getOrElse(treeId, treeId))))
      .map(applyBboxIdMapOnSkeletonUserState(_, bboxIdMapB))

    val byUserId = scala.collection.mutable.Map[String, SkeletonUserStateProto]()
    tracingAUserStatesMapped.foreach { userState =>
      byUserId.put(userState.userId, userState)
    }
    tracingBUserStatesMapped.foreach { userState =>
      byUserId.get(userState.userId) match {
        case Some(existingUserState) =>
          byUserId.put(userState.userId, mergeTwoSkeletonUserStates(existingUserState, userState))
        case None => byUserId.put(userState.userId, userState)
      }
    }

    byUserId.values.toSeq
  }

  private def mergeTwoSkeletonUserStates(tracingAUserState: SkeletonUserStateProto,
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

  private def applyIdMappingsOnSkeletonUserState(userState: SkeletonUserStateProto,
                                                 groupMapping: FunctionalGroupMapping,
                                                 treeIdMapA: TreeIdMap,
                                                 bboxIdMapA: Map[Int, Int]): SkeletonUserStateProto =
    applyBboxIdMapOnSkeletonUserState(userState, bboxIdMapA).copy(
      treeGroupIds = userState.treeGroupIds.map(groupMapping),
      treeIds = userState.treeIds.map(treeId => treeIdMapA.getOrElse(treeId, treeId))
    )

  private def applyBboxIdMapOnSkeletonUserState(userState: SkeletonUserStateProto,
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

  // Merges user states of multiple skeleton tracings, respecting mapped ids of the tracing elements. The user set is preserved
  protected def mergeVolumeUserStates(tracingAUserStates: Seq[VolumeUserStateProto],
                                      tracingBUserStates: Seq[VolumeUserStateProto],
                                      groupMappingA: FunctionalGroupMapping,
                                      segmentIdMapB: Map[Long, Long],
                                      bboxIdMapA: UserBboxIdMap,
                                      bboxIdMapB: UserBboxIdMap): Seq[VolumeUserStateProto] = {
    val tracingAUserStatesMapped =
      tracingAUserStates.map(applyIdMappingsOnVolumeUserState(_, groupMappingA, bboxIdMapA))
    val tracingBUserStatesMapped =
      tracingBUserStates
        .map(userState =>
          userState.copy(segmentIds = userState.segmentIds.map(segmentId =>
            segmentIdMapB.getOrElse(segmentId, segmentId))))
        .map(applyBboxIdMapOnVolumeUserState(_, bboxIdMapB))

    val byUserId = scala.collection.mutable.Map[String, VolumeUserStateProto]()
    tracingAUserStatesMapped.foreach { userState =>
      byUserId.put(userState.userId, userState)
    }
    tracingBUserStatesMapped.foreach { userState =>
      byUserId.get(userState.userId) match {
        case Some(existingUserState) =>
          byUserId.put(userState.userId, mergeTwoVolumeUserStates(existingUserState, userState))
        case None => byUserId.put(userState.userId, userState)
      }
    }

    byUserId.values.toSeq
  }

  private def mergeTwoVolumeUserStates(tracingAUserState: VolumeUserStateProto,
                                       tracingBUserState: VolumeUserStateProto): VolumeUserStateProto =
    VolumeUserStateProto(
      userId = tracingAUserState.userId,
      activeSegmentId = tracingAUserState.activeSegmentId,
      segmentGroupIds = tracingAUserState.segmentGroupIds ++ tracingBUserState.segmentGroupIds,
      segmentGroupExpandedStates = tracingAUserState.segmentGroupExpandedStates ++ tracingBUserState.segmentGroupExpandedStates,
      boundingBoxIds = tracingAUserState.boundingBoxIds ++ tracingBUserState.boundingBoxIds,
      boundingBoxVisibilities = tracingAUserState.boundingBoxVisibilities ++ tracingBUserState.boundingBoxVisibilities,
      segmentIds = tracingAUserState.segmentIds ++ tracingBUserState.segmentIds,
      segmentVisibilities = tracingAUserState.segmentVisibilities ++ tracingBUserState.segmentVisibilities
    )

  private def applyIdMappingsOnVolumeUserState(userStateA: VolumeUserStateProto,
                                               groupMappingA: FunctionalGroupMapping,
                                               bboxIdMapA: Map[Int, Int]): VolumeUserStateProto =
    applyBboxIdMapOnVolumeUserState(userStateA, bboxIdMapA).copy(
      segmentGroupIds = userStateA.segmentGroupIds.map(groupMappingA)
    )

  private def applyBboxIdMapOnVolumeUserState(userState: VolumeUserStateProto,
                                              bboxIdMap: Map[Int, Int]): VolumeUserStateProto = {
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
}
