package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.models.datasource.ResolutionFormatHelper
import com.scalableminds.webknossos.datastore.storage.LegacyDataVaultCredential
import play.api.libs.json.{Json, OFormat}

case class MagLocator(mag: Vec3Int,
                      path: Option[String],
                      credentials: Option[LegacyDataVaultCredential],
                      axisOrder: Option[AxisOrder],
                      channelIndex: Option[Int],
                      credentialId: Option[String])

object MagLocator extends ResolutionFormatHelper {
  implicit val jsonFormat: OFormat[MagLocator] = Json.format[MagLocator]
}
