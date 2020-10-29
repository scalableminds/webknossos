package com.scalableminds.webknossos.datastore.dataformats.knossos

import com.scalableminds.webknossos.datastore.models.CubePosition
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import play.api.libs.json._

case class KnossosSection(name: String, resolutions: List[Either[Int, Point3D]], boundingBox: BoundingBox) {

  def doesContainCube(cube: CubePosition): Boolean =
    boundingBox.intersects(cube.toHighestResBoundingBox)
}

object KnossosSection extends ResolutionFormatHelper {
  implicit val jsonFormat = Json.format[KnossosSection]
}

trait KnossosLayer extends DataLayer {

  val dataFormat = DataFormat.knossos

  def sections: List[KnossosSection]

  lazy val boundingBox = BoundingBox.combine(sections.map(_.boundingBox))

  lazy val resolutions: List[Point3D] = sections
    .map(_.resolutions)
    .reduce(_ union _)
    .map {
      case Left(r)  => Point3D(r, r, r)
      case Right(r) => r
    }
    .toSet
    .toList

  def lengthOfUnderlyingCubes(resolution: Point3D) = KnossosDataFormat.cubeLength

  lazy val bucketProvider = new KnossosBucketProvider(this)
}

case class KnossosDataLayer(
    name: String,
    category: Category.Value,
    sections: List[KnossosSection],
    elementClass: ElementClass.Value,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends KnossosLayer

object KnossosDataLayer {
  implicit val knossosDataLayerFormat = Json.format[KnossosDataLayer]
}

case class KnossosSegmentationLayer(
    name: String,
    sections: List[KnossosSection],
    elementClass: ElementClass.Value,
    mappings: Option[Set[String]],
    largestSegmentId: Long,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends SegmentationLayer
    with KnossosLayer

object KnossosSegmentationLayer {
  implicit val knossosSegmentationLayerFormat = Json.format[KnossosSegmentationLayer]
}
