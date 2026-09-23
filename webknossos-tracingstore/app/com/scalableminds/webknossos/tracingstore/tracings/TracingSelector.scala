package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.tools.JsonAutoFormat

case class TracingSelector(tracingId: String, version: Option[Long] = None) derives JsonAutoFormat
