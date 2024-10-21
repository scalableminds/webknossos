package com.scalableminds.webknossos.tracingstore.tracings

import java.util.UUID

object TracingId {

  def generate: String = UUID.randomUUID.toString

  lazy val dummy: String = "dummyTracingId"

}
