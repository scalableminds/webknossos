package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.image.Color
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.TristateOptionJsonHelper
import com.scalableminds.webknossos.datastore.IdWithBool.{Id32WithBool, Id64WithBool}
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.datastore.VolumeTracing.{Segment, SegmentGroup, VolumeTracing, VolumeUserStateProto}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.tracingstore.annotation.{LayerUpdateAction, UpdateAction, UserStateUpdateAction}
import com.scalableminds.webknossos.tracingstore.tracings.{GroupUtils, MetadataEntry, NamedBoundingBox}
import play.api.libs.json._

trait VolumeUpdateActionHelper {

  protected def mapSegments(tracing: VolumeTracing,
                            segmentId: Long,
                            transformSegment: Segment => Segment): Seq[Segment] =
    tracing.segments.map((segment: Segment) =>
      if (segment.segmentId == segmentId) transformSegment(segment) else segment)

  protected def convertSegmentGroup(aSegmentGroup: UpdateActionSegmentGroup): SegmentGroup =
    SegmentGroup(aSegmentGroup.name,
                 aSegmentGroup.groupId,
                 aSegmentGroup.children.map(convertSegmentGroup),
                 aSegmentGroup.isExpanded)

}

trait VolumeUpdateAction extends LayerUpdateAction

trait ApplyableVolumeUpdateAction extends VolumeUpdateAction {
  def applyOn(tracing: VolumeTracing): VolumeTracing
}

trait BucketMutatingVolumeUpdateAction extends ApplyableVolumeUpdateAction {
  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    if (tracing.getVolumeBucketDataHasChanged) tracing else tracing.copy(volumeBucketDataHasChanged = Some(true))
}

trait UserStateVolumeUpdateAction extends ApplyableVolumeUpdateAction with UserStateUpdateAction {
  def actionAuthorId: Option[ObjectId]
  def applyOnUserState(tracing: VolumeTracing,
                       actionUserId: ObjectId,
                       existingUserStateOpt: Option[VolumeUserStateProto]): VolumeUserStateProto

  override def applyOn(tracing: VolumeTracing): VolumeTracing = actionAuthorId match {
    case None => tracing
    case Some(actionUserId) =>
      val userStateAlreadyExists = tracing.userStates.exists(state => actionUserId.toString == state.userId)
      if (userStateAlreadyExists) {
        tracing.copy(userStates = tracing.userStates.map {
          case userState if actionUserId.toString == userState.userId =>
            applyOnUserState(tracing, actionUserId, Some(userState))
          case userState => userState
        })
      } else {
        tracing.copy(userStates = tracing.userStates :+ applyOnUserState(tracing, actionUserId, None))
      }
  }
}

case class UpdateBucketVolumeAction(position: Vec3Int,
                                    cubeSize: Int,
                                    mag: Vec3Int,
                                    base64Data: Option[String],
                                    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[ObjectId] = None,
                                    info: Option[String] = None)
    extends BucketMutatingVolumeUpdateAction {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  def withoutBase64Data: UpdateBucketVolumeAction =
    this.copy(base64Data = None)

  def bucketPosition: BucketPosition = BucketPosition(
    position.x,
    position.y,
    position.z,
    mag,
    additionalCoordinates
  )
}

case class UpdateTracingVolumeAction(
    activeSegmentId: Long,
    editPosition: Vec3Int,
    editRotation: Vec3Double,
    largestSegmentId: Option[Long],
    zoomLevel: Double,
    editPositionAdditionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
    hideUnregisteredSegments: Option[Boolean] = None,
    actionTracingId: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends ApplyableVolumeUpdateAction
    with ProtoGeometryImplicits {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def isViewOnlyChange: Boolean = true

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.copy(
      activeSegmentId = Some(activeSegmentId),
      editPosition = editPosition,
      editRotation = editRotation,
      largestSegmentId = largestSegmentId,
      zoomLevel = zoomLevel,
      editPositionAdditionalCoordinates = AdditionalCoordinate.toProto(editPositionAdditionalCoordinates),
      hideUnregisteredSegments = hideUnregisteredSegments
    )
}

case class UpdateActiveSegmentIdVolumeAction(activeSegmentId: Long,
                                             actionTracingId: String,
                                             actionTimestamp: Option[Long] = None,
                                             actionAuthorId: Option[ObjectId] = None,
                                             info: Option[String] = None)
    extends UserStateVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def isViewOnlyChange: Boolean = true

  override def applyOnUserState(tracing: VolumeTracing,
                                actionUserId: ObjectId,
                                existingUserStateOpt: Option[VolumeUserStateProto]): VolumeUserStateProto =
    existingUserStateOpt
      .getOrElse(VolumeTracingDefaults.emptyUserState(actionUserId))
      .copy(activeSegmentId = Some(activeSegmentId))
}

