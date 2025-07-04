package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.Annotation.{AnnotationProto, AnnotationUserStateProto}
import com.scalableminds.webknossos.datastore.IdWithBool.{Id32WithBool, Id64WithBool}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonUserStateProto}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeUserStateProto}
import com.scalableminds.webknossos.datastore.helpers.SkeletonTracingDefaults
import com.scalableminds.webknossos.datastore.models.annotation.FetchedAnnotationLayer
import com.scalableminds.webknossos.tracingstore.tracings.GroupUtils.FunctionalGroupMapping
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.TreeUtils.TreeIdMap
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults

trait AnnotationUserStateUtils extends BoundingBoxMerger with IdWithBoolUtils {

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
      val requestingUserTreeVisibilityMap = id32WithBoolsToMap(requestingUserState.map(_.treeVisibilities))
      val ownerTreeVisibilityMap = id32WithBoolsToMap(ownerUserState.map(_.treeVisibilities))
      val requestingUserBoundingBoxVisibilityMap = id32WithBoolsToMap(
        requestingUserState.map(_.boundingBoxVisibilities))
      val ownerBoundingBoxVisibilityMap = id32WithBoolsToMap(ownerUserState.map(_.boundingBoxVisibilities))
      val requestingUserTreeGroupExpandedMap = id32WithBoolsToMap(requestingUserState.map(_.treeGroupExpandedStates))
      val ownerTreeGroupExpandedMap = id32WithBoolsToMap(ownerUserState.map(_.treeGroupExpandedStates))
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
      val requestingUserBoundingBoxVisibilityMap = id32WithBoolsToMap(
        requestingUserState.map(_.boundingBoxVisibilities))
      val ownerBoundingBoxVisibilityMap = id32WithBoolsToMap(ownerUserState.map(_.boundingBoxVisibilities))
      val requestingUserSegmentGroupExpandedMap = id32WithBoolsToMap(
        requestingUserState.map(_.segmentGroupExpandedStates))
      val ownerSegmentGroupExpandedMap = id32WithBoolsToMap(ownerUserState.map(_.segmentGroupExpandedStates))
      val requestingUserSegmentVisibilityMap = id64WithBoolsToMap(requestingUserState.map(_.segmentVisibilities))
      val ownerSegmentVisibilityMap = id64WithBoolsToMap(ownerUserState.map(_.segmentVisibilities))
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
                                           requestingUserId: ObjectId,
                                           ownerId: ObjectId): SkeletonUserStateProto = {
    val ownerUserState = s.userStates.find(_.userId == ownerId.toString).map(_.copy(userId = requestingUserId.toString))

    if (requestingUserId == ownerId)
      ownerUserState.getOrElse(SkeletonTracingDefaults.emptyUserState(requestingUserId))
    else {
      val requestingUserState = s.userStates.find(_.userId == requestingUserId.toString)
      val requestingUserTreeVisibilityMap = id32WithBoolsToMap(requestingUserState.map(_.treeVisibilities))
      val ownerTreeVisibilityMap = id32WithBoolsToMap(ownerUserState.map(_.treeVisibilities))
      val mergedTreeVisibilityMap = ownerTreeVisibilityMap ++ requestingUserTreeVisibilityMap
      val requestingUserBoundingBoxVisibilityMap = id32WithBoolsToMap(
        requestingUserState.map(_.boundingBoxVisibilities))
      val ownerBoundingBoxVisibilityMap = id32WithBoolsToMap(ownerUserState.map(_.boundingBoxVisibilities))
      val mergedBoundingBoxVisibilityMap = ownerBoundingBoxVisibilityMap ++ requestingUserBoundingBoxVisibilityMap
      val requestingUserTreeGroupExpandedMap = id32WithBoolsToMap(requestingUserState.map(_.treeGroupExpandedStates))
      val ownerTreeGroupExpandedMap = id32WithBoolsToMap(ownerUserState.map(_.treeGroupExpandedStates))
      val mergedTreeGroupExpandedMap = ownerTreeGroupExpandedMap ++ requestingUserTreeGroupExpandedMap

      SkeletonUserStateProto(
        userId = requestingUserId.toString,
        activeNodeId = requestingUserState.flatMap(_.activeNodeId).orElse(ownerUserState.flatMap(_.activeNodeId)),
        treeGroupExpandedStates = mapToId32WithBools(mergedTreeGroupExpandedMap),
        boundingBoxVisibilities = mapToId32WithBools(mergedBoundingBoxVisibilityMap),
        treeVisibilities = mapToId32WithBools(mergedTreeVisibilityMap)
      )
    }
  }

  // Since the owner may change in duplicate, we need to render what they would see into a single user state for them
  def renderVolumeUserStateIntoUserState(s: VolumeTracing,
                                         requestingUserId: ObjectId,
                                         ownerId: ObjectId): VolumeUserStateProto = {
    val ownerUserState = s.userStates.find(_.userId == ownerId.toString).map(_.copy(userId = requestingUserId.toString))

    if (requestingUserId == ownerId)
      ownerUserState.getOrElse(VolumeTracingDefaults.emptyUserState(requestingUserId))
    else {
      val requestingUserState = s.userStates.find(_.userId == requestingUserId.toString)
      val requestingUserBoundingBoxVisibilityMap = id32WithBoolsToMap(
        requestingUserState.map(_.boundingBoxVisibilities))
      val ownerBoundingBoxVisibilityMap = id32WithBoolsToMap(ownerUserState.map(_.boundingBoxVisibilities))
      val requestingUserSegmentGroupExpandedMap = id32WithBoolsToMap(
        requestingUserState.map(_.segmentGroupExpandedStates))
      val ownerSegmentGroupExpandedMap = id32WithBoolsToMap(ownerUserState.map(_.segmentGroupExpandedStates))
      val requestingUserSegmentVisibilityMap = id64WithBoolsToMap(requestingUserState.map(_.segmentVisibilities))
      val ownerSegmentVisibilityMap = id64WithBoolsToMap(ownerUserState.map(_.segmentVisibilities))
      val mergedBoundingBoxVisibilityMap = ownerBoundingBoxVisibilityMap ++ requestingUserBoundingBoxVisibilityMap
      val mergedSegmentGroupExpandedMap = ownerSegmentGroupExpandedMap ++ requestingUserSegmentGroupExpandedMap
      val mergedSegmentVisibilityMap = ownerSegmentVisibilityMap ++ requestingUserSegmentVisibilityMap
      VolumeUserStateProto(
        userId = requestingUserId.toString,
        activeSegmentId =
          requestingUserState.flatMap(_.activeSegmentId).orElse(ownerUserState.flatMap(_.activeSegmentId)),
        segmentGroupExpandedStates = mapToId32WithBools(mergedSegmentGroupExpandedMap),
        boundingBoxVisibilities = mapToId32WithBools(mergedBoundingBoxVisibilityMap),
        segmentVisibilities = mapToId64WithBools(mergedSegmentVisibilityMap)
      )
    }
  }

  private def mapId32Bools(idToBools: Seq[Id32WithBool], idMap: Map[Int, Int]): Seq[Id32WithBool] =
    idToBools.map(mapIdBool(_, idMap))

  private def mapIdBool(idToBools: Id32WithBool, idMap: Map[Int, Int]): Id32WithBool =
    idToBools.copy(id = idMap.getOrElse(idToBools.id, idToBools.id))

  private def mapId64Bools(idToBools: Seq[Id64WithBool], idMap: Map[Long, Long]): Seq[Id64WithBool] =
    idToBools.map(mapIdBool(_, idMap))

  private def mapIdBool(idToBools: Id64WithBool, idMap: Map[Long, Long]): Id64WithBool =
    idToBools.copy(id = idMap.getOrElse(idToBools.id, idToBools.id))

  private def mapIdBools(idToBools: Seq[Id32WithBool], functionalIdMapping: FunctionalGroupMapping): Seq[Id32WithBool] =
    idToBools.map(mapIdBool(_, functionalIdMapping))

  private def mapIdBool(idToBools: Id32WithBool, functionalIdMapping: FunctionalGroupMapping): Id32WithBool =
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
      case Id32WithBool(boundingBoxId, boundingBoxVisibility, unknownFields) =>
        bboxIdMap.get(boundingBoxId) match {
          case Some(newId) => Some(Id32WithBool(newId, boundingBoxVisibility))
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
      case Id32WithBool(boundingBoxId, boundingBoxVisibility, unknownFields) =>
        bboxIdMap.get(boundingBoxId) match {
          case Some(newId) => Some(Id32WithBool(newId, boundingBoxVisibility))
          case None        => None
        }
    }
    userState.copy(boundingBoxVisibilities = newVisibilities)
  }
}
