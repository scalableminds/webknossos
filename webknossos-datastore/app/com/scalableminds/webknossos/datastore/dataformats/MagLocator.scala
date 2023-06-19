package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.models.datasource.ResolutionFormatHelper
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, LegacyDataVaultCredential}
import play.api.libs.json.{Json, OFormat}

import java.net.URI

case class MagLocator(mag: Vec3Int,
                      path: Option[String],
                      credentials: Option[LegacyDataVaultCredential],
                      axisOrder: Option[AxisOrder],
                      channelIndex: Option[Int],
                      credentialId: Option[String]) {

  lazy val pathWithFallback: String = path.getOrElse(mag.toMagLiteral(allowScalar = true))
  lazy val uri: URI = new URI(pathWithFallback)
  lazy val isRemote: Boolean = DataVaultService.isSupportedRemoteScheme(uri.getScheme)
}

object MagLocator extends ResolutionFormatHelper {
  implicit val jsonFormat: OFormat[MagLocator] = Json.format[MagLocator]
}
