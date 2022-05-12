package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.tools.AdditionalJsonFormats
import com.scalableminds.webknossos.datastore.models.AgglomerateGraph
import play.api.libs.json.{Json, OFormat}

case class EditableMapping(
    baseMappingName: String,
    segmentToAgglomerate: Map[Long, Long],
    agglomerateToGraph: Map[Long, AgglomerateGraph],
)

object EditableMapping extends AdditionalJsonFormats {
  implicit val jsonFormat: OFormat[EditableMapping] = Json.format[EditableMapping]
}
