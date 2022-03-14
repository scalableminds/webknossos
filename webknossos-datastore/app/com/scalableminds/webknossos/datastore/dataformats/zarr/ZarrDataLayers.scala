package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.net.URI

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.FileSystemHolder
import play.api.libs.json.{Json, OFormat}

case class FileSystemCredentials(user: String, password: Option[String])

object FileSystemCredentials {
  implicit val jsonFormat: OFormat[FileSystemCredentials] = Json.format[FileSystemCredentials]
}

case class RemoteSourceDescriptor(uri: URI, user: Option[String], password: Option[String])  {
  lazy val remotePath: String = uri.getPath
}

case class ZarrResolution(resolution: Vec3Int, path: Option[String], credentials: Option[FileSystemCredentials]) {

  lazy val pathWithFallback: String = path.getOrElse(s"${resolution.x}-${resolution.y}-${resolution.z}")
  private lazy val uri: URI = new URI(pathWithFallback)
  private lazy val isRemote: Boolean = FileSystemHolder.isSupportedRemoteScheme(uri.getScheme)
  lazy val remoteSource: Option[RemoteSourceDescriptor] =
    if (isRemote)
      Some(RemoteSourceDescriptor(uri, credentials.map(_.user), credentials.flatMap(_.password)))
    else
      None

}

object ZarrResolution {
  implicit val jsonFormat: OFormat[ZarrResolution] = Json.format[ZarrResolution]
}

trait ZarrLayer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.zarr

  lazy val bucketProvider = new ZarrBucketProvider(this)

  def resolutions: List[Vec3Int] = List(Vec3Int(1, 1, 1))

  def zarrResolutions: List[ZarrResolution]

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = Int.MaxValue // Prevents the wkw-shard-specific handle caching

}

case class ZarrDataLayer(
                          name: String,
                          category: Category.Value,
                          boundingBox: BoundingBox,
                          elementClass: ElementClass.Value,
                          zarrResolutions: List[ZarrResolution],
                          defaultViewConfiguration: Option[LayerViewConfiguration] = None,
                          adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends ZarrLayer

object ZarrDataLayer {
  implicit val jsonFormat: OFormat[ZarrDataLayer] = Json.format[ZarrDataLayer]
}

case class ZarrSegmentationLayer(
                                  name: String,
                                  boundingBox: BoundingBox,
                                  elementClass: ElementClass.Value,
                                  zarrResolutions: List[ZarrResolution],
                                  largestSegmentId: Long,
                                  mappings: Option[Set[String]],
                                  defaultViewConfiguration: Option[LayerViewConfiguration] = None,
                                  adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends SegmentationLayer
    with ZarrLayer

object ZarrSegmentationLayer {
  implicit val jsonFormat: OFormat[ZarrSegmentationLayer] = Json.format[ZarrSegmentationLayer]
}
