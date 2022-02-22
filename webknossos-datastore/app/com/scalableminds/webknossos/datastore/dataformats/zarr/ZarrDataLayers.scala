package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.zarr.FileSystemType.FileSystemType
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import play.api.libs.json.{Json, OFormat}

case class FileSystemCredentials(username: String, password: String)

object FileSystemCredentials {
  implicit val jsonFormat: OFormat[FileSystemCredentials] = Json.format[FileSystemCredentials]
}

case class FileSystemSelector(typ: FileSystemType, uri: Option[String], credentials: Option[FileSystemCredentials])

object FileSystemSelector {
  implicit val jsonFormat: OFormat[FileSystemSelector] = Json.format[FileSystemSelector]
}

trait ZarrLayer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.zarr

  lazy val bucketProvider = new ZarrBucketProvider(this)

  def resolutions: List[Vec3Int] = List(Vec3Int(1, 1, 1))

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = 1024

  val fileSystemSelector: FileSystemSelector

  val remotePath: Option[String]

}

case class ZarrDataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    fileSystemSelector: FileSystemSelector,
    remotePath: Option[String],
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
    largestSegmentId: Long,
    mappings: Option[Set[String]],
    fileSystemSelector: FileSystemSelector,
    remotePath: Option[String],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends SegmentationLayer
    with ZarrLayer

object ZarrSegmentationLayer {
  implicit val jsonFormat: OFormat[ZarrSegmentationLayer] = Json.format[ZarrSegmentationLayer]
}
