package com.scalableminds.webknossos.tracingstore.tracings

import play.api.libs.json.{Json, OFormat}
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.image.Color
import com.scalableminds.webknossos.datastore.geometry.{NamedBoundingBox => ProtoBoundingBox}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.SkeletonUpdateActionHelper

case class NamedBoundingBox(id: Int,
                            name: Option[String],
                            isVisible: Option[Boolean],
                            color: Option[Color],
                            boundingBox: BoundingBox)
    extends ProtoGeometryImplicits
    with SkeletonUpdateActionHelper {
  def toProto: ProtoBoundingBox = ProtoBoundingBox(id, name, isVisible, convertColorOpt(color), boundingBox)
}

object NamedBoundingBox { implicit val jsonFormat: OFormat[NamedBoundingBox] = Json.format[NamedBoundingBox] }
