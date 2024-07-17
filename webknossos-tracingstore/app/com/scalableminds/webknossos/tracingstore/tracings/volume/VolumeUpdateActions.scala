package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.util.Base64
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.VolumeTracing.{Segment, SegmentGroup, VolumeTracing}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.tracingstore.annotation.UpdateAction
import com.scalableminds.webknossos.tracingstore.tracings.NamedBoundingBox
import play.api.libs.json._

trait VolumeUpdateActionHelper {

  protected def mapSegments(tracing: VolumeTracing,
                            segmentId: Long,
                            transformSegment: Segment => Segment): Seq[Segment] =
    tracing.segments.map((segment: Segment) =>
      if (segment.segmentId == segmentId) transformSegment(segment) else segment)

  protected def convertSegmentGroup(aSegmentGroup: UpdateActionSegmentGroup): SegmentGroup =
    SegmentGroup(aSegmentGroup.name, aSegmentGroup.groupId, aSegmentGroup.children.map(convertSegmentGroup))

}

trait VolumeUpdateAction extends UpdateAction

trait ApplyableVolumeAction extends VolumeUpdateAction

case class UpdateBucketVolumeAction(position: Vec3Int,
                                    cubeSize: Int,
                                    mag: Vec3Int,
                                    base64Data: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None,
                                    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None)
    extends VolumeUpdateAction {
  lazy val data: Array[Byte] = Base64.getDecoder.decode(base64Data)

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  def transformToCompact: CompactVolumeUpdateAction =
    CompactVolumeUpdateAction("updateBucket", actionTimestamp, actionAuthorId, Json.obj())
}

case class UpdateTracingVolumeAction(
    activeSegmentId: Long,
    editPosition: Vec3Int,
    editRotation: Vec3Double,
    largestSegmentId: Option[Long],
    zoomLevel: Double,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[String] = None,
    info: Option[String] = None,
    editPositionAdditionalCoordinates: Option[Seq[AdditionalCoordinate]] = None
) extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  override def isViewOnlyChange: Boolean = true
}

case class RevertToVersionVolumeAction(sourceVersion: Long,
                                       actionTimestamp: Option[Long] = None,
                                       actionAuthorId: Option[String] = None,
                                       info: Option[String] = None)
    extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)

  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
}

case class UpdateUserBoundingBoxesVolumeAction(boundingBoxes: List[NamedBoundingBox],
                                               actionTimestamp: Option[Long] = None,
                                               actionAuthorId: Option[String] = None,
                                               info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  /*override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withUserBoundingBoxes(boundingBoxes.map(_.toProto))*/
}

case class UpdateUserBoundingBoxVisibilityVolumeAction(boundingBoxId: Option[Int],
                                                       isVisible: Boolean,
                                                       actionTimestamp: Option[Long] = None,
                                                       actionAuthorId: Option[String] = None,
                                                       info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  override def isViewOnlyChange: Boolean = true

  /*override def applyOn(tracing: VolumeTracing): VolumeTracing = {

    def updateUserBoundingBoxes(): Seq[geometry.NamedBoundingBoxProto] =
      tracing.userBoundingBoxes.map { boundingBox =>
        if (boundingBoxId.forall(_ == boundingBox.id))
          boundingBox.copy(isVisible = Some(isVisible))
        else
          boundingBox
      }

    tracing.withUserBoundingBoxes(updateUserBoundingBoxes())
  }*/
}

case class RemoveFallbackLayerVolumeAction(actionTimestamp: Option[Long] = None,
                                           actionAuthorId: Option[String] = None,
                                           info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  /*override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.clearFallbackLayer*/
}

case class ImportVolumeDataVolumeAction(largestSegmentId: Option[Long],
                                        actionTimestamp: Option[Long] = None,
                                        actionAuthorId: Option[String] = None,
                                        info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  /*override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.copy(largestSegmentId = largestSegmentId)*/
}

case class AddSegmentIndexVolumeAction(actionTimestamp: Option[Long] = None,
                                       actionAuthorId: Option[String] = None,
                                       info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  /*override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.copy(hasSegmentIndex = Some(true))*/

}

case class UpdateTdCameraVolumeAction(actionTimestamp: Option[Long] = None,
                                      actionAuthorId: Option[String] = None,
                                      info: Option[String] = None)
    extends VolumeUpdateAction {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  override def isViewOnlyChange: Boolean = true
}

case class CreateSegmentVolumeAction(id: Long,
                                     anchorPosition: Option[Vec3Int],
                                     name: Option[String],
                                     color: Option[com.scalableminds.util.image.Color],
                                     groupId: Option[Int],
                                     creationTime: Option[Long],
                                     actionTimestamp: Option[Long] = None,
                                     actionAuthorId: Option[String] = None,
                                     additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                     info: Option[String] = None)
    extends ApplyableVolumeAction
    with ProtoGeometryImplicits {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  /*override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    val newSegment =
      Segment(id,
              anchorPosition.map(vec3IntToProto),
              name,
              creationTime,
              colorOptToProto(color),
              groupId,
              AdditionalCoordinate.toProto(additionalCoordinates))
    tracing.addSegments(newSegment)
  }*/
}

