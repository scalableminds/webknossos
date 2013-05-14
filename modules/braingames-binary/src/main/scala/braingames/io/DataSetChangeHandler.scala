package braingames.io

import java.io.File
import braingames.geometry.Point3D
import braingames.util.ExtendedTypes.ExtendedString
import braingames.util.JsonHelper._
import play.api.libs.json._
import braingames.util.ExtendedTypes
import braingames.binary.models._
import java.nio.file._

case class ImplicitLayerInfo(name: String, resolutions: List[Int])
case class ExplicitLayerInfo(name: String, dataType: String)

trait LayerFormats {
  implicit val colorLayerReads: Reads[ColorLayerLike]
  implicit val segmentationLayerReads: Reads[SegmentationLayerLike]
  implicit val ctxFreeSegmentationLayerReads: Reads[ContextFreeSegmentationLayerLike]
  implicit val bareDataSetReads: Reads[BareDataSetLike]
}

trait DataSetChangeHandler
    extends DirectoryChangeHandler
    with DataSetRepository
    with LayerFormats
    with DataSetFactoryLike
    with ColorLayerFactoryLike {

  def onStart(path: Path) {
    val file = path.toFile()
    val files = file.listFiles()
    if (files != null) {
      val foundDataSets = files.filter(_.isDirectory).flatMap { f =>
        dataSetFromFile(f).map { dataSet =>
          updateOrCreateDataSet(dataSet)
          dataSet.name
        }
      }
      println(s"Found datasets: ${foundDataSets.mkString(",")}")
      deleteAllDataSetsExcept(foundDataSets)
    }
  }

  def onTick(path: Path) {
    onStart(path)
  }

  def onCreate(path: Path) {
    val file = path.toFile()
    dataSetFromFile(file).map { dataSet =>
      updateOrCreateDataSet(dataSet)
    }
  }

  def onDelete(path: Path) {
    val file = path.toFile()
    dataSetFromFile(file).map { dataSet =>
      removeDataSetByName(dataSet.name)
    }
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

  def getColorLayer(f: File): Option[ColorLayerLike] = {
    val colorLayerInfo = new File(f.getPath + "/color/layer.json")
    if (colorLayerInfo.isFile) {
      JsonFromFile(colorLayerInfo).validate[ColorLayerLike] match {
        case JsSuccess(colorLayer, _) => Some(colorLayer)
        case JsError(error) =>
          System.err.println(error.toString)
          None
      }
    } else None
  }

  def segmentationLayerFromFile(layerInfo: File) = {
    JsonFromFile(layerInfo).validate[ContextFreeSegmentationLayerLike] match {
      case JsSuccess(cfSegmentationLayer, _) =>
        val parentDir = layerInfo.getParentFile
        println(s"found segmentation layer: ${parentDir.getName}")
        val batchId = parentDir.getName.replaceFirst("layer", "").toIntOpt
        Some(cfSegmentationLayer.addContext(batchId getOrElse 0))
      case JsError(error) =>
        System.err.println(error.toString)
        None
    }
  }

  def getSegmentationLayers(f: File): List[SegmentationLayerLike] = {
    val segmentationsDir = new File(f.getPath + "/segmentation")
    if (segmentationsDir.isDirectory) {
      for {
        layerDir <- segmentationsDir.listFiles.toList.filter(d => d.isDirectory && d.getName.startsWith("layer"))
        layerInfoFile = new File(layerDir.getPath + "/layer.json")
        if layerInfoFile.isFile
        segmentationLayer <- segmentationLayerFromFile(layerInfoFile)
      } yield {
        segmentationLayer
      }
    } else
      Nil
  }

  def dataSetFromFile(f: File): Option[DataSetLike] = {
    if (f.isDirectory) {
      val dataSetInfo = new File(f.getPath + "/settings.json")
      if (dataSetInfo.isFile) {
        JsonFromFile(dataSetInfo).validate[BareDataSetLike] match {
          case JsSuccess(bareDataSet, _) =>
            getColorLayer(f).map { colorLayer =>
              bareDataSet
                .addLayers(f.getAbsolutePath, colorLayer, getSegmentationLayers(f))
            }
          case JsError(error) =>
            System.err.println(error.toString)
            None
        }
      } else {
        for {
          layer <- listDirectories(f).find(dir => dir.getName == "color")
          resolutionDirectories = listDirectories(layer)
          resolutions = resolutionDirectories.flatMap(_.getName.toIntOpt).toList
          res <- highestResolutionDir(resolutionDirectories)
          xs <- listDirectories(res).headOption
          ys <- listDirectories(xs).headOption
          xMax <- maxValueFromFiles(res.listFiles())
          yMax <- maxValueFromFiles(xs.listFiles())
          zMax <- maxValueFromFiles(ys.listFiles())
        } yield {
          val maxCoordinates = Point3D((xMax + 1) * 128, (yMax + 1) * 128, (zMax + 1) * 128)
          createDataSet(f.getName(), f.getAbsolutePath(), maxCoordinates, colorLayer = createColorLayer(supportedResolutions = resolutions))
        }
      }
    } else None
  }
}
