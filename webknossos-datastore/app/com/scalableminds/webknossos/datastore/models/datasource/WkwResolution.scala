package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.AutoJsonFormat
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.helpers.UPath

case class WkwResolution(
    resolution: Vec3Int,
    cubeLength: Option[Int] = None,
    path: Option[UPath] = None,
    credentialId: Option[String] = None
) derives AutoJsonFormat {
  def toMagLocator: MagLocator =
    MagLocator(mag = resolution, path = path, credentialId = credentialId)

}
object WkwResolution extends MagFormatHelper
