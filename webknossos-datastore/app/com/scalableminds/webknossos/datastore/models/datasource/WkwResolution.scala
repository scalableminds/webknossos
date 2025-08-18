package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import play.api.libs.json.{Json, OFormat}

case class WkwResolution(resolution: Vec3Int,
                         cubeLength: Option[Int] = None,
                         path: Option[String] = None,
                         credentialId: Option[String] = None) {
  def toMagLocator: MagLocator =
    MagLocator(mag = resolution, path = path, credentialId = credentialId)

}
object WkwResolution extends MagFormatHelper {
  implicit val jsonFormat: OFormat[WkwResolution] = Json.format[WkwResolution]
}
