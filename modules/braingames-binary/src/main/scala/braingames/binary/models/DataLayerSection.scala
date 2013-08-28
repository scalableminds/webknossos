package braingames.binary.models

import play.api.libs.json.Json
import java.io.File
import braingames.geometry.{Point3D, BoundingBox}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 17:48
 */

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

object DataLayerSection extends Function4[String, Option[String], List[Int], BoundingBox, DataLayerSection]{
  implicit val dataLayerSectionFormat = Json.format[DataLayerSection]
}