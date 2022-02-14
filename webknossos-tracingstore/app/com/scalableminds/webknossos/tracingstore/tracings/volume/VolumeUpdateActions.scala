package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.util.Base64

import com.scalableminds.util.geometry.{Vec3Int, Vec3Double}
import com.scalableminds.webknossos.datastore.VolumeTracing.{Segment, VolumeTracing}
import com.scalableminds.webknossos.datastore.geometry
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.UpdateAction.VolumeUpdateAction
import com.scalableminds.webknossos.tracingstore.tracings.{NamedBoundingBox, UpdateAction}
import play.api.libs.json._

trait VolumeUpdateActionHelper {

  protected def mapSegments(tracing: VolumeTracing,
                            segmentId: Long,
                            transformSegment: Segment => Segment): Seq[Segment] =
    tracing.segments.map((segment: Segment) =>
      if (segment.segmentId == segmentId) transformSegment(segment) else segment)

}

trait ApplyableVolumeAction extends VolumeUpdateAction

case class UpdateBucketVolumeAction(position: Vec3Int,
                                    cubeSize: Int,
                                    zoomStep: Int,
                                    base64Data: String,
                                    actionTimestamp: Option[Long] = None,
                                    info: Option[String] = None)
    extends VolumeUpdateAction {
  lazy val data: Array[Byte] = Base64.getDecoder.decode(base64Data)

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: CompactVolumeUpdateAction =
    CompactVolumeUpdateAction("updateBucket", actionTimestamp, Json.obj())
}

object UpdateBucketVolumeAction {
  implicit val jsonFormat: OFormat[UpdateBucketVolumeAction] = Json.format[UpdateBucketVolumeAction]
}

case class UpdateTracingVolumeAction(
    activeSegmentId: Long,
    editPosition: Vec3Int,
    editRotation: Vec3Double,
    largestSegmentId: Long,
    zoomLevel: Double,
    actionTimestamp: Option[Long] = None,
    info: Option[String] = None
) extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: CompactVolumeUpdateAction =
    CompactVolumeUpdateAction("updateTracing", actionTimestamp, Json.obj())

  override def isViewOnlyChange: Boolean = true
}

object UpdateTracingVolumeAction {
  implicit val jsonFormat: OFormat[UpdateTracingVolumeAction] = Json.format[UpdateTracingVolumeAction]
}

case class RevertToVersionVolumeAction(sourceVersion: Long,
                                       actionTimestamp: Option[Long] = None,
                                       info: Option[String] = None)
    extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: CompactVolumeUpdateAction =
    CompactVolumeUpdateAction("revertToVersion", actionTimestamp, Json.obj("sourceVersion" -> sourceVersion))
}

object RevertToVersionVolumeAction {
  implicit val jsonFormat: OFormat[RevertToVersionVolumeAction] = Json.format[RevertToVersionVolumeAction]
}

case class UpdateUserBoundingBoxes(boundingBoxes: List[NamedBoundingBox],
                                   actionTimestamp: Option[Long] = None,
                                   info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: CompactVolumeUpdateAction =
    CompactVolumeUpdateAction("updateUserBoundingBoxes", actionTimestamp, Json.obj())

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withUserBoundingBoxes(boundingBoxes.map(_.toProto))
}

object UpdateUserBoundingBoxes {
  implicit val jsonFormat: OFormat[UpdateUserBoundingBoxes] = Json.format[UpdateUserBoundingBoxes]
}

case class UpdateUserBoundingBoxVisibility(boundingBoxId: Option[Int],
                                           isVisible: Boolean,
                                           actionTimestamp: Option[Long] = None,
                                           info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: CompactVolumeUpdateAction =
    CompactVolumeUpdateAction("updateUserBoundingBoxVisibility",
                              actionTimestamp,
                              Json.obj("boundingBoxId" -> boundingBoxId, "newVisibility" -> isVisible))
  override def isViewOnlyChange: Boolean = true

  override def applyOn(tracing: VolumeTracing): VolumeTracing = {

    def updateUserBoundingBoxes(): Seq[geometry.NamedBoundingBoxProto] =
      tracing.userBoundingBoxes.map { boundingBox =>
        if (boundingBoxId.forall(_ == boundingBox.id))
          boundingBox.copy(isVisible = Some(isVisible))
        else
          boundingBox
      }

    tracing.withUserBoundingBoxes(updateUserBoundingBoxes())
  }
}

