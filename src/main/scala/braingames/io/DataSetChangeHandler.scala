package braingames.io

import java.io.File
import braingames.geometry.{Scale, Point3D, Vector3D, BoundingBox}
import braingames.util.ExtendedTypes.ExtendedString
import braingames.util.JsonHelper._
import play.api.libs.json._
import braingames.util.ExtendedTypes
import braingames.binary.models._
import java.nio.file._
import braingames.binary.Cuboid

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

  def extractSections(base: File, dataSetPath: String): Iterable[DataLayerSection] = {
    val sectionSettingsMap = extractSectionSettings(base)
    sectionSettingsMap.map {
      case (path, settings) =>
        DataLayerSection(
          path.getAbsolutePath().replace(dataSetPath, ""),
          settings.sectionId.map(_.toString) getOrElse path.getName,
          settings.resolutions,
          BoundingBox.createFrom(settings.bbox))
    }
  }

  def extractSectionSettings(base: File): Map[File, DataLayerSectionSettings] = {
    val basePath = base.getAbsolutePath()

    def extract(path: File, depth: Int = 0): List[Option[(File, DataLayerSectionSettings)]] = {
      if (depth > maxRecursiveLayerDepth) {
        List()
      } else {
        DataLayerSectionSettings.fromFile(path).map(path -> _) ::
          listDirectories(path).toList.flatMap(d => extract(d, depth + 1))
      }
    }

    extract(base).flatten.toMap
  }

  def extractLayers(file: File, dataSetPath: String) = {
    for {
      layer <- listDirectories(file).toList
      settings <- DataLayerSettings.fromFile(layer)
    } yield {
      println("Found Layer: " + settings)
      val sections = extractSections(layer, dataSetPath).toList
      DataLayer(settings.typ, settings.flags, settings.`class`, settings.fallback, sections)
    }
  }

  def dataSetFromFile(folder: File): Option[DataSet] = {
    if (folder.isDirectory) {
      val dataSet: DataSet = DataSetSettings.readFromFolder(folder) match {
        case Some(settings) =>
          DataSet(
            settings.name,
            folder.getAbsolutePath(),
            settings.priority getOrElse 0,
            settings.scale,
            Nil,
            "/Structure of Neocortical Circuits Group",
            settings.allowedTeams getOrElse List("/Structure of Neocortical Circuits Group/*"))
        case _ =>
          DataSet(
            folder.getName,
            folder.getAbsolutePath,
            0,
            Scale.default,
            Nil,
            "/Structure of Neocortical Circuits Group",
            List("/Structure of Neocortical Circuits Group/*"))
      }

      val layers = extractLayers(folder, folder.getAbsolutePath())

      Some(dataSet.copy(dataLayers = layers))
    } else
      None
  }
}
