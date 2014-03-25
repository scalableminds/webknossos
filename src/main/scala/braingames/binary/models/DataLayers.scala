package braingames.binary.models

import play.api.libs.json._
import braingames.geometry.BoundingBox

trait DataLayerLike {
  val sections: List[DataLayerSectionLike]
  val elementClass: String
  val category: String

  val elementSize = elementClassToSize(elementClass)
  val bytesPerElement = elementSize / 8

  def isCompatibleWith(other: DataLayerLike) =
    this.bytesPerElement == other.bytesPerElement

  def elementClassToSize(elementClass: String): Int = elementClass match {
    case "uint8" => 8
    case "uint16" => 16
    case "uint24" => 24
    case "uint32" => 32
    case "uint64" => 64
    case _ => throw new IllegalArgumentException(s"illegal element class ($elementClass) for DataLayer")
  }
}

case class FallbackLayer(dataSourceName: String, layerName: String)

object FallbackLayer{
  implicit val fallbackLayerFormat = Json.format[FallbackLayer]
}

case class DataLayerType(category: String, interpolation: Interpolation, defaultElementClass: String = "uint8")

case class DataLayer(
  name: String,
  category: String,
  baseDir: String,
  flags: Option[List[String]],
  elementClass: String = "uint8",
  isWritable: Boolean = false,
  fallback: Option[FallbackLayer] = None,
  sections: List[DataLayerSection] = Nil,
  nextSegmentationId: Option[Int] = None
  ) extends DataLayerLike {

  def relativeBaseDir(binaryBase: String) = baseDir.replace(binaryBase, "")

  val interpolator = DataLayer.interpolationFromString(category)

  val resolutions = sections.flatMap(_.resolutions).distinct

  val maxCoordinates = BoundingBox.hull(sections.map(_.bboxBig))

  lazy val boundingBox = BoundingBox.combine(sections.map(_.bboxBig))
}

object DataLayer{

  import braingames.binary.Logger._

  val COLOR =
    DataLayerType("color", TrilerpInterpolation)
  val SEGMENTATION =
    DataLayerType("segmentation", NearestNeighborInterpolation, "uint16")
  val CLASSIFICATION =
    DataLayerType("classification", NearestNeighborInterpolation, "uint16")

  implicit val dataLayerFormat = Json.format[DataLayer]

  val supportedLayers = List(
    COLOR, SEGMENTATION, CLASSIFICATION
  )

  val defaultInterpolation = NearestNeighborInterpolation

  def interpolationFromString(layerCategory: String) = {
    supportedLayers
      .find(_.category == layerCategory)
      .map(_.interpolation)
      .getOrElse {
      logger.warn(s"Invalid interpolation string: '$layerCategory'. Using default interpolation '$defaultInterpolation'")
      defaultInterpolation
    }
  }
}

case class UserDataLayer(dataSourceName: String, dataLayer: DataLayer)

object UserDataLayer {
  implicit val userDataLayerFormat = Json.format[UserDataLayer]
}
