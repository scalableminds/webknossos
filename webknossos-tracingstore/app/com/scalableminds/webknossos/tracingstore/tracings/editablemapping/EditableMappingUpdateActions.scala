package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int
import play.api.libs.json.Format.GenericFormat
import play.api.libs.json.{Format, JsError, JsResult, JsValue, Json, OFormat}

trait EditableMappingUpdateAction {
  def applyOn(editableMapping: EditableMapping): EditableMapping
}

case class SplitAgglomerateUpdateAction(agglomerateId: Long, segmentId1: Long, segmentId2: Long)
    extends EditableMappingUpdateAction {
  def applyOn(editableMapping: EditableMapping): EditableMapping = ???
}

object SplitAgglomerateUpdateAction {
  implicit val jsonFormat: OFormat[SplitAgglomerateUpdateAction] = Json.format[SplitAgglomerateUpdateAction]
}

case class MergeAgglomerateUpdateAction(agglomerateId1: Long,
                                        agglomerateId2: Long,
                                        segmentId1: Long,
                                        segmentPosition2: Vec3Int)
    extends EditableMappingUpdateAction {

  def applyOn(editableMapping: EditableMapping): EditableMapping = ???
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
