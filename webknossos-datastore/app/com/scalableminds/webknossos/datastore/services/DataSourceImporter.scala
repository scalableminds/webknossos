package com.scalableminds.webknossos.datastore.services

import java.nio.file.Path

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.webknossos.datastore.dataformats.MappingProvider
import com.scalableminds.webknossos.datastore.models.datasource._
import net.liftweb.common.Box

import scala.collection.mutable.ArrayBuffer

case class DataSourceImportReport[A](ctx: A, messages: ArrayBuffer[(String, String)] = ArrayBuffer.empty) {

  def error(msg: A => String): Unit = messages.append("error" -> msg(ctx))

  def warning(msg: A => String): Unit = messages.append("warning" -> msg(ctx))

  def info(msg: A => String): Unit = messages.append("info" -> msg(ctx))

  def withContext(f: A => A): DataSourceImportReport[A] = DataSourceImportReport(f(ctx), messages)
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
                        previous.map(_.scale).getOrElse(Vec3Double(0, 0, 0)),
                        previous.flatMap(_.defaultViewConfiguration))
    }

  protected def guessLayerCategory(layerName: String, elementClass: ElementClass.Value)(
      implicit report: DataSourceImportReport[Path]): Category.Value = {
    val ColorRx = ".*color.*".r
    val SegmentationRx = ".*segmentation.*".r

    layerName match {
      case ColorRx() =>
        Category.color
      case SegmentationRx() =>
        Category.segmentation
      case _ =>
        report.warning(layer => s"Layer [$layer] - Falling back to elementClass for determining category")
        Category.fromElementClass(elementClass)
    }
  }

  protected def magFromPath(path: Path): Option[Vec3Int] =
    Vec3Int.fromMagLiteral(path.getFileName.toString, allowScalar = true)

  protected def magDirFilter(path: Path): Boolean = magFromPath(path).isDefined

  protected def magDirSortingKey(path: Path): Int =
    magFromPath(path).get.maxDim

  protected def exploreMappings(baseDir: Path): Option[Set[String]] = MappingProvider.exploreMappings(baseDir)

}
