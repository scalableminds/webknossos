package models.annotation.nml

import com.scalableminds.webknossos.datastore.Annotation.{AnnotationProto, AnnotationUserStateProto}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.annotation.FetchedAnnotationLayer
import models.user.User

trait AnnotationUserStateUtils {

  protected def renderUserState(annotationProto: AnnotationProto,
                                annotationLayers: List[FetchedAnnotationLayer],
                                requestingUser: Option[User],
                                annotationOwner: User): List[FetchedAnnotationLayer] = {
    val annotationUserState = findBestUserStateFor(annotationProto, requestingUser, annotationOwner)
    annotationLayers.map { annotationLayer =>
      annotationLayer.copy(
        tracing =
          renderUserStateForTracing(annotationLayer.tracing, annotationUserState, requestingUser, annotationOwner))
    }
  }

  private def findBestUserStateFor(annotationProto: AnnotationProto,
                                   requestingUserOpt: Option[User],
                                   annotationOwner: User): Option[AnnotationUserStateProto] =
    annotationProto.userStates
      .find(_.userId == requestingUserOpt.getOrElse(annotationOwner)._id.toString)
      .orElse(annotationProto.userStates.find(_.userId == annotationOwner._id.toString))

  private def renderUserStateForTracing(tracing: Either[SkeletonTracing, VolumeTracing],
                                        annotationUserState: Option[AnnotationUserStateProto],
                                        requestingUser: Option[User],
                                        annotationOwner: User): Either[SkeletonTracing, VolumeTracing] = tracing match {
    case Left(s: SkeletonTracing) =>
      val requestingUserState = requestingUser.flatMap(u => s.userStates.find(_.userId == u._id.toString))
      val ownerUserState = s.userStates.find(_.userId == annotationOwner._id.toString)
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
      val requestingUserState = requestingUser.flatMap(u => v.userStates.find(_.userId == u._id.toString))
      val ownerUserState = v.userStates.find(_.userId == annotationOwner._id.toString)
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
}
