package braingames.binary.models

import braingames.geometry.Point3D
import play.api.libs.json.Reads
import play.api.libs.json._
import play.api.libs.functional.syntax._
import braingames.binary.models._

case class DataSetSettings(
  name: String,
  priority: Option[Int],
  fallback: Option[String])

case class DataSet(
    name: String,
    baseDir: String,
    priority: Int = 0,
    fallback: Option[String] = None,
    dataLayers: List[DataLayer] = Nil) {

  def dataLayer(typ: String) =
    dataLayers.find(_.typ == typ)

  val blockLength = 128

  val blockSize = blockLength * blockLength * blockLength

  def pointToBlock(point: Point3D, resolution: Int) =
    Point3D(
      point.x / blockLength / resolution,
      point.y / blockLength / resolution,
      point.z / blockLength / resolution)

  def globalToLocal(point: Point3D, resolution: Int) =
    Point3D(
      (point.x / resolution) % blockLength,
      (point.y / resolution) % blockLength,
      (point.z / resolution) % blockLength)
}

object DataSet {
  val dataSetSettingsReads = Json.reads[DataSetSettings]
}