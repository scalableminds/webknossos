package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int
import play.api.libs.json.Format.GenericFormat
import play.api.libs.json._

trait EditableMappingUpdateAction {
  def addTimestamp(timestamp: Long): EditableMappingUpdateAction
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class SplitAgglomerateUpdateAction(agglomerateId: Long,
                                        segmentPosition1: Option[Vec3Int],
                                        segmentPosition2: Option[Vec3Int],
                                        segmentId1: Option[Long],
                                        segmentId2: Option[Long],
                                        mag: Vec3Int,
                                        actionTimestamp: Option[Long] = None)
    extends EditableMappingUpdateAction {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
}

object SplitAgglomerateUpdateAction {
  implicit val jsonFormat: OFormat[SplitAgglomerateUpdateAction] = Json.format[SplitAgglomerateUpdateAction]
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class MergeAgglomerateUpdateAction(agglomerateId1: Long,
                                        agglomerateId2: Long,
                                        segmentPosition1: Option[Vec3Int],
                                        segmentPosition2: Option[Vec3Int],
                                        segmentId1: Option[Long],
                                        segmentId2: Option[Long],
                                        mag: Vec3Int,
                                        actionTimestamp: Option[Long] = None)
    extends EditableMappingUpdateAction {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
}

object MergeAgglomerateUpdateAction {
  implicit val jsonFormat: OFormat[MergeAgglomerateUpdateAction] = Json.format[MergeAgglomerateUpdateAction]
}

object EditableMappingUpdateAction {

  implicit object editableMappingUpdateActionFormat extends Format[EditableMappingUpdateAction] {
    override def reads(json: JsValue): JsResult[EditableMappingUpdateAction] =
      (json \ "name").validate[String].flatMap {
        case "mergeAgglomerate"    => (json \ "value").validate[MergeAgglomerateUpdateAction]
        case "splitAgglomerate"    => (json \ "value").validate[SplitAgglomerateUpdateAction]
        case unknownAction: String => JsError(s"Invalid update action s'$unknownAction'")
      }

    override def writes(o: EditableMappingUpdateAction): JsValue = o match {
      case s: SplitAgglomerateUpdateAction =>
        Json.obj("name" -> "splitAgglomerate", "value" -> Json.toJson(s)(SplitAgglomerateUpdateAction.jsonFormat))
      case s: MergeAgglomerateUpdateAction =>
        Json.obj("name" -> "mergeAgglomerate", "value" -> Json.toJson(s)(MergeAgglomerateUpdateAction.jsonFormat))
    }
  }

}

case class EditableMappingUpdateActionGroup(
    version: Long,
    timestamp: Long,
    actions: List[EditableMappingUpdateAction]
)

object EditableMappingUpdateActionGroup {
  implicit val jsonFormat: OFormat[EditableMappingUpdateActionGroup] = Json.format[EditableMappingUpdateActionGroup]
}
