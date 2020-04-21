package com.scalableminds.webknossos.tracingstore.tracings

import play.api.libs.json.Json
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.webknossos.tracingstore.geometry.{NamedBoundingBox => ProtoBoundingBox}

case class NamedBoundingBox(id: Int, name: Option[String], isVisible: Option[Boolean], boundingBox: BoundingBox)
    extends ProtoGeometryImplicits {
  def toProto = ProtoBoundingBox(id, name, isVisible, boundingBox)
}

object NamedBoundingBox { implicit val jsonFormat = Json.format[NamedBoundingBox] }