object UpdateUserBoundingBoxVisibility {
  implicit val jsonFormat: OFormat[UpdateUserBoundingBoxVisibility] = Json.format[UpdateUserBoundingBoxVisibility]
}

case class RemoveFallbackLayer(actionTimestamp: Option[Long] = None, info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: CompactVolumeUpdateAction =
    CompactVolumeUpdateAction("removeFallbackLayer", actionTimestamp, Json.obj())

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.clearFallbackLayer
}

object RemoveFallbackLayer {
  implicit val jsonFormat: OFormat[RemoveFallbackLayer] = Json.format[RemoveFallbackLayer]
}

case class ImportVolumeData(largestSegmentId: Long, actionTimestamp: Option[Long] = None, info: Option[String] = None)
    extends ApplyableVolumeAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: CompactVolumeUpdateAction =
    CompactVolumeUpdateAction("importVolumeTracing", actionTimestamp, Json.obj("largestSegmentId" -> largestSegmentId))

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withLargestSegmentId(largestSegmentId)
}

object ImportVolumeData {
  implicit val jsonFormat: OFormat[ImportVolumeData] = Json.format[ImportVolumeData]
}

case class UpdateTdCamera(actionTimestamp: Option[Long] = None, info: Option[String] = None)
    extends VolumeUpdateAction {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: CompactVolumeUpdateAction =
    CompactVolumeUpdateAction("updateTdCamera", actionTimestamp, Json.obj())

  override def isViewOnlyChange: Boolean = true
}

object UpdateTdCamera {
  implicit val jsonFormat: OFormat[UpdateTdCamera] = Json.format[UpdateTdCamera]
}

case class CreateSegmentVolumeAction(id: Long,
                                     anchorPosition: Option[Vec3Int],
                                     name: Option[String],
                                     creationTime: Option[Long],
                                     actionTimestamp: Option[Long] = None)
    extends ApplyableVolumeAction
    with ProtoGeometryImplicits {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: UpdateAction[VolumeTracing] =
    CompactVolumeUpdateAction("createSegment", actionTimestamp, Json.obj("id" -> id))

  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    val newSegment = Segment(id, anchorPosition.map(vec3IntToProto), name, creationTime)
    tracing.addSegments(newSegment)
  }
}

object CreateSegmentVolumeAction {
  implicit val jsonFormat: OFormat[CreateSegmentVolumeAction] = Json.format[CreateSegmentVolumeAction]
}

case class UpdateSegmentVolumeAction(id: Long,
                                     anchorPosition: Option[Vec3Int],
                                     name: Option[String],
                                     creationTime: Option[Long],
                                     actionTimestamp: Option[Long] = None)
    extends ApplyableVolumeAction
    with ProtoGeometryImplicits
    with VolumeUpdateActionHelper {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: UpdateAction[VolumeTracing] =
    CompactVolumeUpdateAction("updateSegment", actionTimestamp, Json.obj("id" -> id))

  override def applyOn(tracing: VolumeTracing): VolumeTracing = {
    def segmentTransform(segment: Segment): Segment =
      segment.copy(
        anchorPosition = anchorPosition.map(vec3IntToProto),
        name = name,
        creationTime = creationTime
      )
    tracing.withSegments(mapSegments(tracing, id, segmentTransform))
  }
}

object UpdateSegmentVolumeAction {
  implicit val jsonFormat: OFormat[UpdateSegmentVolumeAction] = Json.format[UpdateSegmentVolumeAction]
}

case class DeleteSegmentVolumeAction(id: Long, actionTimestamp: Option[Long] = None) extends ApplyableVolumeAction {

  override def addTimestamp(timestamp: Long): VolumeUpdateAction =
    this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact: UpdateAction[VolumeTracing] =
    CompactVolumeUpdateAction("deleteSegment", actionTimestamp, Json.obj("id" -> id))

  override def applyOn(tracing: VolumeTracing): VolumeTracing =
    tracing.withSegments(tracing.segments.filter(_.segmentId != id))

}

object DeleteSegmentVolumeAction {
  implicit val jsonFormat: OFormat[DeleteSegmentVolumeAction] = Json.format[DeleteSegmentVolumeAction]
}

case class CompactVolumeUpdateAction(name: String, actionTimestamp: Option[Long], value: JsObject)
    extends VolumeUpdateAction

