package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.dataformats.zarr.{FileSystemCredentials, RemoteSourceDescriptor}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.models.datasource.ResolutionFormatHelper
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import play.api.libs.json.{Json, OFormat}

import java.net.URI

case class MagLocator(mag: Vec3Int,
                      path: Option[String],
                      credentials: Option[FileSystemCredentials],
                      axisOrder: Option[AxisOrder],
                      channelIndex: Option[Int]) {

  lazy val pathWithFallback: String = path.getOrElse(mag.toMagLiteral(allowScalar = true))
  private lazy val uri: URI = new URI(pathWithFallback)
  lazy val isRemote: Boolean = FileSystemsHolder.isSupportedRemoteScheme(uri.getScheme)
  lazy val remoteSource: Option[RemoteSourceDescriptor] =
    if (isRemote)
      Some(RemoteSourceDescriptor(uri, credentials.map(_.user), credentials.flatMap(_.password)))
    else
      None

}

object MagLocator extends ResolutionFormatHelper {
  implicit val jsonFormat: OFormat[MagLocator] = Json.format[MagLocator]
}
