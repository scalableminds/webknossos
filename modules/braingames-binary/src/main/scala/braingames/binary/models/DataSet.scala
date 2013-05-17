package braingames.binary.models

import braingames.geometry.Point3D
import play.api.libs.json.Reads
import play.api.libs.json.Json
import braingames.binary.models._

case class BareDataSet(name: String, maxCoordinates: Point3D, priority: Int = 0) {
  def addLayers(
    baseDir: String,
    colorLayer: ColorLayer,
    segmentationLayers: List[SegmentationLayer] = Nil,
    classificationLayer: Option[ClassificationLayer] = None) = {
    DataSet(name, baseDir, maxCoordinates, priority, colorLayer, segmentationLayers, classificationLayer)
  }

}

object BareDataSet extends Function3[String, Point3D, Int, BareDataSet] {

  implicit val BareDataSetReads: Reads[BareDataSet] = Json.reads[BareDataSet]
}

//TODO: basedir komplett rausziehen und in config definieren
case class DataSet(
    name: String,
    baseDir: String,
    maxCoordinates: Point3D,
    priority: Int = 0,
    colorLayer: ColorLayer,
    segmentationLayers: List[SegmentationLayer] = Nil,
    classificationLayer: Option[ClassificationLayer] = None) {

  val dataLayers = ((colorLayer :: segmentationLayers)).groupBy(layer => layer.name).mapValues(list => list.head)

  /**
   * Checks if a point is inside the whole data set boundary.
   */
  def doesContain(point: Point3D) =
    point.x >= 0 && point.y >= 0 && point.z >= 0 && // lower bound
      !(point hasGreaterCoordinateAs maxCoordinates)
}