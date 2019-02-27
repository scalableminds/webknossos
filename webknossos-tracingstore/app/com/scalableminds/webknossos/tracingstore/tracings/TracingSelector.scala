package com.scalableminds.webknossos.tracingstore.tracings

import play.api.libs.json.Json

case class TracingSelector(tracingId: String, version: Option[Long] = None)

object TracingSelector { implicit val jsonFormat = Json.format[TracingSelector] }
