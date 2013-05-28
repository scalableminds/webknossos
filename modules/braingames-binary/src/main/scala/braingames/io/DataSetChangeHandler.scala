package braingames.io

import java.io.File
import braingames.geometry.Point3D
import braingames.util.ExtendedTypes.ExtendedString
import braingames.util.JsonHelper._
import play.api.libs.json._
import braingames.util.ExtendedTypes
import braingames.binary.models._
import java.nio.file._
import braingames.binary.Cuboid
import braingames.geometry.Vector3D
import braingames.geometry.BoundingBox

case class ImplicitLayerInfo(name: String, resolutions: List[Int])
case class ExplicitLayerInfo(name: String, dataType: String)

class DataSetChangeHandler(dataSetRepository: DataSetRepository)
    extends DirectoryChangeHandler {

  val maxRecursiveLayerDepth = 2

  def onStart(path: Path, recursive: Boolean) {
    val file = path.toFile()
    val files = file.listFiles()
    if (files != null) {
      val foundDataSets = files.filter(_.isDirectory).flatMap { f =>
        dataSetFromFile(f).map { dataSet =>
          dataSetRepository.updateOrCreate(dataSet)
          dataSet.name
        }
      }
      println(s"Found datasets: ${foundDataSets.mkString(",")}")
      dataSetRepository.deleteAllExcept(foundDataSets)
    }
  }

  def onTick(path: Path, recursive: Boolean) {
    onStart(path, recursive)
  }

  def onCreate(path: Path) {
    val file = path.toFile()
    dataSetFromFile(file).map { dataSet =>
      dataSetRepository.updateOrCreate(dataSet)
    }
  }

  def onDelete(path: Path) {
    val file = path.toFile()
    dataSetFromFile(file).map { dataSet =>
      dataSetRepository.removeByName(dataSet.name)
    }
  }

  def listFiles(f: File): Array[File] = {
    val r = f.listFiles()
    if (r == null)
      Array()
    else
      r
  }

  def listDirectories(f: File) = {
    f.listFiles().filter(_.isDirectory())
  }

  def highestResolutionDir(l: Array[File]) = {
    if (l.isEmpty)
      None
    else
      Some(l.minBy(f => f.getName.toIntOpt.getOrElse(Int.MaxValue)))
  }

  def maxValueFromFiles(l: Array[File]): Option[Int] = {
    val numbers = l.flatMap { f =>
      if (f.getName.size > 1)
        f.getName.substring(1).toIntOpt
      else
        None
    }
    if (numbers.isEmpty)
      None
    else {
      Some(numbers.max)
    }
  }

  def extractSettingsFromFile[T](file: File, settingsReads: Reads[T]): Option[T] = {
    if (file.isFile) {
      JsonFromFile(file)
        .validate(settingsReads)
        .asOpt
    } else None
  }

  def layerSectionSettingsFromFile(f: File): Option[DataLayerSectionSettings] = {
    extractSettingsFromFile(
      new File(f.getPath + "/section.json"),
      DataLayerSection.dataLayerSectionSettingsReads)
  }

  def dataSetSettingsFromFile(f: File): Option[DataSetSettings] = {
    extractSettingsFromFile(
      new File(f.getPath + "/settings.json"),
      DataSet.dataSetSettingsReads)
  }

  def layerSettingsFromFile(f: File): Option[DataLayerSettings] = {
    extractSettingsFromFile(
      new File(f.getPath + "/layer.json"),
      DataLayer.dataLayerSettingsReads)
  }

  def extractSections(base: File, dataSetPath: String): Iterable[DataLayerSection] = {
    val sectionSettingsMap = extractSectionSettings(base)
    sectionSettingsMap.map {
      case (path, settings) =>
        DataLayerSection(
          path.replace(dataSetPath, ""),
          settings.sectionId.map(_.toString),
          settings.resolutions,
          BoundingBox.createFrom(settings.bbox))
    }
  }

  def extractSectionSettings(base: File): Map[String, DataLayerSectionSettings] = {
    val basePath = base.getAbsolutePath()

    def extract(path: File, depth: Int = 0): List[Option[(String, DataLayerSectionSettings)]] = {
      if (depth > maxRecursiveLayerDepth) {
        List()
      } else {
        layerSectionSettingsFromFile(path).map(path.getAbsolutePath() -> _) ::
          listDirectories(path).toList.flatMap(d => extract(d, depth + 1))
      }
    }

    extract(base).flatten.toMap
  }

  def extractLayers(file: File, dataSetPath: String) = {
    for {
      layer <- listDirectories(file).toList
      settings <- layerSettingsFromFile(layer)
    } yield {
      println("Found Layer: " + settings)
      val sections = extractSections(layer, dataSetPath).toList
      DataLayer(settings.typ, settings.flags, settings.`class`, sections)
    }
  }

  def dataSetFromFile(file: File): Option[DataSet] = {
    if (file.isDirectory) {
      val dataSet: DataSet = dataSetSettingsFromFile(file) match {
        case Some(settings) =>
          DataSet(
            settings.name,
            file.getAbsolutePath(),
            settings.priority getOrElse 0,
            settings.fallback)
        case _ =>
          DataSet(file.getName, file.getAbsolutePath)
      }

      val layers = extractLayers(file, file.getAbsolutePath())

      Some(dataSet.copy(dataLayers = layers))
    } else
      None
  }
}
