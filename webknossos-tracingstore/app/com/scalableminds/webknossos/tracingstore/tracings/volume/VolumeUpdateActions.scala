package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.image.Color
import com.scalableminds.util.tools.TristateOptionJsonHelper
import com.scalableminds.webknossos.datastore.VolumeTracing.{Segment, SegmentGroup, VolumeTracing}
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.tracingstore.annotation.{LayerUpdateAction, UpdateAction}
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

case class UpdateBucketVolumeAction(position: Vec3Int,
                                    cubeSize: Int,
                                    mag: Vec3Int,
                                    base64Data: Option[String],
                                    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends BucketMutatingVolumeUpdateAction {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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
    actionAuthorId: Option[String] = None,
    info: Option[String] = None
) extends ApplyableVolumeUpdateAction
    with ProtoGeometryImplicits {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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

case class UpdateUserBoundingBoxesVolumeAction(boundingBoxes: List[NamedBoundingBox],
                                               actionTracingId: String,
                                               actionTimestamp: Option[Long] = None,
                                               actionAuthorId: Option[String] = None,
                                               info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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
                                          actionAuthorId: Option[String] = None,
                                          info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withUserBoundingBoxes(tracing.userBoundingBoxes :+ boundingBox.toProto)

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class DeleteUserBoundingBoxVolumeAction(boundingBoxId: Int,
                                             actionTracingId: String,
                                             actionTimestamp: Option[Long] = None,
                                             actionAuthorId: Option[String] = None,
                                             info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withUserBoundingBoxes(tracing.userBoundingBoxes.filter(_.id != boundingBoxId))

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
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
                                             actionAuthorId: Option[String] = None,
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
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateUserBoundingBoxVisibilityVolumeAction(boundingBoxId: Option[Int],
                                                       isVisible: Boolean,
                                                       actionTracingId: String,
                                                       actionTimestamp: Option[Long] = None,
                                                       actionAuthorId: Option[String] = None,
                                                       info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def applyOn(tracing: VolumeTracing): VolumeTracing = {

    def updateUserBoundingBoxes(): Seq[NamedBoundingBoxProto] =
      tracing.userBoundingBoxes.map { boundingBox =>
        if (boundingBoxId.forall(_ == boundingBox.id))
          boundingBox.copy(isVisible = Some(isVisible))
        else
          boundingBox
      }

    tracing.withUserBoundingBoxes(updateUserBoundingBoxes())
  }

  override def isViewOnlyChange: Boolean = true
}

case class RemoveFallbackLayerVolumeAction(actionTracingId: String,
                                           actionTimestamp: Option[Long] = None,
                                           actionAuthorId: Option[String] = None,
                                           info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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
                                        actionAuthorId: Option[String] = None,
                                        info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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
                                       actionAuthorId: Option[String] = None,
                                       info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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
                                     actionAuthorId: Option[String] = None,
                                     info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with ProtoGeometryImplicits {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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

case class UpdateSegmentVolumeAction(id: Long,
                                     anchorPosition: Option[Vec3Int],
                                     name: Option[String],
                                     color: Option[com.scalableminds.util.image.Color],
                                     creationTime: Option[Long],
                                     groupId: Option[Int],
                                     additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                     metadata: Option[Seq[MetadataEntry]] = None,
                                     actionTracingId: String,
                                     actionTimestamp: Option[Long] = None,
                                     actionAuthorId: Option[String] = None,
                                     info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with ProtoGeometryImplicits
    with VolumeUpdateActionHelper {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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

case class DeleteSegmentVolumeAction(id: Long,
                                     actionTracingId: String,
                                     actionTimestamp: Option[Long] = None,
                                     actionAuthorId: Option[String] = None,
                                     info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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
                                         actionAuthorId: Option[String] = None,
                                         info: Option[String] = None)
    extends BucketMutatingVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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
                                         actionAuthorId: Option[String] = None,
                                         info: Option[String] = None)
    extends ApplyableVolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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

case class UpdateSegmentGroupsVolumeAction(segmentGroups: List[UpdateActionSegmentGroup],
                                           actionTracingId: String,
                                           actionTimestamp: Option[Long] = None,
                                           actionAuthorId: Option[String] = None,
                                           info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with VolumeUpdateActionHelper {
  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withSegmentGroups(segmentGroups.map(convertSegmentGroup))

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateSegmentVisibilityVolumeAction(id: Long,
                                               isVisible: Boolean,
                                               actionTracingId: String,
                                               actionTimestamp: Option[Long] = None,
                                               actionAuthorId: Option[String] = None,
                                               info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with VolumeUpdateActionHelper {

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withSegments(
      tracing.segments.map(segment => if (segment.segmentId == id) segment.withIsVisible(isVisible) else segment))

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateSegmentGroupVisibilityVolumeAction(groupId: Option[Long],
                                                    isVisible: Boolean,
                                                    actionTracingId: String,
                                                    actionTimestamp: Option[Long] = None,
                                                    actionAuthorId: Option[String] = None,
                                                    info: Option[String] = None)
    extends ApplyableVolumeUpdateAction
    with VolumeUpdateActionHelper {

  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    def updateSegmentGroups(segmentGroups: Seq[SegmentGroup]) = {
      def segmentTransform(segment: Segment) =
        if (segmentGroups.exists(group => segment.groupId.contains(group.groupId)))
          segment.withIsVisible(isVisible)
        else segment

      tracing.withSegments(tracing.segments.map(segmentTransform))
    }

    groupId match {
      case None => tracing.withSegments(tracing.segments.map(_.copy(isVisible = Some(isVisible))))
      case Some(groupId) =>
        tracing.segmentGroups
          .find(_.groupId == groupId)
          .map(group => updateSegmentGroups(GroupUtils.getAllChildrenSegmentGroups(group)))
          .getOrElse(tracing)
    }
  }

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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
                                     actionAuthorId: Option[String] = None,
                                     value: JsObject)
    extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
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
        actionAuthorId <- (json \ "value" \ "actionAuthorId").validateOpt[String]
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
object UpdateSegmentVolumeAction {
  implicit val jsonFormat: OFormat[UpdateSegmentVolumeAction] = Json.format[UpdateSegmentVolumeAction]
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
object UpdateSegmentGroupsVolumeAction {
  implicit val jsonFormat: OFormat[UpdateSegmentGroupsVolumeAction] = Json.format[UpdateSegmentGroupsVolumeAction]
}
object UpdateSegmentVisibilityVolumeAction {
  implicit val jsonFormat: OFormat[UpdateSegmentVisibilityVolumeAction] =
    Json.format[UpdateSegmentVisibilityVolumeAction]
}
object UpdateSegmentGroupVisibilityVolumeAction {
  implicit val jsonFormat: OFormat[UpdateSegmentGroupVisibilityVolumeAction] =
    Json.format[UpdateSegmentGroupVisibilityVolumeAction]
}
