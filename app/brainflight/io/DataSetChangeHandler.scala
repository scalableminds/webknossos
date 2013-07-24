package brainflight.io

import java.io.File
import name.pachler.nio.file.Path
import name.pachler.nio.file.impl.PathImpl
import brainflight.tools.geometry.Point3D
import play.api.Logger
import braingames.util.ExtendedTypes.ExtendedString
import net.liftweb.common._
import braingames.util.JsonHelper._
import play.api.libs.json._
import models.binary._
import braingames.util.ExtendedTypes

case class ImplicitLayerInfo(name: String, resolutions: List[Int])
case class ExplicitLayerInfo(name: String, dataType: String)

class MongoDataSetChangeHandler extends DataSetChangeHandler {
  def deleteAllDataSetsExcept(l: Array[String]) = {
    DataSet.deleteAllExcept(l)
  }

  def updateOrCreateDataSet(d: DataSet) = {
    DataSet.updateOrCreate(d)
  }
  
  def removeDataSetByName(name: String) = {
    DataSet.removeByName(name)
  }
}

trait DataSetDAOLike {
  def deleteAllDataSetsExcept(l: Array[String])
  def updateOrCreateDataSet(d: DataSet)
  def removeDataSetByName(name: String)
}

trait DataSetChangeHandler extends DirectoryChangeHandler with DataSetDAOLike {
  def onStart(path: Path) {
    val file = path.asInstanceOf[PathImpl].getFile
    val files = file.listFiles()
    Logger.trace(s"DataSetChangeHandler.onStart: files: ${files.mkString(", ")}")
    if (files != null) {
      val foundDataSets = files.filter(_.isDirectory).flatMap { f =>
        dataSetFromFile(f).map { dataSet =>
          updateOrCreateDataSet(dataSet)
          dataSet.name
        }
      }
      Logger.info(s"Found datasets: ${foundDataSets.mkString(",")}")
      deleteAllDataSetsExcept(foundDataSets)
    }
  }

  def onTick(path: Path) {
    onStart(path)
  }

  def onCreate(path: Path) {
    val file = path.asInstanceOf[PathImpl].getFile
    dataSetFromFile(file).map { dataSet =>
      updateOrCreateDataSet(dataSet)
    }
  }

  def onDelete(path: Path) {
    val file = path.asInstanceOf[PathImpl].getFile
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
  
  def createColorLayerFromFileStructure(f: File): Option[ColorLayer] = {
    for{
      layer <- listDirectories(f).find(dir => dir.getName == "color")
      resolutionDirectories = listDirectories(layer)
      resolutions = resolutionDirectories.flatMap(_.getName.toIntOpt).toList
    } yield ColorLayer(supportedResolutions = resolutions)
  }
  
  def createDataSetFromFileStructure(f: File): Option[DataSet] = {
    for {
      colorLayer <- createColorLayerFromFileStructure(f)
      colorLayerDir <- listDirectories(f).find(dir => dir.getName == "color")
      resolutionDirectories = listDirectories(colorLayerDir)
      res <- highestResolutionDir(resolutionDirectories)
      xs <- listDirectories(res).headOption
      ys <- listDirectories(xs).headOption
      xMax <- maxValueFromFiles(res.listFiles())
      yMax <- maxValueFromFiles(xs.listFiles())
      zMax <- maxValueFromFiles(ys.listFiles())
    } yield {
      val maxCoordinates = Point3D((xMax + 1) * 128, (yMax + 1) * 128, (zMax + 1) * 128)
      DataSet(f.getName(), f.getAbsolutePath(), maxCoordinates, colorLayer = colorLayer)
    }
  }
  
  def readColorLayerJson(f: File): Option[ColorLayer] = {
    val colorLayerInfo = new File(f.getPath + "/color/layer.json")
    if(colorLayerInfo.isFile) {
      JsonFromFile(colorLayerInfo).validate[ColorLayer] match {
        case JsSuccess(colorLayer, _) => Some(colorLayer)
        case JsError(error) =>
          Logger.error(error.toString)
          Logger.info("Falling back to reading colorlayer from file structure!")
          createColorLayerFromFileStructure(f)
      }
    } else None
  }
  
  def getSegmentationLayers(f: File): List[SegmentationLayer] = {
    val segmentationsDir = new File(f.getPath + "/segmentation")
    if(segmentationsDir.isDirectory){
      (for{layerDir <- listDirectories(segmentationsDir).filter(_.getName.matches("""^layer[0-9]+$""")).toList
      } yield {
       val layerInfo = new File(layerDir.getPath + "/layer.json")
       if (layerInfo.isFile) {
         JsonFromFile(layerInfo).validate[ContextFreeSegmentationLayer] match {
           case JsSuccess(cfSegmentationLayer, _) => 
             val parentDir = layerInfo.getParentFile
             Logger.info(s"found segmentation layer: ${parentDir.getName}")
             val batchId = parentDir.getName.replaceFirst("layer", "").toIntOpt
             Some(cfSegmentationLayer.addContext(batchId getOrElse 0))
           case JsError(error) =>
             Logger.error(error.toString)
             None
         }
       } else None
      }).flatten
    } else Nil
  }

  def dataSetFromFile(f: File): Option[DataSet] = {
    if (f.isDirectory) {
      Logger.trace(s"dataSetFromFile: $f")
      val dataSetInfo = new File(f.getPath + "/settings.json")
      if (dataSetInfo.isFile) {
        JsonFromFile(dataSetInfo).validate[BareDataSet] match {
          case JsSuccess(bareDataSet, _) => 
          
          for{ colorLayer <- readColorLayerJson(f)      
          } yield bareDataSet.addLayers(f.getAbsolutePath, colorLayer, getSegmentationLayers(f))
          
          case JsError(error) =>
            Logger.error(error.toString)
            None
        }
      } else {
        createDataSetFromFileStructure(f)
      }
    } else None
  }
}
