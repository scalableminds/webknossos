package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import com.scalableminds.util.tools.AutoJsonFormat

case class UpdateActionTreeGroup(
    name: String,
    groupId: Int,
    isExpanded: Option[Boolean],
    children: List[UpdateActionTreeGroup]
) derives AutoJsonFormat
