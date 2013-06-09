package braingames.binary.models

import play.api.libs.json.Reads
import braingames.geometry.{Scale, Point3D}
import braingames.geometry.Scale._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import braingames.binary.models._
import java.io.File

case class DataSetSettings(
  name: String,
  scale: Scale,
  priority: Option[Int],
  fallback: Option[String])

case class DataSet(
  name: String,
  baseDir: String,
  priority: Int = 0,
  scale: Scale,
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

object DataSetSettings extends SettingsFile {

  val settingsFileName = "settings.json"

  implicit val dataSetSettingsFormat = Json.format[DataSetSettings]

  def settingsFileFromFolder(f: File)  = {
    new File(f.getPath + "/" + settingsFileName)
  }

  def readFromFolder(folder: File): Option[DataSetSettings] = {
    extractSettingsFromFile(
      settingsFileFromFolder(folder),
      dataSetSettingsFormat)
  }

  def fromDataSet(dataSet: DataSet) = DataSetSettings(
    dataSet.name,
    dataSet.scale,
    Some(dataSet.priority),
    dataSet.fallback
  )

  def writeToFolder(dataSet: DataSet, folder: File) = {
    val settings = fromDataSet(dataSet)
    writeSettingsToFile(settings, settingsFileFromFolder(folder))
  }
}