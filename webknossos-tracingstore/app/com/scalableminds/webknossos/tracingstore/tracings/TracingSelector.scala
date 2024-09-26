package com.scalableminds.webknossos.tracingstore.tracings

import play.api.libs.json.{Json, OFormat}

case class TracingSelector(tracingId: String, version: Option[Long] = None)

object TracingSelector { implicit val jsonFormat: OFormat[TracingSelector] = Json.format[TracingSelector] }
