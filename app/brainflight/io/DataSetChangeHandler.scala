package brainflight.io

import java.io.File
import name.pachler.nio.file.Path
import name.pachler.nio.file.impl.PathImpl
import models.DataSet
import brainflight.tools.geometry.Point3D
import play.api.Logger

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

  def isNumber(s: String) = {
    try {
      s.toInt
      true
    } catch {
      case e: NumberFormatException =>
        false
    }
  }

  def listDirectories(f: File) = {
    f.listFiles().filter(_.isDirectory())
  }

  def dataSetFromFile(f: File): Option[DataSet] = {
    if (f.isDirectory()) {
      Logger.trace("dataSetFromFile: " + f)
      val resolutions = f.listFiles().filter(f => f.isDirectory() && isNumber(f.getName())).map(_.getName().toInt).toList

      (for {
        res <- listDirectories(f).headOption
        xs <- listDirectories(res).headOption
        ys <- listDirectories(xs).headOption
      } yield {
        // TODO: improve size calculation
        (res.listFiles().filter(_.getName.startsWith("x")).size,
          xs.listFiles().filter(_.getName.startsWith("y")).size,
          ys.listFiles().filter(_.getName.startsWith("z")).size)
      }) map { coords =>
        val maxCoordinates = Point3D(coords._1 * 128, coords._2 * 128, coords._3 * 128)
        DataSet(f.getName(), f.getAbsolutePath(), resolutions, maxCoordinates)
      }
    } else
      None
  }

}