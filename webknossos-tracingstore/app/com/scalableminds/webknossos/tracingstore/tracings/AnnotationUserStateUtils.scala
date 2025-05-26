package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.Annotation.{AnnotationProto, AnnotationUserStateProto}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonUserStateProto}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeUserStateProto}
import com.scalableminds.webknossos.datastore.helpers.SkeletonTracingDefaults
import com.scalableminds.webknossos.datastore.models.annotation.FetchedAnnotationLayer
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults

trait AnnotationUserStateUtils {

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
      val mergedSegmentVisibilityMap = (requestingUserSegmentVisibilityMap ++ ownerSegmentVisibilityMap).toSeq
      val requestingUserBoundingBoxVisibilityMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerBoundingBoxVisibilityMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val mergedBoundingBoxVisibilityMap =
        (requestingUserBoundingBoxVisibilityMap ++ ownerBoundingBoxVisibilityMap).toSeq
      val requestingUserSegmentGroupExpandedMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.segmentGroupIds.zip(userState.segmentGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerSegmentGroupExpandedMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.segmentGroupIds.zip(userState.segmentGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val mergedSegmentGroupExpandedMap = (requestingUserSegmentGroupExpandedMap ++ ownerSegmentGroupExpandedMap).toSeq
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
}
