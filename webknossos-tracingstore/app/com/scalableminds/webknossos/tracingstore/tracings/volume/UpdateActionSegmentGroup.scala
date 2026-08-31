package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.tools.AutoJsonFormat

case class UpdateActionSegmentGroup(
    name: String,
    groupId: Int,
    isExpanded: Option[Boolean],
    children: List[UpdateActionSegmentGroup]
) derives AutoJsonFormat
