package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import com.scalableminds.util.tools.AutoJsonFormat

case class UpdateActionComment(nodeId: Int, content: String) derives AutoJsonFormat
