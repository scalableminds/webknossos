package com.scalableminds.webknossos.datastore.tracings.skeleton.updating

import play.api.libs.json.Json


case class UpdateActionBranchPoint(nodeId: Int, timestamp: Long)

object UpdateActionBranchPoint {implicit val jsonFormat = Json.format[UpdateActionBranchPoint]}