case class UpdateLargestSegmentIdVolumeAction(largestSegmentId: Long,
                                              actionTracingId: String,
                                              actionTimestamp: Option[Long] = None,
                                              actionAuthorId: Option[ObjectId] = None,
                                              info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.copy(largestSegmentId = Some(largestSegmentId))
}

case class UpdateUserBoundingBoxesVolumeAction(boundingBoxes: List[NamedBoundingBox],
                                               actionTracingId: String,
                                               actionTimestamp: Option[Long] = None,
                                               actionAuthorId: Option[ObjectId] = None,
                                               info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withUserBoundingBoxes(boundingBoxes.map(_.toProto))
}

case class AddUserBoundingBoxVolumeAction(boundingBox: NamedBoundingBox,
                                          actionTracingId: String,
                                          actionTimestamp: Option[Long] = None,
                                          actionAuthorId: Option[ObjectId] = None,
                                          info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withUserBoundingBoxes(tracing.userBoundingBoxes :+ boundingBox.toProto)

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class DeleteUserBoundingBoxVolumeAction(boundingBoxId: Int,
                                             actionTracingId: String,
                                             actionTimestamp: Option[Long] = None,
                                             actionAuthorId: Option[ObjectId] = None,
                                             info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withUserBoundingBoxes(tracing.userBoundingBoxes.filter(_.id != boundingBoxId))

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateUserBoundingBoxVolumeAction(boundingBoxId: Int,
                                             name: Option[Option[String]],
                                             color: Option[Option[Color]],
                                             boundingBox: Option[Option[BoundingBox]],
                                             actionTracingId: String,
                                             actionTimestamp: Option[Long] = None,
                                             actionAuthorId: Option[ObjectId] = None,
                                             info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with ProtoGeometryImplicits {
  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    def updateUserBoundingBoxes() =
      tracing.userBoundingBoxes.map { currentBoundingBox =>
        if (boundingBoxId == currentBoundingBox.id) {
          currentBoundingBox.copy(
            name = name.getOrElse(currentBoundingBox.name),
            color = if (color.isDefined) color.flatMap(colorOptToProto) else currentBoundingBox.color,
            boundingBox =
              if (boundingBox.isDefined)
                boundingBox.flatMap(boundingBoxOptToProto).getOrElse(currentBoundingBox.boundingBox)
              else currentBoundingBox.boundingBox
          )
        } else
          currentBoundingBox
      }
    tracing.withUserBoundingBoxes(updateUserBoundingBoxes())
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateUserBoundingBoxVisibilityVolumeAction(boundingBoxId: Option[Int], // No bbox id → update all bboxes!
                                                       isVisible: Boolean,
                                                       actionTracingId: String,
                                                       actionTimestamp: Option[Long] = None,
                                                       actionAuthorId: Option[ObjectId] = None,
                                                       info: Option[String] = None)
    extends UserStateVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOnUserState(tracing: VolumeTracing,
                                actionUserId: ObjectId,
                                existingUserStateOpt: Option[VolumeUserStateProto]): VolumeUserStateProto = {
    val bboxIdsToUpdate = boundingBoxId.map(Seq(_)).getOrElse(tracing.userBoundingBoxes.map(_.id))
    existingUserStateOpt.map { existingUserState =>
      val visibilityMapMutable = id32WithBoolsToMutableMap(existingUserState.boundingBoxVisibilities)
      bboxIdsToUpdate.foreach(visibilityMapMutable(_) = isVisible)
      existingUserState.copy(
        boundingBoxVisibilities = mutableMapToId32WithBools(visibilityMapMutable)
      )
    }.getOrElse(
      VolumeTracingDefaults
        .emptyUserState(actionUserId)
        .copy(boundingBoxVisibilities = bboxIdsToUpdate.map(bboxId => Id32WithBool(bboxId, isVisible))))
  }

  override def isViewOnlyChange: Boolean = true
}

case class RemoveFallbackLayerVolumeAction(actionTracingId: String,
                                           actionTimestamp: Option[Long] = None,
                                           actionAuthorId: Option[ObjectId] = None,
                                           info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.clearFallbackLayer
}

case class ImportVolumeDataVolumeAction(actionTracingId: String,
                                        largestSegmentId: Option[Long],
                                        actionTimestamp: Option[Long] = None,
                                        actionAuthorId: Option[ObjectId] = None,
                                        info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.copy(largestSegmentId = largestSegmentId)
}

// The current code no longer creates these actions, but they are in the history of some volume annotations.
case class AddSegmentIndexVolumeAction(actionTracingId: String,
                                       actionTimestamp: Option[Long] = None,
                                       actionAuthorId: Option[ObjectId] = None,
                                       info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.copy(hasSegmentIndex = Some(true))

}

case class CreateSegmentVolumeAction(id: Long,
                                     anchorPosition: Option[Vec3Int],
                                     name: Option[String],
                                     color: Option[com.scalableminds.util.image.Color],
                                     groupId: Option[Int],
                                     creationTime: Option[Long],
                                     additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                     metadata: Option[Seq[MetadataEntry]] = None,
                                     actionTracingId: String,
                                     actionTimestamp: Option[Long] = None,
                                     actionAuthorId: Option[ObjectId] = None,
                                     info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with ProtoGeometryImplicits {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    val newSegment =
      Segment(
        id,
        anchorPosition.map(vec3IntToProto),
        name,
        creationTime,
        colorOptToProto(color),
        groupId,
        AdditionalCoordinate.toProto(additionalCoordinates),
        metadata = MetadataEntry.toProtoMultiple(MetadataEntry.deduplicate(metadata))
      )
    tracing.addSegments(newSegment)
  }
}

case class LegacyUpdateSegmentVolumeAction(id: Long,
                                           anchorPosition: Option[Vec3Int],
                                           name: Option[String],
                                           color: Option[com.scalableminds.util.image.Color],
                                           creationTime: Option[Long],
                                           groupId: Option[Int],
                                           additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                           metadata: Option[Seq[MetadataEntry]] = None,
                                           actionTracingId: String,
                                           actionTimestamp: Option[Long] = None,
                                           actionAuthorId: Option[ObjectId] = None,
                                           info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with ProtoGeometryImplicits
    with VolumeUpdateActionHelper {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    def segmentTransform(segment: Segment): Segment =
      segment.copy(
        anchorPosition = anchorPosition.map(vec3IntToProto),
        name = name,
        creationTime = creationTime,
        color = colorOptToProto(color),
        groupId = groupId,
        anchorPositionAdditionalCoordinates = AdditionalCoordinate.toProto(additionalCoordinates),
        metadata = MetadataEntry.toProtoMultiple(MetadataEntry.deduplicate(metadata))
      )
    tracing.withSegments(mapSegments(tracing, id, segmentTransform))
  }
}

case class UpdateSegmentPartialVolumeAction(id: Long,
                                            anchorPosition: Option[Option[Vec3Int]],
                                            name: Option[Option[String]],
                                            color: Option[Option[com.scalableminds.util.image.Color]],
                                            creationTime: Option[Option[Long]],
                                            groupId: Option[Option[Int]],
                                            additionalCoordinates: Option[Option[Seq[AdditionalCoordinate]]] = None,
                                            actionTracingId: String,
                                            actionTimestamp: Option[Long] = None,
                                            actionAuthorId: Option[ObjectId] = None,
                                            info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with ProtoGeometryImplicits
    with VolumeUpdateActionHelper {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    def segmentTransform(segment: Segment): Segment =
      segment.copy(
        anchorPosition =
          if (anchorPosition.isDefined) anchorPosition.flatMap(vec3IntOptToProto) else segment.anchorPosition,
        name = name.getOrElse(segment.name),
        creationTime = creationTime.getOrElse(segment.creationTime),
        color = if (color.isDefined) color.flatMap(colorOptToProto) else segment.color,
        groupId = groupId.getOrElse(segment.groupId),
        anchorPositionAdditionalCoordinates = additionalCoordinates
          .map(AdditionalCoordinate.toProto)
          .getOrElse(segment.anchorPositionAdditionalCoordinates),
      )

    tracing.withSegments(mapSegments(tracing, id, segmentTransform))
  }
}

case class UpdateMetadataOfSegmentVolumeAction(id: Long,
                                               upsertEntriesByKey: Seq[MetadataEntry],
                                               removeEntriesByKey: Seq[String],
                                               actionTracingId: String,
                                               actionTimestamp: Option[Long] = None,
                                               actionAuthorId: Option[ObjectId] = None,
                                               info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with VolumeUpdateActionHelper {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    def segmentTransform(segment: Segment): Segment = {
      val segmentMetadata = segment.metadata.map(MetadataEntry.fromProto)
      val metadataWithoutDeletedEntries = segmentMetadata.filter(m => !removeEntriesByKey.contains(m.key))
      val newEntries = upsertEntriesByKey.filter(m => !metadataWithoutDeletedEntries.exists(m.key == _.key))
      val metadataWithUpdatedEntries = metadataWithoutDeletedEntries.map(entry =>
        upsertEntriesByKey.find(entry.key == _.key).map(entry.update).getOrElse(entry))
      val metadataWithNewEntries = metadataWithUpdatedEntries ++ newEntries
      segment.copy(
        metadata = MetadataEntry.toProtoMultiple(MetadataEntry.deduplicate(Some(metadataWithNewEntries)))
      )
    }

    tracing.withSegments(mapSegments(tracing, id, segmentTransform))
  }
}

case class DeleteSegmentVolumeAction(id: Long,
                                     actionTracingId: String,
                                     actionTimestamp: Option[Long] = None,
                                     actionAuthorId: Option[ObjectId] = None,
                                     info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withSegments(tracing.segments.filter(_.segmentId != id))

}

case class DeleteSegmentDataVolumeAction(id: Long,
                                         actionTracingId: String,
                                         actionTimestamp: Option[Long] = None,
                                         actionAuthorId: Option[ObjectId] = None,
                                         info: Option[String] = None)
    extends BucketMutatingVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateMappingNameVolumeAction(mappingName: Option[String],
                                         isEditable: Option[Boolean],
                                         isLocked: Option[Boolean],
                                         actionTracingId: String,
                                         actionTimestamp: Option[Long],
                                         actionAuthorId: Option[ObjectId] = None,
                                         info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    if (tracing.mappingIsLocked.getOrElse(false)) tracing // cannot change mapping name if it is locked
    else
      tracing.copy(mappingName = mappingName,
                   hasEditableMapping = Some(isEditable.getOrElse(false)),
                   mappingIsLocked = Some(isLocked.getOrElse(false)))
}

case class LegacyUpdateSegmentGroupsVolumeAction(segmentGroups: List[UpdateActionSegmentGroup],
                                                 actionTracingId: String,
                                                 actionTimestamp: Option[Long] = None,
                                                 actionAuthorId: Option[ObjectId] = None,
                                                 info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with VolumeUpdateActionHelper {
  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withSegmentGroups(segmentGroups.map(convertSegmentGroup))

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class MergeSegmentItemsVolumeAction(agglomerateId1: Long, // merged into
                                         agglomerateId2: Long, // is "swallowed" by source
                                         segmentId1: Long, // only used by frontend to resolve live collab conflicts
                                         segmentId2: Long, // only used by frontend to resolve live collab conflicts
                                         actionTracingId: String,
                                         actionTimestamp: Option[Long] = None,
                                         actionAuthorId: Option[ObjectId] = None,
                                         info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with VolumeUpdateActionHelper {
  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    val sourceSegmentOpt = tracing.segments.find(_.segmentId == agglomerateId1)
    val targetSegmentOpt = tracing.segments.find(_.segmentId == agglomerateId2)

    val resultSegment = (sourceSegmentOpt, targetSegmentOpt) match {
      case (None, None)                => Segment(segmentId = agglomerateId1, creationTime = actionTimestamp, isVisible = Some(true))
      case (Some(sourceSegment), None) => sourceSegment
      case (None, Some(targetSegment)) =>
        Segment(
          segmentId = agglomerateId1,
          creationTime = actionTimestamp,
          isVisible = targetSegment.isVisible,
          metadata = targetSegment.metadata,
          anchorPosition = targetSegment.anchorPosition,
          groupId = targetSegment.groupId,
          name = mergeSegmentNames(sourceSegmentOpt.flatMap(_.name), targetSegment.name)
        )
      case (Some(sourceSegment), Some(targetSegment)) =>
        sourceSegment.copy(
          name = mergeSegmentNames(sourceSegment.name, targetSegment.name),
          metadata = mergeSegmentMetadata(sourceSegment, targetSegment)
        )
    }

    val withResultSegment =
      if (sourceSegmentOpt.isDefined) tracing.segments.map { segment: Segment =>
        if (segment.segmentId == agglomerateId1) resultSegment else segment
      } else tracing.segments :+ resultSegment

    tracing.withSegments(withResultSegment.filter(_.segmentId != agglomerateId2))
  }

  private def mergeSegmentNames(sourceSegmentNameOpt: Option[String],
                                targetSegmentNameOpt: Option[String]): Option[String] =
    (sourceSegmentNameOpt, targetSegmentNameOpt) match {
      case (None, None)                                       => None
      case (Some(sourceSegmentName), None)                    => Some(sourceSegmentName)
      case (None, Some(targetSegmentName))                    => Some(s"Segment $agglomerateId1 and $targetSegmentName")
      case (Some(sourceSegmentName), Some(targetSegmentName)) => Some(s"$sourceSegmentName and $targetSegmentName")
    }

  private def mergeSegmentMetadata(sourceSegment: Segment, targetSegment: Segment): Seq[MetadataEntryProto] = {
    val concat = sourceSegment.metadata ++ targetSegment.metadata
    val byKey: Map[String, Seq[MetadataEntryProto]] = concat.groupBy(_.key)
    val pivotIndex = sourceSegment.metadata.length
    concat.zipWithIndex.map {
      case (entry, index) =>
        if (byKey(entry.key).distinct.length == 1) {
          entry
        } else {
          val originalSegmentId = if (index < pivotIndex) agglomerateId1 else agglomerateId2
          entry.copy(key = s"${entry.key}-$originalSegmentId")
        }
    }.distinctBy(_.key)
  }

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpsertSegmentGroupVolumeAction(groupId: Int,
                                          // If not set, the name is not updated. A group must always have a name.
                                          name: Option[String],
                                          // Includes moving the group's current subgroups.
                                          newParentId: Option[Int],
                                          actionTracingId: String,
                                          actionTimestamp: Option[Long] = None,
                                          actionAuthorId: Option[ObjectId] = None,
                                          info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with VolumeUpdateActionHelper {
  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    val newGroup = SegmentGroup(name = name.getOrElse(s"Group $groupId"),
                                groupId = groupId,
                                children = Seq(),
                                isExpanded = Some(true))
    val updatedGroups = newParentId
      .map(parentId => {
        val (groupsWithoutMovee, moveeOpt) = removeGroup(tracing.segmentGroups)
        val movee = moveeOpt.getOrElse(newGroup)
        // If parentId is -1, the group should be inserted at root level.
        if (parentId == -1)
          groupsWithoutMovee :+ movee
        else {
          val (updatedGroups, didInsert) = insertUnderParent(groupsWithoutMovee, parentId, movee)
          if (didInsert) updatedGroups else updatedGroups :+ movee
        }
      })
      .getOrElse {
        val (maybeUpdatedGroups, didRename) = renameInGroups(tracing.segmentGroups)
        if (didRename) maybeUpdatedGroups else maybeUpdatedGroups :+ newGroup

      }
    tracing.withSegmentGroups(updatedGroups)
  }

  private def renameInGroups(groups: Seq[SegmentGroup]): (Seq[SegmentGroup], Boolean) = {
    // To avoid traversing into the subbranch of the group which should be renamed, we pass the second argument to fold left.
    // It keeps track of whether the renaming was already done and then earlies out instead of traversing deeper.
    val updated = groups.foldLeft((Vector.empty[SegmentGroup], false)) {
      // Pass as already renamed.
      case ((acc, true), g) =>
        (acc :+ g, true)
      // Rename group.
      case ((acc, false), g) if g.groupId == groupId =>
        val renamed = g.copy(name = name.getOrElse(g.name))
        (acc :+ renamed, true)
      // Rename recursively.
      case ((acc, false), g) =>
        val (children, done) = renameInGroups(g.children)
        (acc :+ g.withChildren(children), done)
    }
    updated
  }

  private def removeGroup(groups: Seq[SegmentGroup]): (Seq[SegmentGroup], Option[SegmentGroup]) =
    groups.foldLeft((Vector.empty[SegmentGroup], Option.empty[SegmentGroup])) {
      // Already found → keep remaining nodes unchanged
      case ((acc, found @ Some(_)), g) =>
        (acc :+ g, found)
      // Found at this level → remove it
      case ((acc, None), g) if g.groupId == this.groupId =>
        (acc, Some(g))
      // Search children
      case ((acc, None), g) =>
        val (newChildren, found) = removeGroup(g.children)
        (acc :+ g.withChildren(newChildren), found)
    }

  private def insertUnderParent(
      groups: Seq[SegmentGroup],
      parentId: Int,
      child: SegmentGroup
  ): (Seq[SegmentGroup], Boolean) =
    groups.foldLeft((Vector.empty[SegmentGroup], false)) {
      // Already inserted → keep remaining nodes unchanged
      case ((acc, true), g) =>
        (acc :+ g, true)
      // Insert here
      case ((acc, false), g) if g.groupId == parentId =>
        (acc :+ g.withChildren(g.children :+ child), true)
      // Search children
      case ((acc, false), g) =>
        val (children, inserted) = insertUnderParent(g.children, parentId, child)
        (acc :+ g.withChildren(children), inserted)
    }

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class DeleteSegmentGroupVolumeAction(groupId: Int,
                                          actionTracingId: String,
                                          actionTimestamp: Option[Long] = None,
                                          actionAuthorId: Option[ObjectId] = None,
                                          info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with VolumeUpdateActionHelper {
  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    def removeFromGroupHierarchy(groups: Seq[SegmentGroup]): Seq[SegmentGroup] =
      groups.collect {
        case SegmentGroup(_, id, _, _, _) if id == this.groupId =>
          None
        case segmentGroup =>
          Some(segmentGroup.withChildren(removeFromGroupHierarchy(segmentGroup.children)))
      }.flatten
    tracing.withSegmentGroups(removeFromGroupHierarchy(tracing.segmentGroups))
  }

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateSegmentGroupsExpandedStateVolumeAction(groupIds: List[Int],
                                                        areExpanded: Boolean,
                                                        actionTracingId: String,
                                                        actionTimestamp: Option[Long] = None,
                                                        actionAuthorId: Option[ObjectId] = None,
                                                        info: Option[String] = None)
    extends UserStateVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOnUserState(tracing: VolumeTracing,
                                actionUserId: ObjectId,
                                existingUserStateOpt: Option[VolumeUserStateProto]): VolumeUserStateProto =
    existingUserStateOpt.map { existingUserState =>
      val expandedStateMapMutable = id32WithBoolsToMutableMap(existingUserState.segmentGroupExpandedStates)
      groupIds.foreach(expandedStateMapMutable(_) = areExpanded)
      existingUserState.copy(
        segmentGroupExpandedStates = mutableMapToId32WithBools(expandedStateMapMutable)
      )
    }.getOrElse(
      VolumeTracingDefaults
        .emptyUserState(actionUserId)
        .copy(segmentGroupExpandedStates = groupIds.map(groupId => Id32WithBool(groupId, areExpanded)))
    )
}

case class UpdateSegmentVisibilityVolumeAction(id: Long,
                                               isVisible: Boolean,
                                               actionTracingId: String,
                                               actionTimestamp: Option[Long] = None,
                                               actionAuthorId: Option[ObjectId] = None,
                                               info: Option[String] = None)
    extends UserStateVolumeUpdateAction
    with VolumeUpdateActionHelper {

  def applyOnUserState(tracing: VolumeTracing,
                       actionUserId: ObjectId,
                       existingUserStateOpt: Option[VolumeUserStateProto]): VolumeUserStateProto =
    existingUserStateOpt.map { existingUserState =>
      val visibilityMap = id64WithBoolsToMutableMap(existingUserState.segmentVisibilities)
      visibilityMap(id) = isVisible
      existingUserState.copy(
        segmentVisibilities = mutableMapToId64WithBools(visibilityMap)
      )
    }.getOrElse(
      VolumeTracingDefaults
        .emptyUserState(actionUserId)
        .copy(
          segmentVisibilities = Seq(Id64WithBool(id, isVisible)),
        )
    )

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateSegmentGroupVisibilityVolumeAction(groupId: Option[Long], // No group id → update all segments!
                                                    isVisible: Boolean,
                                                    actionTracingId: String,
                                                    actionTimestamp: Option[Long] = None,
                                                    actionAuthorId: Option[ObjectId] = None,
                                                    info: Option[String] = None)
    extends UserStateVolumeUpdateAction
    with VolumeUpdateActionHelper {

  override def applyOnUserState(tracing: VolumeTracing,
                                actionUserId: ObjectId,
                                existingUserStateOpt: Option[VolumeUserStateProto]): VolumeUserStateProto = {
    val segmentIdsToUpdate: Seq[Long] = groupId match {
      case None => tracing.segments.map(segment => segment.segmentId)
      case Some(groupId) =>
        (for {
          segmentGroup <- tracing.segmentGroups.find(_.groupId == groupId)
          segmentGroups = GroupUtils.getAllChildrenSegmentGroups(segmentGroup)
          segmentIds = tracing.segments
            .filter(segment => segmentGroups.exists(group => segment.groupId.contains(group.groupId)))
            .map(_.segmentId)
        } yield segmentIds).getOrElse(Seq.empty)
    }
    existingUserStateOpt.map { existingUserState =>
      val visibilityMapMutable = id64WithBoolsToMutableMap(existingUserState.segmentVisibilities)
      segmentIdsToUpdate.foreach(visibilityMapMutable(_) = isVisible)
      existingUserState.copy(
        segmentVisibilities = mutableMapToId64WithBools(visibilityMapMutable)
      )
    }.getOrElse(
      VolumeTracingDefaults
        .emptyUserState(actionUserId)
        .copy(segmentVisibilities = segmentIdsToUpdate.map(segmentId => Id64WithBool(segmentId, isVisible)))
    )
  }

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

// Only used to represent legacy update actions from the db where not all fields are set
// This is from a time when volume actions were not applied lazily
// (Before https://github.com/scalableminds/webknossos/pull/7917)
case class CompactVolumeUpdateAction(name: String,
                                     actionTracingId: String,
                                     actionTimestamp: Option[Long],
                                     actionAuthorId: Option[ObjectId] = None,
                                     value: JsObject)
    extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[ObjectId]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

object CompactVolumeUpdateAction {
  implicit object compactVolumeUpdateActionFormat extends Format[CompactVolumeUpdateAction] {
    override def reads(json: JsValue): JsResult[CompactVolumeUpdateAction] =
      for {
        name <- (json \ "name").validate[String]
        actionTracingId <- (json \ "value" \ "actionTracingId").validate[String]
        actionTimestamp <- (json \ "value" \ "actionTimestamp").validateOpt[Long]
        actionAuthorId <- (json \ "value" \ "actionAuthorId").validateOpt[ObjectId]
        value <- (json \ "value").validate[JsObject].map(_ - "actionTracingId" - "actionTimestamp" - "actionAuthorId")
      } yield CompactVolumeUpdateAction(name, actionTracingId, actionTimestamp, actionAuthorId, value)

    override def writes(o: CompactVolumeUpdateAction): JsValue =
      Json.obj(
        "name" -> o.name,
        "value" -> (Json.obj("actionTracingId" -> o.actionTracingId,
                             "actionTimestamp" -> o.actionTimestamp,
                             "actionAuthorId" -> o.actionAuthorId) ++ o.value),
        "isCompacted" -> true
      )
  }
}

object UpdateBucketVolumeAction {
  implicit val jsonFormat: OFormat[UpdateBucketVolumeAction] = Json.format[UpdateBucketVolumeAction]
}
object UpdateTracingVolumeAction {
  implicit val jsonFormat: OFormat[UpdateTracingVolumeAction] = Json.format[UpdateTracingVolumeAction]
}
object UpdateActiveSegmentIdVolumeAction {
  implicit val jsonFormat: OFormat[UpdateActiveSegmentIdVolumeAction] = Json.format[UpdateActiveSegmentIdVolumeAction]
}
object UpdateLargestSegmentIdVolumeAction {
  implicit val jsonFormat: OFormat[UpdateLargestSegmentIdVolumeAction] = Json.format[UpdateLargestSegmentIdVolumeAction]
}
object UpdateUserBoundingBoxesVolumeAction {
  implicit val jsonFormat: OFormat[UpdateUserBoundingBoxesVolumeAction] =
    Json.format[UpdateUserBoundingBoxesVolumeAction]
}
object AddUserBoundingBoxVolumeAction {
  implicit val jsonFormat: OFormat[AddUserBoundingBoxVolumeAction] =
    Json.format[AddUserBoundingBoxVolumeAction]
}
object DeleteUserBoundingBoxVolumeAction {
  implicit val jsonFormat: OFormat[DeleteUserBoundingBoxVolumeAction] =
    Json.format[DeleteUserBoundingBoxVolumeAction]
}
object UpdateUserBoundingBoxVolumeAction extends TristateOptionJsonHelper {
  implicit val jsonFormat: OFormat[UpdateUserBoundingBoxVolumeAction] =
    Json.configured(tristateOptionParsing).format[UpdateUserBoundingBoxVolumeAction]
}
object UpdateUserBoundingBoxVisibilityVolumeAction {
  implicit val jsonFormat: OFormat[UpdateUserBoundingBoxVisibilityVolumeAction] =
    Json.format[UpdateUserBoundingBoxVisibilityVolumeAction]
}
object RemoveFallbackLayerVolumeAction {
  implicit val jsonFormat: OFormat[RemoveFallbackLayerVolumeAction] = Json.format[RemoveFallbackLayerVolumeAction]
}
object ImportVolumeDataVolumeAction {
  implicit val jsonFormat: OFormat[ImportVolumeDataVolumeAction] = Json.format[ImportVolumeDataVolumeAction]
}
object AddSegmentIndexVolumeAction {
  implicit val jsonFormat: OFormat[AddSegmentIndexVolumeAction] = Json.format[AddSegmentIndexVolumeAction]
}
object CreateSegmentVolumeAction {
  implicit val jsonFormat: OFormat[CreateSegmentVolumeAction] = Json.format[CreateSegmentVolumeAction]
}
object LegacyUpdateSegmentVolumeAction {
  implicit val jsonFormat: OFormat[LegacyUpdateSegmentVolumeAction] = Json.format[LegacyUpdateSegmentVolumeAction]
}
object UpdateSegmentPartialVolumeAction extends TristateOptionJsonHelper {
  implicit val jsonFormat: OFormat[UpdateSegmentPartialVolumeAction] =
    Json.configured(tristateOptionParsing).format[UpdateSegmentPartialVolumeAction]
}
object UpdateMetadataOfSegmentVolumeAction {
  implicit val jsonFormat: OFormat[UpdateMetadataOfSegmentVolumeAction] =
    Json.format[UpdateMetadataOfSegmentVolumeAction]
}
object MergeSegmentItemsVolumeAction {
  implicit val jsonFormat: OFormat[MergeSegmentItemsVolumeAction] = Json.format[MergeSegmentItemsVolumeAction]
}
object DeleteSegmentVolumeAction {
  implicit val jsonFormat: OFormat[DeleteSegmentVolumeAction] = Json.format[DeleteSegmentVolumeAction]
}
object DeleteSegmentDataVolumeAction {
  implicit val jsonFormat: OFormat[DeleteSegmentDataVolumeAction] = Json.format[DeleteSegmentDataVolumeAction]
}
object UpdateMappingNameVolumeAction {
  implicit val jsonFormat: OFormat[UpdateMappingNameVolumeAction] = Json.format[UpdateMappingNameVolumeAction]
}
object LegacyUpdateSegmentGroupsVolumeAction {
  implicit val jsonFormat: OFormat[LegacyUpdateSegmentGroupsVolumeAction] =
    Json.format[LegacyUpdateSegmentGroupsVolumeAction]
}
object UpsertSegmentGroupVolumeAction {
  implicit val jsonFormat: OFormat[UpsertSegmentGroupVolumeAction] = Json.format[UpsertSegmentGroupVolumeAction]
}
object DeleteSegmentGroupVolumeAction {
  implicit val jsonFormat: OFormat[DeleteSegmentGroupVolumeAction] = Json.format[DeleteSegmentGroupVolumeAction]
}
object UpdateSegmentGroupsExpandedStateVolumeAction {
  implicit val jsonFormat: OFormat[UpdateSegmentGroupsExpandedStateVolumeAction] =
    Json.format[UpdateSegmentGroupsExpandedStateVolumeAction]
}
object UpdateSegmentVisibilityVolumeAction {
  implicit val jsonFormat: OFormat[UpdateSegmentVisibilityVolumeAction] =
    Json.format[UpdateSegmentVisibilityVolumeAction]
}
object UpdateSegmentGroupVisibilityVolumeAction {
  implicit val jsonFormat: OFormat[UpdateSegmentGroupVisibilityVolumeAction] =
    Json.format[UpdateSegmentGroupVisibilityVolumeAction]
}
