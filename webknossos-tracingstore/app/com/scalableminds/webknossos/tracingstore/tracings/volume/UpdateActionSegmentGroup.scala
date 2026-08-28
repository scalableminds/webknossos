package com.scalableminds.webknossos.tracingstore.tracings.volume

import play.api.libs.json.{Json, OFormat}

case class UpdateActionSegmentGroup(
    name: String,
    groupId: Int,
    isExpanded: Option[Boolean],
    children: List[UpdateActionSegmentGroup]
)

object UpdateActionSegmentGroup {
  implicit val jsonFormat: OFormat[UpdateActionSegmentGroup] = Json.format[UpdateActionSegmentGroup]
}
