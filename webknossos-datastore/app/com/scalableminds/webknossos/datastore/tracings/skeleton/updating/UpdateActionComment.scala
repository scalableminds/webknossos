package com.scalableminds.webknossos.datastore.tracings.skeleton.updating

import play.api.libs.json.Json

case class UpdateActionComment(nodeId: Int, content: String)

object UpdateActionComment {implicit val jsonFormat = Json.format[UpdateActionComment]}
