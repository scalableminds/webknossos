package brainflight.io

import java.io.File
import name.pachler.nio.file.Path
import name.pachler.nio.file.impl.PathImpl
import models.DataSet
import brainflight.tools.geometry.Point3D
import play.api.Logger
import brainflight.tools.ExtendedTypes._

class DataSetChangeHandler extends DirectoryChangeHandler {
  def onStart(path: Path) {
    val file = path.asInstanceOf[PathImpl].getFile

    file.listFiles().map { f =>
      if (f.isDirectory()) {
        dataSetFromFile(f).map { dataSet =>
          DataSet.updateOrCreate(dataSet)
        }
      }
    }
  }

  def onTick(path: Path) {
    onStart(path)
  }

  def onCreate(path: Path) {
    val file = path.asInstanceOf[PathImpl].getFile
    dataSetFromFile(file).map { dataSet =>
      DataSet.updateOrCreate(dataSet)
    }
  }

  def onDelete(path: Path) {
    val file = path.asInstanceOf[PathImpl].getFile
    dataSetFromFile(file).map { dataSet =>
      DataSet.removeByName(dataSet.name)
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

  def dataSetFromFile(f: File): Option[DataSet] = {
    if (f.isDirectory) {
      Logger.trace("dataSetFromFile: " + f)
      val resolutions = f.listFiles().filter(_.isDirectory).flatMap(_.getName.toIntOpt).toList
      (for {
        res <- highestResolutionDir(listDirectories(f))
        xs <- listDirectories(res).headOption
        ys <- listDirectories(xs).headOption
        maxX <- maxValueFromFiles(res.listFiles())
        maxY <- maxValueFromFiles(xs.listFiles())
        maxZ <- maxValueFromFiles(ys.listFiles())
      } yield {
        (maxX, maxY, maxZ)
      }) map { coords =>
        val maxCoordinates = Point3D(coords._1 * 128, coords._2 * 128, coords._3 * 128)
        DataSet(f.getName(), f.getAbsolutePath(), resolutions, maxCoordinates)
      }
    } else
      None
  }

}