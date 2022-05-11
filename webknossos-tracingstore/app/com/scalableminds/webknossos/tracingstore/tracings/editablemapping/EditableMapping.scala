package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import play.api.libs.json.{Json, OFormat}

case class EditableMapping(
    baseMappingName: String,
    segmentToAgglomerate: Map[Long, Long],
    agglomerateToGraph: Map[Long, AgglomerateGraph],
)

object EditableMapping {
  implicit val jsonFormat: OFormat[EditableMapping] = Json.format[EditableMapping]
}