object CompactVolumeUpdateAction {
  implicit object compactVolumeUpdateActionFormat extends Format[CompactVolumeUpdateAction] {
    override def reads(json: JsValue): JsResult[CompactVolumeUpdateAction] =
      for {
        name <- (json \ "name").validate[String]
        actionTimestamp <- (json \ "value" \ "actionTimestamp").validateOpt[Long]
        value <- (json \ "value").validate[JsObject].map(_ - "actionTimestamp")
      } yield CompactVolumeUpdateAction(name, actionTimestamp, value)

    override def writes(o: CompactVolumeUpdateAction): JsValue =
      Json.obj("name" -> o.name, "value" -> (Json.obj("actionTimestamp" -> o.actionTimestamp) ++ o.value))
  }
}

object VolumeUpdateAction {

  implicit object volumeUpdateActionFormat extends Format[VolumeUpdateAction] {
    override def reads(json: JsValue): JsResult[VolumeUpdateAction] =
      (json \ "name").validate[String].flatMap {
        case "updateBucket"                    => (json \ "value").validate[UpdateBucketVolumeAction]
        case "updateTracing"                   => (json \ "value").validate[UpdateTracingVolumeAction]
        case "revertToVersion"                 => (json \ "value").validate[RevertToVersionVolumeAction]
        case "updateUserBoundingBoxes"         => (json \ "value").validate[UpdateUserBoundingBoxes]
        case "updateUserBoundingBoxVisibility" => (json \ "value").validate[UpdateUserBoundingBoxVisibility]
        case "removeFallbackLayer"             => (json \ "value").validate[RemoveFallbackLayer]
        case "importVolumeTracing"             => (json \ "value").validate[ImportVolumeData]
        case "updateTdCamera"                  => (json \ "value").validate[UpdateTdCamera]
        case "createSegment"                   => (json \ "value").validate[CreateSegmentVolumeAction]
        case "updateSegment"                   => (json \ "value").validate[UpdateSegmentVolumeAction]
        case "deleteSegment"                   => (json \ "value").validate[DeleteSegmentVolumeAction]
        case unknownAction: String             => JsError(s"Invalid update action s'$unknownAction'")
      }

    override def writes(o: VolumeUpdateAction): JsValue = o match {
      case s: UpdateBucketVolumeAction =>
        Json.obj("name" -> "updateBucket", "value" -> Json.toJson(s)(UpdateBucketVolumeAction.jsonFormat))
      case s: UpdateTracingVolumeAction =>
        Json.obj("name" -> "updateTracing", "value" -> Json.toJson(s)(UpdateTracingVolumeAction.jsonFormat))
      case s: RevertToVersionVolumeAction =>
        Json.obj("name" -> "revertToVersion", "value" -> Json.toJson(s)(RevertToVersionVolumeAction.jsonFormat))
      case s: UpdateUserBoundingBoxes =>
        Json.obj("name" -> "updateUserBoundingBoxes", "value" -> Json.toJson(s)(UpdateUserBoundingBoxes.jsonFormat))
      case s: UpdateUserBoundingBoxVisibility =>
        Json.obj("name" -> "updateUserBoundingBoxVisibility",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxVisibility.jsonFormat))
      case s: RemoveFallbackLayer =>
        Json.obj("name" -> "removeFallbackLayer", "value" -> Json.toJson(s)(RemoveFallbackLayer.jsonFormat))
      case s: ImportVolumeData =>
        Json.obj("name" -> "importVolumeTracing", "value" -> Json.toJson(s)(ImportVolumeData.jsonFormat))
      case s: UpdateTdCamera =>
        Json.obj("name" -> "updateTdCamera", "value" -> Json.toJson(s)(UpdateTdCamera.jsonFormat))
      case s: CreateSegmentVolumeAction =>
        Json.obj("name" -> "createSegment", "value" -> Json.toJson(s)(CreateSegmentVolumeAction.jsonFormat))
      case s: UpdateSegmentVolumeAction =>
        Json.obj("name" -> "updateSegment", "value" -> Json.toJson(s)(UpdateSegmentVolumeAction.jsonFormat))
      case s: DeleteSegmentVolumeAction =>
        Json.obj("name" -> "deleteSegment", "value" -> Json.toJson(s)(DeleteSegmentVolumeAction.jsonFormat))
      case s: CompactVolumeUpdateAction => Json.toJson(s)(CompactVolumeUpdateAction.compactVolumeUpdateActionFormat)
    }
  }

}
