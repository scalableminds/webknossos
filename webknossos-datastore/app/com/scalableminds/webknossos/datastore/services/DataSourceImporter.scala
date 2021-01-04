package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.{Point3D, Scale}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ExtendedTypes._
import com.scalableminds.webknossos.datastore.dataformats.MappingProvider
import com.scalableminds.webknossos.datastore.models.datasource._
import net.liftweb.common.Box

import java.nio.file.Path
import scala.collection.mutable.ArrayBuffer

case class DataSourceImportReport[A](ctx: A, messages: ArrayBuffer[(String, String)] = ArrayBuffer.empty) {

  def error(msg: A => String) = messages.append("error" -> msg(ctx))

  def warning(msg: A => String) = messages.append("warning" -> msg(ctx))

  def info(msg: A => String) = messages.append("info" -> msg(ctx))

  def withContext(f: A => A) = DataSourceImportReport(f(ctx), messages)
}

trait DataSourceImporter {

  def dataFileExtension: String

  protected def exploreLayer(name: String, baseDir: Path, previous: Option[DataLayer])(
      implicit report: DataSourceImportReport[Path]): Box[DataLayer]

  def exploreDataSource(id: DataSourceId,
                        baseDir: Path,
                        previous: Option[DataSource],
                        report: DataSourceImportReport[Path]): Box[DataSource] =
    PathUtils.listDirectories(baseDir).map { layerDirs =>
      val layers = layerDirs.flatMap { layerDir =>
        val layerName = layerDir.getFileName.toString
        val previousLayer = previous.flatMap(_.getDataLayer(layerName))
        exploreLayer(layerName, layerDir, previousLayer)(report.withContext(_.resolve(layerName)))
      }
      GenericDataSource(id,
                        layers,
                        previous.map(_.scale).getOrElse(Scale.default),
                        previous.flatMap(_.defaultViewConfiguration))
    }

  protected def guessLayerCategory(layerName: String, elementClass: ElementClass.Value)(
      implicit report: DataSourceImportReport[Path]): Category.Value = {
    val ColorRx = ".*color.*".r
    val MaskRx = ".*mask.*".r
    val SegmentationRx = ".*segmentation.*".r

    layerName match {
      case ColorRx() =>
        Category.color
      // TODO enable as soon as client has mask support
      //case MaskRx() =>
      //  Category.mask
      case SegmentationRx() =>
        Category.segmentation
      case _ =>
        report.warning(layer => s"Layer [$layer] - Falling back to elementClass for determining category")
        Category.fromElementClass(elementClass)
    }
  }

  protected def parseResolutionName(path: Path): Option[Either[Int, Point3D]] =
    path.getFileName.toString.toIntOpt match {
      case Some(resolutionInt) => Some(Left(resolutionInt))
      case None => {
        val pattern = """(\d+)-(\d+)-(\d+)""".r
        path.getFileName.toString match {
          case pattern(x, y, z) => Some(Right(Point3D(x.toInt, y.toInt, z.toInt)))
          case _                => None
        }
      }
    }

  protected def resolutionDirFilter(path: Path): Boolean = parseResolutionName(path).isDefined

  protected def resolutionDirSortingKey(path: Path) =
    parseResolutionName(path).get match {
      case Left(int)    => int
      case Right(point) => point.maxDim
    }

  protected def exploreMappings(baseDir: Path): Option[Set[String]] = MappingProvider.exploreMappings(baseDir)

}
