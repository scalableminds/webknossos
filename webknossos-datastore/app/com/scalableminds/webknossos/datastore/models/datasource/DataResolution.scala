package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.geometry.Point3D
import play.api.libs.json.Json

case class DataResolution(resolution: Int, scale: Point3D)

object DataResolution {
  implicit val jsonFormat = Json.format[DataResolution]

  def fromResolution(resolution: Int) = DataResolution(resolution, Point3D(resolution, resolution, resolution))
}
