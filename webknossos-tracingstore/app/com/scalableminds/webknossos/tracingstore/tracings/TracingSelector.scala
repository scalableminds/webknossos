package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.tools.AutoJsonFormat

case class TracingSelector(tracingId: String, version: Option[Long] = None) derives AutoJsonFormat
