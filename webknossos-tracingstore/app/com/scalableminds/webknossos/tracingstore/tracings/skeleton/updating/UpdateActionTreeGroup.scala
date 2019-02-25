package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import play.api.libs.json.Json

case class UpdateActionTreeGroup(name: String, groupId: Int, children: List[UpdateActionTreeGroup])

object UpdateActionTreeGroup { implicit val jsonFormat = Json.format[UpdateActionTreeGroup] }
