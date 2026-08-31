package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.image.Color
import com.scalableminds.util.tools.AutoJsonFormat
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto as ProtoBoundingBox
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryConversions
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.SkeletonUpdateActionHelper

case class NamedBoundingBox(
    id: Int,
    name: Option[String],
    isVisible: Option[Boolean],
    color: Option[Color],
    boundingBox: BoundingBox
) extends ProtoGeometryConversions
    with SkeletonUpdateActionHelper derives AutoJsonFormat {
  def toProto: ProtoBoundingBox =
    ProtoBoundingBox(id, name, isVisible, colorOptToProto(color), boundingBoxToProto(boundingBox))
}
