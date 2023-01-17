package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{DataFormat, _}
import com.scalableminds.webknossos.datastore.storage.FileSystemService
import play.api.libs.json.{Json, OFormat}

case class WKWResolution(resolution: Vec3Int, cubeLength: Int)

object WKWResolution extends ResolutionFormatHelper {
  implicit val jsonFormat: OFormat[WKWResolution] = Json.format[WKWResolution]
}

trait WKWLayer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.wkw

  override def bucketProvider(fileSystemServiceOpt: Option[FileSystemService]): BucketProvider =
    new WKWBucketProvider(this)

  def wkwResolutions: List[WKWResolution]

  def resolutions: List[Vec3Int] = wkwResolutions.map(_.resolution)

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int =
    wkwResolutions.find(_.resolution == resolution).map(_.cubeLength).getOrElse(0)

}

case class WKWDataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    wkwResolutions: List[WKWResolution],
    elementClass: ElementClass.Value,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends WKWLayer

object WKWDataLayer {
  implicit val jsonFormat: OFormat[WKWDataLayer] = Json.format[WKWDataLayer]
}

case class WKWSegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    wkwResolutions: List[WKWResolution],
    elementClass: ElementClass.Value,
    mappings: Option[Set[String]],
    largestSegmentId: Option[Long] = None,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends SegmentationLayer
    with WKWLayer

object WKWSegmentationLayer {
  implicit val jsonFormat: OFormat[WKWSegmentationLayer] = Json.format[WKWSegmentationLayer]
}
