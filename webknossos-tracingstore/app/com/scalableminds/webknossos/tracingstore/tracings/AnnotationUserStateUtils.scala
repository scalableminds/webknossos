package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.Annotation.{AnnotationProto, AnnotationUserStateProto}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonUserStateProto}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeUserStateProto}
import com.scalableminds.webknossos.datastore.helpers.SkeletonTracingDefaults
import com.scalableminds.webknossos.datastore.idToBool.{Id32ToBool, Id64ToBool}
import com.scalableminds.webknossos.datastore.models.annotation.FetchedAnnotationLayer
import com.scalableminds.webknossos.tracingstore.tracings.GroupUtils.FunctionalGroupMapping
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.TreeUtils.TreeIdMap
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults

trait AnnotationUserStateUtils extends BoundingBoxMerger with IdToBoolUtils {

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
      val requestingUserTreeVisibilityMap = id32BoolsToMap(requestingUserState.map(_.treeVisibilities))
      val ownerTreeVisibilityMap = id32BoolsToMap(ownerUserState.map(_.treeVisibilities))
      val requestingUserBoundingBoxVisibilityMap = id32BoolsToMap(requestingUserState.map(_.boundingBoxVisibilities))
      val ownerBoundingBoxVisibilityMap = id32BoolsToMap(ownerUserState.map(_.boundingBoxVisibilities))
      val requestingUserTreeGroupExpandedMap = id32BoolsToMap(requestingUserState.map(_.treeGroupExpandedStates))
      val ownerTreeGroupExpandedMap = id32BoolsToMap(ownerUserState.map(_.treeGroupExpandedStates))
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
      val requestingUserBoundingBoxVisibilityMap = id32BoolsToMap(requestingUserState.map(_.boundingBoxVisibilities))
      val ownerBoundingBoxVisibilityMap = id32BoolsToMap(ownerUserState.map(_.boundingBoxVisibilities))
      val requestingUserSegmentGroupExpandedMap = id32BoolsToMap(requestingUserState.map(_.segmentGroupExpandedStates))
      val ownerSegmentGroupExpandedMap = id32BoolsToMap(ownerUserState.map(_.segmentGroupExpandedStates))
      val requestingUserSegmentVisibilityMap = id64BoolsToMap(requestingUserState.map(_.segmentVisibilities))
      val ownerSegmentVisibilityMap = id64BoolsToMap(ownerUserState.map(_.segmentVisibilities))
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
          },
          segments = v.segments.map { segment =>
            segment.copy(
              isVisible = requestingUserSegmentVisibilityMap
                .get(segment.segmentId)
                .orElse(ownerSegmentVisibilityMap.get(segment.segmentId))
                .orElse(segment.isVisible)
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
      val requestingUserTreeVisibilityMap = id32BoolsToMap(requestingUserState.map(_.treeVisibilities))
      val ownerTreeVisibilityMap = id32BoolsToMap(ownerUserState.map(_.treeVisibilities))
      val mergedTreeVisibilityMap = ownerTreeVisibilityMap ++ requestingUserTreeVisibilityMap
      val requestingUserBoundingBoxVisibilityMap = id32BoolsToMap(requestingUserState.map(_.boundingBoxVisibilities))
      val ownerBoundingBoxVisibilityMap = id32BoolsToMap(ownerUserState.map(_.boundingBoxVisibilities))
      val mergedBoundingBoxVisibilityMap = ownerBoundingBoxVisibilityMap ++ requestingUserBoundingBoxVisibilityMap
      val requestingUserTreeGroupExpandedMap = id32BoolsToMap(requestingUserState.map(_.treeGroupExpandedStates))
      val ownerTreeGroupExpandedMap = id32BoolsToMap(ownerUserState.map(_.treeGroupExpandedStates))
      val mergedTreeGroupExpandedMap = ownerTreeGroupExpandedMap ++ requestingUserTreeGroupExpandedMap

      SkeletonUserStateProto(
        userId = requestingUserId,
        activeNodeId = requestingUserState.flatMap(_.activeNodeId).orElse(ownerUserState.flatMap(_.activeNodeId)),
        treeGroupExpandedStates = mapToId32Bools(mergedTreeGroupExpandedMap),
        boundingBoxVisibilities = mapToId32Bools(mergedBoundingBoxVisibilityMap),
        treeVisibilities = mapToId32Bools(mergedTreeVisibilityMap)
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
      val requestingUserBoundingBoxVisibilityMap = id32BoolsToMap(requestingUserState.map(_.boundingBoxVisibilities))
      val ownerBoundingBoxVisibilityMap = id32BoolsToMap(ownerUserState.map(_.boundingBoxVisibilities))
      val requestingUserSegmentGroupExpandedMap = id32BoolsToMap(requestingUserState.map(_.segmentGroupExpandedStates))
      val ownerSegmentGroupExpandedMap = id32BoolsToMap(ownerUserState.map(_.segmentGroupExpandedStates))
      val requestingUserSegmentVisibilityMap = id64BoolsToMap(requestingUserState.map(_.segmentVisibilities))
      val ownerSegmentVisibilityMap = id64BoolsToMap(ownerUserState.map(_.segmentVisibilities))
      val mergedBoundingBoxVisibilityMap = ownerBoundingBoxVisibilityMap ++ requestingUserBoundingBoxVisibilityMap
      val mergedSegmentGroupExpandedMap = ownerSegmentGroupExpandedMap ++ requestingUserSegmentGroupExpandedMap
      val mergedSegmentVisibilityMap = ownerSegmentVisibilityMap ++ requestingUserSegmentVisibilityMap
      VolumeUserStateProto(
        userId = requestingUserId,
        activeSegmentId =
          requestingUserState.flatMap(_.activeSegmentId).orElse(ownerUserState.flatMap(_.activeSegmentId)),
        segmentGroupExpandedStates = mapToId32Bools(mergedSegmentGroupExpandedMap),
        boundingBoxVisibilities = mapToId32Bools(mergedBoundingBoxVisibilityMap),
        segmentVisibilities = mapToId64Bools(mergedSegmentVisibilityMap)
      )
    }
  }

  private def mapId32Bools(idToBools: Seq[Id32ToBool], idMap: Map[Int, Int]): Seq[Id32ToBool] =
    idToBools.map(mapIdBool(_, idMap))

  private def mapIdBool(idToBools: Id32ToBool, idMap: Map[Int, Int]): Id32ToBool =
    idToBools.copy(id = idMap.getOrElse(idToBools.id, idToBools.id))

  private def mapId64Bools(idToBools: Seq[Id64ToBool], idMap: Map[Long, Long]): Seq[Id64ToBool] =
    idToBools.map(mapIdBool(_, idMap))

  private def mapIdBool(idToBools: Id64ToBool, idMap: Map[Long, Long]): Id64ToBool =
    idToBools.copy(id = idMap.getOrElse(idToBools.id, idToBools.id))

  private def mapIdBools(idToBools: Seq[Id32ToBool], functionalIdMapping: FunctionalGroupMapping): Seq[Id32ToBool] =
    idToBools.map(mapIdBool(_, functionalIdMapping))

  private def mapIdBool(idToBools: Id32ToBool, functionalIdMapping: FunctionalGroupMapping): Id32ToBool =
    idToBools.copy(id = functionalIdMapping(idToBools.id))

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
      .map(userState => userState.copy(treeVisibilities = mapId32Bools(userState.treeVisibilities, treeIdMapB)))
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
      treeGroupExpandedStates = tracingAUserState.treeGroupExpandedStates ++ tracingBUserState.treeGroupExpandedStates,
      boundingBoxVisibilities = tracingAUserState.boundingBoxVisibilities ++ tracingBUserState.boundingBoxVisibilities,
      treeVisibilities = tracingAUserState.treeVisibilities ++ tracingBUserState.treeVisibilities
    )

  private def applyIdMappingsOnSkeletonUserState(userStateA: SkeletonUserStateProto,
                                                 groupMapping: FunctionalGroupMapping,
                                                 treeIdMapA: TreeIdMap,
                                                 bboxIdMapA: Map[Int, Int]): SkeletonUserStateProto =
    applyBboxIdMapOnSkeletonUserState(userStateA, bboxIdMapA).copy(
      treeGroupExpandedStates = mapIdBools(userStateA.treeGroupExpandedStates, groupMapping),
      treeVisibilities = mapId32Bools(userStateA.treeVisibilities, treeIdMapA)
    )

  private def applyBboxIdMapOnSkeletonUserState(userState: SkeletonUserStateProto,
                                                bboxIdMap: Map[Int, Int]): SkeletonUserStateProto = {
    val newVisibilities = userState.boundingBoxVisibilities.flatMap {
      case Id32ToBool(boundingBoxId, boundingBoxVisibility, unknownFields) =>
        bboxIdMap.get(boundingBoxId) match {
          case Some(newId) => Some(Id32ToBool(newId, boundingBoxVisibility))
          case None        => None
        }
    }
    userState.copy(boundingBoxVisibilities = newVisibilities)
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
          userState.copy(segmentVisibilities = mapId64Bools(userState.segmentVisibilities, segmentIdMapB)))
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
      segmentGroupExpandedStates = tracingAUserState.segmentGroupExpandedStates ++ tracingBUserState.segmentGroupExpandedStates,
      boundingBoxVisibilities = tracingAUserState.boundingBoxVisibilities ++ tracingBUserState.boundingBoxVisibilities,
      segmentVisibilities = tracingAUserState.segmentVisibilities ++ tracingBUserState.segmentVisibilities
    )

  private def applyIdMappingsOnVolumeUserState(userStateA: VolumeUserStateProto,
                                               groupMappingA: FunctionalGroupMapping,
                                               bboxIdMapA: Map[Int, Int]): VolumeUserStateProto =
    applyBboxIdMapOnVolumeUserState(userStateA, bboxIdMapA).copy(
      segmentGroupExpandedStates = mapIdBools(userStateA.segmentGroupExpandedStates, groupMappingA)
    )

  private def applyBboxIdMapOnVolumeUserState(userState: VolumeUserStateProto,
                                              bboxIdMap: Map[Int, Int]): VolumeUserStateProto = {
    val newVisibilities = userState.boundingBoxVisibilities.flatMap {
      case Id32ToBool(boundingBoxId, boundingBoxVisibility, unknownFields) =>
        bboxIdMap.get(boundingBoxId) match {
          case Some(newId) => Some(Id32ToBool(newId, boundingBoxVisibility))
          case None        => None
        }
    }
    userState.copy(boundingBoxVisibilities = newVisibilities)
  }
}
