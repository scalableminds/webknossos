package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{DataFormat, _}
import play.api.libs.json.{Json, OFormat}

case class WKWResolution(resolution: Either[Int, Point3D], cubeLength: Int) {
  def resolutionAsPoint3D: Point3D = resolution match {
    case Left(r) =>
      Point3D(r, r, r)
    case Right(r) =>
      r
  }
}

object WKWResolution extends ResolutionFormatHelper {
  implicit val jsonFormat: OFormat[WKWResolution] = Json.format[WKWResolution]
}

trait WKWLayer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.wkw

  lazy val bucketProvider = new WKWBucketProvider(this)

  def wkwResolutions: List[WKWResolution]

  def resolutions: List[Point3D] = wkwResolutions.map(_.resolutionAsPoint3D)

  def lengthOfUnderlyingCubes(resolution: Point3D): Int =
    wkwResolutions.find(_.resolutionAsPoint3D == resolution).map(_.cubeLength).getOrElse(0)

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
    largestSegmentId: Long,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends SegmentationLayer
    with WKWLayer

object WKWSegmentationLayer {
  implicit val jsonFormat: OFormat[WKWSegmentationLayer] = Json.format[WKWSegmentationLayer]
}
