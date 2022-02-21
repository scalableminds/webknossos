package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{
  Category,
  DataFormat,
  DataLayer,
  ElementClass,
  SegmentationLayer
}
import play.api.libs.json.{Json, OFormat}

trait ZarrLayer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.zarr

  lazy val bucketProvider = new ZarrBucketProvider(this)

  def resolutions: List[Vec3Int] = List(Vec3Int(1, 1, 1))

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = 1024

}

case class ZarrDataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
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
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends SegmentationLayer
    with ZarrLayer

object ZarrSegmentationLayer {
  implicit val jsonFormat: OFormat[ZarrSegmentationLayer] = Json.format[ZarrSegmentationLayer]
}
