package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.tools.AutoFormat

case class UpdateActionSegmentGroup(
    name: String,
    groupId: Int,
    isExpanded: Option[Boolean],
    children: List[UpdateActionSegmentGroup]
) derives AutoFormat
