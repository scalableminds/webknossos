package com.scalableminds.braingames.datastore.tracings.skeleton

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import play.api.libs.json.Json

/**
  * Created by f on 25.07.17.
  */

case class TracingSelector(tracingId: String, version: Option[Long] = None)

object TracingSelector {implicit val jsonFormat = Json.format[TracingSelector]}
