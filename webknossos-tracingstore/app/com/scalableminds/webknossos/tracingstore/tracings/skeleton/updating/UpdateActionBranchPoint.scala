package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import play.api.libs.json.{Json, OFormat}

case class UpdateActionBranchPoint(nodeId: Int, timestamp: Long)

object UpdateActionBranchPoint {
  implicit val jsonFormat: OFormat[UpdateActionBranchPoint] = Json.format[UpdateActionBranchPoint]
}
