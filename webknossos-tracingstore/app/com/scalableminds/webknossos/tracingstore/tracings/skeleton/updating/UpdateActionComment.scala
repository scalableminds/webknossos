package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import com.scalableminds.util.tools.JsonAutoFormat

case class UpdateActionComment(nodeId: Int, content: String) derives JsonAutoFormat
