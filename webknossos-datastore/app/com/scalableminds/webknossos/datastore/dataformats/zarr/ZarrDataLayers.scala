package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.net.URI

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import play.api.libs.json.{Json, OFormat}

case class FileSystemCredentials(user: String, password: String)

object FileSystemCredentials {
  implicit val jsonFormat: OFormat[FileSystemCredentials] = Json.format[FileSystemCredentials]
}

/*case class RemoteSourceDescriptor(uri: String, user: Option[String], password: Option[String]) {}

object RemoteSourceDescriptor {
  implicit val jsonFormat: OFormat[RemoteSourceDescriptor] = Json.format[RemoteSourceDescriptor]
}*/

case class ZarrResolution(resolution: Vec3Int, path: Option[String], credentials: Option[FileSystemCredentials]) {

  lazy val isRemote = false
  // TODO: check if path is remote
  lazy val remotePath: Option[String] = path.map(p => new URI(p).getPath)
}

trait ZarrLayer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.zarr

  lazy val bucketProvider = new ZarrBucketProvider(this)

  def resolutionsVec3Int: List[Vec3Int] = List(Vec3Int(1, 1, 1))

  def resolutions: List[ZarrResolution]

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = 1024

}

case class ZarrDataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    resolutions: List[ZarrResolution],
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
    resolutions: List[ZarrResolution],
    largestSegmentId: Long,
    mappings: Option[Set[String]],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends SegmentationLayer
    with ZarrLayer

object ZarrSegmentationLayer {
  implicit val jsonFormat: OFormat[ZarrSegmentationLayer] = Json.format[ZarrSegmentationLayer]
}