case class UpdateSegmentVolumeAction(id: Long,
                                     anchorPosition: Option[Vec3Int],
                                     name: Option[String],
                                     color: Option[com.scalableminds.util.image.Color],
                                     creationTime: Option[Long],
                                     groupId: Option[Int],
                                     actionTimestamp: Option[Long] = None,
                                     actionAuthorId: Option[String] = None,
                                     additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                     info: Option[String] = None)
    extends ApplyableVolumeAction
    with ProtoGeometryImplicits
    with VolumeUpdateActionHelper {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  /*override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    def segmentTransform(segment: Segment): Segment =
      segment.copy(
        anchorPosition = anchorPosition.map(vec3IntToProto),
        name = name,
        creationTime = creationTime,
        color = colorOptToProto(color),
        groupId = groupId,
        anchorPositionAdditionalCoordinates = AdditionalCoordinate.toProto(additionalCoordinates)
      )
    tracing.withSegments(mapSegments(tracing, id, segmentTransform))
  }*/
}

case class DeleteSegmentVolumeAction(id: Long,
                                     actionTimestamp: Option[Long] = None,
                                     actionAuthorId: Option[String] = None,
                                     info: Option[String] = None)
    extends VolumeUpdateAction {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  /*override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withSegments(tracing.segments.filter(_.segmentId != id))*/

}

case class DeleteSegmentDataVolumeAction(id: Long,
                                         actionTimestamp: Option[Long] = None,
                                         actionAuthorId: Option[String] = None,
                                         info: Option[String] = None)
    extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
}

case class UpdateMappingNameVolumeAction(mappingName: Option[String],
                                         isEditable: Option[Boolean],
                                         isLocked: Option[Boolean],
                                         actionTimestamp: Option[Long],
                                         actionAuthorId: Option[String] = None,
                                         info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  /*  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    if (tracing.mappingIsLocked.getOrElse(false)) tracing // cannot change mapping name if it is locked
    else
      tracing.copy(mappingName = mappingName,
                   mappingIsEditable = Some(isEditable.getOrElse(false)),
                   mappingIsLocked = Some(isLocked.getOrElse(false)))*/
}

case class UpdateSegmentGroupsVolumeAction(segmentGroups: List[UpdateActionSegmentGroup],
                                           actionTimestamp: Option[Long] = None,
                                           actionAuthorId: Option[String] = None,
                                           info: Option[String] = None)
    extends VolumeUpdateAction
    with VolumeUpdateActionHelper {
  /*override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withSegmentGroups(segmentGroups.map(convertSegmentGroup))*/

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
}

case class CompactVolumeUpdateAction(name: String,
                                     actionTimestamp: Option[Long],
                                     actionAuthorId: Option[String] = None,
                                     value: JsObject,
                                     info: Option[String] = None)
    extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addAuthorId(authorId: Option[String]): VolumeUpdateAction =
    this.copy(actionAuthorId = authorId)
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
}

object CompactVolumeUpdateAction {
  implicit object compactVolumeUpdateActionFormat extends Format[CompactVolumeUpdateAction] {
    override def reads(json: JsValue): JsResult[CompactVolumeUpdateAction] =
      for {
        name <- (json \ "name").validate[String]
        actionTimestamp <- (json \ "value" \ "actionTimestamp").validateOpt[Long]
        actionAuthorId <- (json \ "value" \ "actionAuthorId").validateOpt[String]
        info <- (json \ "value" \ "info").validateOpt[String]
        value <- (json \ "value")
          .validate[JsObject]
          .map(_ - "actionTimestamp") // TODO also separate out info + actionAuthorId
      } yield CompactVolumeUpdateAction(name, actionTimestamp, actionAuthorId, value, info)

    override def writes(o: CompactVolumeUpdateAction): JsValue =
      Json.obj("name" -> o.name, "value" -> (Json.obj("actionTimestamp" -> o.actionTimestamp) ++ o.value))
  }
}

object UpdateBucketVolumeAction {
  implicit val jsonFormat: OFormat[UpdateBucketVolumeAction] = Json.format[UpdateBucketVolumeAction]
}
object UpdateTracingVolumeAction {
  implicit val jsonFormat: OFormat[UpdateTracingVolumeAction] = Json.format[UpdateTracingVolumeAction]
}
object RevertToVersionVolumeAction {
  implicit val jsonFormat: OFormat[RevertToVersionVolumeAction] = Json.format[RevertToVersionVolumeAction]
}
object UpdateUserBoundingBoxesVolumeAction {
  implicit val jsonFormat: OFormat[UpdateUserBoundingBoxesVolumeAction] =
    Json.format[UpdateUserBoundingBoxesVolumeAction]
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
object UpdateTdCameraVolumeAction {
  implicit val jsonFormat: OFormat[UpdateTdCameraVolumeAction] = Json.format[UpdateTdCameraVolumeAction]
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
