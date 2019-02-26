package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import play.api.libs.json.Json

case class UpdateActionComment(nodeId: Int, content: String)

object UpdateActionComment { implicit val jsonFormat = Json.format[UpdateActionComment] }
