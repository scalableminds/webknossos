package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import play.api.libs.json.{Json, OFormat}

case class UpdateActionTreeGroup(name: String, groupId: Int, children: List[UpdateActionTreeGroup])

object UpdateActionTreeGroup {
  implicit val jsonFormat: OFormat[UpdateActionTreeGroup] = Json.format[UpdateActionTreeGroup]
}
