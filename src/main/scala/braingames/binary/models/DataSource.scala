package braingames.binary.models

import play.api.libs.json.Reads
import braingames.geometry.{Scale, Point3D}
import braingames.geometry.Scale._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import braingames.binary.models._
import java.io.File

case class DataSourceSettings(
  name: String,
  scale: Scale,
  priority: Option[Int])

case class DataSource(
  name: String,
  baseDir: String,
  priority: Int = 0,
  scale: Scale,
  dataLayers: List[DataLayer] = Nil,
  owningTeam: String
  ) {

  def dataLayer(typ: String) =
    dataLayers.find(_.typ == typ)

  def relativeBaseDir(binaryBase: String) = baseDir.replace(binaryBase, "")

  val blockLength = 128

  val blockSize = blockLength * blockLength * blockLength

  def pointToBlock(point: Point3D, resolution: Int) =
    Point3D(
      point.x / blockLength / resolution,
      point.y / blockLength / resolution,
      point.z / blockLength / resolution)

  def applyResolution(point: Point3D, resolution: Int) =
    Point3D(
      point.x / resolution,
      point.y / resolution,
      point.z / resolution)

  override def toString() = {
    s"""$name (${dataLayers.map(_.typ).mkString(", ")}})"""
  }
}

object DataSource{
  implicit val dataSourceFormat = Json.format[DataSource]
}

object DataSourceSettings extends SettingsFile{

  val settingsFileName = "settings.json"

  implicit val dataSourceSettingsFormat = Json.format[DataSourceSettings]

  def settingsFileFromFolder(f: File) = {
    new File(f.getPath + "/" + settingsFileName)
  }

  def readFromFolder(folder: File): Option[DataSourceSettings] = {
    extractSettingsFromFile(
      settingsFileFromFolder(folder),
      dataSourceSettingsFormat)
  }

  def fromDataSource(dataSource: DataSource) = DataSourceSettings(
    dataSource.name,
    dataSource.scale,
    Some(dataSource.priority)
  )

  def writeToFolder(dataSource: DataSource, folder: File) = {
    val settings = fromDataSource(dataSource)
    writeSettingsToFile(settings, settingsFileFromFolder(folder))
  }
}