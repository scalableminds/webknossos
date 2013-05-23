package braingames.binary.models

import braingames.geometry.Point3D
import braingames.geometry.Vector3D
import braingames.util.Interpolator
import play.api.libs.json._
import play.api.libs.functional.syntax._
import braingames.binary.models._
import braingames.geometry.BoundingBox

case class DataLayerSectionSettings(
  sectionId: Option[Int],
  bbox: List[List[Int]],
  resolutions: List[Int])

object DataLayerSection {
  val dataLayerSectionSettingsReads = Json.reads[DataLayerSectionSettings]
}

case class DataLayerSection(
  baseDir: String,
  sectionId: Option[String],
  resolutions: List[Int],
  hull: BoundingBox) extends DataLayerSectionLike

trait DataLayerSectionLike {
  val hull: BoundingBox
  val baseDir: String
  val sectionId: Option[String]

  /**
   * Checks if a point is inside the whole data set boundary.
   */
  def doesContainBlock(point: Point3D, blockLength: Int) =
    hull.contains(point.scale((v, _) => v * blockLength))
}

trait DataLayerLike {
  val sections: List[DataLayerSectionLike]
  val elementClass: String
  val typ: String

  val elementSize = elementClassToSize(elementClass)
  val bytesPerElement = elementSize / 8

  def isCompatibleWith(other: DataLayerLike) =
    this.bytesPerElement == other.bytesPerElement

  def elementClassToSize(elementClass: String): Int = elementClass match {
    case "uint8"  => 8
    case "uint16" => 16
    case "uint32" => 32
    case "uint64" => 64
    case _        => throw new IllegalArgumentException(s"illegal element class ($elementClass) for DataLayer")
  }
}

case class DataLayerId(typ: String, section: Option[String] = None)

case class DataLayerSettings(
  typ: String,
  `class`: String,
  flags: Option[List[String]])

case class DataLayer(
    typ: String,
    flags: Option[List[String]],
    elementClass: String = "uint8",
    sections: List[DataLayerSection] = Nil) extends DataLayerLike {
  
  val interpolator = DataLayer.interpolationFromString(typ)

  val resolutions = sections.map(_.resolutions).distinct
  
  val maxCoordinates = BoundingBox.hull(sections.map(_.hull))
}

object DataLayer {

  val dataLayerSettingsReads = Json.reads[DataLayerSettings]

  val defaultInterpolation = NearestNeighborInterpolation

  def interpolationFromString(interpolationTyp: String) = {
    interpolationTyp match {
      case "color" =>
        TrilerpInterpolation
      case "segmentation" | "classification" =>
        NearestNeighborInterpolation
      case s =>
        System.err.println(s"Invalid interpolation string: $s. Using default interpolation")
        defaultInterpolation
    }
  }
}
