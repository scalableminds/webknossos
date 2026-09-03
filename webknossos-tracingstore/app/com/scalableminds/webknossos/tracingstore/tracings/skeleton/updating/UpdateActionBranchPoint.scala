package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import com.scalableminds.util.tools.JsonAutoFormat

case class UpdateActionBranchPoint(nodeId: Int, timestamp: Long) derives JsonAutoFormat
