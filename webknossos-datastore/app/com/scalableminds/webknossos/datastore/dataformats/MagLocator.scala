package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.models.datasource.MagFormatHelper
import com.scalableminds.webknossos.datastore.storage.LegacyDataVaultCredential
import play.api.libs.json.{Json, OFormat}

case class MagLocator(mag: Vec3Int,
                      path: Option[String] = None,
                      credentials: Option[LegacyDataVaultCredential] = None,
                      axisOrder: Option[AxisOrder] = None,
                      channelIndex: Option[Int] = None,
                      credentialId: Option[String] = None)

object MagLocator extends MagFormatHelper {
  implicit val jsonFormat: OFormat[MagLocator] = Json.format[MagLocator]
}
